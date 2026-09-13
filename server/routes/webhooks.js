'use strict';

/**
 * Payment webhooks + the sandbox confirmation endpoint.
 * CSRF is disabled here (gateways call us server-to-server); instead every
 * gateway adapter must positively verify its own signature, and we fail closed.
 */

const express = require('express');
const config = require('../config');
const payments = require('../payments');
const orders = require('../lib/orders');
const audit = require('../lib/audit');
const ratelimit = require('../lib/ratelimit');
const util = require('../lib/util');

const router = express.Router();

function sandboxSign(publicId) {
  return util.hmacSha256(config.secrets.session, `sandbox|${publicId}`).slice(0, 32);
}

router.post('/webhook/:method',
  ratelimit.middleware({ scope: 'webhook', limit: 120, windowMs: 60_000, keyFn: (req) => req.params.method }),
  (req, res) => {
    req.skipCsrf = true;
    const method = String(req.params.method || '').toLowerCase();
    const gw = payments.get(method);
    const ip = util.clientIp(req);

    if (!gw) {
      audit.log('gateway', null, 'webhook.unknown_method', { meta: { method }, ip });
      return res.status(404).json({ ok: false, error: 'unknown_method' });
    }
    if (!config.payments.enabled.includes(method)) {
      return res.status(403).json({ ok: false, error: 'method_disabled' });
    }

    let event;
    try {
      event = gw.parseWebhook(req);
    } catch (err) {
      audit.log('gateway', null, 'webhook.parse_error', { meta: { method, error: err.message }, ip });
      return res.status(400).json({ ok: false, error: 'bad_payload' });
    }

    orders.recordEvent(event.orderId, method, event.event || 'webhook', event.raw, ip);

    if (event.signatureValid === false) {
      audit.log('gateway', null, 'webhook.signature_invalid', { meta: { method, order: event.publicId }, ip });
      return res.status(401).json({ ok: false, error: 'signature_invalid' });
    }
    if (!event.order) {
      audit.log('gateway', null, 'webhook.order_not_found', { meta: { method, order: event.publicId }, ip });
      return res.status(404).json({ ok: false, error: 'order_not_found' });
    }
    if (event.amount && event.order.amount !== event.amount) {
      audit.log('gateway', event.order.id, 'webhook.amount_mismatch', {
        targetType: 'order', targetId: event.order.public_id,
        meta: { expected: event.order.amount, got: event.amount, method }, ip
      });
      return res.status(400).json({ ok: false, error: 'amount_mismatch' });
    }

    try {
      if (event.status === 'paid') {
        const result = orders.markPaid(event.order, { gateway: method, gatewayPaymentId: event.gatewayPaymentId, ip, raw: event.raw });
        audit.log('system', null, 'webhook.provisioned', {
          targetType: 'order', targetId: event.order.public_id,
          meta: { method, stacked: result.stacked, license_id: result.license?.id, alreadyPaid: !!result.alreadyPaid }, ip
        });
      } else if (event.status === 'failed') {
        orders.setStatus(event.order, 'failed');
      } else if (event.status === 'refunded') {
        orders.refund(event.order, { reason: 'gateway_refund', actor: 'system', ip });
      } else {
        orders.setStatus(event.order, 'pending', { gateway_payment_id: event.gatewayPaymentId || event.order.gateway_payment_id });
      }
    } catch (err) {
      audit.log('system', null, 'webhook.provision_error', { meta: { method, order: event.publicId, error: err.message }, ip });
      return res.status(500).json({ ok: false, error: 'provision_failed' });
    }

    // Gateways differ in what they accept; plain 200 + ok flag satisfies all of them.
    res.json({ ok: true, status: 'processed' });
  });

/** Sandbox payment page confirmation — signature-bound to the order id. */
router.post('/sandbox/:pid/confirm', (req, res) => {
  req.skipCsrf = true;
  const pid = String(req.params.pid || '');
  const order = orders.byPublicId(pid);
  if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
  if (order.method !== 'sandbox') return res.status(400).json({ ok: false, error: 'not_sandbox' });

  const provided = String(req.body?.s || req.query?.s || '');
  const ownerConfirmed = req.user && req.user.id === order.user_id;
  if (!ownerConfirmed && !util.safeEqual(provided, sandboxSign(pid))) {
    audit.log('system', null, 'sandbox.confirm_rejected', { targetType: 'order', targetId: pid, ip: util.clientIp(req) });
    return res.status(403).json({ ok: false, error: 'bad_signature' });
  }
  if (order.status === 'paid') return res.json({ ok: true, already: true, redirect: `/checkout/result/${pid}` });

  const status = String(req.body?.status || 'paid');
  if (status === 'failed') {
    orders.setStatus(order, 'failed');
    orders.recordEvent(order.id, 'sandbox', 'failed', { manual: true }, util.clientIp(req));
    return res.json({ ok: true, redirect: `/checkout/result/${pid}` });
  }

  const result = orders.markPaid(order, { gateway: 'sandbox', gatewayPaymentId: `sbx_${pid}`, ip: util.clientIp(req), raw: { sandbox: true } });
  audit.log('system', null, 'sandbox.confirmed', { targetType: 'order', targetId: pid, meta: { license_id: result.license?.id, stacked: result.stacked }, ip: util.clientIp(req) });
  res.json({ ok: true, redirect: `/checkout/result/${pid}` });
});

module.exports = router;
module.exports.sandboxSign = sandboxSign;
