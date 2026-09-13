'use strict';

/**
 * Admin panel API.
 *
 * Two independent locks:
 *   1. `panel.access` permission on the user (granular, handed out per-right)
 *   2. the shared gate password typed at /admin/login (session-scoped flag)
 *
 * Every handler additionally checks its own permission.
 */

const express = require('express');
const config = require('../config');
const db = require('../db');
const users = require('../lib/users');
const perms = require('../lib/permissions');
const licenseSvc = require('../lib/license');
const orders = require('../lib/orders');
const payments = require('../payments');
const session = require('../lib/session');
const seed = require('../lib/seed');
const audit = require('../lib/audit');
const ratelimit = require('../lib/ratelimit');
const util = require('../lib/util');

const router = express.Router();
const { now, toInt, clientIp, slugify } = util;

/* ------------------------------------------------------------- middleware -- */

/** Authenticated + holds the base `panel.access` right. */
function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'unauthenticated', redirect: '/login?next=/admin' });
  if (req.user.status === 'banned') return res.status(403).json({ ok: false, error: 'banned' });
  if (!perms.can(req.user, 'panel.access')) {
    audit.log('user', req.user.id, 'admin.denied_no_permission', { ip: clientIp(req) });
    return res.status(403).json({ ok: false, error: 'no_panel_access', message: 'У вашего аккаунта нет доступа к панели.' });
  }
  next();
}

/** requireStaff + the shared gate password already typed in this session. */
function gate(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'unauthenticated', redirect: '/login?next=/admin' });
  if (req.user.status === 'banned') return res.status(403).json({ ok: false, error: 'banned' });
  if (!perms.can(req.user, 'panel.access')) {
    audit.log('user', req.user.id, 'admin.denied_no_permission', { ip: clientIp(req) });
    return res.status(403).json({ ok: false, error: 'no_panel_access', message: 'У вашего аккаунта нет доступа к панели.' });
  }
  if (!req.isAdminSession) {
    return res.status(401).json({ ok: false, error: 'gate_required', message: 'Требуется пароль администратора.', redirect: '/admin/login' });
  }
  next();
}

/** The gate endpoints themselves must be reachable before the gate is passed. */
const GATE_EXEMPT = new Set(['/gate', '/gate/exit']);

function requirePerm(permission) {
  return [gate, (req, res, next) => {
    if (!perms.can(req.user, permission)) {
      audit.log('admin', req.user.id, 'admin.denied_permission', { meta: { permission, path: req.path }, ip: clientIp(req) });
      return res.status(403).json({ ok: false, error: 'forbidden', message: `Недостаточно прав: ${permission}` });
    }
    next();
  }];
}

router.use((req, res, next) => (GATE_EXEMPT.has(req.path) ? requireStaff(req, res, next) : gate(req, res, next)));
router.use(ratelimit.middleware({ scope: 'admin', limit: config.security.rateLimit.admin, windowMs: config.security.rateLimit.windowMs }));

/* ------------------------------------------------------------------ gate --- */

router.post('/gate', (req, res) => {
  const password = String(req.body?.password || '');
  if (!seed.verifyAdminGate(password)) {
    const rl = ratelimit.check('admin-gate', `${req.user.id}:${clientIp(req)}`, 6, 10 * 60_000);
    audit.log('admin', req.user.id, 'admin.gate_failed', { ip: clientIp(req) });
    if (!rl.allowed) return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком много попыток. Подождите 10 минут.' });
    return res.status(401).json({ ok: false, error: 'bad_gate_password', message: 'Неверный пароль администратора.', attempts_left: rl.remaining });
  }
  ratelimit.reset('admin-gate', `${req.user.id}:${clientIp(req)}`);
  session.setAdminGate(req, 1);
  db.run('UPDATE users SET admin_gate_ok_at = ? WHERE id = ?', now(), req.user.id);
  audit.log('admin', req.user.id, 'admin.gate_ok', { ip: clientIp(req) });
  res.json({ ok: true, redirect: '/admin', permissions: [...perms.effectiveFor(req.user)] });
});

router.post('/gate/exit', (req, res) => {
  session.setAdminGate(req, 0);
  audit.log('admin', req.user.id, 'admin.gate_exit', { ip: clientIp(req) });
  res.json({ ok: true, redirect: '/dashboard' });
});

