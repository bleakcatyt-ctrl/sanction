'use strict';
/**
 * Клиент RollyPay (https://docs.rollypay.io).
 *  - POST /api/v1/payments  (X-API-Key + уникальный X-Nonce) → pay_url
 *  - GET  /api/v1/payments/{id}
 *  - Вебхуки: X-Signature = HMAC-SHA256(signing_secret, timestamp + "." + rawBody), X-Timestamp
 * Ключ кассы и signing_secret читаются только из конфигурации вне проекта и в браузер не попадают.
 */
const crypto = require('node:crypto');
const config = require('./config');
const { safeEqual, randomToken } = require('./lib');

const WEBHOOK_TOLERANCE_SEC = 15 * 60;
const fakePayments = new Map(); // только DEV_FAKE_PAYMENTS

class GatewayError extends Error {}

async function api(method, path, body) {
  const { baseUrl, apiKey } = config.rollypay;
  if (!apiKey) throw new GatewayError('Платёжный шлюз не настроен');
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': apiKey,
      'X-Nonce': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
    redirect: 'error',
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text.slice(0, 200_000)); } catch { /* не JSON */ }
  if (!res.ok) {
    console.error(`[rollypay] ${method} ${path} → ${res.status}`, text.slice(0, 300));
    throw new GatewayError('Платёжный шлюз вернул ошибку ' + res.status);
  }
  return json;
}

/** pay_url обязан вести на домен RollyPay — иначе подмена ссылки превратилась бы в фишинг. */
function assertPayUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new GatewayError('Некорректная ссылка на оплату'); }
  if (config.rollypay.fake) {
    if (url.origin !== new URL(config.appUrl).origin) throw new GatewayError('Некорректная ссылка на оплату');
    return url.toString();
  }
  const host = url.hostname.toLowerCase();
  const ok = url.protocol === 'https:' && config.rollypay.payHostSuffixes.some((s) => host === s || host.endsWith('.' + s));
  if (!ok) throw new GatewayError('Ссылка на оплату не принадлежит платёжному шлюзу');
  return url.toString();
}

async function createPayment({ amount, orderId, description, customerId, successUrl, failUrl, metadata }) {
  if (config.rollypay.fake) {
    const id = 'pay_fake_' + randomToken(9);
    fakePayments.set(id, { payment_id: id, order_id: orderId, status: 'created', amount, payment_currency: 'RUB', test: true });
    return { payment_id: id, order_id: orderId, status: 'created', pay_url: `${config.appUrl}/dev/pay/${encodeURIComponent(orderId)}`, amount };
  }
  const payload = {
    amount,
    payment_currency: 'RUB',
    order_id: orderId,
    description,
    customer_id: customerId,
    success_redirect_url: successUrl,
    fail_redirect_url: failUrl,
    metadata,
  };
  if (config.rollypay.testMode) payload.test = true;
  const r = await api('POST', '/api/v1/payments', payload);
  if (!r.payment_id || !r.pay_url) throw new GatewayError('Неожиданный ответ платёжного шлюза');
  return r;
}

async function getPayment(paymentId) {
  if (config.rollypay.fake) return fakePayments.get(paymentId) || null;
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(paymentId)) throw new GatewayError('Некорректный payment_id');
  return api('GET', `/api/v1/payments/${encodeURIComponent(paymentId)}`);
}

function sign(timestamp, rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Проверка подписи вебхука в постоянное время + окно по времени от replay. */
function verifyWebhook(rawBody, headers, secret = config.rollypay.signingSecret) {
  if (!secret) return false;
  const signature = String(headers['x-signature'] || '');
  const timestamp = String(headers['x-timestamp'] || '');
  if (!signature || !/^\d{9,13}$/.test(timestamp)) return false;
  let ts = Number(timestamp);
  if (ts > 1e12) ts = Math.floor(ts / 1000);
  if (Math.abs(Date.now() / 1000 - ts) > WEBHOOK_TOLERANCE_SEC) return false;
  return safeEqual(sign(timestamp, rawBody, secret), signature.toLowerCase());
}

function fakeSetStatus(paymentId, status) {
  const p = fakePayments.get(paymentId);
  if (p) p.status = status;
}

module.exports = { createPayment, getPayment, verifyWebhook, sign, assertPayUrl, GatewayError, fakeSetStatus };
