'use strict';

const express = require('express');
const config = require('../config');
const db = require('../db');
const users = require('../lib/users');
const session = require('../lib/session');
const audit = require('../lib/audit');
const ratelimit = require('../lib/ratelimit');
const util = require('../lib/util');

const router = express.Router();
const authLimiter = ratelimit.middleware({ scope: 'auth', limit: config.security.rateLimit.auth, windowMs: config.security.rateLimit.windowMs });

router.post('/register', authLimiter, (req, res) => {
  if (!db.settingBool('signup.enabled', true)) {
    return res.status(403).json({ ok: false, error: 'signup_closed', message: 'Регистрация временно закрыта.' });
  }
  const { username, email, password, password2 } = req.body || {};
  if (password !== password2) {
    return res.status(400).json({ ok: false, error: 'validation', field_errors: [{ field: 'password2', message: 'Пароли не совпадают' }] });
  }
  const errors = users.validateSignup({ username, email, password });
  if (errors.length) return res.status(400).json({ ok: false, error: 'validation', field_errors: errors });

  const user = users.create({ username, email, password, ip: util.clientIp(req) });
  if (req.sessionToken) session.destroy(req, req.sessionToken);
  const s = session.create(req, user.id);
  res.json({
    ok: true,
    user: users.publicProfile(user),
    csrf: session.csrfToken(s.tokenHash),
    redirect: '/dashboard'
  });
});

router.post('/login', authLimiter, (req, res) => {
  const { login, password } = req.body || {};
  const ip = util.clientIp(req);
  const rl = ratelimit.check('login-ip', ip, config.security.loginMaxAttempts * 3, 10 * 60_000);
  if (!rl.allowed) {
    return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Слишком много попыток входа. Подождите несколько минут.' });
  }

  const user = users.find(login);
  const check = users.verifyCredentials(user, password);
  if (!check.ok) {
    if (user) users.registerFailure(user, ip);
    if (check.reason === 'locked') return res.status(423).json({ ok: false, error: 'locked', message: check.message });
    if (check.reason === 'banned') return res.status(403).json({ ok: false, error: 'banned', message: 'Аккаунт заблокирован. Обратитесь в поддержку.' });
    return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Неверный логин или пароль' });
  }

  const fresh = users.registerSuccess(user, ip);
  ratelimit.reset('login-ip', ip);
  // Rotate: drop any prior session (stale tab, another account) before issuing
  // the new one, so an old cookie can not ride along with this login.
  if (req.sessionToken) session.destroy(req, req.sessionToken);
  const s = session.create(req, fresh.id);
  const next = String(req.body?.next || '').startsWith('/admin') ? '/admin/login' : '/dashboard';

  res.json({
    ok: true,
    user: users.publicProfile(fresh),
    csrf: session.csrfToken(s.tokenHash),
    redirect: fresh.is_admin || ['admin', 'owner'].includes(fresh.role) ? next : '/dashboard'
  });
});

router.post('/logout', (req, res) => {
  if (req.user) audit.log('user', req.user.id, 'auth.logout', { ip: util.clientIp(req) });
  const raw = req.cookies?.[session.COOKIE];
  session.destroy(req, raw);
  res.json({ ok: true, redirect: '/' });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'unauthenticated' });
  const unread = db.pluck('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND seen = 0', req.user.id) || 0;
  res.json({ ok: true, user: users.publicProfile(req.user), unread, csrf: req.csrf });
});

router.post('/password', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'unauthenticated' });
  const { current, next, next2 } = req.body || {};
  if (next !== next2) return res.status(400).json({ ok: false, error: 'validation', field_errors: [{ field: 'next2', message: 'Пароли не совпадают' }] });
  if (String(next || '').length < 8) return res.status(400).json({ ok: false, error: 'validation', field_errors: [{ field: 'next', message: 'Минимум 8 символов' }] });
  const check = users.verifyCredentials(req.user, current);
  if (!check.ok) return res.status(401).json({ ok: false, error: 'validation', field_errors: [{ field: 'current', message: 'Текущий пароль неверен' }] });

  users.setPassword(req.user.id, next);
  session.destroyForUser(req.user.id, req.sessionTokenHash);
  audit.log('user', req.user.id, 'auth.password_changed', { ip: util.clientIp(req) });
  res.json({ ok: true, message: 'Пароль изменён. Остальные сессии завершены.' });
});

module.exports = router;
