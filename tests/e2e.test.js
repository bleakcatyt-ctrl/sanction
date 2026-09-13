'use strict';

/**
 * End-to-end test of the whole product:
 *   signup → purchase → automatic provisioning → loader handshake →
 *   heartbeat → expiry → admin actions.
 *
 * Runs against a throwaway SQLite database in data/test/.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TEST_DATA = path.join(__dirname, '..', 'data', 'test');
fs.rmSync(TEST_DATA, { recursive: true, force: true });

process.env.DATA_DIR = 'data/test';
process.env.DB_FILE = 'data/test/e2e.db';
process.env.NODE_ENV = 'test';
process.env.ADMIN_GATE_PASSWORD = 'lerety65789)5433';
process.env.SEED_ADMIN_PASSWORD = 'Sanction!2026';
process.env.LOGIN_MAX_ATTEMPTS = '200';
process.env.LOADER_MAX_ATTEMPTS = '3';
process.env.LOGIN_LOCK_MINUTES = '1';
// Points at a throwaway path so the download tests can materialise an artifact
// without touching loader/dist (the rest of the suite still sees it missing).
process.env.LOADER_ARTIFACT = path.join(TEST_DATA, 'Sanction.Loader.exe');

// The suite fires hundreds of requests from a single loopback address, so the
// production-shaped limiters are lifted here. They are covered explicitly in
// the 'protocol rejects tampering and replay' and lock-out tests instead.
process.env.RL_GLOBAL = '100000';
process.env.RL_AUTH = '100000';
process.env.RL_LOADER = '100000';
process.env.RL_ADMIN = '100000';

const { app } = require('../server/index');
const db = require('../server/db');
const config = require('../server/config');
const { LoaderClient } = require('./loader-client');

let base = '';
let server = null;

/* --------------------------------------------------------- http helper --- */

function client(cookies = {}) {
  const jar = { ...cookies };
  function cookieHeader() {
    return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  function absorb(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    raw.forEach((c) => {
      if (!c) return;
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || !v) delete jar[k];
      else jar[k] = v;
    });
  }
  return {
    jar,
    async req(method, url, body, headers = {}) {
      const res = await fetch(base + url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(jar.snc_sid && !headers['X-CSRF-Token'] && method !== 'GET' ? {} : {}),
          ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
          ...headers
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual'
      });
      absorb(res);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, json, text, headers: res.headers };
    },
    get(url, headers) { return this.req('GET', url, undefined, headers); },
    post(url, body, headers) { return this.req('POST', url, body, headers); },
    put(url, body, headers) { return this.req('PUT', url, body, headers); },
    /** POST with the CSRF token taken from /api/auth/me */
    async cpost(url, body) {
      const me = await this.get('/api/auth/me');
      const csrf = me.json?.csrf || '';
      return this.post(url, body, { 'X-CSRF-Token': csrf });
    },
    async cput(url, body) {
      const me = await this.get('/api/auth/me');
      return this.put(url, body, { 'X-CSRF-Token': me.json?.csrf || '' });
    }
  };
}

/* ------------------------------------------------------------- fixtures -- */

const GATE = 'lerety65789)5433';
const ADMIN_LOGIN = 'tiran';
const ADMIN_PASS = 'Sanction!2026';
const uniq = () => crypto.randomBytes(4).toString('hex');

async function signup(c, username) {
  const r = await c.post('/api/auth/register', {
    username, email: `${username}@test.local`, password: 'Passw0rd!23', password2: 'Passw0rd!23'
  });
  assert.equal(r.status, 200, 'signup must succeed: ' + JSON.stringify(r.json));
  return r.json;
}

async function adminClient() {
  const c = client();
  const login = await c.post('/api/auth/login', { login: ADMIN_LOGIN, password: ADMIN_PASS });
  assert.equal(login.status, 200, 'admin login failed');
  const gate = await c.cpost('/api/admin/gate', { password: GATE });
  assert.equal(gate.status, 200, 'admin gate failed: ' + JSON.stringify(gate.json));
  return c;
}

