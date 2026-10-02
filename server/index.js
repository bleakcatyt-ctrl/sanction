'use strict';
const http = require('node:http');
const config = require('./config');
config.validate();

const crypto = require('node:crypto');
if (config.rollypay.fake && !config.rollypay.signingSecret) {
  // dev-шлюз подписывает «вебхуки» локально — секрет производный от сессионного, на диск не пишется
  config.rollypay.signingSecret = crypto.createHmac('sha256', config.sessionSecret).update('dev-rollypay').digest('hex');
}

const { open, defaultFile } = require('./db');
const { createApp } = require('./app');
const crawler = require('./crawler');
const auth = require('./auth');

const db = open(defaultFile());
if (config.demo) require('./demo').seed(db);
if (config.crawlerEnabled) crawler.start(db);
setInterval(() => auth.purgeExpiredSessions(db), 3600_000).unref();

const server = http.createServer(createApp(db));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 500;
server.listen(config.port, config.host, () => {
  console.log(`Вектор запущен: ${config.appUrl} (${config.production ? 'production' : 'development'})`);
  console.log(`  БД: ${defaultFile()}`);
  console.log(`  Платежи: ${config.rollypay.fake ? 'DEV-шлюз (фейковый)' : config.rollypay.configured ? 'RollyPay' + (config.rollypay.testMode ? ' (тестовый режим)' : '') : 'НЕ НАСТРОЕНЫ'}`);
  if (config.demo) console.log('  Режим DEMO: в БД загружены демонстрационные вакансии');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { try { db.close(); } catch { /* */ } process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
}