router.get('/me', (req, res) => {
  res.json({
    ok: true,
    user: users.publicProfile(req.user),
    permissions: [...perms.effectiveFor(req.user)],
    gate: true
  });
});

/* --------------------------------------------------------------- summary --- */

router.get('/summary', requirePerm('system.stats'), (req, res) => {
  licenseSvc.sweep();
  const t = now();
  res.json({
    ok: true,
    users: users.stats(),
    licenses: licenseSvc.stats(),
    revenue: orders.revenueStats(),
    loader: {
      online: db.pluck(`SELECT COUNT(DISTINCT license_id) FROM loader_sessions WHERE state='authed' AND last_heartbeat > ?`, t - config.security.heartbeatTtlSeconds * 1000) || 0,
      sessions24h: db.pluck(`SELECT COUNT(*) FROM loader_sessions WHERE created_at >= ?`, t - 86_400_000) || 0,
      authFailures24h: db.pluck(`SELECT COUNT(*) FROM audit_log WHERE action='loader.auth_failed' AND created_at >= ?`, t - 86_400_000) || 0,
      killswitch: db.settingBool('loader.killswitch', false),
      min_version: db.setting('loader.min_version', config.build.minVersion),
      latest_version: db.setting('loader.latest_version', config.build.latestVersion)
    },
    system: {
      site_status: db.setting('site.status', 'online'),
      activation_mode: db.setting('license.activation_mode', 'on_first_login'),
      stack_purchases: db.setting('billing.stack_purchases', 'extend'),
      payment_methods: payments.list()
    }
  });
});

/* ----------------------------------------------------------------- users --- */

router.get('/users', requirePerm('users.view'), (req, res) => {
  const page = Math.max(1, toInt(req.query.page, 1));
  const perPage = util.clamp(toInt(req.query.per_page, 25), 5, 100);
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const role = String(req.query.role || '').trim();

  const rows = users.list({ limit: perPage, offset: (page - 1) * perPage, search, status, role });
  res.json({
    ok: true,
    total: users.countAll({ search, status, role }),
    page, per_page: perPage,
    users: rows.map((u) => ({
      ...u,
      total_spent_label: util.money(u.total_spent || 0),
      created_label: util.formatDate(u.created_at),
      last_login_label: u.last_login_at ? util.formatDate(u.last_login_at) : '—',
      permissions: u.is_admin || ['admin', 'owner'].includes(u.role) ? [...perms.effectiveFor(u)] : []
    }))
  });
});

router.get('/users/:id', requirePerm('users.view'), (req, res) => {
  const user = users.byId(toInt(req.params.id));
  if (!user) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({
    ok: true,
    user: { ...users.publicProfile(user), last_login_ip: user.last_login_ip, created_label: util.formatDate(user.created_at) },
    permissions: [...perms.effectiveFor(user)],
    licenses: licenseSvc.byUser(user.id).map((l) => {
      const st = licenseSvc.state(l);
      return { ...st, expires_label: util.formatDate(l.expires_at), created_label: util.formatDate(l.created_at) };
    }),
    orders: orders.byUser(user.id, 50).map((o) => ({ ...o, amount_label: util.money(o.amount, o.currency), created_label: util.formatDate(o.created_at) })),
    audit: audit.list({ limit: 30 }).filter((a) => a.actor_id === String(user.id))
  });
});

router.post('/users/:id/status', requirePerm('users.ban'), (req, res) => {
  const id = toInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ ok: false, error: 'self', message: 'Нельзя заблокировать самого себя.' });
  const target = users.byId(id);
  if (!target) return res.status(404).json({ ok: false, error: 'not_found' });
  if (target.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ ok: false, error: 'forbidden', message: 'Только владелец может менять статус владельца.' });
  }
  const status = ['active', 'banned', 'pending'].includes(req.body?.status) ? req.body.status : 'active';
  users.setStatus(id, status, { actorId: req.user.id, ip: clientIp(req), reason: req.body?.reason || null });
  res.json({ ok: true, user: users.publicProfile(users.byId(id)), message: status === 'banned' ? 'Пользователь заблокирован.' : 'Статус обновлён.' });
});

