'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { now, sha256, hmacSha256, safeEqual, clientIp, userAgent } = require('./util');

const COOKIE = config.session.cookieName;

function cookieOpts(expires) {
  return {
    httpOnly: true,
    secure: config.session.secureCookie,
    sameSite: config.session.sameSite,
    path: '/',
    ...(expires ? { expires } : {})
  };
}

function create(req, userId, { adminGate = 0 } = {}) {
  const id = crypto.randomBytes(24).toString('base64url');
  const tokenHash = sha256(id);
  const expiresAt = now() + config.session.ttlSeconds * 1000;
  db.run(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen, ip, user_agent, admin_gate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    tokenHash, userId, now(), expiresAt, now(), clientIp(req), userAgent(req), adminGate ? 1 : 0
  );
  if (req && req.res) req.res.cookie(COOKIE, id, cookieOpts(new Date(expiresAt)));
  return { id, tokenHash, expiresAt };
}

function read(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const row = db.get('SELECT * FROM sessions WHERE id = ?', sha256(raw));
  if (!row) return null;
  if (row.expires_at < now()) { destroy(req, raw); return null; }
  return { session: row, token: raw, tokenHash: sha256(raw) };
}

function touch(req, tokenHash) {
  db.run('UPDATE sessions SET last_seen = ? WHERE id = ?', now(), tokenHash);
}

function destroy(req, raw) {
  if (raw) db.run('DELETE FROM sessions WHERE id = ?', sha256(raw));
  if (req && req.res) req.res.clearCookie(COOKIE, cookieOpts());
}

function destroyForUser(userId, keepTokenHash = null) {
  if (keepTokenHash) db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, keepTokenHash);
  else db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function purgeExpired() {
  return db.run('DELETE FROM sessions WHERE expires_at < ?', now()).changes;
}

function setAdminGate(req, value) {
  const s = read(req);
  if (!s) return false;
  db.run('UPDATE sessions SET admin_gate = ? WHERE id = ?', value ? 1 : 0, s.tokenHash);
  return true;
}

/* ------------------------------------------------------------------ csrf -- */

function csrfToken(tokenHash) {
  return hmacSha256(config.secrets.session, `csrf|${tokenHash}`).slice(0, 43);
}

function verifyCsrf(req) {
  const s = read(req);
  if (!s) return false;
  const sent = req.get('x-csrf-token') || req.body?.csrf || req.query?.csrf || '';
  if (!sent) return false;
  return safeEqual(sent, csrfToken(s.tokenHash));
}

/**
 * Writes that must stay reachable without a matching CSRF token.
 *
 * Login and register are the entry points: the page a visitor is looking at may
 * have been rendered before the current session existed (a stale tab, a second
 * registration, a session recreated after a DB reset), in which case the page
 * carries an empty token and enforcing it would dead-end the user on the very
 * form they are submitting with "Сессия устарела" — refresh does not help.
 * Both routes rotate the session on success (see routes/auth.js), which removes
 * the session-fixation value a token would otherwise add here.
 */
const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/register']);

/** Middleware: attach req.user / req.session / req.csrf and enforce CSRF on writes. */
function attach(req, res, next) {
  const found = read(req);
  req.sessionRecord = found ? found.session : null;
  req.sessionToken = found ? found.token : null;
  req.sessionTokenHash = found ? found.tokenHash : null;

  if (found) {
    const user = db.get('SELECT * FROM users WHERE id = ?', found.session.user_id);
    if (user && user.status !== 'banned') {
      req.user = user;
      req.isAdminSession = !!found.session.admin_gate;
      req.csrf = csrfToken(found.tokenHash);
      touch(req, found.tokenHash);
    } else {
      destroy(req, found.token);
    }
  }
  if (!req.csrf) req.csrf = '';

  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && req.sessionTokenHash && !CSRF_EXEMPT.has(req.path)) {
    // Webhook routes opt out via req.skipCsrf = true (set by the route module).
    if (!req.skipCsrf && !verifyCsrf(req)) {
      const wantsJson = req.path.startsWith('/api/') || req.get('accept')?.includes('json');
      if (wantsJson) return res.status(403).json({ ok: false, error: 'csrf_failed', message: 'Сессия устарела. Обновите страницу и повторите.' });
      return res.status(403).render('error', { title: '403', code: 403, message: 'Недействительный CSRF-токен. Вернитесь назад и повторите действие.' });
    }
  }
  next();
}

module.exports = { create, read, touch, destroy, destroyForUser, purgeExpired, setAdminGate, csrfToken, verifyCsrf, attach, COOKIE };