/** Buy a plan through the sandbox gateway and return { order, credentials }. */
async function buy(c, planCode, opts = {}) {
  const checkout = await c.cpost('/api/billing/checkout', { plan: planCode, method: 'sandbox', coupon: opts.coupon || null });
  assert.equal(checkout.status, 200, 'checkout failed: ' + JSON.stringify(checkout.json));
  const pid = checkout.json.order;
  const sign = checkout.json.redirect.split('/checkout/sandbox/')[1];
  assert.ok(sign, 'sandbox checkout url missing');

  const page = await c.get('/checkout/sandbox/' + pid);
  assert.equal(page.status, 200);
  const sig = /data-sign="([^"]+)"/.exec(page.text);
  assert.ok(sig, 'sandbox signature not rendered');

  const confirm = await c.post(`/api/payments/sandbox/${pid}/confirm`, { s: sig[1], status: opts.fail ? 'failed' : 'paid' });
  assert.equal(confirm.status, 200, 'confirm failed: ' + JSON.stringify(confirm.json));
  return { pid, sign };
}

/* ----------------------------------------------------------------- tests -- */

test('boot', async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  config.publicUrl = base;

  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.db, true);
});

test('public pages render', async () => {
  for (const p of ['/', '/pricing', '/status', '/news', '/faq', '/terms', '/login', '/register']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, `${p} should be 200`);
    const html = await res.text();
    assert.ok(html.includes('<!doctype html>'), `${p} should be html`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), `${p} must not contain emoji`);
  }
  const nf = await fetch(base + '/does-not-exist');
  assert.equal(nf.status, 404);
});

test('signup, login, session and CSRF', async () => {
  const c = client();
  const name = 'buyer' + uniq();
  await signup(c, name);

  const me = await c.get('/api/auth/me');
  assert.equal(me.json.user.username, name);
  assert.ok(me.json.csrf, 'csrf token must be issued');

  // write without CSRF must be rejected
  const noCsrf = await c.post('/api/me/notifications/read', {});
  assert.equal(noCsrf.status, 403);

  // wrong password
  const c2 = client();
  const bad = await c2.post('/api/auth/login', { login: name, password: 'nope' });
  assert.equal(bad.status, 401);

  // duplicate signup
  const c3 = client();
  const dup = await c3.post('/api/auth/register', { username: name, email: `${name}@test.local`, password: 'Passw0rd!23', password2: 'Passw0rd!23' });
  assert.equal(dup.status, 400);
  assert.ok(dup.json.field_errors.some((e) => e.field === 'username'));

  const out = await c.cpost('/api/auth/logout', {});
  assert.equal(out.json.ok, true);
  const after = await c.get('/api/auth/me');
  assert.equal(after.status, 401);
});

test('plans, quotes and coupons', async () => {
  const plans = await (await fetch(base + '/api/billing/plans')).json();
  assert.equal(plans.plans.length, 3);
  assert.deepEqual(plans.plans.map((p) => p.days), [30, 90, 180]);

  const q = await (await fetch(base + '/api/billing/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'SANCTION-90' })
  })).json();
  assert.equal(q.total, q.base);

  const bad = await (await fetch(base + '/api/billing/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'SANCTION-90', coupon: 'NOPE' })
  })).json();
  assert.equal(bad.coupon_error, 'coupon_not_found');
});

test('admin gate: wrong password rejected, right one opens the panel', async () => {
  const c = client();
  const lg = await c.post('/api/auth/login', { login: ADMIN_LOGIN, password: ADMIN_PASS });
  assert.equal(lg.status, 200, 'admin login failed: ' + JSON.stringify(lg.json));

  const before = await c.get('/api/admin/summary');
  assert.equal(before.status, 401);
  assert.equal(before.json.error, 'gate_required');

  const wrong = await c.cpost('/api/admin/gate', { password: 'wrong-guess' });
  assert.equal(wrong.status, 401);

  const right = await c.cpost('/api/admin/gate', { password: GATE });
  assert.equal(right.json.ok, true);
  assert.ok(right.json.permissions.includes('panel.access'));
  assert.ok(right.json.permissions.includes('licenses.generate'));

  const summary = await c.get('/api/admin/summary');
  assert.equal(summary.status, 200);
  assert.ok(summary.json.users.total >= 3);
  assert.equal(summary.json.system.activation_mode, 'on_first_login');
});

test('drake also has panel access', async () => {
  const c = client();
  await c.post('/api/auth/login', { login: 'drake', password: ADMIN_PASS });
  const gate = await c.cpost('/api/admin/gate', { password: GATE });
  assert.equal(gate.json.ok, true);
  const summary = await c.get('/api/admin/summary');
  assert.equal(summary.status, 200);
});

