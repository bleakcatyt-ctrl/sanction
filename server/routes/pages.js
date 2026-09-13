'use strict';

const express = require('express');
const fs = require('node:fs');
const config = require('../config');
const db = require('../db');
const users = require('../lib/users');
const perms = require('../lib/permissions');
const licenseSvc = require('../lib/license');
const orders = require('../lib/orders');
const payments = require('../payments');
const webhooks = require('./webhooks');
const util = require('../lib/util');

const router = express.Router();

function siteSettings() {
  return {
    title: db.setting('site.title', config.brand.name),
    tagline: db.setting('site.tagline', config.brand.tagline),
    status: db.setting('site.status', 'online'),
    status_text: db.setting('site.status_text', 'All systems operational'),
    announcement: db.setting('site.announcement', ''),
    support: db.setting('site.support', config.brand.support),
    discord: db.setting('site.discord', config.brand.discord),
    telegram: db.setting('site.telegram', config.brand.telegram),
    signup_enabled: db.settingBool('signup.enabled', true),
    maintenance_message: db.setting('maintenance.message', 'Технические работы.')
  };
}

function plansView() {
  return config.plans.map((p) => ({
    ...p,
    price_label: util.money(orders.minor(p.price), config.payments.currency),
    old_price_label: p.oldPrice ? util.money(orders.minor(p.oldPrice), config.payments.currency) : null,
    per_day: (p.price / p.days).toFixed(1),
    save: p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0
  }));
}

function view(req, res, template, data = {}) {
  const site = siteSettings();
  const user = req.user ? users.publicProfile(req.user) : null;
  res.render(template, {
    site,
    user,
    perms: req.user ? [...perms.effectiveFor(req.user)] : [],
    isAdminSession: !!req.isAdminSession,
    csrf: req.csrf || '',
    brand: config.brand,
    plans: plansView(),
    currency: config.payments.currency,
    year: new Date().getFullYear(),
    util,
    path: req.path,
    query: req.query,
    ...data
  });
}

/* ---------------------------------------------------------- maintenance ---- */

router.use((req, res, next) => {
  const status = db.setting('site.status', 'online');
  const isStaff = req.user && (req.user.is_admin || ['admin', 'owner'].includes(req.user.role));
  const isApi = req.path.startsWith('/api/');
  if (status === 'maintenance' && !isStaff && !isApi && !req.path.startsWith('/admin')) {
    return view(req, res, 'maintenance', { title: 'Технические работы' });
  }
  next();
});

/* --------------------------------------------------------------- public ---- */

