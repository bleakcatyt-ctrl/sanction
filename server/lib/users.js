'use strict';

const db = require('../db');
const audit = require('./audit');
const passwords = require('./passwords');
const perms = require('./permissions');
const util = require('./util');

const { now, isValidEmail, isValidUsername, sha256 } = util;

const SAFE_COLUMNS = `id, username, email, role, status, email_verified, is_admin, created_at, updated_at,
  last_login_at, last_login_ip, avatar_seed, failed_logins, locked_until, admin_gate_ok_at`;

function byId(id) { return db.get(`SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE id = ?`, id); }
function byUsername(name) { return db.get(`SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE username = ? COLLATE NOCASE`, String(name || '').trim()); }
function byEmail(email) { return db.get(`SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE email = ? COLLATE NOCASE`, String(email || '').trim()); }
function find(loginOrEmail) {
  const v = String(loginOrEmail || '').trim();
  return byUsername(v) || byEmail(v);
}
function exists(identifier) { return Boolean(find(identifier)); }

function publicProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    is_admin: !!user.is_admin,
    email_verified: !!user.email_verified,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    avatar_seed: user.avatar_seed,
    permissions: user.is_admin || user.role === 'owner' || user.role === 'admin' ? [...perms.effectiveFor(user)] : []
  };
}

function validateSignup({ username, email, password }) {
  const errors = [];
  if (!isValidUsername(username)) errors.push({ field: 'username', message: 'Логин: 3–24 символа, только латиница, цифры, _ . -' });
  if (!isValidEmail(email)) errors.push({ field: 'email', message: 'Некорректный e-mail' });
  if (String(password || '').length < 8) errors.push({ field: 'password', message: 'Пароль минимум 8 символов' });
  if (exists(username)) errors.push({ field: 'username', message: 'Такой логин уже занят' });
  if (byEmail(email)) errors.push({ field: 'email', message: 'Такой e-mail уже зарегистрирован' });
  return errors;
}

function create({ username, email, password, role = 'user', is_admin = 0, ip = null, permissions = null }) {
  const t = now();
  const res = db.run(
    `INSERT INTO users (username, email, password_hash, role, status, is_admin, created_at, updated_at, last_login_ip, avatar_seed)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    username.trim(), email.trim().toLowerCase(), passwords.hashPassword(password), role, is_admin ? 1 : 0, t, t, ip, sha256(username).slice(0, 12)
  );
  if (permissions && permissions.length) perms.replaceSet(res.id, permissions, res.id);
  audit.log('system', null, 'user.registered', { targetType: 'user', targetId: String(res.id), meta: { username, email }, ip });
  return byId(res.id);
}

function verifyCredentials(user, password) {
  if (!user) return { ok: false, reason: 'invalid_credentials' };
  if (user.status === 'banned') return { ok: false, reason: 'banned' };
  if (user.locked_until && user.locked_until > now()) {
    return { ok: false, reason: 'locked', message: `Вход заблокирован ещё на ${util.msToHuman(user.locked_until - now())}` };
  }
  if (!passwords.verifyPassword(password, user.password_hash)) return { ok: false, reason: 'invalid_credentials' };
  return { ok: true };
}

function registerFailure(user, ip) {
  const fails = (user?.failed_logins || 0) + 1;
  const lock = fails >= require('../config').security.loginMaxAttempts
    ? now() + require('../config').security.loginLockMinutes * 60_000
    : null;
  if (user) {
    db.run('UPDATE users SET failed_logins = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?', fails, lock, user.id);
  }
  audit.log('system', user ? String(user.id) : null, 'auth.failed', { targetType: 'user', targetId: user ? String(user.id) : null, meta: { fails, lock }, ip });
  return { fails, lock };
}

function registerSuccess(user, ip) {
  db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ? WHERE id = ?', now(), ip, user.id);
  audit.log('user', user.id, 'auth.login', { targetType: 'user', targetId: String(user.id), ip });
  return byId(user.id);
}

function setPassword(userId, newPassword) {
  db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', passwords.hashPassword(newPassword), now(), userId);
}

function updateProfile(userId, { email = null, username = null }) {
  const fields = []; const params = [];
  if (email) { fields.push('email = ?'); params.push(email.trim().toLowerCase()); }
  if (username) { fields.push('username = ?'); params.push(username.trim()); }
  if (!fields.length) return byId(userId);
  fields.push('updated_at = ?'); params.push(now());
  params.push(userId);
  db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...params);
  return byId(userId);
}

function setStatus(userId, status, { actor = 'admin', actorId = null, ip = null, reason = null } = {}) {
  db.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, now(), userId);
  if (status === 'banned') {
    db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    db.run(`UPDATE licenses SET status = 'banned', revoked_reason = ? WHERE user_id = ? AND status IN ('pending','active')`, reason || 'user_banned', userId);
    db.run(`UPDATE loader_sessions SET state = 'revoked', revoked_reason = 'user_banned' WHERE license_id IN (SELECT id FROM licenses WHERE user_id = ?)`, userId);
  }
  audit.log(actor, actorId, `user.status.${status}`, { targetType: 'user', targetId: String(userId), meta: { reason }, ip });
  return byId(userId);
}

function list({ limit = 50, offset = 0, search = '', role = '', status = '' } = {}) {
  const where = []; const params = [];
  if (search) { where.push('(username LIKE ? OR email LIKE ? OR CAST(id AS TEXT) = ?)'); params.push(`%${search}%`, `%${search}%`, /^\d+$/.test(search) ? search : '-1'); }
  if (role) { where.push('role = ?'); params.push(role); }
  if (status) { where.push('status = ?'); params.push(status); }
  const rows = db.all(
    `SELECT ${SAFE_COLUMNS.split(',').map((c) => `u.${c.trim()}`).join(', ')},
            (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id) AS licenses_count,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status='paid') AS paid_orders,
            (SELECT COALESCE(SUM(o.amount),0) FROM orders o WHERE o.user_id = u.id AND o.status='paid') AS total_spent
     FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  return rows;
}

function countAll({ search = '', role = '', status = '' } = {}) {
  const where = []; const params = [];
  if (search) { where.push('(username LIKE ? OR email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (role) { where.push('role = ?'); params.push(role); }
  if (status) { where.push('status = ?'); params.push(status); }
  return db.pluck(`SELECT COUNT(*) FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params) || 0;
}

function stats() {
  const t = now();
  const day = 86_400_000;
  return {
    total: db.pluck('SELECT COUNT(*) FROM users') || 0,
    today: db.pluck('SELECT COUNT(*) FROM users WHERE created_at >= ?', t - day) || 0,
    week: db.pluck('SELECT COUNT(*) FROM users WHERE created_at >= ?', t - 7 * day) || 0,
    banned: db.pluck(`SELECT COUNT(*) FROM users WHERE status='banned'`) || 0,
    staff: db.pluck(`SELECT COUNT(*) FROM users WHERE is_admin = 1 OR role IN ('admin','owner')`) || 0,
    activeSessions: db.pluck('SELECT COUNT(*) FROM sessions WHERE expires_at > ?', t) || 0
  };
}

module.exports = {
  SAFE_COLUMNS, byId, byUsername, byEmail, find, exists, publicProfile,
  validateSignup, create, verifyCredentials, registerFailure, registerSuccess,
  setPassword, updateProfile, setStatus, list, countAll, stats
};
