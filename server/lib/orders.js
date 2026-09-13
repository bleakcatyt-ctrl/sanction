'use strict';

/**
 * Order / checkout domain: quoting with coupons, order creation, provisioning
 * once a gateway confirms payment, refunds.
 */

const db = require('../db');
const config = require('../config');
const audit = require('./audit');
const licenseSvc = require('./license');
const util = require('./util');

const { now, randomId } = util;
const MINUTE = 60_000;
const ORDER_TTL_MIN = 45;

function minor(rubles) { return Math.round(Number(rubles) * 100); }
function rubles(minorUnits) { return (Number(minorUnits) || 0) / 100; }

/* ------------------------------------------------------------- coupons ---- */

function findCoupon(code) {
  if (!code) return null;
  return db.get('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE', String(code).trim());
}

function couponIsValid(coupon, user, planCode) {
  if (!coupon || !coupon.active) return { ok: false, reason: 'coupon_not_found' };
  if (coupon.expires_at && coupon.expires_at < now()) return { ok: false, reason: 'coupon_expired' };
  if (coupon.plan_code && coupon.plan_code !== planCode) return { ok: false, reason: 'coupon_plan_mismatch' };
  if (coupon.max_uses > 0 && coupon.used >= coupon.max_uses) return { ok: false, reason: 'coupon_exhausted' };
  if (user && coupon.per_user > 0) {
    const used = db.pluck('SELECT COUNT(*) FROM coupon_uses WHERE coupon_id = ? AND user_id = ?', coupon.id, user.id) || 0;
    if (used >= coupon.per_user) return { ok: false, reason: 'coupon_used' };
  }
  return { ok: true };
}

/** Price quote for a plan, optionally with a coupon. All values in minor units. */
function quote(planCode, couponCode = null, user = null) {
  const plan = config.planByCode[planCode];
  if (!plan) return null;
  const base = minor(plan.price);
  let discount = 0;
  let coupon = null;
  let couponError = null;

  if (couponCode) {
    coupon = findCoupon(couponCode);
    const check = couponIsValid(coupon, user, planCode);
    if (!check.ok) { couponError = check.reason; coupon = null; }
    else {
      discount = coupon.kind === 'percent'
        ? Math.round(base * Math.min(90, coupon.value) / 100)
        : Math.min(base, minor(coupon.value));
    }
  }
  return {
    plan,
    base,
    discount,
    total: Math.max(0, base - discount),
    currency: config.payments.currency,
    coupon: coupon ? { code: coupon.code, kind: coupon.kind, value: coupon.value } : null,
    coupon_error: couponError
  };
}

/* -------------------------------------------------------------- orders ---- */

function create({ user, planCode, method, couponCode = null, ip = null }) {
  const q = quote(planCode, couponCode, user);
  if (!q) throw new Error('unknown_plan');
  if (!config.payments.enabled.includes(method)) throw new Error('method_disabled');

  const publicId = 'ORD-' + randomId('').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);
  const t = now();
  const res = db.run(
    `INSERT INTO orders (public_id, user_id, plan_code, amount, currency, discount, coupon_code, method, status, created_at, expires_at, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`,
    publicId, user.id, planCode, q.total, q.currency, q.discount, q.coupon ? q.coupon.code : null, method,
    t, t + ORDER_TTL_MIN * MINUTE, ip
  );
  const order = byId(res.id);
  audit.log('user', user.id, 'order.created', { targetType: 'order', targetId: order.public_id, meta: { plan: planCode, amount: q.total, method }, ip });
  return order;
}

function byId(id) { return db.get('SELECT * FROM orders WHERE id = ?', id); }
function byPublicId(pid) { return db.get('SELECT * FROM orders WHERE public_id = ?', pid); }
function byUser(userId, limit = 50) {
  return db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
}
function all({ limit = 100, offset = 0, status = '', search = '' } = {}) {
  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (search) { where.push('(public_id LIKE ? OR plan_code LIKE ? OR CAST(user_id AS TEXT) = ?)'); params.push(`%${search}%`, `%${search}%`, /^\d+$/.test(search) ? search : '-1'); }
  return db.all(
    `SELECT o.*, u.username FROM orders o LEFT JOIN users u ON u.id = o.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
}
function countAll({ status = '', search = '' } = {}) {
  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (search) { where.push('(public_id LIKE ? OR plan_code LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  return db.pluck(`SELECT COUNT(*) FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params) || 0;
}

function setStatus(order, status, extra = {}) {
  const fields = ['status = ?'];
  const params = [status];
  for (const [k, v] of Object.entries(extra)) { fields.push(`${k} = ?`); params.push(v); }
  params.push(order.id);
  db.run(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, ...params);
  return byId(order.id);
}