router.post('/users/:id/password', requirePerm('users.edit'), (req, res) => {
  const id = toInt(req.params.id);
  const target = users.byId(id);
  if (!target) return res.status(404).json({ ok: false, error: 'not_found' });
  const generated = String(req.body?.password || '') || util.randomLoaderPassword(16);
  if (generated.length < 8) return res.status(400).json({ ok: false, error: 'weak_password' });
  users.setPassword(id, generated);
  session.destroyForUser(id);
  audit.log('admin', req.user.id, 'admin.user_password_reset', { targetType: 'user', targetId: String(id), ip: clientIp(req) });
  res.json({ ok: true, password: generated, message: 'Пароль изменён, все сессии завершены.' });
});

router.post('/users/:id/permissions', requirePerm('users.permissions'), (req, res) => {
  const id = toInt(req.params.id);
  const target = users.byId(id);
  if (!target) return res.status(404).json({ ok: false, error: 'not_found' });
  if (target.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ ok: false, error: 'forbidden', message: 'Права владельца может менять только владелец.' });
  }
  let requested = req.body?.permissions;
  if (typeof requested === 'string') requested = requested.split(',');
  if (!Array.isArray(requested)) return res.status(400).json({ ok: false, error: 'validation', message: 'permissions должен быть массивом.' });

  const unknown = requested.filter((p) => !perms.ALL_KEYS.includes(p));
  if (unknown.length) return res.status(400).json({ ok: false, error: 'validation', message: `Неизвестные права: ${unknown.join(', ')}` });

  // Only an owner may hand out `users.permissions` itself.
  if (requested.includes('users.permissions') && req.user.role !== 'owner') {
    return res.status(403).json({ ok: false, error: 'forbidden', message: 'Право «выдавать права» может передавать только владелец.' });
  }
  // Never let a non-owner strip or grant beyond their own set.
  if (req.user.role !== 'owner') {
    const mine = perms.effectiveFor(req.user);
    const overreach = requested.filter((p) => !mine.has(p));
    if (overreach.length) {
      return res.status(403).json({ ok: false, error: 'forbidden', message: `Нельзя выдать права, которых нет у вас: ${overreach.join(', ')}` });
    }
  }

  if (id === req.user.id && !requested.includes('panel.access')) {
    return res.status(400).json({ ok: false, error: 'self_lockout', message: 'Нельзя забрать у себя доступ к панели.' });
  }

  const applied = perms.replaceSet(id, requested, req.user.id);
  db.run('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?', applied.includes('panel.access') ? 1 : 0, now(), id);
  if (!applied.includes('panel.access')) session.destroyForUser(id);
  audit.log('admin', req.user.id, 'admin.permissions_changed', {
    targetType: 'user', targetId: String(id), meta: { count: applied.length, permissions: applied }, ip: clientIp(req)
  });
  res.json({ ok: true, permissions: applied, message: `Права обновлены (${applied.length}).` });
});

router.get('/permissions/catalog', requirePerm('users.permissions'), (req, res) => {
  res.json({ ok: true, catalog: perms.CATALOG, groups: perms.GROUPS, presets: perms.PRESETS, all: perms.ALL_KEYS });
});

/* -------------------------------------------------------------- licenses --- */

router.get('/licenses', requirePerm('licenses.view'), (req, res) => {
  const page = Math.max(1, toInt(req.query.page, 1));
  const perPage = util.clamp(toInt(req.query.per_page, 25), 5, 200);
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const rows = licenseSvc.all({ limit: perPage, offset: (page - 1) * perPage, search, status }).map((l) => {
    const st = licenseSvc.state(l);
    return {
      ...st,
      username: l.username,
      created_label: util.formatDate(l.created_at),
      expires_label: util.formatDate(l.expires_at),
      activated_label: util.formatDate(l.activated_at),
      hwid_short: l.hwid ? l.hwid.slice(0, 12).toUpperCase() + '…' : null,
      last_seen_label: l.last_seen_at ? util.formatDate(l.last_seen_at) : 'никогда'
    };
  });
  res.json({ ok: true, total: licenseSvc.countAll({ search, status }), page, per_page: perPage, licenses: rows });
});

