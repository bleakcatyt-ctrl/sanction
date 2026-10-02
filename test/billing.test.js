'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, insertJob } = require('./helpers');
const config = require('../server/config');
const rp = require('../server/rollypay');

let env; let c;
before(async () => {
  env = await boot();
  for (let i = 0; i < 9; i++) insertJob(env.db, { company: 'Co' + i, title: 'ML Engineer ' + i });
  c = client(env.base);
  await c.post('/api/auth/register', { email: 'pay@test.io', password: 'long-enough-pass' });
});
after(async () => { await env.close(); });

const webhook = (event, { secret = config.rollypay.signingSecret, ts = String(Math.floor(Date.now() / 1000)) } = {}) => {
  const body = JSON.stringify(event);
  return fetch(env.base + '/api/webhooks/rollypay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timestamp': ts, 'X-Signature': rp.sign(ts, body, secret) }, body });
};
const proUntil = () => env.db.prepare("SELECT pro_until FROM users WHERE email='pay@test.io'").get().pro_until;

test('платные функции закрыты на сервере', async () => {
  const comps = (await c.get('/api/companies')).json;
  assert.equal(comps.pro, false);
  assert.equal(comps.items.length, 6);
  assert.equal(comps.locked, 3);
  assert.equal((await c.get('/api/companies/co1')).status, 402);
  assert.equal((await c.get('/api/searches')).status, 402);
  assert.equal((await c.post('/api/searches', { name: 'x', query: {} })).status, 402);
  const jobs = (await c.get('/api/jobs?sort=match')).json;
  assert.ok(jobs.items.every((j) => j.match === undefined));
});

test('цену нельзя подменить: клиент передаёт только id тарифа', async () => {
  assert.equal((await c.post('/api/billing/checkout', { plan: 'pro_month', amount: '1.00' })).status, 200);
  const o = env.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1').get();
  assert.equal(o.amount, '990.00');
  assert.equal((await c.post('/api/billing/checkout', { plan: 'free_forever' })).status, 400);
});

test('вебхук: неверная подпись / просроченный timestamp отклоняются', async () => {
  const o = env.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1').get();
  const ev = { event_type: 'payment.paid', payment_id: o.payment_id, order_id: o.id, status: 'paid', amount: o.amount, currency: 'RUB', test: true };
  assert.equal((await webhook(ev, { secret: 'wrong' })).status, 403);
  assert.equal((await webhook(ev, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status, 403);
  assert.equal(proUntil(), 0);
});

test('вебхук paid без подтверждения через API шлюза не активирует подписку', async () => {
  const o = env.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1').get();
  // в «шлюзе» платёж всё ещё created
  const r = await webhook({ event_type: 'payment.paid', payment_id: o.payment_id, order_id: o.id, status: 'paid', amount: o.amount, currency: 'RUB', test: true });
  assert.equal(r.status, 200);
  assert.equal(proUntil(), 0);
});

test('оплата: подписка выдаётся один раз, повтор вебхука идемпотентен, сумма сверяется', async () => {
  const o = env.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1').get();
  rp.fakeSetStatus(o.payment_id, 'paid');
  const ev = { event_type: 'payment.paid', payment_id: o.payment_id, order_id: o.id, status: 'paid', amount: o.amount, currency: 'RUB', test: true };
  assert.equal((await webhook(ev)).status, 200);
  const first = proUntil();
  assert.ok(first > Date.now() + 29 * 86400_000 && first < Date.now() + 31 * 86400_000);
  assert.equal((await webhook(ev)).status, 200);
  assert.equal(proUntil(), first, 'повтор не должен продлевать');
  const session = (await c.get('/api/session')).json;
  assert.equal(session.user.pro, true);
});

test('Pro открывает радар, поиски и совпадение со стеком', async () => {
  const comps = (await c.get('/api/companies')).json;
  assert.equal(comps.pro, true); assert.equal(comps.items.length, 9);
  assert.equal((await c.get('/api/companies/co1')).status, 200);
  await c.req('PUT', '/api/profile', { stack: ['Python'], name: '' });
  const jobs = (await c.get('/api/jobs?sort=match')).json;
  assert.ok(jobs.items[0].match > 0);
  const s = await c.post('/api/searches', { name: 'ML', query: { q: 'ml', remote: true } });
  assert.equal(s.status, 200);
  assert.equal((await c.get('/api/searches')).json.items.length, 1);
});

test('чужую сумму/платёж подменить нельзя: несовпадение суммы и payment_id игнорируются', async () => {
  await c.post('/api/billing/checkout', { plan: 'pro_year' });
  const o = env.db.prepare("SELECT * FROM orders WHERE plan='pro_year'").get();
  const before = proUntil();
  rp.fakeSetStatus(o.payment_id, 'paid');
  await webhook({ event_type: 'payment.paid', payment_id: o.payment_id, order_id: o.id, status: 'paid', amount: '1.00', currency: 'RUB', test: true });
  // fake-шлюз отдаёт настоящую сумму 7990.00, поэтому проверяем «чужой payment_id»
  await webhook({ event_type: 'payment.paid', payment_id: 'pay_other', order_id: o.id, status: 'paid', amount: o.amount, currency: 'RUB', test: true });
  assert.equal(env.db.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status !== 'paid' || proUntil() > before, true);
  assert.notEqual(env.db.prepare('SELECT payment_id FROM orders WHERE id=?').get(o.id).payment_id, 'pay_other');
});

test('возврат отзывает купленный срок', async () => {
  const o = env.db.prepare("SELECT * FROM orders WHERE plan='pro_month'").get();
  const before = proUntil();
  assert.equal((await webhook({ event_type: 'payment.refunded', payment_id: o.payment_id, order_id: o.id, status: 'refunded', amount: o.amount, currency: 'RUB', test: true })).status, 200);
  assert.ok(proUntil() <= before - 29 * 86400_000);
  assert.equal(env.db.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status, 'refunded');
});

test('dev-шлюз проводит платёж через боевой обработчик вебхука', async () => {
  const c2 = client(env.base);
  await c2.post('/api/auth/register', { email: 'dev@test.io', password: 'long-enough-pass' });
  const { json } = await c2.post('/api/billing/checkout', { plan: 'pro_quarter' });
  assert.match(json.pay_url, /\/dev\/pay\//);
  assert.equal((await c2.post('/api/dev/pay/simulate', { order_id: json.order_id, outcome: 'paid' })).status, 200);
  const st = (await c2.get('/api/billing/orders/' + json.order_id)).json;
  assert.equal(st.order.status, 'paid'); assert.ok(st.pro_until);
});

test('pay_url должен вести на домен шлюза', () => {
  const real = config.rollypay.fake;
  config.rollypay.fake = false;
  try {
    assert.ok(rp.assertPayUrl('https://pay.rollypay.io/pay/tok_1'));
    for (const bad of ['https://evil.com/pay', 'https://rollypay.io.evil.com/x', 'http://pay.rollypay.io/x', 'javascript:alert(1)']) assert.throws(() => rp.assertPayUrl(bad), bad);
  } finally { config.rollypay.fake = real; }
});
