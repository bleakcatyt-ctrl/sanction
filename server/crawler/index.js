'use strict';
const { sources } = require('./sources');
const { classify } = require('./classify');
const { now, htmlToText, cleanLine, safeUrl, companyKey } = require('../lib');
const { tx } = require('../db');

const MAX_AGE_DAYS = 45;
const MIN_KEEP_AI = 0;

const CUR = { USD: '$', EUR: '€', GBP: '£', RUB: '₽', INR: '₹', CAD: 'CA$', AUD: 'A$' };
function formatSalary(s, fallbackText = '') {
  if (!s || (!s.min && !s.max)) return cleanLine(fallbackText, 60);
  const cur = CUR[String(s.currency || '').toUpperCase()] || String(s.currency || '').toUpperCase();
  const short = (n) => {
    n = Number(n);
    if (!n) return '';
    if (n >= 10000) return Math.round(n / 1000) + 'k';
    return String(Math.round(n));
  };
  const per = { hourly: '/час', monthly: '/мес', annual: '/год', yearly: '/год' }[String(s.period || '').toLowerCase()] || '';
  const a = short(s.min); const b = short(s.max);
  const range = a && b && a !== b ? `${a}–${b}` : a || b;
  return `${range} ${cur}${per}`.trim().slice(0, 60);
}

/** Сырые данные → запись для БД (или null, если вакансия нам не подходит). */
function normalize(raw, sourceId, t = now()) {
  const title = cleanLine(raw.title, 160);
  const company = cleanLine(raw.company, 100);
  const url = safeUrl(raw.url);
  if (!title || !company || !url || !raw.ext_id) return null;
  const description = htmlToText(raw.description, 8000);
  const tags = (raw.tags || []).map((x) => cleanLine(x, 40)).filter(Boolean).slice(0, 40);
  const c = classify({ title, tags, description });
  if (!c.isDev) return null;
  const posted = raw.posted_at && raw.posted_at <= t + 86400_000 ? raw.posted_at : t;
  if (t - posted > MAX_AGE_DAYS * 86400_000) return null;
  if (c.aiScore < MIN_KEEP_AI) return null;
  const location = cleanLine(raw.location, 120);
  return {
    source: sourceId,
    ext_id: String(raw.ext_id).slice(0, 300),
    title, company, company_key: companyKey(company), location,
    remote: raw.remote || /remote|удал[её]н/i.test(location) ? 1 : 0,
    url, salary_text: formatSalary(raw.salary, raw.salaryText),
    category: c.category, level: c.level, ai_score: c.aiScore, stack: JSON.stringify(c.stack),
    description, posted_at: posted,
  };
}

const UPSERT = `INSERT INTO jobs (source, ext_id, title, company, company_key, location, remote, url, salary_text, category, level, ai_score, stack, description, posted_at, first_seen, last_seen)
  VALUES (@source,@ext_id,@title,@company,@company_key,@location,@remote,@url,@salary_text,@category,@level,@ai_score,@stack,@description,@posted_at,@t,@t)
  ON CONFLICT(source, ext_id) DO UPDATE SET title=excluded.title, company=excluded.company, company_key=excluded.company_key,
    location=excluded.location, remote=excluded.remote, url=excluded.url, salary_text=excluded.salary_text, category=excluded.category,
    level=excluded.level, ai_score=excluded.ai_score, stack=excluded.stack, description=excluded.description, last_seen=excluded.last_seen`;

function saveJobs(db, rows) {
  const t = now();
  let inserted = 0;
  tx(db, () => {
    const before = db.prepare('SELECT COUNT(*) c FROM jobs').get().c;
    const st = db.prepare(UPSERT);
    for (const r of rows) st.run({ ...r, t });
    inserted = db.prepare('SELECT COUNT(*) c FROM jobs').get().c - before;
  });
  return inserted;
}

function pruneJobs(db) {
  const t = now();
  // не видели 10 дней или старше MAX_AGE_DAYS — вакансия, вероятно, закрыта
  db.prepare('DELETE FROM jobs WHERE last_seen < ? OR posted_at < ?').run(t - 10 * 86400_000, t - MAX_AGE_DAYS * 86400_000);
  db.prepare('DELETE FROM crawl_runs WHERE started_at < ?').run(t - 14 * 86400_000);
}

async function runSource(db, src, http) {
  const started = now();
  const run = db.prepare('INSERT INTO crawl_runs (source, started_at) VALUES (?,?)').run(src.id, started);
  let fetched = 0; let kept = 0; let inserted = 0; let error = '';
  try {
    const raws = await src.fetch(http);
    fetched = raws.length;
    const rows = [];
    for (const raw of raws) {
      try { const n = normalize(raw, src.id); if (n) rows.push(n); } catch { /* битая запись — пропускаем */ }
    }
    kept = rows.length;
    inserted = saveJobs(db, rows);
  } catch (e) {
    error = String(e.message || e).slice(0, 300);
  }
  db.prepare('UPDATE crawl_runs SET finished_at=?, ok=?, fetched=?, kept=?, inserted=?, error=? WHERE id=?')
    .run(now(), error ? 0 : 1, fetched, kept, inserted, error, run.lastInsertRowid);
  return { source: src.id, fetched, kept, inserted, error };
}

function isDue(db, src) {
  const last = db.prepare('SELECT started_at FROM crawl_runs WHERE source = ? ORDER BY started_at DESC LIMIT 1').get(src.id);
  return !last || now() - last.started_at >= src.intervalMs;
}

let running = false;
/** Один проход планировщика: запускает только те источники, чей интервал истёк. */
async function tick(db, { force = false, http } = {}) {
  if (running) return [];
  running = true;
  const results = [];
  try {
    for (const src of sources) {
      if (src.enabled && !src.enabled()) continue;
      if (!force && !isDue(db, src)) continue;
      results.push(await runSource(db, src, http));
    }
    if (results.length) pruneJobs(db);
  } finally { running = false; }
  return results;
}

function start(db) {
  const go = () => tick(db).then((r) => r.forEach((x) => console.log(`[crawler] ${x.source}: получено ${x.fetched}, подошло ${x.kept}, новых ${x.inserted}${x.error ? ' ОШИБКА ' + x.error : ''}`))).catch((e) => console.error('[crawler]', e));
  setTimeout(go, 3000).unref();
  setInterval(go, 10 * 60_000).unref();
}

module.exports = { normalize, formatSalary, saveJobs, tick, start, pruneJobs };