router.get('/', (req, res) => {
  const t = util.now();
  const stats = {
    users: db.pluck('SELECT COUNT(*) FROM users') || 0,
    active: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status='active' AND (expires_at IS NULL OR expires_at > ?)`, t) || 0,
    uptime: db.setting('site.status_text', 'All systems operational'),
    posts: db.all('SELECT slug, title, tag, body, created_at FROM posts WHERE published=1 ORDER BY id DESC LIMIT 3')
  };
  view(req, res, 'home', { title: `${siteSettings().title} — private access`, stats });
});

router.get('/pricing', (req, res) => {
  view(req, res, 'pricing', {
    title: 'Тарифы — 30 / 90 / 180 дней',
    methods: payments.list(),
    faq: FAQ
  });
});

router.get('/status', (req, res) => {
  const t = util.now();
  view(req, res, 'status', {
    title: 'Статус сервиса',
    info: {
      site: db.setting('site.status', 'online'),
      site_text: db.setting('site.status_text', ''),
      loader_api: db.settingBool('loader.killswitch', false) ? 'degraded' : 'operational',
      downloads: db.settingBool('loader.download_enabled', true) && fs.existsSync(config.build.artifactPath) ? 'operational' : 'unavailable',
      payments: payments.listReady().length ? 'operational' : 'sandbox',
      build: db.setting('loader.latest_version', config.build.latestVersion),
      online: db.pluck(`SELECT COUNT(DISTINCT license_id) FROM loader_sessions WHERE state='authed' AND last_heartbeat > ?`, t - config.security.heartbeatTtlSeconds * 1000) || 0,
      active: db.pluck(`SELECT COUNT(*) FROM licenses WHERE status='active' AND (expires_at IS NULL OR expires_at > ?)`, t) || 0,
      recent: db.all('SELECT slug, title, tag, created_at FROM posts WHERE published=1 ORDER BY id DESC LIMIT 6')
    }
  });
});

router.get('/news', (req, res) => {
  view(req, res, 'news', { title: 'Новости и обновления', posts: db.all('SELECT * FROM posts WHERE published=1 ORDER BY id DESC LIMIT 50') });
});

router.get('/news/:slug', (req, res) => {
  const post = db.get('SELECT * FROM posts WHERE slug = ? AND published=1', req.params.slug);
  if (!post) return view(req, res, 'error', { title: '404', code: 404, message: 'Запись не найдена.' });
  view(req, res, 'post', { title: post.title, post });
});

router.get('/faq', (req, res) => view(req, res, 'faq', { title: 'Вопросы и ответы', faq: FAQ }));

router.get('/terms', (req, res) => view(req, res, 'terms', { title: 'Условия использования' }));

/* ----------------------------------------------------------------- auth ---- */

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(String(req.query.next || '/dashboard'));
  view(req, res, 'login', { title: 'Вход', next: String(req.query.next || '') });
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  if (!db.settingBool('signup.enabled', true)) return view(req, res, 'error', { title: 'Регистрация закрыта', code: 403, message: 'Регистрация временно закрыта.' });
  view(req, res, 'register', { title: 'Регистрация' });
});

router.get('/logout', (req, res) => res.redirect('/dashboard'));

/* ------------------------------------------------------------ dashboard ---- */

function requirePageAuth(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

router.get('/dashboard', requirePageAuth, (req, res) => {
  const licenses = licenseSvc.byUser(req.user.id).map((l) => {
    const st = licenseSvc.state(l);
    return { ...st, expires_label: util.formatDate(l.expires_at), created_label: util.formatDate(l.created_at) };
  });
  const unread = db.pluck('SELECT COUNT(*) FROM notifications WHERE user_id=? AND seen=0', req.user.id) || 0;
  view(req, res, 'dashboard', {
    title: 'Личный кабинет',
    licenses,
    primary: licenses.find((l) => ['active', 'pending'].includes(l.status)) || licenses[0] || null,
    orderList: orders.byUser(req.user.id, 20),
    notifications: db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30', req.user.id),
    unread,
    methods: payments.list(),
    artifact_available: fs.existsSync(config.build.artifactPath),
    loader_build: db.setting('loader.latest_version', config.build.latestVersion),
    can_admin: perms.can(req.user, 'panel.access')
  });
});

router.get('/dashboard/license', (req, res) => res.redirect('/dashboard#license'));
router.get('/dashboard/orders', (req, res) => res.redirect('/dashboard#orders'));
router.get('/dashboard/settings', (req, res) => res.redirect('/dashboard#settings'));

/* ------------------------------------------------------------- checkout ---- */

router.get('/checkout/sandbox/:pid', requirePageAuth, (req, res) => {
  const order = orders.byPublicId(req.params.pid);
  if (!order) return view(req, res, 'error', { title: '404', code: 404, message: 'Заказ не найден.' });
  if (order.user_id !== req.user.id && !perms.can(req.user, 'orders.view')) {
    return view(req, res, 'error', { title: '403', code: 403, message: 'Это не ваш заказ.' });
  }
  const plan = config.planByCode[order.plan_code];
  view(req, res, 'checkout-sandbox', {
    title: `Оплата ${order.public_id}`,
    order, plan,
    sign: webhooks.sandboxSign(order.public_id),
    amount_label: util.money(order.amount, order.currency)
  });
});

router.get('/checkout/result/:pid', requirePageAuth, (req, res) => {
  const order = orders.byPublicId(req.params.pid);
  if (!order) return view(req, res, 'error', { title: '404', code: 404, message: 'Заказ не найден.' });
  if (order.user_id !== req.user.id && !perms.can(req.user, 'orders.view')) {
    return view(req, res, 'error', { title: '403', code: 403, message: 'Это не ваш заказ.' });
  }
  const lic = order.status === 'paid' ? db.get('SELECT * FROM licenses WHERE order_id = ? ORDER BY id DESC LIMIT 1', order.id) : null;
  const st = lic ? licenseSvc.state(lic) : null;
  const stacked = lic && db.pluck(`SELECT COUNT(*) FROM licenses WHERE user_id=? AND plan_code=?`, order.user_id, order.plan_code) > 1;
  view(req, res, 'checkout-result', {
    title: 'Результат оплаты',
    order,
    license: lic ? {
      ...st,
      loader: licenseSvc.credentials(lic),
      expires_label: util.formatDate(lic.expires_at)
    } : null,
    stacked,
    artifact_available: fs.existsSync(config.build.artifactPath),
    plan: config.planByCode[order.plan_code]
  });
});

/* ---------------------------------------------------------------- admin ---- */

router.get('/admin/login', requirePageAuth, (req, res) => {
  if (!perms.can(req.user, 'panel.access')) {
    return view(req, res, 'error', { title: '403', code: 403, message: 'У вашего аккаунта нет доступа к панели администратора.' });
  }
  if (req.isAdminSession) return res.redirect('/admin');
  view(req, res, 'admin-login', { title: 'Панель — подтверждение доступа' });
});

router.get('/admin', requirePageAuth, (req, res) => {
  if (!perms.can(req.user, 'panel.access')) return res.redirect('/dashboard');
  if (!req.isAdminSession) return res.redirect('/admin/login');
  licenseSvc.sweep();
  view(req, res, 'admin', { title: 'Панель управления', permissions: [...perms.effectiveFor(req.user)] });
});

router.get('/admin/:section', requirePageAuth, (req, res) => {
  if (!perms.can(req.user, 'panel.access')) return res.redirect('/dashboard');
  if (!req.isAdminSession) return res.redirect('/admin/login');
  view(req, res, 'admin', { title: 'Панель управления', permissions: [...perms.effectiveFor(req.user)], section: req.params.section });
});

/* ------------------------------------------------------------------ FAQ ---- */

const FAQ = [
  {
    id: 'access',
    q: 'Как выдается доступ после оплаты?',
    a: 'Сразу после подтверждения платежа в личном кабинете появляются лицензионный ключ, отдельная пара логин/пароль для лоадера и кнопка загрузки. Всё это хранится в базе и синхронизировано с лоадером — вводить ключ вручную не нужно.'
  },
  {
    id: 'days',
    q: 'Когда начинается отсчёт 30 / 90 / 180 дней?',
    a: 'По умолчанию отсчёт стартует с первого успешного входа в лоадер, а не с момента оплаты. Поведение переключается в админ-панели на «с момента покупки».'
  },
  {
    id: 'expired',
    q: 'Что произойдёт, когда подписка закончится?',
    a: 'Сервер переводит лицензию в статус expired, отзывает активную сессию лоадера на ближайшем heartbeat и закрывает загрузку. Продление добавляет дни к остатку, если доступ ещё действует.'
  },
  {
    id: 'hwid',
    q: 'Сколько устройств можно использовать?',
    a: 'Одна лицензия привязывается к одному HWID. Количество сбросов зависит от тарифа: 3 для 30 дней, 5 для 90 дней и 8 для 180 дней, между сбросами действует кулдаун 72 часа.'
  },
  {
    id: 'hwid-reinstall',
    q: 'Лоадер не принимает моё железо после переустановки системы.',
    a: 'Откройте личный кабинет → «Лицензия» → «Сбросить HWID». Если сбросы закончились, напишите в поддержку — администратор может снять привязку принудительно.'
  },
  {
    id: 'payments',
    q: 'Какие способы оплаты доступны?',
    a: 'Карты РФ и СБП через Lava.ru, ЮKassa и ENOT.io, а также тестовый режим песочницы для проверки сценария покупки. Список активных способов задаётся в админ-панели.'
  },
  {
    id: 'security',
    q: 'Насколько защищён канал между лоадером и сервером?',
    a: 'Каждая сессия поднимает собственный обмен ключами ECDH P-256, дальше всё общение идёт в AES-256-GCM со счётчиком пакетов и проверкой времени. Лицензионный токен подписан ECDSA на стороне сервера и проверяется встроенным публичным ключом.'
  },
  {
    id: 'transfer',
    q: 'Можно ли передать ключ другому человеку?',
    a: 'Нет. Ключ привязан к аккаунту и к HWID, а смена устройства ограничена количеством сбросов. Передача доступа ведёт к отзыву лицензии без возврата.'
  }
];

module.exports = router;
module.exports.view = view;
module.exports.siteSettings = siteSettings;
module.exports.FAQ = FAQ;