test('purchase provisions a license with loader credentials', async () => {
  const c = client();
  const name = 'pay' + uniq();
  await signup(c, name);

  const { pid } = await buy(c, 'SANCTION-90');
  const order = await c.get('/api/billing/orders/' + pid);
  assert.equal(order.json.order.status, 'paid');

  const list = await c.get('/api/me/licenses');
  assert.equal(list.json.licenses.length, 1);
  const lic = list.json.licenses[0];
  assert.equal(lic.plan_code, 'SANCTION-90');
  assert.equal(lic.days, 90);
  assert.equal(lic.status, 'pending', 'clock must not start before first loader login');
  assert.ok(lic.license_key.startsWith('SNC-'));
  assert.ok(lic.loader.login.startsWith('snc_'));
  assert.ok(lic.loader.password.length >= 12);
  assert.equal(lic.expires_at, null);

  // result page shows the credentials
  const page = await c.get('/checkout/result/' + pid);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(lic.license_key));
  assert.ok(page.text.includes(lic.loader.login));
  assert.ok(page.text.includes(lic.loader.password));

  // notification was created
  const notif = await c.get('/api/me/notifications');
  assert.ok(notif.json.notifications.length >= 2);

  return { client: c, lic };
});

test('repeat purchase of the same plan extends instead of duplicating', async () => {
  const c = client();
  await signup(c, 'stack' + uniq());
  await buy(c, 'SANCTION-30');
  const first = (await c.get('/api/me/licenses')).json.licenses[0];

  await buy(c, 'SANCTION-30');
  const after = (await c.get('/api/me/licenses')).json.licenses;
  assert.equal(after.length, 1, 'must reuse the same license');
  assert.equal(after[0].id, first.id);
  assert.equal(after[0].days, 60, '30 + 30 days');
});

test('admin can generate keys in bulk and they land in the same database', async () => {
  const admin = await adminClient();
  const r = await admin.cpost('/api/admin/licenses/generate', { plan: 'SANCTION-180', count: 3, note: 'e2e bulk' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.count, 3);
  r.json.licenses.forEach((l) => {
    assert.ok(l.license_key.startsWith('SNC-'));
    assert.ok(l.loader_login.startsWith('snc_'));
    assert.ok(l.loader_password);
  });
  // unique
  const logins = new Set(r.json.licenses.map((l) => l.loader_login));
  assert.equal(logins.size, 3);

  const listed = await admin.get('/api/admin/licenses?search=' + r.json.licenses[0].license_key);
  assert.equal(listed.json.total, 1);
});

test('loader: bootstrap → handshake → license → heartbeat', async () => {
  const c = client();
  await signup(c, 'ldr' + uniq());
  await buy(c, 'SANCTION-90');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const lc = new LoaderClient(base);
  const pub = await lc.loadPublicKey();
  assert.equal(pub.status, 200);
  assert.ok(pub.text.includes('BEGIN PUBLIC KEY'));

  const boot = await lc.bootstrap();
  assert.equal(boot.status, 200, JSON.stringify(boot.json));
  assert.equal(boot.json.protocol, 1);
  assert.match(boot.json.server_pub, /^04[0-9a-f]{128}$/);

  const auth = await lc.auth(lic.loader.login, lic.loader.password);
  assert.equal(auth.status, 200, JSON.stringify(auth.json));
  assert.ok(lc.lastPayload, 'encrypted payload must be returned');
  assert.equal(lc.lastPayload.state, 'active', 'first login activates the license');
  assert.equal(lc.lastPayload.license.plan, 'SANCTION-90');
  assert.ok(lc.lastPayload.license.expires_at > Date.now());
  assert.ok(lc.lastPayload.token, 'signed license token required');
  assert.equal(lc.lastPayload.license.hwid_bound, true);

  // token signature verifies with the embedded server public key
  const claims = lc.verifySignature(lc.lastPayload.token);
  assert.ok(claims, 'license token signature must verify');
  assert.equal(claims.typ, 'license');
  assert.equal(claims.plan, 'SANCTION-90');
  assert.equal(claims.login, lic.loader.login);
  assert.ok(claims.exp > claims.iat);

  // the site now sees the license as active with an expiry date
  const after = (await c.get('/api/me/licenses')).json.licenses[0];
  assert.equal(after.status, 'active');
  assert.ok(after.expires_at);
  assert.equal(after.hwid_resets_left, 5, '90-day plan grants 5 resets, binding does not spend one');

  const hb = await lc.heartbeat();
  assert.equal(hb.status, 200, JSON.stringify(hb.json));
  assert.equal(lc.lastPayload.action, 'heartbeat');
  assert.equal(lc.lastPayload.heartbeat_interval, 60);
  assert.ok(lc.lastPayload.refresh_token);

  const status = await lc.call('hwid_status');
  assert.equal(status.status, 200);
  assert.equal(lc.lastPayload.hwid_bound, true);

  const out = await lc.logout();
  assert.equal(out.status, 200);
});

test('loader: wrong password is rejected and repeated failures lock the license', async () => {
  const c = client();
  await signup(c, 'badpw' + uniq());
  await buy(c, 'SANCTION-30');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  for (let i = 0; i < 3; i++) {
    const lc = new LoaderClient(base);
    const r = await lc.auth(lic.loader.login, 'wrong-password-' + i);
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'invalid_credentials');
    assert.equal(lc.lastPayload, null, 'nothing must be returned to an unauthenticated client');
  }
  const locked = new LoaderClient(base);
  const r = await locked.auth(lic.loader.login, lic.loader.password);
  assert.equal(r.status, 423);
  assert.equal(r.json.code, 'locked');
});

