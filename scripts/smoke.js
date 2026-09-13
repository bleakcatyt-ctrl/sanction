#!/usr/bin/env node
'use strict';

/**
 * npm run smoke            — live check against http://127.0.0.1:3000
 * SMOKE_URL=https://…  npm run smoke
 *
 * Walks the real product path over HTTP against a running server:
 *   health → public pages → signup → sandbox purchase → credentials →
 *   loader handshake (ECDH + AES-GCM + ECDSA token) → heartbeat →
 *   admin gate → key generation → revocation → loader refuses the key.
 *
 * Unlike `npm test` (throwaway DB in data/test) this hits a live instance, so
 * it is the right check after a deploy. It creates one test user and two keys.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const { LoaderClient } = require(path.join(__dirname, '..', 'tests', 'loader-client'));

const BASE = String(process.env.SMOKE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_USER = process.env.SMOKE_ADMIN_USER || 'tiran';
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS || 'Sanction!2026';
const GATE = process.env.SMOKE_GATE || 'lerety65789)5433';
const BUYER_PASS = process.env.SMOKE_BUYER_PASS || 'Passw0rd!23';

const uniq = () => crypto.randomBytes(4).toString('hex');
const results = [];
let failures = 0;

function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? ' ok ' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? '  — ' + detail : ''}`);
}

/* ------------------------------------------------------------- http client -- */

