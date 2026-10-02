'use strict';
const config = require('./config');
const rp = require('./rollypay');
const { tx } = require('./db');
const { now, randomToken } = require('./lib');
const { HttpError } = require('./http');

const DAY = 86400_000;

/** Цены задаются ТОЛЬКО на сервере. Клиент присылает лишь id тарифа. */
const PLANS = {
  pro_month:   { id: 'pro_month',   title: 'Pro · 1 месяц',   days: 30,  price: 990,  badge: '' },
  pro_quarter: { id: 'pro_quarter', title: 'Pro · 3 месяца',  days: 90,  price: 2490, badge: 'Выгоднее на 16%' },
  pro_year:    { id: 'pro_year',    title: 'Pro · 12 месяцев', days: 365, price: 7990, badge: 'Выгоднее на 33%' },
};
const money = (rub) => rub.toFixed(2);

function publicPlans() {
  return Object.values(PLANS).map((p) => ({
    id: p.id, title: p.title, days: p.days, price: p.price, badge: p.badge,
    per_month: Math.round((p.price / p.days) * 30),
  }));
}

async function createCheckout(db, user, planId) {
  const plan = PLANS[planId];
  if (!plan) throw new HttpError(400, 'Неизвестный тариф');
  if (!config.rollypay.configured && !config.rollypay.fake) throw new HttpError(503, 'Оплата временно недоступна');

  // Повторно используем свежий неоплаченный заказ — не плодим платежи при двойном клике
  const reuse = db.prepare(`SELECT * FROM orders WHERE user_id = ? AND plan = ? AND status IN ('created','processing')
    AND pay_url IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 1`).get(user.id, plan.id, now() - 20 * 60_000);
  if (reuse) return { order_id: reuse.id, pay_url: reuse.pay_url };

  const orderId = 'vk_' + Date.now().toString(36) + '_' + randomToken(6);
  const amount = money(plan.price);
  const t = now();
  const testFlag = config.rollypay.testMode || config.rollypay.fake ? 1 : 0;
  db.prepare(`INSERT INTO orders (id, user_id, plan, amount, currency, days, status, test, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(orderId, user.id, plan.id, amount, 'RUB', plan.days, 'created', testFlag, t, t);

  let payment;
  try {
    payment = await rp.createPayment({
      amount,
      orderId,
      description: `Вектор — ${plan.title}`,
      customerId: 'u' + user.id,
      successUrl: `${config.appUrl}/account?order=${encodeURIComponent(orderId)}`,
      failUrl: `${config.appUrl}/pricing?failed=${encodeURIComponent(orderId)}`,
      metadata: { plan: plan.id },
    });
    payment.pay_url = rp.assertPayUrl(payment.pay_url);
  } catch (e) {
    db.prepare(`UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?`).run(now(), orderId);
    console.error('[billing] createPayment failed:', e.message);
    throw new HttpError(502, 'Не удалось создать платёж. Попробуйте позже.');
  }
  db.prepare('UPDATE orders SET payment_id = ?, pay_url = ?, updated_at = ? WHERE id = ?').run(String(payment.payment_id), payment.pay_url, now(), orderId);
  return { order_id: orderId, pay_url: payment.pay_url };
}

/**
 * Единая точка применения состояния платежа (вебхук и ручная сверка).
 * Идемпотентна: повторная доставка того же события ничего не меняет.
 */
function applyPaymentState(db, { orderId, paymentId, status, amount, currency, test }) {
  return tx(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return { ignored: 'order_not_found' };
    if (!order.payment_id || order.payment_id !== paymentId) return { ignored: 'payment_id_mismatch' };
    if (!!test !== !!order.test) return { ignored: 'test_flag_mismatch' };
    const t = now();

    if (status === 'paid') {
      if (order.status === 'paid' || order.status === 'refunded' || order.status === 'chargeback') return { ignored: 'already_final' };
      // Сумма и валюта сверяются с НАШЕЙ записью, а не доверяются вебхуку
      if (String(currency || 'RUB').toUpperCase() !== order.currency || Number(amount) !== Number(order.amount)) {
        console.error(`[billing] amount mismatch order=${orderId} got=${amount} ${currency} want=${order.amount}`);
        return { ignored: 'amount_mismatch' };
      }
      const user = db.prepare('SELECT pro_until FROM users WHERE id = ?').get(order.user_id);
      if (!user) return { ignored: 'user_gone' };
      const base = Math.max(t, user.pro_until);
      db.prepare('UPDATE users SET pro_until = ? WHERE id = ?').run(base + order.days * DAY, order.user_id);
      db.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?`).run(t, t, orderId);
      return { activated: true, userId: order.user_id };
    }
    if (status === 'refunded' || status === 'chargeback') {
      if (order.status === 'paid') {
        const user = db.prepare('SELECT pro_until FROM users WHERE id = ?').get(order.user_id);
        if (user) db.prepare('UPDATE users SET pro_until = ? WHERE id = ?').run(Math.max(0, user.pro_until - order.days * DAY), order.user_id);
      }
      if (order.status !== 'refunded' && order.status !== 'chargeback') {
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, t, orderId);
      }
      return { revoked: order.status === 'paid' };
    }
    if (status === 'canceled' || status === 'expired') {
      if (order.status === 'created' || order.status === 'processing') {
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, t, orderId);
      }
      return { closed: true };
    }
    if (status === 'processing' && order.status === 'created') {
      db.prepare(`UPDATE orders SET status = 'processing', updated_at = ? WHERE id = ?`).run(t, orderId);
    }
    return { noop: true };
  });
}

