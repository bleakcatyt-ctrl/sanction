'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const { now, randomToken, safeEqual } = require('./lib');
const { HttpError } = require('./http');

/* ---------- пароли: scrypt + соль ---------- */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

function scrypt(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? reject(e) : resolve(k)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = { N: +parts[1], r: +parts[2], p: +parts[3], keylen: Buffer.from(parts[5], 'base64').length };
  if (!(params.N >= 4096 && params.N <= 1 << 20)) return false;
  const key = await scrypt(password, Buffer.from(parts[4], 'base64'), params);
  return crypto.timingSafeEqual(key, Buffer.from(parts[5], 'base64'));
}

// Фиктивный хеш — чтобы вход по несуществующему email занимал столько же времени
let dummyHash;
async function dummyVerify(password) {
  dummyHash ||= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

const COMMON = new Set(['password', 'password1', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', 'passw0rd123', 'iloveyou123', 'admin12345', '0123456789', '1q2w3e4r5t', 'qwertyuiop123', 'пароль1234']);
function validatePassword(password, email) {
  if (typeof password !== 'string') throw new HttpError(400, 'Укажите пароль');
  if (password.length < 10) throw new HttpError(400, 'Пароль должен быть не короче 10 символов');
  if (password.length > 200) throw new HttpError(400, 'Пароль слишком длинный');
  if (COMMON.has(password.toLowerCase())) throw new HttpError(400, 'Слишком простой пароль');
  if (email && password.toLowerCase() === String(email).toLowerCase()) throw new HttpError(400, 'Пароль не должен совпадать с email');
  if (/^(.)\1+$/.test(password)) throw new HttpError(400, 'Слишком простой пароль');
}

const EMAIL_RE = /^[^\s@<>"']{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new HttpError(400, 'Некорректный email');
  return e;
}

/* ---------- сессии ---------- */
const SESSION_DAYS = 30;
const COOKIE_NAME = config.secureCookies ? '__Host-vk' : 'vk';
// В БД хранится не сам токен, а HMAC от него — утечка БД не даёт войти в чужие сессии.
const hashToken = (t) => crypto.createHmac('sha256', config.sessionSecret).update(t).digest('hex');

function createSession(db, userId, userAgent = '') {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const t = now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at, user_agent) VALUES (?,?,?,?,?,?)')
    .run(hashToken(token), userId, csrf, t, t + SESSION_DAYS * 86400_000, String(userAgent).slice(0, 200));
  return { token, csrf, maxAge: SESSION_DAYS * 86400 };
}

function getSession(db, token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const row = db.prepare(`SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.email, u.name, u.pro_until, u.stack, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(hashToken(token));
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return {
    csrf: row.csrf,
    user: { id: row.id, email: row.email, name: row.name, pro_until: row.pro_until, stack: safeJson(row.stack, []), created_at: row.created_at },
    tokenHash: row.token_hash,
  };
}

const destroySession = (db, tokenHash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
const destroyOtherSessions = (db, userId, keepHash) => db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keepHash);
const purgeExpiredSessions = (db) => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());

function safeJson(s, def) { try { return JSON.parse(s); } catch { return def; } }

const isPro = (user) => !!user && user.pro_until > now();
const publicUser = (user) => user && ({
  id: user.id, email: user.email, name: user.name, stack: user.stack,
  pro: isPro(user), pro_until: user.pro_until > now() ? user.pro_until : null,
});

module.exports = {
  hashPassword, verifyPassword, dummyVerify, validatePassword, normalizeEmail,
  createSession, getSession, destroySession, destroyOtherSessions, purgeExpiredSessions,
  COOKIE_NAME, isPro, publicUser, safeJson, safeEqual,
};
