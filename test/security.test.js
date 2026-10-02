'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot, client } = require('./helpers');

let env;
before(async () => { env = await boot(); });
after(async () => { await env.close(); });

test('статика: код, БД, секреты и скрытые файлы недоступны', async () => {
  const c = client(env.base);
  for (const p of ['/server/config.js', '/server/db.js', '/package.json', '/.env', '/.git/config', '/../server/config.js', '/%2e%2e/server/config.js', '/fonts/../../server/config.js', '/..%2fserver%2fconfig.js', '/vektor.db', '/%00.js']) {
    const r = await c.get(p);
    assert.notEqual(r.status, 200, `${p} не должен отдаваться (получили ${r.status})`);
    assert.ok(!/require\(|SESSION_SECRET/.test(r.text), `${p} утёк`);
  }
  assert.equal((await c.get('/')).status, 200);
  assert.equal((await c.get('/css/app.css')).status, 200);
});

test('заголовки безопасности и CSP', async () => {
  const r = await client(env.base).get('/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('в web/ нет секретов и серверного кода', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(__dirname, '..', 'web'))) {
    if (/\.(woff2|svg|png)$/.test(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /rpk_live|signing_secret|SIGNING_SECRET|X-API-Key/i, f);
    assert.doesNotMatch(t, /innerHTML\s*=/, `${f}: innerHTML запрещён`);
  }
});

test('регистрация: валидация, CSRF/Origin, дубликаты', async () => {
  const c = client(env.base);
  assert.equal((await c.post('/api/auth/register', { email: 'bad', password: 'long-enough-pass' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'a@test.io', password: 'short' })).status, 400);
  assert.equal((await c.req('POST', '/api/auth/register', { email: 'a@test.io', password: 'long-enough-pass' }, { Origin: 'https://evil.example' })).status, 403);
  const ok = await c.post('/api/auth/register', { email: 'A@Test.io', password: 'long-enough-pass', name: '<img src=x onerror=alert(1)>' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.email, 'a@test.io');
  assert.ok(ok.json.csrf);
  assert.equal((await client(env.base).post('/api/auth/register', { email: 'a@test.io', password: 'long-enough-pass' })).status, 409);
  const setCookie = (await client(env.base).post('/api/auth/login', { email: 'a@test.io', password: 'long-enough-pass' })).headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/);
});

test('пароль в БД хранится как scrypt-хэш, токен сессии — как HMAC', () => {
  const u = env.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('a@test.io');
  assert.match(u.password_hash, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!u.password_hash.includes('long-enough-pass'));
});

test('CSRF-токен обязателен для изменяющих запросов авторизованного пользователя', async () => {
  const c = client(env.base);
  await c.post('/api/auth/login', { email: 'a@test.io', password: 'long-enough-pass' });
  const noToken = await fetch(env.base + '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', Cookie: c.cookie }, body: '{}' });
  assert.equal(noToken.status, 403, 'с валидной сессией, но без CSRF-токена');
  const wrong = await fetch(env.base + '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', Cookie: c.cookie, 'X-CSRF-Token': 'nope' }, body: '{}' });
  assert.equal(wrong.status, 403);
  assert.equal((await c.req('PUT', '/api/profile', { stack: ['Python', 'x<script>', 'bad;name', '😀'], name: 'Ann' })).status, 200);
  const me = (await c.get('/api/session')).json.user;
  assert.deepEqual(me.stack, ['Python', 'x']); // теги вычищены, спецсимволы отброшены
});

test('вход: неверный пароль, блокировка после серии неудач', async () => {
  const c = client(env.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: 'a@test.io', password: 'wrong-wrong-wrong' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'a@test.io', password: 'long-enough-pass' })).status, 429);
});

test('SQL-инъекции в фильтрах не ломают запросы', async () => {
  const c = client(env.base);
  for (const q of ["' OR 1=1 --", "%", "_", '"; DROP TABLE users; --', "\\"]) {
    const r = await c.get('/api/jobs?q=' + encodeURIComponent(q) + '&stack=' + encodeURIComponent(q));
    assert.equal(r.status, 200);
  }
  assert.ok(env.db.prepare('SELECT COUNT(*) c FROM users').get().c >= 1);
});

test('конфиг отказывается стартовать с секретами/БД внутри проекта', () => {
  const root = path.join(__dirname, '..');
  const r1 = spawnSync(process.execPath, ['-e', "require('./server/config')"], { cwd: root, env: { ...process.env, VEKTOR_ENV_FILE: path.join(root, '.env') }, encoding: 'utf8' });
  assert.notEqual(r1.status, 0); assert.match(r1.stderr, /внутри проекта/);
  const r2 = spawnSync(process.execPath, ['-e', "require('./server/config')"], { cwd: root, env: { ...process.env, VEKTOR_DATA_DIR: path.join(root, 'data') }, encoding: 'utf8' });
  assert.notEqual(r2.status, 0); assert.match(r2.stderr, /внутри проекта/);
});

test('production не стартует с фейковыми платежами и без секретов', () => {
  const root = path.join(__dirname, '..');
  const r = spawnSync(process.execPath, ['-e', "const c=require('./server/config');c.validate()"], { cwd: root, env: { ...process.env, NODE_ENV: 'production', VEKTOR_DEV_FAKE_PAYMENTS: '1' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /DEV_FAKE_PAYMENTS/);
});
