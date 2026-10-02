#!/usr/bin/env node
'use strict';
/**
 * Создаёт файл секретов ВНЕ папки проекта с правами 600.
 * Запуск: npm run init-secrets
 * Ключи RollyPay (api_key / signing_secret) вписываются в этот файл вручную — не в репозиторий.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const file = path.resolve(process.env.VEKTOR_ENV_FILE || path.join(os.homedir(), '.config', 'vektor', 'vektor.env'));
const rel = path.relative(ROOT, file);
if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
  console.error('Отказ: файл секретов не должен находиться внутри проекта.');
  process.exit(1);
}
if (fs.existsSync(file)) {
  console.log(`Файл уже существует, ничего не меняю: ${file}`);
  process.exit(0);
}
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
const body = `# Секреты сайта «Вектор». Файл лежит вне проекта, права 600. НЕ коммитить, НЕ копировать в /web.
VEKTOR_SESSION_SECRET=${crypto.randomBytes(48).toString('hex')}

# Публичный https-адрес сайта (для редиректов после оплаты и проверки Origin)
VEKTOR_APP_URL=https://example.com

# RollyPay: выдаются при создании кассы (https://docs.rollypay.io)
VEKTOR_ROLLYPAY_API_KEY=
VEKTOR_ROLLYPAY_SIGNING_SECRET=
# 1 — слать платежи с "test": true (песочница без реальных денег)
VEKTOR_ROLLYPAY_TEST_MODE=1

# Опционально: токен приложения HH.ru (api.hh.ru без токена отдаёт 403)
VEKTOR_HH_ACCESS_TOKEN=

# Если сайт стоит за nginx/Caddy — 1 (тогда берётся IP из X-Forwarded-For)
VEKTOR_TRUST_PROXY=1
VEKTOR_CONTACT_EMAIL=hello@example.com
`;
fs.writeFileSync(file, body, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`Готово: ${file}\nОткройте его и впишите VEKTOR_APP_URL и ключи RollyPay.`);
