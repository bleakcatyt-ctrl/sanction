'use strict';

require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(ROOT, process.env.DATA_DIR) : path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseTrustProxy(v) {
  if (v === undefined || v === '') return 1;
  const s = String(v).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'off') return false;
  if (s === 'true') return true;
  if (['loopback', 'uniquelocal', 'unique-local'].includes(s)) return s.replace('-', '');
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Stable secrets. In production they must come from the environment.
 * For local runs we generate them once into data/*.key so restarts do not
 * invalidate existing loader sessions.
 */
function stableSecret(fileName, envValue, bytes = 32) {
  if (envValue) return envValue;
  const p = path.join(DATA_DIR, fileName);
  try {
    const existing = fs.readFileSync(p, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* first run */ }
  const generated = crypto.randomBytes(bytes).toString('hex');
  fs.writeFileSync(p, generated, { mode: 0o600 });
  return generated;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  root: ROOT,
  dataDir: DATA_DIR,
  dbFile: process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : path.join(DATA_DIR, 'sanction.db'),

  host: process.env.HOST || '0.0.0.0',
  port: int(process.env.PORT, 3000),

  // Public base URL — used in links, download URLs and payment webhooks.
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${int(process.env.PORT, 3000)}`).replace(/\/+$/, ''),

  brand: {
    name: process.env.BRAND_NAME || 'SANCTION',
    tagline: process.env.BRAND_TAGLINE || 'private access infrastructure',
    support: process.env.SUPPORT_CONTACT || 'support@sanction.private',
    discord: process.env.DISCORD_INVITE || '',
    telegram: process.env.TELEGRAM_HANDLE || ''
  },

  secrets: {
    // Signs site session cookies / CSRF tokens.
    session: stableSecret('session.key', process.env.SESSION_SECRET),
    // Signs loader license tokens (HMAC-SHA256 fallback next to ECDSA).
    license: stableSecret('license.key', process.env.LICENSE_SECRET),
    // Long-lived server identity key for the loader handshake (ECDSA P-256).
    serverIdentity: stableSecret('server-identity.key', process.env.SERVER_IDENTITY_KEY, 48)
  },

  session: {
    cookieName: 'snc_sid',
    ttlSeconds: int(process.env.SESSION_TTL, 60 * 60 * 24 * 14),
    secureCookie: bool(process.env.COOKIE_SECURE, false),
    sameSite: process.env.COOKIE_SAMESITE || 'lax'
  },

  security: {
    // Hard gate that has to be typed on /admin/login on top of a normal login.
    adminGatePassword: process.env.ADMIN_GATE_PASSWORD || 'lerety65789)5433',
    loginMaxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 8),
    loginLockMinutes: int(process.env.LOGIN_LOCK_MINUTES, 15),
    loaderMaxAttempts: int(process.env.LOADER_MAX_ATTEMPTS, 10),
    loaderLockMinutes: int(process.env.LOADER_LOCK_MINUTES, 20),
    loaderSessionTtlSeconds: int(process.env.LOADER_SESSION_TTL, 60 * 15),
    heartbeatTtlSeconds: int(process.env.HEARTBEAT_TTL, 180),
    licenseTokenTtlSeconds: int(process.env.LICENSE_TOKEN_TTL, 60 * 5),
    downloadTokenTtlSeconds: int(process.env.DOWNLOAD_TOKEN_TTL, 60 * 10),
    maxClockSkewSeconds: int(process.env.MAX_CLOCK_SKEW, 120),
    // How many reverse-proxy hops to trust when resolving the client IP.
    // 1 = a single local nginx; 'loopback' = any local proxy; 0/false = the app
    // is exposed directly and X-Forwarded-For must be ignored (it is spoofable).
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    rateLimit: {
      windowMs: int(process.env.RL_WINDOW_MS, 60_000),
      global: int(process.env.RL_GLOBAL, 600),
      auth: int(process.env.RL_AUTH, 25),
      loader: int(process.env.RL_LOADER, 120),
      admin: int(process.env.RL_ADMIN, 240)
    }
  },

  licensing: {
    maxHwidResets: int(process.env.MAX_HWID_RESETS, 3),
    hwidResetCooldownHours: int(process.env.HWID_RESET_COOLDOWN_H, 72),
    devicesPerLicense: int(process.env.DEVICES_PER_LICENSE, 1),
    graceMinutes: int(process.env.EXPIRY_GRACE_MIN, 0)
  },

  payments: {
    // sandbox | lava | yookassa | enot  (comma separated list of enabled methods)
    enabled: (process.env.PAYMENT_METHODS || 'sandbox,lava,yookassa,enot').split(',').map((s) => s.trim()).filter(Boolean),
    defaultMethod: process.env.PAYMENT_DEFAULT || 'sandbox',
    currency: process.env.CURRENCY || 'RUB',

    lava: {
      projectId: process.env.LAVA_PROJECT_ID || '',
      secretKey: process.env.LAVA_SECRET_KEY || '',
      apiUrl: process.env.LAVA_API_URL || 'https://api.lava.ru'
    },
    yookassa: {
      shopId: process.env.YOOKASSA_SHOP_ID || '',
      secretKey: process.env.YOOKASSA_SECRET_KEY || '',
      apiUrl: process.env.YOOKASSA_API_URL || 'https://api.yookassa.ru/v3'
    },
    enot: {
      projectId: process.env.ENOT_PROJECT_ID || '',
      wallet: process.env.ENOT_WALLET || '',
      secretKey1: process.env.ENOT_SECRET_KEY1 || '',
      secretKey2: process.env.ENOT_SECRET_KEY2 || '',
      apiUrl: process.env.ENOT_API_URL || 'https://api.enot.io'
    }
  },

  build: {
    // Latest loader build the server is willing to talk to. Older builds are
    // rejected so a leaked binary can be revoked instantly.
    latestVersion: process.env.LOADER_VERSION || '1.0.4',
    minVersion: process.env.LOADER_MIN_VERSION || '1.0.0',
    killSwitch: bool(process.env.LOADER_KILLSWITCH, false),
    fileName: process.env.LOADER_FILE_NAME || 'Sanction.Loader.exe',
    // Real artifact path; falls back to the bundled placeholder build.
    artifactPath: process.env.LOADER_ARTIFACT
      ? path.resolve(ROOT, process.env.LOADER_ARTIFACT)
      : path.join(ROOT, 'loader', 'dist', 'Sanction.Loader.exe'),
    sha256: process.env.LOADER_SHA256 || ''
  }
};

config.plans = [
  {
    id: 'p30',
    code: 'SANCTION-30',
    days: 30,
    name: '30 days',
    subtitle: 'Trial run',
    price: int(process.env.PRICE_30, 690),
    oldPrice: int(process.env.PRICE_30_OLD, 990),
    badge: '',
    accent: 'steel',
    features: ['full feature set', '1 device (HWID)', '3 HWID resets', 'priority queue', 'auto updates']
  },
  {
    id: 'p90',
    code: 'SANCTION-90',
    days: 90,
    name: '90 days',
    subtitle: 'Most picked',
    price: int(process.env.PRICE_90, 1590),
    oldPrice: int(process.env.PRICE_90_OLD, 2970),
    badge: 'popular',
    accent: 'azure',
    features: ['full feature set', '1 device (HWID)', '5 HWID resets', 'priority queue', 'auto updates', 'private channel access']
  },
  {
    id: 'p180',
    code: 'SANCTION-180',
    days: 180,
    name: '180 days',
    subtitle: 'Best value',
    price: int(process.env.PRICE_180, 2690),
    oldPrice: int(process.env.PRICE_180_OLD, 5940),
    badge: 'value',
    accent: 'ice',
    features: ['full feature set', '1 device (HWID)', '8 HWID resets', 'priority queue', 'auto updates', 'private channel access', 'dedicated support line']
  }
];

config.planByCode = Object.fromEntries(config.plans.map((p) => [p.code, p]));
config.planById = Object.fromEntries(config.plans.map((p) => [p.id, p]));

module.exports = config;
