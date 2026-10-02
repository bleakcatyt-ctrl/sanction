'use strict';
/**
 * Источники вакансий. Каждый возвращает «сырые» объекты в общем формате:
 *  { ext_id, title, company, location, remote, url, description(html|text), tags[], posted_at(ms), salary:{min,max,currency,period}|salaryText }
 * Условия источников (атрибуция со ссылкой на оригинал, лимиты запросов) соблюдаются:
 * ссылка «Откликнуться» всегда ведёт на оригинальную вакансию, источник указывается в карточке.
 */
const config = require('../../config');
const { getJson } = require('../http');

const H = 3600_000;

const toMs = (v) => {
  if (!v) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

const sources = [
  {
    id: 'remotive', name: 'Remotive', site: 'https://remotive.com', intervalMs: 6 * H, // условия: не чаще 4 раз в сутки
    async fetch(http = getJson) {
      const data = await http('https://remotive.com/api/remote-jobs');
      return (data.jobs || []).map((j) => ({
        ext_id: String(j.id), title: j.title, company: j.company_name, location: j.candidate_required_location || 'Remote',
        remote: true, url: j.url, description: j.description, tags: [...(j.tags || []), j.category].filter(Boolean),
        posted_at: toMs(j.publication_date + (String(j.publication_date).endsWith('Z') ? '' : 'Z')), salaryText: j.salary || '',
      }));
    },
  },
  {
    id: 'arbeitnow', name: 'Arbeitnow', site: 'https://www.arbeitnow.com', intervalMs: 3 * H,
    async fetch(http = getJson) {
      const out = [];
      for (let page = 1; page <= 4; page++) {
        const data = await http(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
        for (const j of data.data || []) {
          out.push({
            ext_id: j.slug, title: j.title, company: j.company_name, location: j.location || '', remote: !!j.remote, url: j.url,
            description: j.description, tags: [...(j.tags || []), ...(j.job_types || [])], posted_at: toMs(j.created_at),
          });
        }
        if (!data.links || !data.links.next) break;
      }
      return out;
    },
  },
  {
    id: 'jobicy', name: 'Jobicy', site: 'https://jobicy.com', intervalMs: 3 * H,
    async fetch(http = getJson) {
      const out = new Map();
      for (const tag of ['machine-learning', 'ai', 'llm', 'python', 'data-science']) {
        let data;
        try { data = await http(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`); } catch (e) { if (out.size) continue; throw e; }
        for (const j of data.jobs || []) {
          out.set(String(j.id), {
            ext_id: String(j.id), title: j.jobTitle, company: j.companyName, location: j.jobGeo || 'Remote', remote: true, url: j.url,
            description: j.jobDescription || j.jobExcerpt, tags: [...(j.jobIndustry || []), ...(j.jobType || []), j.jobLevel].filter(Boolean),
            posted_at: toMs(j.pubDate), salary: j.salaryMin ? { min: j.salaryMin, max: j.salaryMax, currency: j.salaryCurrency, period: j.salaryPeriod } : null,
          });
        }
      }
      return [...out.values()];
    },
  },
  {
    id: 'remoteok', name: 'Remote OK', site: 'https://remoteok.com', intervalMs: 3 * H,
    async fetch(http = getJson) {
      const data = await http('https://remoteok.com/api');
      return (Array.isArray(data) ? data : []).filter((j) => j && j.id && j.position).map((j) => ({
        ext_id: String(j.id), title: j.position, company: j.company, location: j.location || 'Remote', remote: true,
        url: j.url || j.apply_url, description: j.description, tags: j.tags || [], posted_at: toMs(j.epoch || j.date),
        salary: j.salary_min ? { min: j.salary_min, max: j.salary_max, currency: 'USD', period: 'annual' } : null,
      }));
    },
  },
  {
    id: 'himalayas', name: 'Himalayas', site: 'https://himalayas.app', intervalMs: 3 * H,
    async fetch(http = getJson) {
      const out = new Map();
      for (const q of ['machine learning', 'llm', 'ai engineer', 'data scientist', 'python']) {
        let data;
        try { data = await http(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent`); } catch (e) { if (out.size) continue; throw e; }
        for (const j of data.jobs || []) {
          const id = j.guid || j.applicationLink;
          out.set(id, {
            ext_id: id, title: j.title, company: j.companyName, location: (j.locationRestrictions || []).join(', ') || 'Remote', remote: true,
            url: j.applicationLink || j.guid, description: j.description, tags: [...(j.categories || []).map((c) => c.replace(/-/g, ' ')), ...(j.seniority || [])],
            posted_at: toMs(j.pubDate),
            salary: j.minSalary ? { min: j.minSalary, max: j.maxSalary, currency: j.currency, period: j.salaryPeriod } : null,
          });
        }
      }
      return [...out.values()];
    },
  },
  {
    id: 'hh', name: 'HeadHunter', site: 'https://hh.ru', intervalMs: 3 * H,
    enabled: () => !!config.hhToken, // api.hh.ru без токена приложения отвечает 403
    async fetch(http = getJson) {
      const out = new Map();
      const headers = { Authorization: `Bearer ${config.hhToken}`, 'HH-User-Agent': `Vektor/1.0 (${config.contactEmail || config.appUrl})` };
      for (const text of ['machine learning', 'LLM', 'data scientist', 'ML engineer', 'нейросети разработчик', 'python разработчик ИИ']) {
        const data = await http(`https://api.hh.ru/vacancies?text=${encodeURIComponent(text)}&per_page=100&order_by=publication_time&period=14`, headers);
        for (const j of data.items || []) {
          out.set(String(j.id), {
            ext_id: String(j.id), title: j.name, company: j.employer && j.employer.name, location: (j.area && j.area.name) || '',
            remote: !!(j.schedule && j.schedule.id === 'remote'), url: j.alternate_url,
            description: [j.snippet && j.snippet.responsibility, j.snippet && j.snippet.requirement].filter(Boolean).join('\n'),
            tags: [], posted_at: toMs(j.published_at),
            salary: j.salary ? { min: j.salary.from, max: j.salary.to, currency: j.salary.currency === 'RUR' ? 'RUB' : j.salary.currency, period: 'monthly' } : null,
          });
        }
      }
      return [...out.values()];
    },
  },
];

module.exports = { sources, toMs };
