'use strict';
const { now } = require('./lib');
const { CATEGORY_LABELS } = require('./crawler/classify');
const { sources } = require('./crawler/sources');

const AI_MIN = 40;
const LEVELS = ['intern', 'junior', 'middle', 'senior', 'lead'];
const SORTS = ['new', 'ai', 'match'];
const SOURCE_IDS = new Set([...sources.map((s) => s.id), 'demo']);
const SOURCE_NAMES = Object.fromEntries([...sources.map((s) => [s.id, s.name]), ['demo', 'Демо-данные']]);

const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/** Любой ввод (query string или JSON) → строго нормализованные фильтры. Всё остальное отбрасывается. */
function parseFilters(src) {
  const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
  const f = {};
  const q = String(get('q') ?? '').trim().slice(0, 100);
  f.q = q ? q.split(/\s+/).slice(0, 6).map((x) => x.slice(0, 40)) : [];
  f.focus = get('focus') === 'all' ? 'all' : 'ai';
  const cat = get('category');
  f.category = cat && CATEGORY_LABELS[cat] ? cat : '';
  const lvl = get('level');
  f.level = LEVELS.includes(lvl) ? lvl : '';
  f.remote = get('remote') === '1' || get('remote') === true;
  f.salary = get('salary') === '1' || get('salary') === true;
  const src_ = get('source');
  f.source = src_ && SOURCE_IDS.has(src_) ? src_ : '';
  let st = get('stack') ?? '';
  if (Array.isArray(st)) st = st.join(',');
  f.stack = String(st).split(',').map((x) => x.trim().slice(0, 30)).filter(Boolean).slice(0, 6);
  f.days = clampInt(get('days'), 0, 60, 0);
  const sort = get('sort');
  f.sort = SORTS.includes(sort) ? sort : 'new';
  return f;
}

