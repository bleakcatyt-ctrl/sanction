'use strict';
/**
 * Конфигурация.
 *
 * ВАЖНО (безопасность): секреты читаются из файла ВНЕ папки проекта
 * (по умолчанию ~/.config/vektor/vektor.env) или из переменных окружения.
 * Если указать путь внутри проекта — сервер откажется стартовать.
 * Папка раздаваемых файлов — только /web, код и данные туда не попадают.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

const production = process.env.NODE_ENV === 'production';
const envFile = path.resolve(process.env.VEKTOR_ENV_FILE || path.join(os.homedir(), '.config', 'vektor', 'vektor.env'));
if (isInside(envFile, ROOT)) {
  throw new Error(`Файл секретов не должен лежать внутри проекта: ${envFile}`);
}

let fileVars = {};
if (fs.existsSync(envFile)) {
  const st = fs.statSync(envFile);
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    const msg = `Файл секретов ${envFile} доступен другим пользователям. Выполните: chmod 600 ${envFile}`;
    if (production) throw new Error(msg);
    console.warn('[config] ВНИМАНИЕ: ' + msg);
  }
  fileVars = parseEnv(fs.readFileSync(envFile, 'utf8'));
}

function get(name, def) {
  const k = 'VEKTOR_' + name;
  if (process.env[k] !== undefined && process.env[k] !== '') return process.env[k];
  if (fileVars[k] !== undefined && fileVars[k] !== '') return fileVars[k];
  return def;
}
const flag = (name) => ['1', 'true', 'yes'].includes(String(get(name, '')).toLowerCase());

const dataDir = path.resolve(get('DATA_DIR', path.join(os.homedir(), '.local', 'share', 'vektor')));
if (isInside(dataDir, ROOT)) {
  throw new Error(`Каталог данных (БД) не должен лежать внутри проекта: ${dataDir}`);
}

const port = parseInt(get('PORT', '3000'), 10);
const appUrl = String(get('APP_URL', `http://localhost:${port}`)).replace(/\/+$/, '');

const config = {
  ROOT,
  WEB_DIR: path.join(ROOT, 'web'),
  production,
  envFile,
  dataDir,
  host: get('HOST', '0.0.0.0'),
  port,
  appUrl,
  secureCookies: appUrl.startsWith('https://'),
  trustProxy: flag('TRUST_PROXY'),
  sessionSecret: get('SESSION_SECRET', ''),
  demo: flag('DEMO'),
  crawlerEnabled: !flag('DISABLE_CRAWLER'),
  hhToken: get('HH_ACCESS_TOKEN', ''),
  contactEmail: get('CONTACT_EMAIL', ''),
  rollypay: {
    baseUrl: String(get('ROLLYPAY_BASE_URL', 'https://rollypay.io')).replace(/\/+$/, ''),
    apiKey: get('ROLLYPAY_API_KEY', ''),
    signingSecret: get('ROLLYPAY_SIGNING_SECRET', ''),
    testMode: flag('ROLLYPAY_TEST_MODE'),
    payHostSuffixes: String(get('ROLLYPAY_PAY_HOSTS', 'rollypay.io')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    fake: flag('DEV_FAKE_PAYMENTS'),
  },
};

config.rollypay.configured = !!(config.rollypay.apiKey && config.rollypay.signingSecret);

config.validate = function validate() {
  const errors = [];
  if (config.rollypay.fake && production) errors.push('DEV_FAKE_PAYMENTS запрещён при NODE_ENV=production');
  if (config.demo && production) errors.push('DEMO запрещён при NODE_ENV=production');
  if (production) {
    if (config.sessionSecret.length < 32) errors.push('VEKTOR_SESSION_SECRET должен быть не короче 32 символов (npm run init-secrets)');
    if (!config.appUrl.startsWith('https://')) errors.push('VEKTOR_APP_URL должен начинаться с https:// в production');
    if (!config.rollypay.configured) errors.push('Не заданы VEKTOR_ROLLYPAY_API_KEY / VEKTOR_ROLLYPAY_SIGNING_SECRET');
  } else if (!config.sessionSecret) {
    // В разработке — эфемерный секрет (сессии сбросятся после перезапуска).
    config.sessionSecret = require('node:crypto').randomBytes(32).toString('hex');
    console.warn('[config] VEKTOR_SESSION_SECRET не задан — использую временный (только для разработки)');
  }
  if (errors.length) throw new Error('Ошибка конфигурации:\n - ' + errors.join('\n - '));
};

module.exports = config;