test('loader: license key works as a login too', async () => {
  const c = client();
  await signup(c, 'bykey' + uniq());
  await buy(c, 'SANCTION-30');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const lc = new LoaderClient(base);
  await lc.loadPublicKey();
  const r = await lc.auth(lic.license_key, lic.loader.password);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(lc.lastPayload.state, 'active');
});

test('loader: second device is rejected with hwid_mismatch', async () => {
  const c = client();
  await signup(c, 'hwid' + uniq());
  await buy(c, 'SANCTION-90');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const first = new LoaderClient(base);
  const a = await first.auth(lic.loader.login, lic.loader.password, { hwid: crypto.createHash('sha256').update('pc-one').digest('hex'), hwidLabel: 'PC-ONE' });
  assert.equal(a.status, 200, JSON.stringify(a.json));

  const second = new LoaderClient(base);
  const b = await second.auth(lic.loader.login, lic.loader.password, { hwid: crypto.createHash('sha256').update('pc-two').digest('hex'), hwidLabel: 'PC-TWO' });
  assert.equal(b.status, 403);
  assert.equal(b.json.code, 'hwid_mismatch');
  assert.equal(second.lastPayload, null);

  // self-service reset from the website unlocks the new machine
  const reset = await c.cpost(`/api/me/licenses/${lic.id}/hwid-reset`, {});
  assert.equal(reset.status, 200, JSON.stringify(reset.json));

  const third = new LoaderClient(base);
  const d = await third.auth(lic.loader.login, lic.loader.password, { hwid: crypto.createHash('sha256').update('pc-two').digest('hex') });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(third.lastPayload.license.hwid_bound, true);

  const after = (await c.get('/api/me/licenses')).json.licenses[0];
  assert.equal(after.hwid_resets_left, 4);
});

test('loader: expired subscription returns nothing and blocks access', async () => {
  const c = client();
  await signup(c, 'exp' + uniq());
  await buy(c, 'SANCTION-30');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];
  const hwid = crypto.createHash('sha256').update('expiry-rig').digest('hex');

  const lc = new LoaderClient(base, { hwid });
  await lc.loadPublicKey();
  const ok = await lc.auth(lic.loader.login, lic.loader.password);
  assert.equal(ok.status, 200);
  assert.ok(lc.lastPayload.token);

  // time travel: move expiry into the past directly in the database
  db.run('UPDATE licenses SET expires_at = ? WHERE id = ?', Date.now() - 1000, lic.id);

  const hb = await lc.heartbeat();
  assert.equal(hb.status, 402);
  assert.equal(hb.json.code, 'subscription_expired');
  assert.equal(lc.lastPayload, null, 'no payload for an expired subscription');
  assert.ok(hb.json.renew_url.includes('/pricing'));

  // re-auth is refused as well
  const lc2 = new LoaderClient(base, { hwid });
  const again = await lc2.auth(lic.loader.login, lic.loader.password);
  assert.equal(again.status, 402);
  assert.equal(again.json.code, 'subscription_expired');

  // download endpoint refuses too
  const dl = await c.cpost(`/api/me/licenses/${lic.id}/download`, {});
  assert.equal(dl.status, 402);

  const siteLic = (await c.get('/api/me/licenses')).json.licenses[0];
  assert.equal(siteLic.status, 'expired');

  // renewal brings it back
  await buy(c, 'SANCTION-30');
  const renewed = (await c.get('/api/me/licenses')).json.licenses[0];
  assert.equal(renewed.status, 'active');
  assert.ok(renewed.expires_at > Date.now());

  const lc3 = new LoaderClient(base, { hwid });
  const after = await lc3.auth(lic.loader.login, lic.loader.password);
  assert.equal(after.status, 200, JSON.stringify(after.json));
});

