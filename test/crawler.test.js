'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const { classify } = require('../server/crawler/classify');
const { normalize, tick } = require('../server/crawler');
const { sources } = require('../server/crawler/sources');
const { htmlToText, safeUrl, companyKey } = require('../server/lib');
const { open } = require('../server/db');
const jobs = require('../server/jobs');

test('классификатор отделяет ИИ от обычной разработки и не-IT', () => {
  const ml = classify({ title: 'Senior LLM Engineer', tags: [], description: 'We build RAG with LangChain and PyTorch' });
  assert.ok(ml.isDev && ml.aiScore >= 70); assert.equal(ml.category, 'llm'); assert.equal(ml.level, 'senior');
  assert.ok(ml.stack.includes('RAG') && ml.stack.includes('PyTorch'));
  assert.equal(classify({ title: 'Data Scientist', description: '' }).category, 'ds');
  assert.equal(classify({ title: 'MLOps Engineer', description: 'Kubernetes' }).category, 'mlops');
  const dev = classify({ title: 'Backend Developer', tags: ['golang'], description: 'APIs' });
  assert.ok(dev.isDev && dev.aiScore < 40);
  assert.equal(classify({ title: 'Sales Manager', tags: ['AI/ML'], description: 'sell AI' }).isDev, false);
  assert.equal(classify({ title: 'Content Reviewer', tags: ['AI/ML'], description: '' }).isDev, false);
  assert.equal(classify({ title: 'Junior ML Engineer' }).level, 'junior');
});

test('htmlToText вычищает скрипты/теги и чинит кракозябры', () => {
  const t = htmlToText('<p>Hi</p><script>alert(1)</script><ul><li>One</li></ul><img src=x onerror=alert(1)>&amp; it&#39;s');
  assert.doesNotMatch(t, /script|alert|onerror|<|>/);
  assert.match(t, /• One/);
  assert.equal(htmlToText('Donâ\u0080\u0099t'), 'Don’t');
});

test('safeUrl пропускает только http(s)', () => {
  assert.equal(safeUrl('javascript:alert(1)'), ''); assert.equal(safeUrl('data:text/html,x'), '');
  assert.ok(safeUrl('https://a.com/x'));
  assert.equal(companyKey('Acme, Inc.'), companyKey('ACME Inc'));
});

test('normalize: отбрасывает старые/не-IT/без ссылки, форматирует зарплату', () => {
  const base = { ext_id: '1', title: 'ML Engineer', company: 'Acme', url: 'https://x.io/1', description: '<b>PyTorch</b>', posted_at: Date.now() - 3600_000, salary: { min: 120000, max: 150000, currency: 'USD', period: 'annual' } };
  const n = normalize(base, 'remotive');
  assert.equal(n.salary_text, '120k–150k $/год'); assert.ok(n.ai_score >= 70);
  assert.equal(normalize({ ...base, url: 'javascript:1' }, 'x'), null);
  assert.equal(normalize({ ...base, posted_at: Date.now() - 90 * 86400_000 }, 'x'), null);
  assert.equal(normalize({ ...base, title: 'Recruiter' }, 'x'), null);
});

test('адаптеры источников разбирают ответы API (мок HTTP)', async () => {
  const now = Date.now();
  const mocks = {
    remotive: { jobs: [{ id: 1, url: 'https://remotive.com/j/1', title: 'AI Engineer', company_name: 'Lemon', category: 'Software Development', tags: ['python'], publication_date: new Date(now - 3600_000).toISOString().slice(0, 19), candidate_required_location: 'Europe', salary: '$100k', description: '<p>RAG</p>' }] },
    arbeitnow: { data: [{ slug: 'ml-1', company_name: 'Berlin AI', title: 'Machine Learning Engineer', description: 'PyTorch', remote: true, url: 'https://www.arbeitnow.com/jobs/1', tags: ['AI'], job_types: [], location: 'Berlin', created_at: Math.floor(now / 1000) - 600 }], links: {} },
    jobicy: { jobs: [{ id: 5, url: 'https://jobicy.com/jobs/5', jobTitle: 'LLM Engineer', companyName: 'Quora', jobGeo: 'USA', jobDescription: '<p>LLM</p>', jobIndustry: ['Engineering'], jobType: ['Full-Time'], pubDate: new Date(now - 7200_000).toISOString() }] },
    remoteok: [{ legal: 'x' }, { id: '9', position: 'ML Engineer', company: 'ROK', url: 'https://remoteok.com/9', tags: ['ml'], description: 'x', epoch: Math.floor(now / 1000) - 100, salary_min: 90000, salary_max: 120000 }],
    himalayas: { jobs: [{ title: 'Data Scientist', companyName: 'Wave HQ', guid: 'https://himalayas.app/j/1', applicationLink: 'https://himalayas.app/j/1', description: 'x', categories: ['Data-Science'], seniority: ['Mid-level'], pubDate: Math.floor(now / 1000) - 100, minSalary: 100000, maxSalary: 130000, currency: 'CAD', salaryPeriod: 'annual', locationRestrictions: ['Canada'] }] },
    hh: { items: [{ id: '77', name: 'ML-инженер', employer: { name: 'Яндекс' }, area: { name: 'Москва' }, schedule: { id: 'remote' }, alternate_url: 'https://hh.ru/vacancy/77', snippet: { requirement: 'Python, PyTorch', responsibility: 'Обучать модели' }, published_at: new Date(now - 3600_000).toISOString(), salary: { from: 300000, to: null, currency: 'RUR' } }] },
  };
  for (const s of sources) {
    const http = async () => mocks[s.id];
    const raws = await s.fetch(http);
    assert.ok(raws.length >= 1, s.id);
    const n = normalize(raws[0], s.id);
    assert.ok(n, `${s.id} должен пройти normalize`);
    assert.ok(n.url.startsWith('http'));
  }
});

test('tick сохраняет вакансии, не дублирует и уважает интервал', async () => {
  const db = open(':memory:');
  const http = async () => ({ jobs: [{ id: 1, url: 'https://remotive.com/j/1', title: 'AI Engineer', company_name: 'Lemon', category: 'x', tags: [], publication_date: new Date(Date.now() - 1000).toISOString().slice(0, 19), description: 'RAG LLM' }] });
  const first = await tick(db, { force: true, http });
  assert.ok(first.find((r) => r.source === 'remotive').inserted === 1);
  await tick(db, { force: true, http });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs WHERE source='remotive'").get().c, 1);
  const again = await tick(db, { http });
  assert.equal(again.length, 0, 'интервал ещё не истёк');
  assert.equal(jobs.searchJobs(db, jobs.parseFilters({ q: 'lemon' })).total >= 1, true);
});
