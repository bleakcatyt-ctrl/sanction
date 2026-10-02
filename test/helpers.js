'use strict';
// Тестовое окружение: ДО загрузки config выставляем безопасные значения, БД — в памяти.
process.env.VEKTOR_ENV_FILE = '/tmp/vektor-test-nonexistent.env';
process.env.VEKTOR_DATA_DIR = require('node:os').tmpdir() + '/vektor-test-data';
process.env.VEKTOR_APP_URL = 'http://localhost:3999';
process.env.VEKTOR_SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.VEKTOR_DEV_FAKE_PAYMENTS = '1';
process.env.VEKTOR_ROLLYPAY_SIGNING_SECRET = 'whsec_test_123';
process.env.VEKTOR_DISABLE_CRAWLER = '1';

const http = require('node:http');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

async function boot() {
  const db = open(':memory:');
  const server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base, close: () => new Promise((r) => server.close(r)) };
}

/** Мини-клиент с cookie-jar и CSRF. */
function client(base) {
  let cookie = ''; let csrf = null;
  const c = {
    async req(method, path, body, headers = {}) {
      const h = { Origin: 'http://localhost:3999', ...headers };
      if (cookie) h.Cookie = cookie;
      if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
      if (csrf && method !== 'GET') h['X-CSRF-Token'] = csrf;
      const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* */ }
      if (json && json.csrf) csrf = json.csrf;
      return { status: res.status, json, text, headers: res.headers };
    },
    get cookie() { return cookie; },
    get: (p) => c.req('GET', p),
    post: (p, b) => c.req('POST', p, b ?? {}),
  };
  return c;
}

function insertJob(db, o = {}) {
  const t = Date.now();
  db.prepare(`INSERT INTO jobs (source, ext_id, title, company, company_key, location, remote, url, salary_text, category, level, ai_score, stack, description, posted_at, first_seen, last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(o.source || 'remotive', o.ext || String(Math.random()), o.title || 'ML Engineer', o.company || 'Acme', (o.company || 'Acme').toLowerCase(), 'Remote', 1,
    'https://example.com/j', '', o.category || 'ml', 'middle', o.ai || 80, JSON.stringify(o.stack || ['Python', 'PyTorch']), 'desc', o.posted || t, t, t);
}

module.exports = { boot, client, insertJob };
