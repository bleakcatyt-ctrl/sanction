'use strict';
const config = require('./config');
const { now, cleanLine } = require('./lib');
const { HttpError, sendJson, clientIp, readJson, readBody, parseCookies, serializeCookie, checkOrigin, rateLimit, rateLimitPeek, rateLimitReset } = require('./http');
const auth = require('./auth');
const billing = require('./billing');
const rp = require('./rollypay');
const jobs = require('./jobs');
const { CATEGORY_LABELS } = require('./crawler/classify');
const { sources } = require('./crawler/sources');

const FREE_COMPANY_PREVIEW = 6;
const MAX_SEARCHES = 10;

const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts });
};

const meta = () => ({
  categories: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
  levels: jobs.LEVELS,
  sources: sources.map((s) => ({ id: s.id, name: s.name })),
});

const setSessionCookie = (res, s) => res.setHeader('Set-Cookie', serializeCookie(auth.COOKIE_NAME, s.token, { maxAge: s.maxAge }));
const clearSessionCookie = (res) => res.setHeader('Set-Cookie', serializeCookie(auth.COOKIE_NAME, '', { maxAge: 0 }));

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Войдите в аккаунт', { code: 'auth_required' });
  return ctx.user;
}
function requirePro(ctx) {
  requireUser(ctx);
  if (!ctx.pro) throw new HttpError(402, 'Функция доступна в тарифе Pro', { code: 'pro_required' });
}
const intParam = (v) => {
  if (!/^\d{1,12}$/.test(String(v))) throw new HttpError(404, 'Не найдено');
  return Number(v);
};

/* ============ сессия / аккаунт ============ */
route('GET', '/api/session', (ctx) => ({
  user: auth.publicUser(ctx.user), csrf: ctx.session ? ctx.session.csrf : null,
  plans: billing.publicPlans(), meta: meta(), contact: config.contactEmail,
  payments: { live: config.rollypay.configured, fake: config.rollypay.fake, test: config.rollypay.testMode },
}));

route('POST', '/api/auth/register', async (ctx) => {
  rateLimit('reg:' + ctx.ip, 5, 3600_000);
  const b = await readJson(ctx.req);
  const email = auth.normalizeEmail(b.email);
  auth.validatePassword(b.password, email);
  const name = cleanLine(b.name || '', 60);
  const hash = await auth.hashPassword(b.password);
  let id;
  try {
    id = Number(ctx.db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,?)').run(email, name, hash, now()).lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'Этот email уже зарегистрирован');
    throw e;
  }
  const s = auth.createSession(ctx.db, id, ctx.req.headers['user-agent']);
  setSessionCookie(ctx.res, s);
  const u = auth.getSession(ctx.db, s.token);
  return { user: auth.publicUser(u.user), csrf: s.csrf };
});

route('POST', '/api/auth/login', async (ctx) => {
  rateLimit('login-ip:' + ctx.ip, 20, 15 * 60_000);
  const b = await readJson(ctx.req);
  const email = auth.normalizeEmail(b.email);
  const key = 'login-fail:' + email;
  if (rateLimitPeek(key, 5, 15 * 60_000)) throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут.');
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const row = ctx.db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  let ok = false;
  if (row) ok = await auth.verifyPassword(password, row.password_hash);
  else await auth.dummyVerify(password);
  if (!ok) {
    try { rateLimit(key, 5, 15 * 60_000); } catch { /* уже заблокирован */ }
    throw new HttpError(401, 'Неверный email или пароль');
  }
  rateLimitReset(key);
  const s = auth.createSession(ctx.db, row.id, ctx.req.headers['user-agent']);
  setSessionCookie(ctx.res, s);
  const u = auth.getSession(ctx.db, s.token);
  return { user: auth.publicUser(u.user), csrf: s.csrf };
});

route('POST', '/api/auth/logout', (ctx) => {
  if (ctx.session) auth.destroySession(ctx.db, ctx.session.tokenHash);
  clearSessionCookie(ctx.res);
  return { ok: true };
});

route('POST', '/api/auth/password', async (ctx) => {
  const user = requireUser(ctx);
  rateLimit('pw:' + user.id, 5, 3600_000);
  const b = await readJson(ctx.req);
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!(await auth.verifyPassword(String(b.current || '').slice(0, 200), row.password_hash))) throw new HttpError(403, 'Текущий пароль неверен');
  auth.validatePassword(b.next, user.email);
  ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(b.next), user.id);
  auth.destroyOtherSessions(ctx.db, user.id, ctx.session.tokenHash); // остальные устройства разлогиниваются
  return { ok: true };
});

route('DELETE', '/api/account', async (ctx) => {
  const user = requireUser(ctx);
  rateLimit('del:' + user.id, 3, 3600_000);
  const b = await readJson(ctx.req);
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!(await auth.verifyPassword(String(b.password || '').slice(0, 200), row.password_hash))) throw new HttpError(403, 'Пароль неверен');
  ctx.db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  clearSessionCookie(ctx.res);
  return { ok: true };
});