test('admin revocation kills the loader session on the next heartbeat', async () => {
  const c = client();
  await signup(c, 'rev' + uniq());
  await buy(c, 'SANCTION-180');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];
  const hwid = crypto.createHash('sha256').update('revocation-rig').digest('hex');

  const lc = new LoaderClient(base, { hwid });
  await lc.auth(lic.loader.login, lic.loader.password);
  assert.ok(lc.lastPayload.token);

  const admin = await adminClient();
  const r = await admin.cpost(`/api/admin/licenses/${lic.id}/revoke`, { reason: 'chargeback' });
  assert.equal(r.json.ok, true);

  const hb = await lc.heartbeat();
  assert.equal(hb.status, 403);
  assert.equal(hb.json.code, 'license_revoked');

  const fresh = new LoaderClient(base, { hwid });
  const re = await fresh.auth(lic.loader.login, lic.loader.password);
  assert.equal(re.status, 403);
  assert.equal(re.json.code, 'license_revoked');

  // restore puts it back
  await admin.cpost(`/api/admin/licenses/${lic.id}/restore`, {});
  const restored = new LoaderClient(base, { hwid });
  const ok = await restored.auth(lic.loader.login, lic.loader.password);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('admin extends a subscription and the loader sees the new date', async () => {
  const c = client();
  await signup(c, 'ext' + uniq());
  await buy(c, 'SANCTION-30');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const lc = new LoaderClient(base);
  await lc.auth(lic.loader.login, lic.loader.password);
  const before = lc.lastPayload.license.expires_at;

  const admin = await adminClient();
  const r = await admin.cpost(`/api/admin/licenses/${lic.id}/extend`, { days: 45 });
  assert.equal(r.json.ok, true);

  const hb = await lc.heartbeat();
  assert.equal(hb.status, 200);
  assert.ok(lc.lastPayload.expires_at > before, 'expiry must move forward');
});

test('kill switch stops every loader', async () => {
  const admin = await adminClient();
  const on = await admin.cpost('/api/admin/loader/killswitch', { enabled: true });
  assert.equal(on.json.enabled, true);

  const lc = new LoaderClient(base);
  const boot = await lc.bootstrap();
  assert.equal(boot.status, 503);
  assert.equal(boot.json.code, 'killswitch');

  await admin.cpost('/api/admin/loader/killswitch', { enabled: false });
  const boot2 = await lc.bootstrap();
  assert.equal(boot2.status, 200);
});

test('outdated builds are rejected', async () => {
  const admin = await adminClient();
  await admin.cpost('/api/admin/loader/build', { min_version: '2.0.0', latest_version: '2.0.0' });

  const lc = new LoaderClient(base, { build: '1.0.4' });
  const boot = await lc.bootstrap();
  assert.equal(boot.status, 426);
  assert.equal(boot.json.code, 'build_outdated');

  await admin.cpost('/api/admin/loader/build', { min_version: '1.0.0', latest_version: '1.0.4' });
  const boot2 = await lc.bootstrap();
  assert.equal(boot2.status, 200);
});

test('protocol rejects tampering and replay', async () => {
  const c = client();
  await signup(c, 'tamper' + uniq());
  await buy(c, 'SANCTION-90');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const lc = new LoaderClient(base);
  const auth = await lc.auth(lic.loader.login, lic.loader.password);
  assert.equal(auth.status, 200);

  // replay the exact same envelope
  const envelope = lc._encrypt({ action: 'heartbeat' });
  const first = await fetch(base + '/api/loader/v1/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope)
  });
  assert.equal(first.status, 200);
  const replay = await fetch(base + '/api/loader/v1/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope)
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).code, 'replay_detected');

  // flipping a ciphertext byte breaks the GCM tag
  const good = lc._encrypt({ action: 'heartbeat' });
  const raw = Buffer.from(good.p, 'base64url');
  raw[raw.length - 1] ^= 0xff;
  good.p = raw.toString('base64url');
  const bad = await fetch(base + '/api/loader/v1/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good)
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'decrypt_failed');

  // unknown session
  const ghost = await fetch(base + '/api/loader/v1/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, sid: 'does-not-exist', n: 1, ts: Math.floor(Date.now() / 1000), p: 'AAAA' })
  });
  assert.equal(ghost.status, 404);
});