router.get('/licenses/:id', requirePerm('licenses.view'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const st = licenseSvc.state(lic);
  const canSeeCredentials = perms.can(req.user, 'licenses.credentials');
  res.json({
    ok: true,
    license: {
      ...st,
      created_label: util.formatDate(lic.created_at),
      expires_label: util.formatDate(lic.expires_at),
      user: users.publicProfile(users.byId(lic.user_id)),
      order: lic.order_id ? orders.byId(lic.order_id) : null,
      loader: canSeeCredentials ? licenseSvc.credentials(lic) : { login: lic.loader_login, password: null }
    },
    devices: db.all('SELECT * FROM license_devices WHERE license_id = ? ORDER BY id DESC', lic.id),
    resets: db.all('SELECT * FROM hwid_resets WHERE license_id = ? ORDER BY id DESC LIMIT 50', lic.id),
    sessions: db.all('SELECT * FROM loader_sessions WHERE license_id = ? ORDER BY created_at DESC LIMIT 50', lic.id),
    events: db.all(`SELECT * FROM audit_log WHERE target_type='license' AND target_id=? ORDER BY id DESC LIMIT 100`, String(lic.id))
  });
});

router.post('/licenses/generate', requirePerm('licenses.generate'), (req, res) => {
  const planCode = String(req.body?.plan || '');
  const count = util.clamp(toInt(req.body?.count, 1), 1, 200);
  const days = toInt(req.body?.days, 0) || null;
  const note = String(req.body?.note || '').slice(0, 200) || null;
  const username = String(req.body?.username || '').trim();
  const activateNow = req.body?.activate === true || req.body?.activate === 'true';

  if (!config.planByCode[planCode]) return res.status(400).json({ ok: false, error: 'unknown_plan' });

  let target = req.body?.user_id ? users.byId(toInt(req.body.user_id)) : null;
  if (!target && username) target = users.find(username);
  if (!target) {
    // Unassigned stock keys are attached to the requesting admin so they are never orphaned.
    target = req.user;
  }

  const created = db.transaction(() => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const r = licenseSvc.issue({
        userId: target.id, planCode, days, note, actor: 'admin', actorId: req.user.id,
        ip: clientIp(req), activateNow
      });
      out.push({
        id: r.license.id,
        license_key: r.license.license_key,
        loader_login: r.license.loader_login,
        loader_password: r.password,
        plan_code: planCode,
        days: r.license.days,
        status: r.license.status,
        expires_at: r.license.expires_at
      });
    }
    return out;
  });

  audit.log('admin', req.user.id, 'admin.licenses_generated', { meta: { plan: planCode, count, user_id: target.id }, ip: clientIp(req) });
  res.json({ ok: true, count: created.length, licenses: created, assigned_to: target.username });
});

router.post('/licenses/:id/extend', requirePerm('licenses.extend'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const days = toInt(req.body?.days, 0);
  if (!days || Math.abs(days) > 3650) return res.status(400).json({ ok: false, error: 'validation', message: 'Укажите количество дней (−3650…3650).' });
  const updated = days > 0
    ? licenseSvc.extend(lic, days, { actorId: req.user.id, ip: clientIp(req), note: String(req.body?.note || '').slice(0, 120) || null })
    : licenseSvc.extend(lic, days, { actorId: req.user.id, ip: clientIp(req) });
  res.json({ ok: true, license: licenseSvc.state(updated), message: `Добавлено ${days} дн.` });
});

router.post('/licenses/:id/plan', requirePerm('licenses.extend'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const updated = licenseSvc.changePlan(lic, String(req.body?.plan || ''), { actorId: req.user.id, ip: clientIp(req) });
  res.json({ ok: true, license: licenseSvc.state(updated) });
});

router.post('/licenses/:id/revoke', requirePerm('licenses.revoke'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const reason = String(req.body?.reason || 'revoked_by_admin').slice(0, 120);
  licenseSvc.revoke(lic, reason, { actorId: req.user.id, ip: clientIp(req) });
  res.json({ ok: true, message: 'Ключ отозван. Лоадер потеряет доступ на ближайшем heartbeat.' });
});

router.post('/licenses/:id/restore', requirePerm('licenses.revoke'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  licenseSvc.restore(lic, { actorId: req.user.id, ip: clientIp(req) });
  res.json({ ok: true, license: licenseSvc.state(licenseSvc.byId(lic.id)) });
});

