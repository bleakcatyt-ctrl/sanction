'use strict';

/**
 * Lava.ru — RUB card / SBP / crypto gateway popular with digital-goods stores.
 *
 * Set LAVA_PROJECT_ID + LAVA_SECRET_KEY to enable.
 * NOTE: field names below follow the public Lava.ru API. If your project uses a
 * different revision, adjust `mapInvoice` / `parseWebhook` — the provisioning
 * pipeline does not change.
 */

const crypto = require('node:crypto');
const config = require('../config');
const orders = require('../lib/orders');

const id = 'lava';
const cfg = () => config.payments.lava;

function ready() {
  return Boolean(cfg().projectId && cfg().secretKey);
}

function available() {
  return config.payments.enabled.includes(id) && ready();
}

function describe() {
  return {
    id,
    label: 'Lava.ru',
    hint: 'Карты РФ, СБП, криптовалюта. Работает без юрлица.',
    icon: 'card',
    fee: 'от 3,5 %',
    requiresSetup: true,
    ready: ready()
  };
}

async function createCheckout({ order, user, returnUrl, webhookUrl }) {
  const body = {
    wallet: cfg().projectId,
    payment_method: 'card',
    sum: orders.rubles(order.amount).toFixed(2),
    order_id: order.public_id,
    comment: `Sanction ${order.plan_code}`,
    return_url: returnUrl,
    webhook_url: webhookUrl,
    customer_email: user.email,
    lifetime: String(Math.floor(orders.ORDER_TTL_MIN / 60))
  };

  const auth = Buffer.from(`${cfg().projectId}:${cfg().secretKey}`).toString('base64');
  const res = await fetch(`${cfg().apiUrl}/payment/invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || json?.message || `lava_http_${res.status}`;
    throw Object.assign(new Error(message), { gateway: id, status: res.status, payload: json });
  }
  return mapInvoice(json);
}

function mapInvoice(json) {
  const data = json?.data ?? json;
  return {
    paymentUrl: data?.url ?? data?.payment_url ?? data?.link ?? null,
    gatewayPaymentId: data?.invoice_id ?? data?.id ?? null,
    meta: data
  };
}

/**
 * Lava signs webhooks with an HMAC/MD5 of the sorted payload + secret.
 * We accept both schemes and fail closed when the secret is missing.
 */
function verifySignature(req) {
  if (!ready()) return false;
  const body = { ...(req.body || {}) };
  const provided = String(body.auth_key || body.sign || req.get('x-auth-key') || '');
  if (!provided) return false;
  delete body.auth_key;
  delete body.sign;

  const pairs = Object.keys(body).sort().filter((k) => body[k] !== '' && body[k] !== null && body[k] !== undefined);

  const md5Source = pairs.map((k) => body[k]).join(':') + ':' + cfg().secretKey;
  const md5 = crypto.createHash('md5').update(md5Source).digest('hex');

  const hmacSource = pairs.map((k) => `${k}=${body[k]}`).join('&');
  const hmac = crypto.createHmac('sha256', cfg().secretKey).update(hmacSource).digest('hex');
  const hmacMd5 = crypto.createHmac('md5', cfg().secretKey).update(hmacSource).digest('hex');

  const candidates = [md5, hmac, hmacMd5].map((s) => s.toLowerCase());
  return candidates.includes(provided.toLowerCase());
}

function parseWebhook(req) {
  const body = req.body || {};
  const publicId = String(body.order_id || body.orderId || body.invoice_id || '');
  const order = publicId ? orders.byPublicId(publicId) : null;
  const statusRaw = String(body.status || body.status_name || '').toLowerCase();
  let status = 'pending';
  if (['paid', 'success', 'succeeded', '1', 'completed'].includes(statusRaw)) status = 'paid';
  else if (['fail', 'failed', 'canceled', 'cancelled', 'error'].includes(statusRaw)) status = 'failed';

  return {
    event: statusRaw || 'webhook',
    order,
    orderId: order ? order.id : null,
    publicId,
    status,
    gatewayPaymentId: String(body.invoice_id || body.payment_id || body.transaction_id || '') || null,
    amount: Math.round(Number(body.sum || body.amount || body.amount_rub || 0) * 100),
    currency: String(body.currency || config.payments.currency),
    raw: body,
    signatureValid: verifySignature(req)
  };
}

module.exports = { id, available, ready, describe, createCheckout, parseWebhook, verifySignature };