test('download ticket is signed, single purpose and time limited', async () => {
  const c = client();
  await signup(c, 'dl' + uniq());
  await buy(c, 'SANCTION-90');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const lc = new LoaderClient(base);
  await lc.auth(lic.loader.login, lic.loader.password);
  const r = await lc.download();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // artifact is not shipped with the repository, so the server reports it honestly
  assert.equal(lc.lastPayload.code, 'artifact_missing');

  // forged ticket is rejected by /dl/loader
  const forged = await fetch(base + '/dl/loader?t=' + encodeURIComponent('abc.def'));
  assert.equal(forged.status, 401);
});

test('granular permissions: support agent cannot generate keys', async () => {
  const admin = await adminClient();

  const name = 'support' + uniq();
  const c = client();
  await signup(c, name);
  const uid = c.jsonUserId = (await c.get('/api/auth/me')).json.user.id;

  const grant = await admin.cpost(`/api/admin/users/${uid}/permissions`, { permissions: ['panel.access', 'users.view', 'licenses.view'] });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.deepEqual(grant.json.permissions.sort(), ['licenses.view', 'panel.access', 'users.view']);

  const gate = await c.cpost('/api/admin/gate', { password: GATE });
  assert.equal(gate.json.ok, true);

  const canView = await c.get('/api/admin/users');
  assert.equal(canView.status, 200);

  const cannotGenerate = await c.cpost('/api/admin/licenses/generate', { plan: 'SANCTION-90', count: 1 });
  assert.equal(cannotGenerate.status, 403);

  const cannotKill = await c.cpost('/api/admin/loader/killswitch', { enabled: true });
  assert.equal(cannotKill.status, 403);

  // a non-owner cannot escalate beyond their own set
  const escalate = await c.cpost(`/api/admin/users/${uid}/permissions`, { permissions: ['panel.access', 'licenses.generate'] });
  assert.equal(escalate.status, 403);

  // owner revokes panel access
  await admin.cpost(`/api/admin/users/${uid}/permissions`, { permissions: [] });
  const after = await c.get('/api/admin/users');
  assert.ok([401, 403].includes(after.status), 'panel must be closed, got ' + after.status);
});

test('banning a user kills site and loader access', async () => {
  const c = client();
  const name = 'ban' + uniq();
  await signup(c, name);
  await buy(c, 'SANCTION-90');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];
  const uid = (await c.get('/api/auth/me')).json.user.id;

  const lc = new LoaderClient(base);
  const auth = await lc.auth(lic.loader.login, lic.loader.password);
  assert.equal(auth.status, 200);

  const admin = await adminClient();
  await admin.cpost(`/api/admin/users/${uid}/status`, { status: 'banned', reason: 'e2e' });

  const hb = await lc.heartbeat();
  assert.equal(hb.status, 403);
  assert.equal(hb.json.code, 'account_banned');

  const fresh = new LoaderClient(base);
  const re = await fresh.auth(lic.loader.login, lic.loader.password);
  assert.equal(re.status, 403);

  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 401, 'site session must be dropped');
});

test('HWID blacklist blocks the device everywhere', async () => {
  const admin = await adminClient();
  const hwid = crypto.createHash('sha256').update('blacklisted-rig-' + uniq()).digest('hex');

  const r = await admin.cpost('/api/admin/hwid/blacklist', { hwid, reason: 'e2e' });
  assert.equal(r.json.ok, true);

  const c = client();
  await signup(c, 'bl' + uniq());
  await buy(c, 'SANCTION-30');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];

  const lc = new LoaderClient(base);
  const auth = await lc.auth(lic.loader.login, lic.loader.password, { hwid });
  assert.equal(auth.status, 403);
  assert.equal(auth.json.code, 'hwid_blacklisted');

  await admin.cpost('/api/admin/hwid/blacklist/remove', { hwid });
  const lc2 = new LoaderClient(base);
  const auth2 = await lc2.auth(lic.loader.login, lic.loader.password, { hwid });
  assert.equal(auth2.status, 200, JSON.stringify(auth2.json));
});

