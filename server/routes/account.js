'use strict';

const express = require('express');
const fs = require('node:fs');
const config = require('../config');
const db = require('../db');
const users = require('../lib/users');
const licenseSvc = require('../lib/license');
const orders = require('../lib/orders');
const audit = require('../lib/audit');
const ratelimit = require('../lib/ratelimit');
const util = require('../lib/util');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'unauthenticated', message: 'Требуется вход.' });
  next();
}
router.use(requireAuth);

/** Personal view of a license, including the loader credential pair. */
function licenseView(lic, { withCredentials = true } = {}) {
  const st = licenseSvc.state(lic);
  const creds = withCredentials ? licenseSvc.credentials(lic) : null;
  return {
    id: lic.id,
    license_key: lic.license_key,
    plan_code: lic.plan_code,
    plan_name: config.planByCode[lic.plan_code]?.name || lic.plan_code,
    days: lic.days,
    status: st.status,
    usable: st.usable,
    downloadable: st.downloadable,
    activated_at: lic.activated_at,
    expires_at: lic.expires_at,
    remaining_ms: st.remaining_ms,
    remaining_days: st.remaining_days,
    remaining_label: st.days_left_label,
    hwid_bound: st.hwid_bound,
    hwid_short: lic.hwid ? lic.hwid.slice(0, 12).toUpperCase() + '…' : null,
    hwid_label: lic.hwid_label,
    hwid_bound_at: lic.hwid_bound_at,
    hwid_resets_left: lic.hwid_resets_left,
    hwid_reset_at: lic.hwid_reset_at,
    last_seen_at: lic.last_seen_at,
    loader_version: lic.loader_version,
    revoked_reason: lic.revoked_reason,
    loader: creds ? { login: creds.login, password: creds.password } : null,
    reset_available: licenseSvc.canResetHwid(lic)
  };
}

router.get('/licenses', (req, res) => {
  const list = licenseSvc.byUser(req.user.id).map((l) => licenseView(l));
  res.json({ ok: true, licenses: list });
});

router.get('/licenses/:id', (req, res) => {
  const lic = licenseSvc.byId(util.toInt(req.params.id));
  if (!lic || lic.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    license: licenseView(lic),
    devices: db.all('SELECT hwid, label, bound_at, revoked_at FROM license_devices WHERE license_id = ? ORDER BY id DESC', lic.id),
    resets: db.all('SELECT * FROM hwid_resets WHERE license_id = ? ORDER BY id DESC LIMIT 20', lic.id),
    events: db.all(`SELECT action, meta, ip, created_at FROM audit_log WHERE target_type='license' AND target_id = ? ORDER BY id DESC LIMIT 30`, String(lic.id))
  });
});

router.post('/licenses/:id/hwid-reset', ratelimit.middleware({ scope: 'hwid', limit: 6, windowMs: 3600_000 }), (req, res) => {
  const lic = licenseSvc.byId(util.toInt(req.params.id));
  if (!lic || lic.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'not_found' });

  const result = licenseSvc.resetHwid(lic, { ip: util.clientIp(req), actor: 'user', actorId: req.user.id });
  if (!result.ok) {
    return res.status(409).json({
      ok: false,
      error: result.reason,
      message: result.message || (result.reason === 'no_resets_left'
        ? 'Сбросы HWID закончились. Обратитесь в поддержку.'
        : 'Не удалось сбросить HWID.')
    });
  }
  licenseSvc.notify(req.user.id, 'HWID сброшен', 'Привязка устройства снята. Следующий вход в лоадер привяжет новое железо.', '/dashboard/license', 'info');
  res.json({ ok: true, message: 'HWID сброшен. Запустите лоадер на новом устройстве.', resets_left: (lic.hwid_resets_left || 1) - 1 });
});

router.post('/licenses/:id/reveal', (req, res) => {
  const lic = licenseSvc.byId(util.toInt(req.params.id));
  if (!lic || lic.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'not_found' });
  audit.log('user', req.user.id, 'license.credentials_viewed', { targetType: 'license', targetId: String(lic.id), ip: util.clientIp(req) });
  res.json({ ok: true, loader: licenseSvc.credentials(lic) });
});