router.post('/licenses/:id/hwid-reset', requirePerm('hwid.reset'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const force = req.body?.force === true || req.body?.force === 'true';
  const r = licenseSvc.resetHwid(lic, { force, actor: 'admin', actorId: req.user.id, ip: clientIp(req) });
  if (!r.ok) return res.status(409).json({ ok: false, error: r.reason, message: r.message || 'Не удалось сбросить HWID.' });
  res.json({ ok: true, message: force ? 'HWID сброшен принудительно.' : 'HWID сброшен.' });
});

router.get('/licenses/:id/credentials', requirePerm('licenses.credentials'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  audit.log('admin', req.user.id, 'admin.credentials_viewed', { targetType: 'license', targetId: String(lic.id), ip: clientIp(req) });
  res.json({ ok: true, loader: licenseSvc.credentials(lic) });
});

router.post('/licenses/:id/credentials/rotate', requirePerm('licenses.credentials'), (req, res) => {
  const lic = licenseSvc.byId(toInt(req.params.id));
  if (!lic) return res.status(404).json({ ok: false, error: 'not_found' });
  const password = licenseSvc.rotateCredentials(lic, { actorId: req.user.id, ip: clientIp(req) });
  res.json({ ok: true, loader: { login: lic.loader_login, password }, message: 'Пароль лоадера перевыпущен.' });
});

/* ------------------------------------------------------------------ hwid --- */

router.get('/hwid/blacklist', requirePerm('hwid.view'), (req, res) => {
  res.json({ ok: true, entries: db.all('SELECT * FROM hwid_blacklist ORDER BY created_at DESC LIMIT 500') });
});