function recordEvent(orderId, gateway, event, payload, ip = null) {
  db.run('INSERT INTO payment_events (order_id, gateway, event, payload, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    orderId, gateway, event, util.jsonStringify(payload), ip, now());
}

/**
 * Idempotent "payment confirmed" handler.
 * Stacks days onto an existing license when the user already owns one,
 * otherwise provisions a brand-new license with a fresh login/password pair.
 */
function markPaid(order, { gateway = 'manual', gatewayPaymentId = null, actor = 'gateway', actorId = null, ip = null, raw = null } = {}) {
  if (!order) throw new Error('order_not_found');
  if (order.status === 'paid') return { order: byId(order.id), stacked: false, alreadyPaid: true };
  if (['refunded', 'cancelled'].includes(order.status)) throw new Error(`order_${order.status}`);

  const result = db.transaction(() => {
    const paidAt = now();
    let updated = setStatus(order, 'paid', { paid_at: paidAt, ...(gatewayPaymentId ? { gateway_payment_id: gatewayPaymentId } : {}) });

    if (order.discount > 0 && order.coupon_code) {
      const coupon = findCoupon(order.coupon_code);
      if (coupon) {
        db.run('UPDATE coupons SET used = used + 1 WHERE id = ?', coupon.id);
        db.run('INSERT INTO coupon_uses (coupon_id, user_id, order_id, created_at) VALUES (?, ?, ?, ?)', coupon.id, order.user_id, order.id, paidAt);
      }
    }

    const plan = config.planByCode[order.plan_code];
    const stackMode = db.setting('billing.stack_purchases', 'extend'); // extend | new
    const existing = db.get(
      `SELECT * FROM licenses WHERE user_id = ? AND plan_code = ? AND status IN ('pending','active','expired')
       ORDER BY (expires_at IS NULL) DESC, expires_at DESC LIMIT 1`,
      order.user_id, order.plan_code
    );

    let license; let password = null; let stacked = false;

    if (existing && stackMode === 'extend') {
      license = licenseSvc.extend(existing, plan.days, { actor, actorId, ip, note: `order ${order.public_id}` });
      stacked = true;
    } else {
      const issued = licenseSvc.issue({
        userId: order.user_id, orderId: order.id, planCode: order.plan_code,
        actor, ip, activateNow: licenseSvc.activationMode() === 'on_purchase'
      });
      license = issued.license; password = issued.password;
    }

    db.run('UPDATE users SET status = ? WHERE id = ? AND status = ?', 'active', order.user_id, 'pending');
    recordEvent(order.id, gateway, 'paid', raw ?? { gateway_payment_id: gatewayPaymentId }, ip);
    audit.log(actor === 'gateway' ? 'system' : actor, actorId ?? null, 'order.paid', {
      targetType: 'order', targetId: order.public_id, meta: { amount: order.amount, plan: order.plan_code, gateway, stacked, license_id: license.id }, ip
    });
    licenseSvc.notify(order.user_id, stacked ? 'Подписка продлена' : 'Оплата прошла',
      stacked
        ? `Заказ ${order.public_id}: добавлено ${plan.days} дн. Доступ до ${util.formatDate(license.expires_at)}.`
        : `Заказ ${order.public_id}: ключ ${plan.code} выдан. Логин и пароль лоадера — в личном кабинете.`,
      '/dashboard/license', 'success');

    return { order: updated, license, password, stacked };
  });

  return result;
}

function refund(order, { reason = 'refund', actor = 'admin', actorId = null, ip = null } = {}) {
  return db.transaction(() => {
    const updated = setStatus(order, 'refunded', {});
    const lic = db.get('SELECT * FROM licenses WHERE order_id = ?', order.id);
    if (lic) licenseSvc.revoke(lic, reason, { actor, actorId, ip });
    recordEvent(order.id, 'manual', 'refunded', { reason }, ip);
    audit.log(actor, actorId, 'order.refunded', { targetType: 'order', targetId: order.public_id, meta: { reason }, ip });
    licenseSvc.notify(order.user_id, 'Возврат по заказу', `Заказ ${order.public_id} возвращён. Доступ отозван.`, '/dashboard/orders', 'error');
    return updated;
  });
}

function cancel(order, { reason = 'cancelled', actor = 'user', actorId = null, ip = null } = {}) {
  if (order.status === 'paid') throw new Error('order_paid');
  const updated = setStatus(order, 'cancelled');
  recordEvent(order.id, 'manual', 'cancelled', { reason }, ip);
  audit.log(actor, actorId, 'order.cancelled', { targetType: 'order', targetId: order.public_id, ip });
  return updated;
}

function revenueStats() {
  const t = now();
  const day = 24 * 3600_000;
  return {
    total: db.pluck(`SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid'`) || 0,
    today: db.pluck(`SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND paid_at >= ?`, t - day) || 0,
    week: db.pluck(`SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND paid_at >= ?`, t - 7 * day) || 0,
    month: db.pluck(`SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND paid_at >= ?`, t - 30 * day) || 0,
    count: db.pluck(`SELECT COUNT(*) FROM orders WHERE status='paid'`) || 0,
    byMethod: db.all(`SELECT method, COUNT(*) c, COALESCE(SUM(amount),0) sum FROM orders WHERE status='paid' GROUP BY method ORDER BY c DESC`),
    byPlan: db.all(`SELECT plan_code, COUNT(*) c, COALESCE(SUM(amount),0) sum FROM orders WHERE status='paid' GROUP BY plan_code ORDER BY c DESC`),
    daily: db.all(
      `SELECT DATE(paid_at/1000, 'unixepoch') d, COUNT(*) c, COALESCE(SUM(amount),0) sum
       FROM orders WHERE status='paid' AND paid_at >= ? GROUP BY d ORDER BY d`, t - 30 * day
    )
  };
}

module.exports = {
  minor, rubles, MINUTE, ORDER_TTL_MIN,
  findCoupon, couponIsValid, quote,
  create, byId, byPublicId, byUser, all, countAll,
  setStatus, recordEvent, markPaid, refund, cancel, revenueStats
};
