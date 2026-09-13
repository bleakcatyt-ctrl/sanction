'use strict';

/**
 * ENOT.io — RUB aggregator (cards / SBP / crypto), classic MD5 sign scheme.
 * Set ENOT_PROJECT_ID, ENOT_WALLET, ENOT_SECRET_KEY1, ENOT_SECRET_KEY2.
 */

const crypto = require('node:crypto');
const config = require('../config');
const orders = require('../lib/orders');

const id = 'enot';
const cfg = () => config.payments.enot;

function ready() { return Boolean(cfg().projectId && cfg().wallet && cfg().secretKey1 && cfg().secretKey2); }
function available() { return config.payments.enabled.includes(id) && ready(); }

function describe() {
  return {
    id,
    label: 'ENOT.io',
    hint: 'Карты РФ, СБП, крипта. Подключение за один день.',
    icon: 'wallet',
    fee: 'от 3 %',
    requiresSetup: true,
    ready: ready()
  };
}

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

async function createCheckout({ order, user, returnUrl, webhookUrl }) {
  const amount = orders.rubles(order.amount).toFixed(2);
  // sign = md5(projectId:amount:orderId:secret1)
  const sign = md5(`${cfg().projectId}:${amount}:${order.public_id}:${cfg().secretKey1}`);

  const params = new URLSearchParams({
    merchant_id: cfg().projectId,
    wallet: cfg().wallet,
    amount,
    order_id: order.public_id,
    sign,
    comment: `Sanction ${order.plan_code}`,
    us: encodeURIComponent(user.email),
    success_url: returnUrl || '',
    fail_url: returnUrl || '',
    ...(webhookUrl ? { notify_url: webhookUrl } : {})
  });

  // ENOT opens a payment form; we hand the browser a GET URL.
  return {
    paymentUrl: `${cfg().apiUrl}/payment/form?${params.toString()}`,
    gatewayPaymentId: null,
    meta: { order_id: order.public_id, amount, sign }
  };
}

function verifySignature(req) {
  if (!ready()) return false;
  const b = req.body || {};
  const provided = String(b.sign || '').toLowerCase();
  if (!provided) return false;
  // notify sign = md5(merchant_id:amount:order_id:secret2)
  const expected = md5(`${b.merchant_id}:${b.amount}:${b.order_id}:${cfg().secretKey2}`).toLowerCase();
  if (provided === expected) return true;
  // some revisions send int_amount
  const alt = md5(`${b.merchant_id}:${b.int_amount}:${b.order_id}:${cfg().secretKey2}`).toLowerCase();
  return provided === alt;
}

function parseWebhook(req) {
  const b = req.body || {};
  const publicId = String(b.order_id || '');
  const order = publicId ? orders.byPublicId(publicId) : null;
  const statusRaw = String(b.status || b.status_name || '').toLowerCase();

  let status = 'pending';
  if (['paid', 'success', 'completed'].includes(statusRaw)) status = 'paid';
  else if (['fail', 'failed', 'canceled', 'cancelled'].includes(statusRaw)) status = 'failed';

  return {
    event: statusRaw || 'webhook',
    order,
    orderId: order ? order.id : null,
    publicId,
    status,
    gatewayPaymentId: String(b.invoice_id || b.payment_id || b.transaction_id || '') || null,
    amount: Math.round(Number(b.amount || 0) * 100),
    currency: String(b.currency || config.payments.currency),
    raw: b,
    signatureValid: verifySignature(req)
  };
}

module.exports = { id, available, ready, describe, createCheckout, parseWebhook, verifySignature };