router.post('/hwid/blacklist', requirePerm('hwid.blacklist'), (req, res) => {
  const hwid = licenseSvc.normalizeHwid(req.body?.hwid);
  if (!hwid) return res.status(400).json({ ok: false, error: 'validation', message: 'Некорректный HWID.' });
  db.run('INSERT OR REPLACE INTO hwid_blacklist (hwid, reason, created_by, created_at) VALUES (?, ?, ?, ?)',
    hwid, String(req.body?.reason || '').slice(0, 200), req.user.id, now());
  const affected = db.run(`UPDATE licenses SET status='revoked', revoked_reason='hwid_blacklisted' WHERE hwid = ? AND status IN ('pending','active')`, hwid).changes;
  db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='hwid_blacklisted' WHERE license_id IN (SELECT id FROM licenses WHERE hwid = ?)`, hwid);
  audit.log('admin', req.user.id, 'admin.hwid_blacklisted', { targetType: 'hwid', targetId: hwid.slice(0, 16), meta: { affected }, ip: clientIp(req) });
  res.json({ ok: true, message: `HWID в чёрном списке. Затронуто лицензий: ${affected}.` });
});

router.post('/hwid/blacklist/remove', requirePerm('hwid.blacklist'), (req, res) => {
  const hwid = licenseSvc.normalizeHwid(req.body?.hwid);
  if (!hwid) return res.status(400).json({ ok: false, error: 'validation' });
  db.run('DELETE FROM hwid_blacklist WHERE hwid = ?', hwid);
  audit.log('admin', req.user.id, 'admin.hwid_unblacklisted', { targetType: 'hwid', targetId: hwid.slice(0, 16), ip: clientIp(req) });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- orders --- */

router.get('/orders', requirePerm('orders.view'), (req, res) => {
  const page = Math.max(1, toInt(req.query.page, 1));
  const perPage = util.clamp(toInt(req.query.per_page, 25), 5, 200);
  const status = String(req.query.status || '');
  const search = String(req.query.search || '').trim();
  const rows = orders.all({ limit: perPage, offset: (page - 1) * perPage, status, search });
  res.json({
    ok: true,
    total: orders.countAll({ status, search }),
    page, per_page: perPage,
    revenue: orders.revenueStats(),
    orders: rows.map((o) => ({
      ...o,
      amount_label: util.money(o.amount, o.currency),
      created_label: util.formatDate(o.created_at),
      paid_label: o.paid_at ? util.formatDate(o.paid_at) : '—'
    }))
  });
});

router.post('/orders/:pid/mark-paid', requirePerm('orders.mark_paid'), (req, res) => {
  const order = orders.byPublicId(String(req.params.pid));
  if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
  if (order.status === 'paid') return res.status(409).json({ ok: false, error: 'already_paid' });
  const result = orders.markPaid(order, {
    gateway: 'manual',
    gatewayPaymentId: String(req.body?.reference || `manual_${order.public_id}`),
    actor: 'admin', actorId: req.user.id, ip: clientIp(req), raw: { manual: true, note: req.body?.note || null }
  });
  res.json({ ok: true, order: result.order, license_id: result.license.id, stacked: result.stacked, message: 'Заказ оплачен вручную, доступ выдан.' });
});

router.post('/orders/:pid/refund', requirePerm('orders.refund'), (req, res) => {
  const order = orders.byPublicId(String(req.params.pid));
  if (!order) return res.status(404).json({ ok: false, error: 'not_found' });
  if (order.status !== 'paid') return res.status(409).json({ ok: false, error: 'not_paid' });
  orders.refund(order, { reason: String(req.body?.reason || 'refund'), actorId: req.user.id, ip: clientIp(req) });
  res.json({ ok: true, message: 'Возврат оформлен, лицензия отозвана.' });
});

/* --------------------------------------------------------------- coupons --- */

router.get('/coupons', requirePerm('coupons.manage'), (req, res) => {
  res.json({ ok: true, coupons: db.all('SELECT * FROM coupons ORDER BY id DESC LIMIT 200') });
});

router.post('/coupons', requirePerm('coupons.manage'), (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const kind = req.body?.kind === 'fixed' ? 'fixed' : 'percent';
  const value = util.clamp(toInt(req.body?.value, 0), 1, kind === 'percent' ? 90 : 10_000_000);
  if (!code) return res.status(400).json({ ok: false, error: 'validation', message: 'Нужен код купона.' });
  if (!value) return res.status(400).json({ ok: false, error: 'validation', message: 'Укажите значение скидки.' });
  if (orders.findCoupon(code)) return res.status(409).json({ ok: false, error: 'exists' });

  const plan = req.body?.plan && config.planByCode[String(req.body.plan)] ? String(req.body.plan) : null;
  const expiresDays = toInt(req.body?.expires_days, 0);
  const res2 = db.run(
    `INSERT INTO coupons (code, kind, value, plan_code, max_uses, per_user, active, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    code, kind, value, plan, util.clamp(toInt(req.body?.max_uses, 0), 0, 100000),
    util.clamp(toInt(req.body?.per_user, 1), 1, 100),
    expiresDays > 0 ? now() + expiresDays * 86_400_000 : null, req.user.id, now()
  );
  audit.log('admin', req.user.id, 'admin.coupon_created', { targetType: 'coupon', targetId: code, meta: { kind, value, plan }, ip: clientIp(req) });
  res.json({ ok: true, coupon: db.get('SELECT * FROM coupons WHERE id = ?', res2.id) });
});

router.post('/coupons/:id/toggle', requirePerm('coupons.manage'), (req, res) => {
  const id = toInt(req.params.id);
  const c = db.get('SELECT * FROM coupons WHERE id = ?', id);
  if (!c) return res.status(404).json({ ok: false, error: 'not_found' });
  db.run('UPDATE coupons SET active = ? WHERE id = ?', c.active ? 0 : 1, id);
  audit.log('admin', req.user.id, 'admin.coupon_toggled', { targetType: 'coupon', targetId: c.code, ip: clientIp(req) });
  res.json({ ok: true, coupon: db.get('SELECT * FROM coupons WHERE id = ?', id) });
});

/* ---------------------------------------------------------------- loader --- */