route('PUT', '/api/profile', async (ctx) => {
  const user = requireUser(ctx);
  const b = await readJson(ctx.req);
  const stack = Array.isArray(b.stack) ? b.stack : [];
  const clean = [...new Set(stack.map((s) => cleanLine(s, 30)).filter((s) => s && /^[\p{L}\p{N} .+#/_-]+$/u.test(s)))].slice(0, 20);
  const name = cleanLine(b.name ?? user.name, 60);
  ctx.db.prepare('UPDATE users SET stack = ?, name = ? WHERE id = ?').run(JSON.stringify(clean), name, user.id);
  return { stack: clean, name };
}, { csrf: true });

/* ============ вакансии ============ */
route('GET', '/api/stats', (ctx) => jobs.getStats(ctx.db));

route('GET', '/api/jobs', (ctx) => {
  const f = jobs.parseFilters(ctx.url.searchParams);
  if (f.sort === 'match' && !ctx.pro) f.sort = 'new';
  return jobs.searchJobs(ctx.db, f, { page: ctx.url.searchParams.get('page'), limit: ctx.url.searchParams.get('limit'), user: ctx.user, pro: ctx.pro });
});

route('GET', '/api/jobs/:id', (ctx, p) => {
  const j = jobs.getJob(ctx.db, intParam(p.id), { user: ctx.user, pro: ctx.pro });
  if (!j) throw new HttpError(404, 'Вакансия не найдена или уже закрыта');
  return j;
});

route('GET', '/api/saved', (ctx) => {
  const user = requireUser(ctx);
  const rows = ctx.db.prepare('SELECT job_id FROM saved_jobs WHERE user_id = ? ORDER BY saved_at DESC LIMIT 200').all(user.id);
  const items = rows.map((r) => jobs.getJob(ctx.db, r.job_id, { user, pro: ctx.pro })).filter(Boolean).map(({ description, ...rest }) => rest);
  return { items };
});
route('PUT', '/api/saved/:id', (ctx, p) => {
  const user = requireUser(ctx);
  const id = intParam(p.id);
  if (!ctx.db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw new HttpError(404, 'Вакансия не найдена');
  if (ctx.db.prepare('SELECT COUNT(*) c FROM saved_jobs WHERE user_id = ?').get(user.id).c >= 500) throw new HttpError(400, 'Слишком много сохранённых вакансий');
  ctx.db.prepare('INSERT OR IGNORE INTO saved_jobs (user_id, job_id, saved_at) VALUES (?,?,?)').run(user.id, id, now());
  return { ok: true };
});
route('DELETE', '/api/saved/:id', (ctx, p) => {
  const user = requireUser(ctx);
  ctx.db.prepare('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?').run(user.id, intParam(p.id));
  return { ok: true };
});

/* ============ радар компаний ============ */
route('GET', '/api/companies', (ctx) => {
  const sp = ctx.url.searchParams;
  const focus = sp.get('focus') === 'all' ? 'all' : 'ai';
  if (ctx.pro) {
    const r = jobs.listCompanies(ctx.db, { q: sp.get('q') || '', page: sp.get('page'), limit: 12, focus });
    return { ...r, pro: true, locked: 0 };
  }
  // Бесплатно — превью: только топ компаний, остальное закрыто (отрезается на сервере)
  const r = jobs.listCompanies(ctx.db, { page: 1, limit: FREE_COMPANY_PREVIEW, focus });
  return { total: r.total, page: 1, pages: 1, items: r.items, pro: false, locked: Math.max(0, r.total - r.items.length) };
});
route('GET', '/api/companies/:key', (ctx, p) => {
  requirePro(ctx);
  const c = jobs.getCompany(ctx.db, p.key.slice(0, 80), { user: ctx.user, pro: true });
  if (!c) throw new HttpError(404, 'Компания не найдена');
  return c;
});

/* ============ сохранённые поиски (Pro) ============ */
const presentSearch = (db, s) => {
  const f = jobs.parseFilters(JSON.parse(s.query));
  return { id: s.id, name: s.name, query: JSON.parse(s.query), new_count: jobs.countNewForSearch(db, f, s.last_seen), created_at: s.created_at };
};
route('GET', '/api/searches', (ctx) => {
  requirePro(ctx);
  return { items: ctx.db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id).map((s) => presentSearch(ctx.db, s)) };
});
route('POST', '/api/searches', async (ctx) => {
  requirePro(ctx);
  const b = await readJson(ctx.req);
  if (ctx.db.prepare('SELECT COUNT(*) c FROM saved_searches WHERE user_id = ?').get(ctx.user.id).c >= MAX_SEARCHES) throw new HttpError(400, `Не больше ${MAX_SEARCHES} сохранённых поисков`);
  const f = jobs.parseFilters(b.query && typeof b.query === 'object' ? b.query : {});
  const query = { q: f.q.join(' '), focus: f.focus, category: f.category, level: f.level, remote: f.remote, salary: f.salary, source: f.source, stack: f.stack };
  const name = cleanLine(b.name || f.q.join(' ') || 'Мой поиск', 60);
  const r = ctx.db.prepare('INSERT INTO saved_searches (user_id, name, query, last_seen, created_at) VALUES (?,?,?,?,?)').run(ctx.user.id, name, JSON.stringify(query), now(), now());
  return presentSearch(ctx.db, ctx.db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(Number(r.lastInsertRowid)));
});
route('POST', '/api/searches/:id/seen', (ctx, p) => {
  requirePro(ctx);
  ctx.db.prepare('UPDATE saved_searches SET last_seen = ? WHERE id = ? AND user_id = ?').run(now(), intParam(p.id), ctx.user.id);
  return { ok: true };
});
route('DELETE', '/api/searches/:id', (ctx, p) => {
  requirePro(ctx);
  ctx.db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(intParam(p.id), ctx.user.id);
  return { ok: true };
});

/* ============ оплата ============ */
route('POST', '/api/billing/checkout', async (ctx) => {
  const user = requireUser(ctx);
  rateLimit('checkout:' + user.id, 10, 3600_000);
  const b = await readJson(ctx.req);
  return billing.createCheckout(ctx.db, user, String(b.plan || ''));
});
route('GET', '/api/billing/orders', (ctx) => {
  const user = requireUser(ctx);
  return { items: ctx.db.prepare('SELECT * FROM orders WHERE user_id = ? AND status != ? ORDER BY created_at DESC LIMIT 30').all(user.id, 'failed').map(billing.publicOrder) };
});
route('GET', '/api/billing/orders/:id', async (ctx, p) => {
  const user = requireUser(ctx);
  rateLimit('order-poll:' + user.id, 60, 60_000);
  let order = ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(p.id.slice(0, 60), user.id);
  if (!order) throw new HttpError(404, 'Заказ не найден');
  order = await billing.refreshOrder(ctx.db, order);
  const fresh = ctx.db.prepare('SELECT pro_until FROM users WHERE id = ?').get(user.id);
  return { order: billing.publicOrder(order), pro_until: fresh.pro_until > now() ? fresh.pro_until : null };
});

// Вебхук RollyPay: без cookie/CSRF — подлинность подтверждается HMAC-подписью.
route('POST', '/api/webhooks/rollypay', async (ctx) => {
  rateLimit('wh:' + ctx.ip, 120, 60_000);
  const raw = (await readBody(ctx.req, 64 * 1024)).toString('utf8');
  await billing.handleWebhook(ctx.db, raw, ctx.req.headers);
  return { ok: true };
}, { noCsrf: true });

/* ============ dev-шлюз (только VEKTOR_DEV_FAKE_PAYMENTS=1, не в production) ============ */
if (config.rollypay.fake) {
  route('GET', '/api/dev/orders/:id', (ctx, p) => {
    const user = requireUser(ctx);
    const o = ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(p.id.slice(0, 60), user.id);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    return { order: billing.publicOrder(o) };
  });
  route('POST', '/api/dev/pay/simulate', async (ctx) => {
    const user = requireUser(ctx);
    const b = await readJson(ctx.req);
    const o = ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(String(b.order_id || '').slice(0, 60), user.id);
    if (!o || !o.payment_id) throw new HttpError(404, 'Заказ не найден');
    const status = b.outcome === 'paid' ? 'paid' : 'canceled';
    rp.fakeSetStatus(o.payment_id, status);
    const body = JSON.stringify({ event_type: 'payment.' + status, payment_id: o.payment_id, order_id: o.id, status, amount: o.amount, currency: o.currency, test: true });
    const ts = String(Math.floor(Date.now() / 1000));
    // Идём через настоящий путь вебхука, включая проверку подписи
    const result = await billing.handleWebhook(ctx.db, body, { 'x-timestamp': ts, 'x-signature': rp.sign(ts, body, config.rollypay.signingSecret) });
    return { ok: true, result };
  });
}

/* ============ диспетчер ============ */
async function handleApi(ctx) {
  const { req, res, url } = ctx;
  rateLimit('api:' + ctx.ip, 600, 60_000);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/health') return sendJson(res, 200, { ok: true });

  let matched = null; let params = {}; let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method === req.method) { matched = r; params = m.groups || {}; break; }
  }
  if (!matched) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Метод не поддерживается' : 'Не найдено');

  // сессия
  const token = parseCookies(req.headers.cookie)[auth.COOKIE_NAME];
  ctx.session = auth.getSession(ctx.db, token);
  ctx.user = ctx.session ? ctx.session.user : null;
  ctx.pro = auth.isPro(ctx.user);

  if (req.method !== 'GET' && req.method !== 'HEAD' && !matched.opts.noCsrf) {
    checkOrigin(req);
    if (ctx.session) {
      const sent = String(req.headers['x-csrf-token'] || '');
      if (!sent || !auth.safeEqual(sent, ctx.session.csrf)) throw new HttpError(403, 'Неверный CSRF-токен. Обновите страницу.');
    }
  }
  const out = await matched.handler(ctx, params);
  if (!res.headersSent) sendJson(res, 200, out);
}

module.exports = { handleApi };