async function handleWebhook(db, rawBody, headers) {
  if (!rp.verifyWebhook(rawBody, headers)) throw new HttpError(403, 'Invalid signature');
  let ev;
  try { ev = JSON.parse(rawBody); } catch { throw new HttpError(400, 'Bad JSON'); }
  if (!ev || typeof ev.event_type !== 'string' || !ev.event_type.startsWith('payment.')) return { ignored: 'event_type' };
  if (typeof ev.order_id !== 'string' || typeof ev.payment_id !== 'string') throw new HttpError(400, 'Bad payload');

  db.prepare('INSERT OR IGNORE INTO webhook_events (payment_id, event_type, received_at) VALUES (?,?,?)').run(ev.payment_id, ev.event_type, now());

  const status = String(ev.status || ev.event_type.slice('payment.'.length));
  if (status === 'paid') {
    // Эшелонированная защита: подтверждаем оплату прямым запросом к API RollyPay
    let remote;
    try { remote = await rp.getPayment(ev.payment_id); } catch (e) {
      console.error('[billing] confirm failed:', e.message);
      throw new HttpError(503, 'Retry later'); // RollyPay повторит доставку
    }
    if (!remote || remote.status !== 'paid') {
      console.error(`[billing] webhook says paid, API says ${remote && remote.status}`);
      return { ignored: 'not_paid_remote' };
    }
    return applyPaymentState(db, {
      orderId: ev.order_id, paymentId: ev.payment_id, status,
      amount: remote.amount ?? ev.amount, currency: remote.payment_currency ?? ev.currency, test: remote.test ?? ev.test ?? false,
    });
  }
  return applyPaymentState(db, { orderId: ev.order_id, paymentId: ev.payment_id, status, amount: ev.amount, currency: ev.currency, test: ev.test ?? false });
}

/** Сверка при возврате пользователя на сайт: если вебхук задержался — забираем статус сами. */
async function refreshOrder(db, order) {
  if (!order.payment_id || !['created', 'processing'].includes(order.status)) return order;
  try {
    const remote = await rp.getPayment(order.payment_id);
    if (remote && remote.status && remote.status !== 'created') {
      applyPaymentState(db, {
        orderId: order.id, paymentId: order.payment_id, status: remote.status,
        amount: remote.amount, currency: remote.payment_currency, test: remote.test ?? !!order.test,
      });
    }
  } catch (e) {
    console.error('[billing] refresh failed:', e.message);
  }
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
}

const publicOrder = (o) => ({
  id: o.id, plan: o.plan, plan_title: PLANS[o.plan]?.title || o.plan, amount: o.amount, currency: o.currency,
  status: o.status, test: !!o.test, created_at: o.created_at, paid_at: o.paid_at,
});

module.exports = { PLANS, publicPlans, createCheckout, applyPaymentState, handleWebhook, refreshOrder, publicOrder };
