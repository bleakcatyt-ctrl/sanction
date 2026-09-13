'use strict';

const crypto = require('node:crypto');

const now = () => Date.now();
const sec = () => Math.floor(Date.now() / 1000);

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomId(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

/** Crockford-ish alphabet, no ambiguous chars — keys look professional and are easy to type. */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomKey(groups = 4, size = 4, prefix = 'SNC') {
  const bytes = crypto.randomBytes(groups * size);
  const parts = [];
  for (let g = 0; g < groups; g++) {
    let part = '';
    for (let i = 0; i < size; i++) part += KEY_ALPHABET[bytes[g * size + i] % KEY_ALPHABET.length];
    parts.push(part);
  }
  return prefix ? `${prefix}-${parts.join('-')}` : parts.join('-');
}

/** Loader login is short, memorable and unique-ish: snc_k7qm2z */
function randomLoaderLogin() {
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `snc_${suffix.toLowerCase()}`;
}

/** Strong pronounceable-ish password for the loader credential pair. */
function randomLoaderPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const symbol = '!@#$%&*?+-';
  const all = upper + lower + digit + symbol;
  const bytes = crypto.randomBytes(length + 8);
  const out = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digit[bytes[2] % digit.length],
    symbol[bytes[3] % symbol.length]
  ];
  for (let i = 4; i < length; i++) out.push(all[bytes[i] % all.length]);
  // Fisher-Yates with crypto randomness
  for (let i = out.length - 1; i > 0; i--) {
    const j = bytes[length + (i % 8)] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // keep timing uniform
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromBase64url(str) {
  return Buffer.from(String(str), 'base64url');
}

/**
 * Client address for rate limits, audit and license bindings.
 *
 * Express resolves req.ip against the configured `trust proxy` depth, so a
 * spoofed X-Forwarded-For is ignored when the app is exposed directly. The raw
 * header is only used as a fallback for non-express callers (tests, scripts).
 */
function clientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || firstForwarded(req) || '';
  // Collapse IPv4-mapped IPv6 so 1.2.3.4 and ::ffff:1.2.3.4 share one bucket.
  return raw.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
}

function firstForwarded(req) {
  const xff = req.headers?.['x-forwarded-for'];
  return typeof xff === 'string' && xff.length ? xff.split(',')[0].trim() : '';
}

function userAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 255);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function msToHuman(ms) {
  if (ms === null || ms === undefined) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function dateFmt(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function formatDate(ts, locale = 'ru-RU') {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  try {
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function money(minor, currency = 'RUB') {
  const value = minor / 100;
  const formatted = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  return currency === 'RUB' ? `${formatted} ₽` : `${formatted} ${currency}`;
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email || '').trim());
}

function isValidUsername(name) {
  return /^[a-zA-Z0-9_.\-]{3,24}$/.test(String(name || '').trim());
}

function maskSecret(s, keep = 4) {
  const str = String(s || '');
  if (str.length <= keep) return '*'.repeat(str.length);
  return str.slice(0, keep) + '*'.repeat(Math.min(12, str.length - keep));
}

function jsonParse(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function jsonStringify(obj) {
  try { return JSON.stringify(obj ?? null); } catch { return null; }
}

function truncate(str, n = 80) {
  const s = String(str ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  now, sec, randomHex, randomId, randomKey, randomLoaderLogin, randomLoaderPassword,
  safeEqual, sha256, hmacSha256, base64url, fromBase64url, clientIp, firstForwarded, userAgent,
  clamp, toInt, slugify, msToHuman, dateFmt, formatDate, money, compareVersions,
  isValidEmail, isValidUsername, maskSecret, jsonParse, jsonStringify, truncate, escapeHtml,
  KEY_ALPHABET
};