function buildWhere(f, extra = {}) {
  const where = []; const params = [];
  if (f.focus === 'ai') { where.push('j.ai_score >= ?'); params.push(AI_MIN); }
  if (f.category) { where.push('j.category = ?'); params.push(f.category); }
  if (f.level) { where.push('j.level = ?'); params.push(f.level); }
  if (f.remote) where.push('j.remote = 1');
  if (f.salary) where.push("j.salary_text != ''");
  if (f.source) { where.push('j.source = ?'); params.push(f.source); }
  if (f.days) { where.push('j.posted_at >= ?'); params.push(now() - f.days * 86400_000); }
  for (const s of f.stack) { where.push("j.stack LIKE ? ESCAPE '\\'"); params.push(`%"${likeEscape(s.replace(/"/g, ''))}"%`); }
  for (const w of f.q) {
    where.push("(j.title LIKE ? ESCAPE '\\' OR j.company LIKE ? ESCAPE '\\' OR j.stack LIKE ? ESCAPE '\\' OR j.description LIKE ? ESCAPE '\\')");
    const p = `%${likeEscape(w)}%`;
    params.push(p, p, p, p);
  }
  if (extra.firstSeenAfter) { where.push('j.first_seen > ?'); params.push(extra.firstSeenAfter); }
  if (extra.companyKey) { where.push('j.company_key = ?'); params.push(extra.companyKey); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const COLS = `j.id, j.source, j.title, j.company, j.company_key, j.location, j.remote, j.url, j.salary_text, j.category, j.level,
  j.ai_score, j.stack, j.posted_at, substr(j.description, 1, 220) AS snippet`;

function present(r, { userStack, savedSet } = {}) {
  const stack = parseJson(r.stack, []);
  const out = {
    id: r.id, source: r.source, source_name: SOURCE_NAMES[r.source] || r.source, title: r.title, company: r.company, company_key: r.company_key,
    location: r.location, remote: !!r.remote, url: r.url, salary: r.salary_text, category: r.category, category_label: CATEGORY_LABELS[r.category] || r.category,
    level: r.level, ai_score: r.ai_score, stack, posted_at: r.posted_at, snippet: r.snippet,
  };
  if (savedSet) out.saved = savedSet.has(r.id);
  if (userStack && userStack.length) {
    const mine = new Set(userStack.map((s) => s.toLowerCase()));
    const common = stack.filter((s) => mine.has(s.toLowerCase()));
    out.match = stack.length ? Math.min(100, Math.round((100 * common.length) / Math.min(stack.length, 6))) : 0;
    out.match_stack = common;
  }
  return out;
}

function savedIds(db, userId) {
  if (!userId) return null;
  return new Set(db.prepare('SELECT job_id FROM saved_jobs WHERE user_id = ?').all(userId).map((r) => r.job_id));
}

function searchJobs(db, f, { page = 1, limit = 20, user = null, pro = false } = {}) {
  limit = clampInt(limit, 1, 40, 20);
  page = clampInt(page, 1, 500, 1);
  const { sql, params } = buildWhere(f);
  const total = db.prepare(`SELECT COUNT(*) c FROM jobs j ${sql}`).get(...params).c;
  const userStack = pro && user && user.stack.length ? user.stack : null;
  const saved = savedIds(db, user && user.id);
  let rows;
  if (f.sort === 'match' && userStack) {
    rows = db.prepare(`SELECT ${COLS} FROM jobs j ${sql} ORDER BY j.posted_at DESC LIMIT 600`).all(...params)
      .map((r) => present(r, { userStack, savedSet: saved }))
      .sort((a, b) => b.match - a.match || b.posted_at - a.posted_at)
      .slice((page - 1) * limit, page * limit);
  } else {
    const order = f.sort === 'ai' ? 'j.ai_score DESC, j.posted_at DESC' : 'j.posted_at DESC';
    rows = db.prepare(`SELECT ${COLS} FROM jobs j ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit)
      .map((r) => present(r, { userStack, savedSet: saved }));
  }
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), items: rows };
}

function getJob(db, id, { user = null, pro = false } = {}) {
  const r = db.prepare(`SELECT ${COLS}, j.description FROM jobs j WHERE j.id = ?`).get(id);
  if (!r) return null;
  const out = present(r, { userStack: pro && user && user.stack.length ? user.stack : null, savedSet: savedIds(db, user && user.id) });
  out.description = r.description;
  const peers = db.prepare('SELECT COUNT(*) c FROM jobs WHERE company_key = ? AND id != ?').get(r.company_key, id).c;
  out.company_other_roles = peers;
  return out;
}

let statsCache = { at: 0, v: null };
function getStats(db) {
  if (statsCache.v && now() - statsCache.at < 60_000) return statsCache.v;
  const t = now();
  const base = db.prepare(`SELECT COUNT(*) jobs, COUNT(DISTINCT company_key) companies,
    SUM(posted_at > ?) day, SUM(posted_at > ?) week, SUM(remote) remote, SUM(salary_text != '') with_salary FROM jobs WHERE ai_score >= ?`)
    .get(t - 86400_000, t - 7 * 86400_000, AI_MIN);
  const cats = db.prepare('SELECT category, COUNT(*) c FROM jobs WHERE ai_score >= ? GROUP BY category ORDER BY c DESC').all(AI_MIN)
    .map((r) => ({ id: r.category, label: CATEGORY_LABELS[r.category] || r.category, count: r.c }));
  const counts = new Map();
  for (const r of db.prepare('SELECT stack FROM jobs WHERE ai_score >= ?').all(AI_MIN)) {
    for (const s of parseJson(r.stack, [])) counts.set(s, (counts.get(s) || 0) + 1);
  }
  const topStack = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([name, count]) => ({ name, count }));
  const last = db.prepare('SELECT source, MAX(CASE WHEN ok=1 THEN finished_at END) last_ok FROM crawl_runs GROUP BY source').all();
  const srcStats = db.prepare('SELECT source, COUNT(*) c FROM jobs GROUP BY source').all();
  const srcMap = new Map(srcStats.map((r) => [r.source, r.c]));
  const lastMap = new Map(last.map((r) => [r.source, r.last_ok]));
  const list = sources.map((s) => ({ id: s.id, name: s.name, site: s.site, jobs: srcMap.get(s.id) || 0, last_ok: lastMap.get(s.id) || null, enabled: s.enabled ? !!s.enabled() : true }));
  const v = {
    jobs: base.jobs || 0, companies: base.companies || 0, new_24h: base.day || 0, new_7d: base.week || 0, remote: base.remote || 0, with_salary: base.with_salary || 0,
    categories: cats, top_stack: topStack, sources: list, demo: (srcMap.get('demo') || 0) > 0,
    updated_at: Math.max(0, ...last.map((r) => r.last_ok || 0)) || null,
  };
  statsCache = { at: t, v };
  return v;
}
const resetStatsCache = () => { statsCache = { at: 0, v: null }; };

/* ---------- Радар компаний ---------- */
function listCompanies(db, { q = '', page = 1, limit = 12, focus = 'ai', offset: off, max } = {}) {
  limit = clampInt(limit, 1, 40, 12);
  page = clampInt(page, 1, 200, 1);
  const where = []; const params = [];
  if (focus === 'ai') { where.push('ai_score >= ?'); params.push(AI_MIN); }
  const words = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 4);
  for (const w of words) { where.push("company LIKE ? ESCAPE '\\'"); params.push(`%${likeEscape(w.slice(0, 40))}%`); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(DISTINCT company_key) c FROM jobs ${W}`).get(...params).c;
  const offset = off ?? (page - 1) * limit;
  const eff = max !== undefined ? Math.max(0, Math.min(limit, max - offset)) : limit;
  const t = now();
  const rows = eff <= 0 ? [] : db.prepare(`SELECT company_key, MAX(company) company, COUNT(*) roles, SUM(ai_score >= ${AI_MIN}) ai_roles, SUM(remote) remote_roles,
      SUM(posted_at > ?) new7, MAX(posted_at) latest, MAX(ai_score) top_ai, GROUP_CONCAT(DISTINCT source) sources
    FROM jobs ${W} GROUP BY company_key ORDER BY new7 DESC, ai_roles DESC, roles DESC, latest DESC LIMIT ? OFFSET ?`)
    .all(t - 7 * 86400_000, ...params, eff, offset);
  const items = rows.map((r) => {
    const jobs = db.prepare('SELECT id, title, stack, category FROM jobs WHERE company_key = ? ORDER BY posted_at DESC LIMIT 40').all(r.company_key);
    const counts = new Map();
    for (const j of jobs) for (const s of parseJson(j.stack, [])) counts.set(s, (counts.get(s) || 0) + 1);
    return {
      key: r.company_key, name: r.company, roles: r.roles, ai_roles: r.ai_roles, remote_roles: r.remote_roles, new_7d: r.new7,
      latest: r.latest, sources: String(r.sources).split(',').map((s) => SOURCE_NAMES[s] || s),
      stack: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n),
      sample_titles: jobs.slice(0, 3).map((j) => j.title),
    };
  });
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), items };
}

function getCompany(db, key, { user = null, pro = false } = {}) {
  const jobs = db.prepare(`SELECT ${COLS} FROM jobs j WHERE j.company_key = ? ORDER BY j.posted_at DESC LIMIT 100`).all(key);
  if (!jobs.length) return null;
  const saved = savedIds(db, user && user.id);
  const userStack = pro && user && user.stack.length ? user.stack : null;
  const items = jobs.map((r) => present(r, { userStack, savedSet: saved }));
  return { key, name: jobs[0].company, jobs: items };
}

/* ---------- Сохранённые поиски (Pro) ---------- */
function countNewForSearch(db, f, since) {
  const { sql, params } = buildWhere(f, { firstSeenAfter: since });
  return db.prepare(`SELECT COUNT(*) c FROM jobs j ${sql}`).get(...params).c;
}

module.exports = {
  AI_MIN, parseFilters, searchJobs, getJob, getStats, resetStatsCache, listCompanies, getCompany, countNewForSearch,
  SOURCE_NAMES, CATEGORY_LABELS, LEVELS,
};