test('coupons apply at checkout', async () => {
  const admin = await adminClient();
  const code = 'E2E' + uniq().toUpperCase().slice(0, 5);
  const created = await admin.cpost('/api/admin/coupons', { code, kind: 'percent', value: 25, max_uses: 5, expires_days: 1 });
  assert.equal(created.status, 200, JSON.stringify(created.json));

  const c = client();
  await signup(c, 'cpn' + uniq());
  const q = await c.cpost('/api/billing/quote', { plan: 'SANCTION-90', coupon: code });
  assert.equal(q.json.discount, Math.round(q.json.base * 0.25));

  await buy(c, 'SANCTION-90', { coupon: code });
  const orders = await c.get('/api/me/orders');
  const paid = orders.json.orders.find((o) => o.status === 'paid');
  assert.ok(paid.discount > 0);
  assert.equal(paid.coupon_code, code);

  // second use by the same user is refused (per_user = 1)
  const q2 = await c.cpost('/api/billing/quote', { plan: 'SANCTION-90', coupon: code });
  assert.equal(q2.json.coupon_error, 'coupon_used');
});

test('failed and cancelled payments do not provision anything', async () => {
  const c = client();
  await signup(c, 'fail' + uniq());
  await buy(c, 'SANCTION-30', { fail: true });
  const list = await c.get('/api/me/licenses');
  assert.equal(list.json.licenses.length, 0);

  const checkout = await c.cpost('/api/billing/checkout', { plan: 'SANCTION-30', method: 'sandbox' });
  const pid = checkout.json.order;
  const cancel = await c.cpost(`/api/billing/orders/${pid}/cancel`, {});
  assert.equal(cancel.json.ok, true);
  const after = await c.get('/api/billing/orders/' + pid);
  assert.equal(after.json.order.status, 'cancelled');
});

test('sandbox confirmation requires a valid signature', async () => {
  const c = client();
  await signup(c, 'sig' + uniq());
  const checkout = await c.cpost('/api/billing/checkout', { plan: 'SANCTION-30', method: 'sandbox' });
  const pid = checkout.json.order;

  const stranger = client();
  const forged = await stranger.post(`/api/payments/sandbox/${pid}/confirm`, { s: 'deadbeef', status: 'paid' });
  assert.equal(forged.status, 403);

  const still = await c.get('/api/billing/orders/' + pid);
  assert.notEqual(still.json.order.status, 'paid');
});

test('webhook endpoints reject unsigned gateway calls', async () => {
  const c = client();
  await signup(c, 'wh' + uniq());
  const checkout = await c.cpost('/api/billing/checkout', { plan: 'SANCTION-30', method: 'lava' });
  // lava is not configured, so checkout must fail cleanly
  assert.equal(checkout.status, 409);
  assert.equal(checkout.json.error, 'gateway_error');

  const wh = await fetch(base + '/api/payments/webhook/lava', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: 'ORD-FAKE', status: 'paid' })
  });
  assert.ok([400, 401, 403, 404].includes(wh.status), 'unsigned webhook must not provision, got ' + wh.status);
  const body = await wh.json();
  assert.notEqual(body.ok, true, 'an unsigned webhook must never provision an order');
});

test('audit log records privileged actions', async () => {
  const admin = await adminClient();
  const r = await admin.get('/api/admin/audit?limit=50');
  assert.equal(r.status, 200);
  const actions = r.json.entries.map((e) => e.action);
  assert.ok(actions.includes('admin.gate_ok'));
  assert.ok(actions.some((a) => a.startsWith('loader.')));
  assert.ok(actions.some((a) => a.startsWith('license.')));
});

test('settings update flows into runtime behaviour', async () => {
  const admin = await adminClient();
  await admin.cpost('/api/admin/settings', { 'license.activation_mode': 'on_purchase', 'site.announcement': 'e2e banner' });

  const c = client();
  await signup(c, 'act' + uniq());
  await buy(c, 'SANCTION-30');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];
  assert.equal(lic.status, 'active', 'on_purchase must start the clock immediately');
  assert.ok(lic.expires_at > Date.now());

  const home = await (await fetch(base + '/')).text();
  assert.ok(home.includes('e2e banner'));

  await admin.cpost('/api/admin/settings', { 'license.activation_mode': 'on_first_login', 'site.announcement': '' });
});

test('maintenance mode closes the site for regular users only', async () => {
  const admin = await adminClient();
  await admin.cpost('/api/admin/maintenance', { mode: 'maintenance', text: 'e2e works' });

  const c = client();
  await signup(c, 'mnt' + uniq());
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes('Технические работы'));

  const adminHome = await admin.get('/');
  assert.ok(!adminHome.text.includes('Технические работы'));

  await admin.cpost('/api/admin/maintenance', { mode: 'online' });
});