/** Signed one-time download ticket for the website (mirrors the loader flow). */
router.post('/licenses/:id/download', ratelimit.middleware({ scope: 'dl', limit: 10, windowMs: 600_000 }), (req, res) => {
  const lic = licenseSvc.byId(util.toInt(req.params.id));
  if (!lic || lic.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'not_found' });

  const st = licenseSvc.state(lic);
  if (!st.downloadable) {
    return res.status(402).json({
      ok: false,
      error: st.status === 'expired' ? 'subscription_expired' : 'not_entitled',
      message: st.status === 'expired'
        ? `Подписка истекла ${util.formatDate(lic.expires_at)}. Продлите доступ, чтобы скачать сборку.`
        : 'Загрузка доступна только с действующей подпиской.'
    });
  }
  if (req.user.status === 'banned') return res.status(403).json({ ok: false, error: 'banned' });
  if (!db.settingBool('loader.download_enabled', true)) {
    return res.status(403).json({ ok: false, error: 'downloads_disabled', message: 'Выдача сборок временно отключена.' });
  }
  if (!fs.existsSync(config.build.artifactPath)) {
    return res.status(409).json({ ok: false, error: 'artifact_missing', message: 'Сборка ещё не загружена на сервер. Напишите в поддержку.' });
  }

  const proto = require('../lib/protocol');
  const build = db.setting('loader.latest_version', config.build.latestVersion);
  const ticket = proto.issueDownloadToken({ license: lic, hwid: lic.hwid, build });
  db.run('INSERT INTO downloads (license_id, user_id, build, ip, created_at) VALUES (?, ?, ?, ?, ?)',
    lic.id, lic.user_id, build, util.clientIp(req), util.now());
  audit.log('user', req.user.id, 'loader.download_issued', { targetType: 'license', targetId: String(lic.id), meta: { build }, ip: util.clientIp(req) });

  res.json({
    ok: true,
    url: `/dl/loader?t=${encodeURIComponent(ticket.token)}`,
    file_name: config.build.fileName,
    build,
    ttl: config.security.downloadTokenTtlSeconds
  });
});

router.get('/orders', (req, res) => {
  res.json({
    ok: true,
    orders: orders.byUser(req.user.id).map((o) => ({
      ...o,
      amount_label: util.money(o.amount, o.currency),
      created_label: util.formatDate(o.created_at),
      paid_label: o.paid_at ? util.formatDate(o.paid_at) : null
    }))
  });
});

router.get('/notifications', (req, res) => {
  const rows = db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
  res.json({ ok: true, notifications: rows, unread: rows.filter((r) => !r.seen).length });
});

router.post('/notifications/read', (req, res) => {
  const id = util.toInt(req.body?.id, 0);
  if (id) db.run('UPDATE notifications SET seen = 1 WHERE id = ? AND user_id = ?', id, req.user.id);
  else db.run('UPDATE notifications SET seen = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

router.get('/sessions', (req, res) => {
  const rows = db.all(
    'SELECT id, created_at, last_seen, ip, user_agent, admin_gate FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC LIMIT 30',
    req.user.id, util.now()
  );
  res.json({
    ok: true,
    count: rows.length,
    current: req.sessionTokenHash,
    sessions: rows.map((r) => ({
      id: r.id.slice(0, 10) + '…',
      created_label: util.formatDate(r.created_at),
      last_seen_label: util.formatDate(r.last_seen),
      ip: r.ip,
      device: util.truncate(r.user_agent || 'неизвестно', 64),
      admin_gate: !!r.admin_gate,
      current: r.id === req.sessionTokenHash
    }))
  });
});

router.post('/sessions/kill', (req, res) => {
  const session = require('../lib/session');
  session.destroyForUser(req.user.id, req.sessionTokenHash);
  audit.log('user', req.user.id, 'auth.sessions_killed', { ip: util.clientIp(req) });
  res.json({ ok: true, message: 'Другие сессии завершены.' });
});

router.put('/profile', (req, res) => {
  const { email, username } = req.body || {};
  const errors = [];
  if (username && username !== req.user.username) {
    if (!util.isValidUsername(username)) errors.push({ field: 'username', message: 'Некорректный логин' });
    else if (users.byUsername(username)) errors.push({ field: 'username', message: 'Логин занят' });
  }
  if (email && email.toLowerCase() !== req.user.email) {
    if (!util.isValidEmail(email)) errors.push({ field: 'email', message: 'Некорректный e-mail' });
    else if (users.byEmail(email)) errors.push({ field: 'email', message: 'E-mail занят' });
  }
  if (errors.length) return res.status(400).json({ ok: false, error: 'validation', field_errors: errors });

  const updated = users.updateProfile(req.user.id, { email, username });
  audit.log('user', req.user.id, 'user.profile_updated', { ip: util.clientIp(req) });
  res.json({ ok: true, user: users.publicProfile(updated) });
});

module.exports = router;
module.exports.licenseView = licenseView;
