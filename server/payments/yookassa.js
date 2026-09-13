'use strict';

/**
 * ЮKassa (YooMoney) — official REST API v3.
 * Set YOOKASSA_SHOP_ID + YOOKASSA_SECRET_KEY to enable.
 *
 * YooKassa does not sign webhooks; the documented protections are
 * (a) source-IP allowlist and (b) HTTP Basic auth on the webhook URL.
 * Both are implemented below — put the credentials into your YooKassa
 * "HTTP-уведомления" settings.
 */

const config = require('../config');
const orders = require('../lib/orders');

const id = 'yookassa';
const cfg = () => config.payments.yookassa;

const IP_ALLOWLIST = (process.env.YOOKASSA_WEBHOOK_IPS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const WEBHOOK_USER = process.env.YOOKASSA_WEBHOOK_USER || '';
const WEBHOOK_PASS = process.env.YOOKASSA_WEBHOOK_PASS || '';

function ready() { return Boolean(cfg().shopId && cfg().secretKey); }
function available() { return config.payments.enabled.includes(id) && ready(); }

function describe() {
  return {
    id,
    label: 'ЮKassa',
    hint: 'Карты РФ, СБП, ЮMoney. Требуется договор и shopId.',
    icon: 'bank',
    fee: 'от 2,8 %',
    requiresSetup: true,
    ready: ready()
  };
}

async function createCheckout({ order, user, returnUrl, webhookUrl }) {
  const auth = Buffer.from(`${cfg().shopId}:${cfg().secretKey}`).toString('base64');
  const idempotenceKey = `snc-${order.public_id}`;

  const body = {
    amount: { value: orders.rubles(order.amount).toFixed(2), currency: order.currency === 'RUB' ? 'RUB' : order.currency },
    description: `Sanction — ${order.plan_code}`,
    metadata: { order_id: order.public_id, plan: order.plan_code, user_id: String(order.user_id) },
    confirmation: { type: 'redirect', return_url: returnUrl },
    receipt: {
      customer: { email: user.email },
      items: [{
        description: `Подписка Sanction ${order.plan_code}`,
        quantity: '1',
        amount: { value: orders.rubles(order.amount).toFixed(2), currency: 'RUB' },
        vat_code: 1,
        payment_mode: 'full_payment',
        payment_subject: 'service'
      }]
    },
    ...(webhookUrl ? { notification_url: webhookUrl } : {})
  };

  const res = await fetch(`${cfg().apiUrl}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
      'Idempotence-Key': idempotenceKey
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(json?.description || `yookassa_http_${res.status}`), { gateway: id, status: res.status, payload: json });
  }
  return {
    paymentUrl: json?.confirmation?.confirmation_url || null,
    gatewayPaymentId: json?.id || null,
    meta: json
  };
}

/** Exact IP or "a.b.c." prefix match — good enough for a gateway allowlist. */
function ipMatches(ip, entry) {
  if (ip === entry) return true;
  if (entry.endsWith('/')) return ip.startsWith(entry);
  if (entry.endsWith('.')) return ip.startsWith(entry);
  return false;
}

/** IP allowlist + optional HTTP Basic auth, as documented by YooKassa. */
function verifySignature(req) {
  const ip = String(req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '');
  const bare = ip.replace(/^::ffff:/, '');
  if (IP_ALLOWLIST.length && !IP_ALLOWLIST.some((entry) => ipMatches(bare, entry))) return false;
  if (WEBHOOK_USER && WEBHOOK_PASS) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const [u, p] = decoded.split(':');
    if (u !== WEBHOOK_USER || p !== WEBHOOK_PASS) return false;
  }
  // If neither protection is configured we fail closed — never trust blindly.
  return IP_ALLOWLIST.length > 0 || Boolean(WEBHOOK_USER && WEBHOOK_PASS);
}

function parseWebhook(req) {
  const body = req.body || {};
  const obj = body.object || {};
  const publicId = String(obj.metadata?.order_id || '');
  const order = publicId ? orders.byPublicId(publicId) : null;
  const event = String(body.event || '');

  let status = 'pending';
  if (event === 'payment.succeeded' || obj.status === 'succeeded') status = 'paid';
  else if (event === 'payment.canceled' || obj.status === 'canceled') status = 'failed';
  else if (event === 'payment.waiting_for_capture') status = 'pending';
  else if (event === 'refund.succeeded') status = 'refunded';

  return {
    event,
    order,
    orderId: order ? order.id : null,
    publicId,
    status,
    gatewayPaymentId: obj.id || null,
    amount: Math.round(Number(obj.amount?.value ?? 0) * 100),
    currency: obj.amount?.currency || config.payments.currency,
    raw: body,
    signatureValid: verifySignature(req)
  };
}

module.exports = { id, available, ready, describe, createCheckout, parseWebhook, verifySignature };