router.get('/loader/sessions', requirePerm('loader.view'), (req, res) => {
  const t = now();
  const rows = db.all(
    `SELECT ls.*, l.license_key, l.loader_login, l.plan_code, l.status AS license_status, u.username
     FROM loader_sessions ls
     LEFT JOIN licenses l ON l.id = ls.license_id
     LEFT JOIN users u ON u.id = l.user_id
     ORDER BY ls.created_at DESC LIMIT 200`
  );
  res.json({
    ok: true,
    heartbeat_ttl: config.security.heartbeatTtlSeconds,
    sessions: rows.map((r) => ({
      id: r.id,
      license_id: r.license_id,
      license_key: r.license_key,
      loader_login: r.loader_login,
      username: r.username,
      plan_code: r.plan_code,
      state: r.state,
      build: r.build,
      ip: r.ip,
      created_label: util.formatDate(r.created_at),
      last_heartbeat_label: r.last_heartbeat ? util.formatDate(r.last_heartbeat) : '—',
      online: r.state === 'authed' && r.last_heartbeat && (t - r.last_heartbeat) < config.security.heartbeatTtlSeconds * 1000,
      expires_label: util.formatDate(r.expires_at),
      revoked_reason: r.revoked_reason
    }))
  });
});

router.post('/loader/killswitch', requirePerm('loader.killswitch'), (req, res) => {
  const enabled = req.body?.enabled === true || req.body?.enabled === 'true' || req.body?.enabled === 1;
  db.setSetting('loader.killswitch', enabled ? '1' : '0');
  if (enabled) db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='killswitch' WHERE state='authed'`);
  audit.log('admin', req.user.id, 'admin.killswitch', { meta: { enabled }, ip: clientIp(req) });
  res.json({ ok: true, enabled, message: enabled ? 'Kill switch включён — все сессии лоадера сброшены.' : 'Kill switch выключен.' });
});

router.post('/loader/build', requirePerm('loader.build'), (req, res) => {
  const min = String(req.body?.min_version || '').trim();
  const latest = String(req.body?.latest_version || '').trim();
  if (min && !/^\d+\.\d+\.\d+$/.test(min)) return res.status(400).json({ ok: false, error: 'validation', message: 'Формат версии: X.Y.Z' });
  if (latest && !/^\d+\.\d+\.\d+$/.test(latest)) return res.status(400).json({ ok: false, error: 'validation', message: 'Формат версии: X.Y.Z' });
  if (min) db.setSetting('loader.min_version', min);
  if (latest) db.setSetting('loader.latest_version', latest);
  if (req.body?.download_enabled !== undefined) {
    db.setSetting('loader.download_enabled', ['1', 'true', true].includes(req.body.download_enabled) ? '1' : '0');
  }
  audit.log('admin', req.user.id, 'admin.build_policy', { meta: { min, latest }, ip: clientIp(req) });
  res.json({ ok: true, min_version: db.setting('loader.min_version'), latest_version: db.setting('loader.latest_version'), download_enabled: db.settingBool('loader.download_enabled', true) });
});

router.post('/loader/sessions/revoke', requirePerm('loader.killswitch'), (req, res) => {
  const licenseId = toInt(req.body?.license_id, 0);
  const changes = licenseId
    ? db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='admin' WHERE license_id = ? AND state != 'revoked'`, licenseId).changes
    : db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='admin' WHERE state != 'revoked'`).changes;
  audit.log('admin', req.user.id, 'admin.sessions_revoked', { meta: { license_id: licenseId || 'all', changes }, ip: clientIp(req) });
  res.json({ ok: true, revoked: changes });
});

/* ------------------------------------------------------------------ posts -- */

router.get('/posts', requirePerm('content.posts'), (req, res) => {
  res.json({ ok: true, posts: db.all('SELECT * FROM posts ORDER BY id DESC LIMIT 100') });
});

router.post('/posts', requirePerm('content.posts'), (req, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!title || !body) return res.status(400).json({ ok: false, error: 'validation', message: 'Нужны заголовок и текст.' });
  const slug = String(req.body?.slug || '').trim() || slugify(title) || `post-${now()}`;
  const tag = String(req.body?.tag || 'update').slice(0, 24);
  if (db.get('SELECT id FROM posts WHERE slug = ?', slug)) {
    db.run('UPDATE posts SET title=?, tag=?, body=?, published=1 WHERE slug=?', title, tag, body, slug);
  } else {
    db.run('INSERT INTO posts (slug, title, tag, body, published, author_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      slug, title, tag, body, req.user.id, now());
  }
  audit.log('admin', req.user.id, 'admin.post_saved', { targetType: 'post', targetId: slug, ip: clientIp(req) });
  res.json({ ok: true, post: db.get('SELECT * FROM posts WHERE slug = ?', slug) });
});

router.post('/posts/:id/delete', requirePerm('content.posts'), (req, res) => {
  const id = toInt(req.params.id);
  db.run('DELETE FROM posts WHERE id = ?', id);
  audit.log('admin', req.user.id, 'admin.post_deleted', { targetType: 'post', targetId: String(id), ip: clientIp(req) });
  res.json({ ok: true });
});

/* --------------------------------------------------------------- settings -- */

const EDITABLE_SETTINGS = [
  'site.title', 'site.tagline', 'site.status', 'site.status_text', 'site.announcement',
  'site.support', 'site.discord', 'site.telegram',
  'license.activation_mode', 'billing.stack_purchases',
  'loader.download_enabled', 'signup.enabled', 'maintenance.message',
  'payment.lava.project_id', 'payment.lava.secret_key',
  'payment.yookassa.shop_id', 'payment.yookassa.secret_key',
  'payment.enot.project_id', 'payment.enot.wallet', 'payment.enot.secret_key_1', 'payment.enot.secret_key_2'
];

router.get('/settings', requirePerm('content.settings'), (req, res) => {
  const out = {};
  for (const key of EDITABLE_SETTINGS) {
    const v = db.setting(key, null);
    out[key] = key.includes('secret') || key.includes('key_') ? util.maskSecret(v || '', 3) : v;
  }
  out.__raw_presence = Object.fromEntries(EDITABLE_SETTINGS.filter((k) => k.includes('secret') || k.includes('key_'))
    .map((k) => [k, Boolean(db.setting(k, null))]));
  res.json({ ok: true, settings: out, editable: EDITABLE_SETTINGS });
});

router.post('/settings', requirePerm('content.settings'), (req, res) => {
  const body = req.body || {};
  const changed = [];
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in body)) continue;
    let value = body[key];
    if (value === null || value === undefined) value = '';
    value = String(value);
    // masked placeholders coming back from the UI must not overwrite secrets
    if ((key.includes('secret') || key.includes('key_')) && /^\*+$/.test(value.replace(/[^*]/g, '')) && value.includes('*')) continue;
    db.setSetting(key, value);
    changed.push(key);
  }
  payments.applyOverrides();
  audit.log('admin', req.user.id, 'admin.settings_updated', { meta: { changed }, ip: clientIp(req) });
  res.json({ ok: true, changed, message: `Сохранено настроек: ${changed.length}` });
});

/* ------------------------------------------------------------------ audit -- */

router.get('/audit', requirePerm('audit.view'), (req, res) => {
  const limit = util.clamp(toInt(req.query.limit, 100), 10, 500);
  const offset = Math.max(0, toInt(req.query.offset, 0));
  const action = String(req.query.action || '').trim();
  const rows = audit.list({ limit, offset, action: action || null });
  res.json({
    ok: true, total: audit.count({ action: action || null }),
    entries: rows.map((r) => ({ ...r, meta: util.jsonParse(r.meta), created_label: util.formatDate(r.created_at) }))
  });
});

/* ------------------------------------------------------------------ misc --- */

router.post('/maintenance', requirePerm('content.settings'), (req, res) => {
  const mode = String(req.body?.mode || 'online');
  if (!['online', 'maintenance', 'detected'].includes(mode)) return res.status(400).json({ ok: false, error: 'validation' });
  db.setSetting('site.status', mode);
  if (req.body?.text) db.setSetting('site.status_text', String(req.body.text).slice(0, 200));
  audit.log('admin', req.user.id, 'admin.maintenance', { meta: { mode }, ip: clientIp(req) });
  res.json({ ok: true, mode });
});

router.post('/sweep', requirePerm('system.stats'), (req, res) => {
  const expired = licenseSvc.sweep();
  const sessions = db.run('DELETE FROM sessions WHERE expires_at < ?', now()).changes;
  const loaderSessions = db.run(`DELETE FROM loader_sessions WHERE expires_at < ? AND state != 'authed'`, now() - 86_400_000).changes;
  res.json({ ok: true, expired_licenses: expired, purged_site_sessions: sessions, purged_loader_sessions: loaderSessions });
});

module.exports = router;