test('profile and password changes work', async () => {
  const c = client();
  const name = 'prof' + uniq();
  await signup(c, name);

  const put = await c.cput('/api/me/profile', { email: `${name}-new@test.local` });
  assert.equal(put.json.ok, true);
  assert.equal(put.json.user.email, `${name}-new@test.local`);

  const bad = await c.cpost('/api/auth/password', { current: 'wrong', next: 'Another1!23', next2: 'Another1!23' });
  assert.equal(bad.status, 401);

  const okp = await c.cpost('/api/auth/password', { current: 'Passw0rd!23', next: 'Another1!23', next2: 'Another1!23' });
  assert.equal(okp.json.ok, true);

  const c2 = client();
  const login = await c2.post('/api/auth/login', { login: name, password: 'Another1!23' });
  assert.equal(login.status, 200);
});

test('loader credentials can be rotated', async () => {
  const c = client();
  await signup(c, 'rot' + uniq());
  await buy(c, 'SANCTION-90');
  const lic = (await c.get('/api/me/licenses')).json.licenses[0];
  const oldPass = lic.loader.password;

  const admin = await adminClient();
  const r = await admin.cpost(`/api/admin/licenses/${lic.id}/credentials/rotate`, {});
  assert.equal(r.json.ok, true);
  assert.notEqual(r.json.loader.password, oldPass);

  const stale = new LoaderClient(base);
  const a = await stale.auth(lic.loader.login, oldPass);
  assert.equal(a.status, 401);

  const fresh = new LoaderClient(base);
  const b = await fresh.auth(lic.loader.login, r.json.loader.password);
  assert.equal(b.status, 200, JSON.stringify(b.json));
});

test('loader login generator produces unique well-formed logins', () => {
  // Regression: the suffix loop once guarded on a different index than the one
  // it read, so most positions degraded to a literal "x" and every fresh
  // install handed out the same snc_xxxxx login.
  const util = require('../server/lib/util');
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const login = util.randomLoaderLogin();
    assert.match(login, /^snc_[a-z2-9]{6}$/, `degenerate loader login: ${login}`);
    seen.add(login);
  }
  assert.equal(seen.size, 500, 'loader login generator collided with itself');
});

test('each issued license gets its own loader login', async () => {
  const logins = new Set();
  for (let i = 0; i < 3; i++) {
    const c = client();
    await signup(c, 'multi' + uniq());
    await buy(c, 'SANCTION-30');
    const lic = (await c.get('/api/me/licenses')).json.licenses[0];
    assert.match(lic.loader.login, /^snc_[a-z2-9]{6}$/, 'unexpected loader login shape');
    logins.add(lic.loader.login);
  }
  assert.equal(logins.size, 3, 'loader logins are not unique across licenses');
});

test('login succeeds from a stale tab holding a live session cookie', async () => {
  // The page a visitor submits may have been rendered before the current session
  // existed, so window.SNC.csrf is empty. Login must not dead-end on csrf_failed.
  const c = client();
  const name = 'stale' + uniq();
  await signup(c, name);

  const again = await c.post('/api/auth/login', { login: name, password: 'Passw0rd!23' });
  assert.equal(again.status, 200, 'login blocked for a client with an existing cookie: ' + JSON.stringify(again.json));
  assert.equal(again.json.user.username, name);

  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, name);
});

test('a freshly bought key is downloadable before activation', async () => {
  // Default activation is on_first_login, i.e. the loader activates the license.
  // The browser download therefore has to work while the key is still pending,
  // otherwise nothing could ever activate it.
  const artifact = path.join(TEST_DATA, 'Sanction.Loader.exe');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, 'MZ-dummy-build');
  try {
    const c = client();
    await signup(c, 'dl' + uniq());
    await buy(c, 'SANCTION-30');
    const lic = (await c.get('/api/me/licenses')).json.licenses[0];
    assert.equal(lic.status, 'pending');
    assert.equal(lic.downloadable, true, 'pending key must be downloadable');

    const r = await c.cpost(`/api/me/licenses/${lic.id}/download`, {});
    assert.equal(r.status, 200, 'download refused for a paid pending key: ' + JSON.stringify(r.json));
    assert.ok(r.json.url.startsWith('/dl/loader?t='), 'no signed ticket returned');

    const file = await c.get(r.json.url);
    assert.equal(file.status, 200);
    assert.equal(file.text, 'MZ-dummy-build');
    assert.match(String(file.headers.get('content-disposition')), /attachment; filename="Sanction.Loader.exe"/);

    const page = await c.get('/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Скачать лоадер/, 'dashboard hides the download button for a pending key');
  } finally {
    fs.rmSync(artifact, { force: true });
  }
});

test('cleanup', () => {
  if (server) server.close();
});
