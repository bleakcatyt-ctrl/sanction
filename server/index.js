'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./db');
const seed = require('./lib/seed');
const session = require('./lib/session');
const licenseSvc = require('./lib/license');
const payments = require('./payments');
const audit = require('./lib/audit');
const ratelimit = require('./lib/ratelimit');
const util = require('./lib/util');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', config.security.trustProxy);
app.disable('x-powered-by');

const { icon } = require('./lib/icons');
app.locals.icon = icon;
app.locals.config = config;

/* ------------------------------------------------------------ middlewares -- */

app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  // Gateway callbacks are machine-to-machine: no cookies, no CSRF.
  if (req.path.startsWith('/api/payments/')) req.skipCsrf = true;

  const nonce = require('node:crypto').randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}'`,
    "connect-src 'self'",
    "form-action 'self'"
  ].join('; '));
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use('/static', express.static(path.join(config.root, 'public'), {
  maxAge: config.isProd ? '7d' : 0,
  etag: true,
  index: false
}));

app.use(session.attach);
app.use(ratelimit.middleware({ scope: 'global', limit: config.security.rateLimit.global, windowMs: config.security.rateLimit.windowMs }));

/* ----------------------------------------------------------------- routes -- */

app.use('/api/auth', require('./routes/auth'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/me', require('./routes/account'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/webhooks'));
app.use('/api/loader', require('./routes/loader'));
app.use('/', require('./routes/loader').downloads);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: config.brand.name.toLowerCase(),
    version: config.build.latestVersion,
    time: util.sec(),
    db: db.pluck('SELECT 1') === 1,
    status: db.setting('site.status', 'online')
  });
});

app.get('/api/site', (req, res) => {
  res.json({
    ok: true,
    site: require('./routes/pages').siteSettings(),
    plans: config.plans,
    methods: payments.list()
  });
});

app.use('/', require('./routes/pages'));

/* ----------------------------------------------------------- error paths -- */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
  const view = require('./routes/pages').view;
  res.status(404);
  view(req, res, 'error', { title: '404', code: 404, message: 'Страница не найдена.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  audit.log('system', req.user ? String(req.user.id) : null, 'http.error', {
    meta: { path: req.path, method: req.method, message: err.message }, ip: util.clientIp(req)
  });
  if (status >= 500) console.error('[error]', req.method, req.path, err);
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ ok: false, error: err.code || 'server_error', message: status >= 500 && !config.isProd ? err.message : 'Внутренняя ошибка.' });
  }
  res.status(status);
  require('./routes/pages').view(req, res, 'error', {
    title: String(status), code: status,
    message: status >= 500 ? 'Внутренняя ошибка сервера. Мы уже знаем.' : err.message
  });
});

/* ------------------------------------------------------------- bootstrapping */

/**
 * Shared initialisation. Runs at import time so that both `node server/index.js`
 * and an embedded app (tests, custom supervisors) get a seeded database.
 * Everything here is idempotent.
 */
const boot = (function init() {
  payments.applyOverrides();
  const seeded = seed.ensure();
  licenseSvc.sweep();
  return seeded;
})();

function start() {
  const seeded = boot;

  const server = app.listen(config.port, config.host, () => {
    const line = '─'.repeat(58);
    console.log(`\n┌${line}┐`);
    console.log(`  ${config.brand.name} platform ready`);
    console.log(`  local    http://localhost:${config.port}`);
    console.log(`  network  http://${config.host}:${config.port}`);
    console.log(`  database ${path.relative(config.root, config.dbFile)}`);
    console.log(`  mode     ${config.env}`);
    const artifact = path.relative(config.root, config.build.artifactPath);
    const hasArtifact = fs.existsSync(config.build.artifactPath);
    console.log(`  loader   ${hasArtifact ? `${artifact} (${config.build.latestVersion})` : 'не собран'}`);
    if (seeded.created.length) {
      console.log(`  seeded   ${seeded.created.join(', ')}  (credentials -> data/seed-credentials.txt)`);
    }
    console.log(`└${line}┘\n`);
    if (!hasArtifact) {
      // Buyers see "Артефакт не загружен" in the dashboard; the operator needs
      // the actionable half of that story, so say it once at boot.
      console.log(`  [!] Сборки лоадера нет: выдача файла вернёт artifact_missing.`);
      console.log(`      Сборка на Windows:  cd loader && build.cmd   (нужен .NET 8 SDK)`);
      console.log(`      Результат положить в ${artifact}\n`);
    }
  });

  /* periodic jobs */
  setInterval(() => {
    try {
      const expired = licenseSvc.sweep();
      session.purgeExpired();
      db.run(`DELETE FROM loader_sessions WHERE expires_at < ? AND state != 'authed'`, util.now() - 3600_000);
      if (expired) console.log(`[jobs] ${expired} license(s) expired`);
    } catch (err) {
      console.error('[jobs]', err.message);
    }
  }, 60_000).unref();

  const shutdown = (signal) => {
    console.log(`\n[${signal}] shutting down…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) start();

module.exports = { app, start };