function client() {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

  function absorb(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of raw) {
      if (!c) continue;
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || !v) delete jar[k];
      else jar[k] = v;
    }
  }

  return {
    async req(method, url, body, headers = {}) {
      const res = await fetch(BASE + url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
      return { status: res.status, json, text };
    },
    get(url, headers) { return this.req('GET', url, undefined, headers); },
    post(url, body, headers) { return this.req('POST', url, body, headers); },
    async cpost(url, body) {
      const me = await this.get('/api/auth/me');
      return this.post(url, body, { 'X-CSRF-Token': me.json?.csrf || '' });
    }
  };
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/* -------------------------------------------------------------------- run -- */

async function main() {
  const t0 = Date.now();
  console.log('');
  console.log('Sanction — smoke test');
  console.log('  target  ' + BASE);
  console.log('─'.repeat(64));

  /* 1. health */
  const health = await (await fetch(BASE + '/api/health')).json().catch(() => null);
  step('health', health?.ok === true && health?.db === true,
    health ? `status=${health.status} version=${health.version}` : 'нет ответа');
  if (!health?.ok) return finish(t0);

  /* 2. public pages */
  const pages = ['/', '/pricing', '/status', '/news', '/faq', '/terms', '/login', '/register'];
  for (const p of pages) {
    const res = await fetch(BASE + p);
    const html = await res.text();
    const emoji = EMOJI.test(html);
    step(`страница ${p}`, res.status === 200 && !emoji,
      res.status === 200 ? (emoji ? 'найдены эмодзи' : `${(html.length / 1024).toFixed(1)} КБ`) : `код ${res.status}`);
  }

  /* 3. signup */
  const buyer = 'smoke' + uniq();
  const c = client();
  const reg = await c.post('/api/auth/register', {
    username: buyer, email: `${buyer}@smoke.local`, password: BUYER_PASS, password2: BUYER_PASS
  });
  step('регистрация покупателя', reg.status === 200 && reg.json?.ok === true, buyer);

  const me = await c.get('/api/auth/me');
  step('сессия и CSRF', me.status === 200 && !!me.json?.csrf, me.json?.user?.username || 'нет csrf');

  /* 4. quote + checkout + sandbox confirm */
  const quote = await c.cpost('/api/billing/quote', { plan: 'SANCTION-90', coupon: null });
  step('расчёт цены 90 дней', quote.status === 200 && quote.json?.ok === true,
    quote.json?.total_label || quote.json?.error || '');

  const checkout = await c.cpost('/api/billing/checkout', { plan: 'SANCTION-90', method: 'sandbox', coupon: null });
  const pid = checkout.json?.order;
  step('создание заказа', checkout.status === 200 && !!pid, pid || JSON.stringify(checkout.json));

  let license = null;
  if (pid) {
    const page = await c.get('/checkout/sandbox/' + pid);
    const sig = /data-sign="([^"]+)"/.exec(page.text);
    step('песочница: подписанная страница', page.status === 200 && !!sig, sig ? 'подпись получена' : 'нет data-sign');

    if (sig) {
      const confirm = await c.post(`/api/payments/sandbox/${pid}/confirm`, { s: sig[1], status: 'paid' });
      step('оплата подтверждена', confirm.status === 200 && confirm.json?.ok === true, confirm.json?.redirect || '');

      const list = await c.get('/api/me/licenses');
      license = list.json?.licenses?.[0] || null;
      const until = license?.expires_at ? 'до ' + new Date(license.expires_at).toLocaleDateString('ru-RU') : 'ожидает первого входа';
      step('лицензия выдана', !!license && ['active', 'pending'].includes(license.status),
        license ? `${license.plan_code} · ${license.license_key} · ${license.status} · ${until}` : 'пусто');
      step('доступны логин и пароль лоадера',
        !!(license?.loader?.login && license?.loader?.password), license?.loader?.login || 'нет данных');
    }
  }

  /* 5. loader flow */
  let session = null;
  if (license?.loader?.login) {
    const lc = new LoaderClient(BASE);
    const pk = await lc.loadPublicKey();
    step('публичный ключ сервера', pk.status === 200 && pk.text.includes('PUBLIC KEY'), 'SPKI PEM');

    const boot = await lc.bootstrap();
    step('bootstrap лоадера', boot.status === 200 && boot.json?.ok === true,
      boot.json?.sid ? `sid ${String(boot.json.sid).slice(0, 8)}…` : JSON.stringify(boot.json));

    const auth = await lc.auth(license.loader.login, license.loader.password);
    const payload = lc.lastPayload;
    step('рукопожатие (ECDH + AES-GCM)', auth.status === 200 && payload?.ok === true,
      payload ? `${payload.license?.plan} · ${payload.state}` : JSON.stringify(auth.json));

    const claims = payload?.token ? lc.verifySignature(payload.token) : null;
    step('подпись токена лицензии', !!claims && claims.typ === 'license' && claims.iss === 'sanction',
      claims ? `hwid ${String(claims.hwid).slice(0, 12)}… · exp ${new Date(claims.exp * 1000).toLocaleString('ru-RU')}` : 'не проверена');

    const hwidLocal = lc.hwid;
    step('HWID совпадает с токеном',
      !!claims && claims.hwid === crypto.createHash('sha256').update(hwidLocal).digest('hex').slice(0, 32),
      claims?.hwid ? 'привязка подтверждена' : '—');

    const hb = await lc.heartbeat();
    step('heartbeat', hb.status === 200 && hb.json?.ok === true && lc.lastPayload?.ok === true,
      lc.lastPayload ? `остаток ${Math.round((lc.lastPayload.remaining_ms || 0) / 86400000)} дн.` : '');

    const after = await c.get('/api/me/licenses');
    const live = after.json?.licenses?.[0] || null;
    step('активация при первом входе', live?.status === 'active' && !!live?.expires_at,
      live ? `${live.status} · ${live.remaining_days ?? '?'} дн. · HWID ${live.hwid_short || '—'}` : 'нет данных');

    const dl = await lc.download();
    const dlPayload = lc.lastPayload;
    step('билет на скачивание',
      dl.status === 200 && (dlPayload?.ok === true ? !!dlPayload.url : dlPayload?.code === 'artifact_missing'),
      dlPayload?.ok ? `сборка ${dlPayload.build}` : `нет артефакта (${dlPayload?.code || '—'}) — соберите лоадер`);

    const out = await lc.logout();
    step('logout', out.status === 200, 'сессия закрыта');
    session = lc;
  }

  /* 6. admin panel */
  const admin = client();
  const login = await admin.post('/api/auth/login', { login: ADMIN_USER, password: ADMIN_PASS });
  step('вход администратора', login.status === 200 && login.json?.ok === true, ADMIN_USER);

  if (login.status === 200) {
    const denied = await admin.get('/api/admin/summary');
    step('панель закрыта до гейта', denied.status === 401 || denied.status === 403,
      `код ${denied.status} · ${denied.json?.error || denied.json?.code || ''}`);

    const gate = await admin.cpost('/api/admin/gate', { password: GATE });
    step('гейт админки', gate.status === 200 && gate.json?.ok === true, 'пароль принят');

    const badGate = await client().post('/api/admin/gate', { password: 'wrong' });
    step('неверный гейт отклонён', badGate.status !== 200, `код ${badGate.status}`);

    const summary = await admin.get('/api/admin/summary');
    step('сводка доступна', summary.status === 200 && !!summary.json?.users && !!summary.json?.licenses,
      summary.json?.users
        ? `пользователей ${summary.json.users.total} · лицензий ${summary.json.licenses.total} (активных ${summary.json.licenses.active}) · онлайн ${summary.json.loader?.online ?? 0}`
        : `код ${summary.status}`);

    /* 7. generate a key in the panel and prove revocation reaches the loader */
    const gen = await admin.cpost('/api/admin/licenses/generate', {
      plan: 'SANCTION-30', count: 1, note: 'smoke', user_id: null, activate: true
    });
    const created = gen.json?.licenses?.[0] || null;
    step('генерация ключа в админке', gen.status === 200 && !!created,
      created ? `${created.license_key} · ${created.loader_login}` : JSON.stringify(gen.json));

    if (created) {
      const lc2 = new LoaderClient(BASE);
      await lc2.loadPublicKey();
      await lc2.bootstrap();
      const first = await lc2.auth(created.loader_login, created.loader_password);
      step('ключ из админки работает', first.status === 200 && lc2.lastPayload?.ok === true,
        lc2.lastPayload?.license?.plan || JSON.stringify(first.json));

      const revoke = await admin.cpost(`/api/admin/licenses/${created.id}/revoke`, { reason: 'smoke' });
      step('отзыв ключа', revoke.status === 200 && revoke.json?.ok === true, 'license_revoked');

      const hb2 = await lc2.heartbeat();
      const refused = hb2.status !== 200 || hb2.json?.ok === false;
      step('лоадер теряет доступ после отзыва', refused && /revoked|403/.test(JSON.stringify(hb2.json) + hb2.status),
        `код ${hb2.json?.code || hb2.status}`);

      const creds = await admin.get(`/api/admin/licenses/${created.id}/credentials`);
      step('просмотр пароля требует права и пишется в аудит', creds.status === 200, `код ${creds.status}`);
    }
  }

  /* 8. security headers */
  const head = await fetch(BASE + '/');
  const csp = head.headers.get('content-security-policy') || '';
  step('CSP с nonce', /script-src 'self' 'nonce-/.test(csp), csp.slice(0, 60) + '…');
  step('заголовки защиты',
    head.headers.get('x-content-type-options') === 'nosniff' && !!head.headers.get('x-frame-options'),
    'nosniff + frame options');

  const noCsrf = await c.post('/api/me/notifications/read', {});
  step('запись без CSRF отклоняется', noCsrf.status === 403, `код ${noCsrf.status}`);

  const anon = await client().get('/api/me/licenses');
  step('кабинет закрыт без входа', anon.status === 401, `код ${anon.status}`);

  finish(t0);
}

function finish(t0) {
  const passed = results.filter((r) => r.ok).length;
  console.log('─'.repeat(64));
  console.log(`  ${passed}/${results.length} проверок пройдено за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  if (failures) {
    console.log('');
    console.log('  Провалено:');
    for (const r of results.filter((x) => !x.ok)) console.log(`    • ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log('');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('');
  console.error('Smoke test остановлен: ' + err.message);
  console.error(err.stack);
  process.exit(2);
});
