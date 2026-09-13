'use strict';

const express = require('express');
const config = require('../config');
const db = require('../db');
const orders = require('../lib/orders');
const payments = require('../payments');
const audit = require('../lib/audit');
const ratelimit = require('../lib/ratelimit');
const util = require('../lib/util');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'unauthenticated', message: 'Войдите, чтобы оформить заказ.' , redirect: '/login' });
  next();
}

router.get('/plans', (req, res) => {
  const status = db.setting('site.status', 'online');
  res.json({
    ok: true,
    currency: config.payments.currency,
    sales_open: status !== 'maintenance',
    plans: config.plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      subtitle: p.subtitle,
      days: p.days,
      price: p.price,
      old_price: p.oldPrice,
      price_label: util.money(orders.minor(p.price), config.payments.currency),
      old_price_label: p.oldPrice ? util.money(orders.minor(p.oldPrice), config.payments.currency) : null,
      per_day: (p.price / p.days).toFixed(1),
      badge: p.badge,
      accent: p.accent,
      features: p.features
    }))
  });
});

router.get('/methods', (req, res) => {
  res.json({ ok: true, methods: payments.list(), default: config.payments.defaultMethod });
});

router.post('/quote', (req, res) => {
  const q = orders.quote(String(req.body?.plan || ''), String(req.body?.coupon || '').trim() || null, req.user || null);
  if (!q) return res.status(404).json({ ok: false, error: 'unknown_plan' });
  res.json({
    ok: true,
    base: q.base,
    discount: q.discount,
    total: q.total,
    currency: q.currency,
    base_label: util.money(q.base, q.currency),
    discount_label: q.discount ? '−' + util.money(q.discount, q.currency) : null,
    total_label: util.money(q.total, q.currency),
    coupon: q.coupon,
    coupon_error: q.coupon_error
  });
});

router.post('/checkout', requireAuth, ratelimit.middleware({ scope: 'checkout', limit: 12, windowMs: 300_000 }), async (req, res) => {
  const plan = String(req.body?.plan || '');
  const method = String(req.body?.method || config.payments.defaultMethod);
  const coupon = String(req.body?.coupon || '').trim() || null;

  if (!config.planByCode[plan]) return res.status(400).json({ ok: false, error: 'unknown_plan', message: 'Неизвестный тариф.' });
  if (req.user.status === 'banned') return res.status(403).json({ ok: false, error: 'banned', message: 'Аккаунт заблокирован.' });
  if (db.setting('site.status', 'online') === 'maintenance') {
    return res.status(503).json({ ok: false, error: 'maintenance', message: db.setting('maintenance.message', 'Технические работы.') });
  }

  let order;
  try {
    order = orders.create({ user: req.user, planCode: plan, method, couponCode: coupon, ip: util.clientIp(req) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message, message: err.message === 'method_disabled' ? 'Способ оплаты недоступен.' : 'Не удалось создать заказ.' });
  }

  const returnUrl = `${config.publicUrl}/checkout/result/${order.public_id}`;
  const webhookUrl = payments.webhookUrlFor(method);

  try {
    const checkout = await payments.createCheckout({ order, user: req.user, method, returnUrl, webhookUrl });
    const updated = orders.setStatus(order, 'pending', { checkout_url: checkout.paymentUrl, gateway_payment_id: checkout.gatewayPaymentId });
    audit.log('user', req.user.id, 'order.checkout_created', { targetType: 'order', targetId: order.public_id, meta: { method, url: checkout.paymentUrl } , ip: util.clientIp(req) });
    res.json({ ok: true, order: updated.public_id, redirect: checkout.paymentUrl, amount_label: util.money(order.amount, order.currency) });
  } catch (err) {
    orders.recordEvent(order.id, method, 'checkout_error', { message: err.message, status: err.status, payload: err.payload }, util.clientIp(req));
    orders.setStatus(order, 'failed');
    audit.log('system', req.user.id, 'order.checkout_failed', { targetType: 'order', targetId: order.public_id, meta: { method, error: err.message }, ip: util.clientIp(req) });
    res.status(err.status || 502).json({
      ok: false,
      error: 'gateway_error',
      message: err.message === 'method_not_configured'
        ? 'Этот способ оплаты ещё не настроен. Выберите песочницу или другой метод.'
        : `Платёжный шлюз недоступен: ${err.message}`
    });
  }
});

router.get('/orders/:pid', requireAuth, (req, res) => {
  const order = orders.byPublicId(req.params.pid);
  if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
  const isOwner = order.user_id === req.user.id;
  const isStaff = req.user.is_admin || ['admin', 'owner'].includes(req.user.role);
  if (!isOwner && !isStaff) return res.status(403).json({ ok: false, error: 'forbidden' });

  const lic = db.get('SELECT id, license_key, plan_code, status, expires_at, loader_login FROM licenses WHERE order_id = ?', order.id);
  res.json({
    ok: true,
    order: {
      ...order,
      amount_label: util.money(order.amount, order.currency),
      created_label: util.formatDate(order.created_at),
      paid_label: order.paid_at ? util.formatDate(order.paid_at) : null
    },
    license: lic ? licenseSvcState(lic) : null,
    events: db.all('SELECT gateway, event, created_at FROM payment_events WHERE order_id = ? ORDER BY id DESC LIMIT 20', order.id)
  });
});

function licenseSvcState(lic) {
  const licenseSvc = require('../lib/license');
  const st = licenseSvc.state(lic);
  return {
    id: lic.id, license_key: lic.license_key, plan_code: lic.plan_code,
    status: st.status, expires_at: lic.expires_at, remaining_label: st.days_left_label
  };
}

router.post('/orders/:pid/cancel', requireAuth, (req, res) => {
  const order = orders.byPublicId(req.params.pid);
  if (!order || order.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'not_found' });
  if (order.status === 'paid') return res.status(409).json({ ok: false, error: 'already_paid', message: 'Заказ уже оплачен.' });
  orders.cancel(order, { actor: 'user', actorId: req.user.id, ip: util.clientIp(req) });
  res.json({ ok: true, message: 'Заказ отменён.' });
});

module.exports = router;
