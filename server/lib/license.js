'use strict';

/**
 * License / subscription lifecycle. This is the single source of truth shared
 * by the website, the billing pipeline and the loader API.
 */

const db = require('../db');
const config = require('../config');
const audit = require('./audit');
const passwords = require('./passwords');
const util = require('./util');

const { now, randomKey, randomLoaderLogin, randomLoaderPassword, sha256 } = util;
const ENC_PURPOSE = 'loader-credential';

const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ reads -- */

const PUBLIC_COLUMNS = `id, user_id, order_id, license_key, loader_login, plan_code, days, status,
  created_at, activated_at, expires_at, hwid, hwid_label, hwid_bound_at, hwid_resets_left,
  hwid_reset_at, max_devices, last_seen_at, last_seen_ip, loader_version, revoked_reason, note, fail_count, locked_until`;

function byId(id) { return db.get(`SELECT ${PUBLIC_COLUMNS} FROM licenses WHERE id = ?`, id); }
function byKey(key) { return db.get(`SELECT ${PUBLIC_COLUMNS} FROM licenses WHERE license_key = ?`, String(key || '').trim().toUpperCase()); }
function byLogin(login) { return db.get(`SELECT ${PUBLIC_COLUMNS} FROM licenses WHERE loader_login = ?`, String(login || '').trim().toLowerCase()); }
function byUser(userId) { return db.all(`SELECT ${PUBLIC_COLUMNS} FROM licenses WHERE user_id = ? ORDER BY id DESC`, userId); }
function all({ limit = 100, offset = 0, search = '', status = '' } = {}) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(license_key LIKE ? OR loader_login LIKE ? OR hwid LIKE ? OR CAST(user_id AS TEXT) = ?)');
    const s = `%${search}%`;
    params.push(s, s, s, /^\d+$/.test(search) ? search : '-1');
  }
  if (status) { where.push('status = ?'); params.push(status); }
  const sql = `SELECT ${PUBLIC_COLUMNS}, (SELECT username FROM users u WHERE u.id = licenses.user_id) AS username
               FROM licenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT ? OFFSET ?`;
  return db.all(sql, ...params, limit, offset);
}
function countAll({ search = '', status = '' } = {}) {
  const where = []; const params = [];
  if (search) { where.push('(license_key LIKE ? OR loader_login LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (status) { where.push('status = ?'); params.push(status); }
  return db.pluck(`SELECT COUNT(*) FROM licenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params) || 0;
}

/* ------------------------------------------------------------- computed --- */

function activationMode() {
  return db.setting('license.activation_mode', 'on_first_login'); // on_first_login | on_purchase
}

/** Normalised view of a license, always recomputed from the clock. */
function state(license) {
  if (!license) return null;
  const t = now();
  let status = license.status;
  let expired = false;

  if ((status === 'active') && license.expires_at && license.expires_at <= t) {
    status = 'expired';
    expired = true;
  }
  const graceMs = config.licensing.graceMinutes * 60_000;
  const usable = status === 'active' && !expired && (!license.expires_at || license.expires_at + graceMs > t);
  // A paid key that has not been activated yet must stay downloadable: with the
  // default on_first_login activation the loader itself is what activates the
  // license, so gating the download on `usable` would make the very first
  // download unreachable and the key could never start.
  const downloadable = (status === 'active' || status === 'pending') && !expired;

  return {
    ...license,
    status,
    expired,
    usable,
    downloadable,
    activated: !!license.activated_at,
    remaining_ms: license.expires_at ? Math.max(0, license.expires_at - t) : null,
    remaining_days: license.expires_at ? Math.max(0, Math.floor((license.expires_at - t) / DAY)) : null,
    hwid_bound: !!license.hwid,
    days_left_label: license.expires_at ? util.msToHuman(Math.max(0, license.expires_at - t)) : '—'
  };
}

/* -------------------------------------------------------------- creation -- */

function uniqueLoaderLogin() {
  for (let i = 0; i < 40; i++) {
    const login = randomLoaderLogin();
    if (!db.get('SELECT id FROM licenses WHERE loader_login = ?', login)) return login;
  }
  return `snc_${sha256(util.randomHex(8)).slice(0, 8)}`;
}

function uniqueKey() {
  for (let i = 0; i < 40; i++) {
    const key = randomKey(4, 4, 'SNC');
    if (!db.get('SELECT id FROM licenses WHERE license_key = ?', key)) return key;
  }
  throw new Error('cannot_allocate_key');
}

/**
 * Provision a license. Called by the billing pipeline right after an order is
 * marked paid, and by the admin panel for manual / bulk key generation.
 */
function issue({ userId, orderId = null, planCode, days = null, hwidResets = null, maxDevices = null, note = null, actor = 'system', ip = null, activateNow = false }) {
  const plan = config.planByCode[planCode];
  if (!plan) throw new Error(`unknown plan: ${planCode}`);
  const duration = days || plan.days;

  const login = uniqueLoaderLogin();
  const password = randomLoaderPassword(14);
  const key = uniqueKey();
  const t = now();

  const status = activateNow || activationMode() === 'on_purchase' ? 'active' : 'pending';
  const activatedAt = status === 'active' ? t : null;
  const expiresAt = status === 'active' ? t + duration * DAY : null;
  const resets = hwidResets === null ? (plan.id === 'p30' ? 3 : plan.id === 'p90' ? 5 : 8) : hwidResets;

  const res = db.run(
    `INSERT INTO licenses
       (user_id, order_id, license_key, loader_login, loader_password_enc, loader_password_hash,
        plan_code, days, status, created_at, activated_at, expires_at, hwid_resets_left, max_devices, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, orderId, key, login,
    passwords.encrypt(password, ENC_PURPOSE),
    passwords.hashPassword(password),
    planCode, duration, status, t, activatedAt, expiresAt,
    resets, maxDevices || config.licensing.devicesPerLicense, note
  );

  const license = byId(res.id);

  audit.log(actor === 'system' ? 'system' : 'admin', actor === 'system' ? null : actor, 'license.issued', {
    targetType: 'license', targetId: String(license.id),
    meta: { plan: planCode, days: duration, order_id: orderId, login }, ip
  });

  notify(userId, 'Доступ активирован', `Ваш ключ ${planCode} готов. Логин и пароль лоадера доступны в личном кабинете.`, '/dashboard/license', 'success');

  return { license, password };
}

function notify(userId, title, body, link = null, kind = 'info') {
  if (!userId) return;
  db.run(
    'INSERT INTO notifications (user_id, kind, title, body, link, seen, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    userId, kind, title, body, link, now()
  );
}

/* ----------------------------------------------------------- activation --- */

/**
 * First successful loader login starts the clock (mode = on_first_login).
 * Returns the fresh license row.
 */
function activate(license, { ip = null, build = null } = {}) {
  const t = now();
  if (license.status === 'pending') {
    db.run(
      `UPDATE licenses SET status = 'active', activated_at = ?, expires_at = ?, last_seen_at = ?, last_seen_ip = ?, loader_version = COALESCE(?, loader_version)
       WHERE id = ?`,
      t, t + license.days * DAY, t, ip, build, license.id
    );
    audit.log('loader', license.id, 'license.activated', { targetType: 'license', targetId: String(license.id), meta: { plan: license.plan_code, days: license.days, build }, ip });
    notify(license.user_id, 'Подписка запущена', `Отсчёт ${license.days} дней начался. Действует до ${util.formatDate(t + license.days * DAY)}.`, '/dashboard/license', 'success');
    return byId(license.id);
  }
  db.run('UPDATE licenses SET last_seen_at = ?, last_seen_ip = ?, loader_version = COALESCE(?, loader_version) WHERE id = ?', t, ip, build, license.id);
  return byId(license.id);
}

/* ------------------------------------------------------------- expiry ----- */

function sweep() {
  const t = now();
  const due = db.all(`SELECT ${PUBLIC_COLUMNS} FROM licenses WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`, t);
  for (const lic of due) {
    db.run(`UPDATE licenses SET status = 'expired' WHERE id = ?`, lic.id);
    db.run(`UPDATE loader_sessions SET state = 'revoked', revoked_reason = 'expired' WHERE license_id = ? AND state != 'revoked'`, lic.id);
    audit.log('system', null, 'license.expired', { targetType: 'license', targetId: String(lic.id), meta: { plan: lic.plan_code, expired_at: lic.expires_at } });
    notify(lic.user_id, 'Подписка истекла', `Доступ ${lic.plan_code} закончился ${util.formatDate(lic.expires_at)}. Продлите, чтобы продолжить.`, '/pricing', 'warning');
  }
  // pending keys never expire, but abandoned orders do
  db.run(`UPDATE orders SET status = 'expired' WHERE status IN ('created','pending') AND expires_at IS NOT NULL AND expires_at <= ?`, t);
  return due.length;
}

/* --------------------------------------------------------------- HWID ----- */

function normalizeHwid(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
  if (s.length < 16) return null;
  return s.length === 64 ? s : sha256(s);
}

function isBlacklisted(hwid) {
  return !!db.get('SELECT hwid FROM hwid_blacklist WHERE hwid = ?', hwid);
}

function bindHwid(license, hwidRaw, { label = null, ip = null, actor = 'loader' } = {}) {
  const hwid = normalizeHwid(hwidRaw);
  if (!hwid) return { ok: false, reason: 'invalid_hwid' };
  if (isBlacklisted(hwid)) return { ok: false, reason: 'hwid_blacklisted' };

  if (!license.hwid) {
    db.run('UPDATE licenses SET hwid = ?, hwid_label = ?, hwid_bound_at = ? WHERE id = ?', hwid, label, now(), license.id);
    db.run('INSERT OR IGNORE INTO license_devices (license_id, hwid, label, bound_at) VALUES (?, ?, ?, ?)', license.id, hwid, label, now());
    audit.log(actor, license.id, 'hwid.bound', { targetType: 'license', targetId: String(license.id), meta: { hwid: hwid.slice(0, 12) + '…', label }, ip });
    return { ok: true, hwid, changed: false };
  }
  if (license.hwid === hwid) {
    if (label) db.run('UPDATE licenses SET hwid_label = ? WHERE id = ?', label, license.id);
    return { ok: true, hwid, changed: false };
  }
  return { ok: false, reason: 'hwid_mismatch', hwid };
}

function canResetHwid(license) {
  if (!license.hwid) return { ok: true, reason: 'not_bound' };
  if (license.hwid_resets_left <= 0) return { ok: false, reason: 'no_resets_left' };
  const cooldownMs = config.licensing.hwidResetCooldownHours * 3600_000;
  if (license.hwid_reset_at && now() - license.hwid_reset_at < cooldownMs) {
    const left = util.msToHuman(cooldownMs - (now() - license.hwid_reset_at));
    return { ok: false, reason: 'cooldown', message: `Следующий сброс доступен через ${left}` };
  }
  return { ok: true };
}

function resetHwid(license, { newHwid = null, label = null, ip = null, actor = 'user', actorId = null, force = false } = {}) {
  const old = license.hwid;
  if (!force) {
    const check = canResetHwid(license);
    if (!check.ok) return { ok: false, ...check };
    if (license.hwid_resets_left > 0) {
      db.run('UPDATE licenses SET hwid_resets_left = hwid_resets_left - 1 WHERE id = ?', license.id);
    }
  }
  const normalized = newHwid ? normalizeHwid(newHwid) : null;
  if (normalized && isBlacklisted(normalized)) return { ok: false, reason: 'hwid_blacklisted' };

  db.run(
    'UPDATE licenses SET hwid = ?, hwid_label = ?, hwid_bound_at = ?, hwid_reset_at = ? WHERE id = ?',
    normalized, normalized ? label : null, normalized ? now() : null, now(), license.id
  );
  if (old) db.run('UPDATE license_devices SET revoked_at = ? WHERE license_id = ? AND hwid = ? AND revoked_at IS NULL', now(), license.id, old);
  if (normalized) db.run('INSERT OR IGNORE INTO license_devices (license_id, hwid, label, bound_at) VALUES (?, ?, ?, ?)', license.id, normalized, label, now());
  db.run(`UPDATE loader_sessions SET state = 'revoked', revoked_reason = 'hwid_reset' WHERE license_id = ? AND state = 'authed'`, license.id);

  db.run('INSERT INTO hwid_resets (license_id, old_hwid, new_hwid, actor, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    license.id, old, normalized, actor, ip, now());
  audit.log(actor === 'user' ? 'user' : 'admin', actorId ?? license.id, 'hwid.reset', { targetType: 'license', targetId: String(license.id), meta: { old: old ? old.slice(0, 12) + '…' : null, force }, ip });
  return { ok: true, old, new: normalized };
}

/* --------------------------------------------------------- credentials ---- */

/**
 * Secrets never live on the license rows that flow through the app: they are
 * read straight from the database on demand and returned only to callers that
 * are allowed to see them.
 */
function passwordHash(licenseId) {
  return db.pluck('SELECT loader_password_hash FROM licenses WHERE id = ?', licenseId);
}

function verifyPassword(license, plain) {
  const hash = passwordHash(license.id);
  return Boolean(hash) && passwords.verifyPassword(String(plain ?? ''), hash);
}

function credentials(license) {
  const enc = db.pluck('SELECT loader_password_enc FROM licenses WHERE id = ?', license.id);
  return {
    login: license.loader_login,
    password: passwords.decrypt(enc, ENC_PURPOSE)
  };
}

function rotateCredentials(license, { actor = 'admin', actorId = null, ip = null } = {}) {
  const password = randomLoaderPassword(16);
  db.run('UPDATE licenses SET loader_password_enc = ?, loader_password_hash = ?, fail_count = 0, locked_until = NULL WHERE id = ?',
    passwords.encrypt(password, ENC_PURPOSE), passwords.hashPassword(password), license.id);
  db.run(`UPDATE loader_sessions SET state = 'revoked', revoked_reason = 'credentials_rotated' WHERE license_id = ?`, license.id);
  audit.log(actor, actorId, 'license.credentials_rotated', { targetType: 'license', targetId: String(license.id), ip });
  notify(license.user_id, 'Пароль лоадера изменён', 'Старый пароль больше не действует. Новый доступен в личном кабинете.', '/dashboard/license', 'warning');
  return password;
}

/* ------------------------------------------------------------ operations -- */

/**
 * Add days to a license.
 *   never activated -> the term simply grows, the clock stays off
 *   active          -> days stack onto the remaining time
 *   expired         -> a fresh term starts from now
 */
function extend(license, addDays, { actor = 'admin', actorId = null, ip = null, note = null } = {}) {
  const t = now();
  const totalDays = (license.days || 0) + addDays;
  let expiresAt = license.expires_at;
  let status = license.status;
  const activatedAt = license.activated_at;

  if (!['revoked', 'banned'].includes(license.status)) {
    if (!activatedAt) {
      status = license.status === 'expired' ? 'pending' : license.status;
      expiresAt = null;
    } else if (!expiresAt || expiresAt <= t) {
      expiresAt = t + addDays * DAY;
      status = 'active';
    } else {
      expiresAt = expiresAt + addDays * DAY;
      status = 'active';
    }
  }

  db.run(
    `UPDATE licenses SET days = ?, expires_at = ?, status = ?, activated_at = ?, revoked_reason = NULL, note = COALESCE(?, note) WHERE id = ?`,
    totalDays, expiresAt, status, activatedAt, note, license.id
  );

  if (status === 'active') {
    db.run(`UPDATE loader_sessions SET state = 'authed', revoked_reason = NULL WHERE license_id = ? AND revoked_reason IN ('expired','admin')`, license.id);
  }

  audit.log(actor, actorId, 'license.extended', {
    targetType: 'license', targetId: String(license.id),
    meta: { added: addDays, total_days: totalDays, expires_at: expiresAt, status }, ip
  });
  notify(license.user_id, status === 'active' ? 'Подписка продлена' : 'Срок увеличен',
    status === 'active'
      ? `Добавлено ${addDays} дн. Доступ действует до ${util.formatDate(expiresAt)}.`
      : `Добавлено ${addDays} дн. Отсчёт начнётся с первого запуска лоадера.`,
    '/dashboard/license', 'success');
  return byId(license.id);
}

function changePlan(license, planCode, { actor = 'admin', actorId = null, ip = null } = {}) {
  const plan = config.planByCode[planCode];
  if (!plan) throw new Error('unknown plan');
  db.run('UPDATE licenses SET plan_code = ?, days = ? WHERE id = ?', planCode, plan.days, license.id);
  audit.log(actor, actorId, 'license.plan_changed', { targetType: 'license', targetId: String(license.id), meta: { from: license.plan_code, to: planCode }, ip });
  return byId(license.id);
}

function revoke(license, reason = 'revoked_by_admin', { actor = 'admin', actorId = null, ip = null } = {}) {
  db.run(`UPDATE licenses SET status = 'revoked', revoked_reason = ? WHERE id = ?`, reason, license.id);
  db.run(`UPDATE loader_sessions SET state = 'revoked', revoked_reason = ? WHERE license_id = ?`, reason, license.id);
  audit.log(actor, actorId, 'license.revoked', { targetType: 'license', targetId: String(license.id), meta: { reason }, ip });
  notify(license.user_id, 'Доступ отозван', `Ключ ${license.plan_code} отозван. Причина: ${reason}.`, '/dashboard/license', 'error');
  return byId(license.id);
}

function restore(license, { actor = 'admin', actorId = null, ip = null } = {}) {
  const t = now();
  const status = license.activated_at ? (license.expires_at && license.expires_at <= t ? 'expired' : 'active') : 'pending';
  db.run(`UPDATE licenses SET status = ?, revoked_reason = NULL WHERE id = ?`, status, license.id);
  audit.log(actor, actorId, 'license.restored', { targetType: 'license', targetId: String(license.id), ip });
  return byId(license.id);
}

/* ------------------------------------------------------------- statistics -- */

function stats() {
  const t = now();
  sweepLight();
  return {
    total: db.pluck('SELECT COUNT(*) FROM licenses') || 0,
    active: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)`, t) || 0,
    pending: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status = 'pending'`) || 0,
    expired: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status = 'expired' OR (status='active' AND expires_at <= ?)`, t) || 0,
    revoked: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status IN ('revoked','banned')`) || 0,
    expiring7d: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status='active' AND expires_at > ? AND expires_at <= ?`, t, t + 7 * DAY) || 0,
    online: db.pluck(`SELECT COUNT(DISTINCT license_id) FROM loader_sessions WHERE state='authed' AND (last_heartbeat IS NULL OR last_heartbeat > ?)`, t - config.security.heartbeatTtlSeconds * 1000) || 0,
    byPlan: db.all(`SELECT plan_code, COUNT(*) AS c FROM licenses GROUP BY plan_code ORDER BY c DESC`)
  };
}

/** Cheap variant used on hot paths — no notifications, no audit. */
function sweepLight() {
  const t = now();
  db.run(`UPDATE licenses SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`, t);
}

module.exports = {
  DAY,
  byId, byKey, byLogin, byUser, all, countAll, state, activationMode,
  issue, activate, sweep, sweepLight,
  normalizeHwid, isBlacklisted, bindHwid, canResetHwid, resetHwid,
  credentials, verifyPassword, passwordHash, rotateCredentials,
  extend, changePlan, revoke, restore,
  stats, notify
};
