import { h, mount, clear, icon, timeAgo, toast } from './dom.js';
import { api, loadSession, state, user, isPro } from './api.js';

const root = document.getElementById('app');
const headerEl = h('header', { class: 'header' });
const tapeEl = h('div', { class: 'tape', 'aria-label': 'Свежие вакансии' });
const demoEl = h('div', { class: 'demo-flag hidden' }, 'ДЕМО-РЕЖИМ: показаны вымышленные вакансии. Настоящие появятся после первого сбора с источников.');
const mainEl = h('main', { id: 'main', tabindex: '-1' });
const footerEl = h('footer', { class: 'footer' });
mount(root, headerEl, demoEl, tapeEl, mainEl, footerEl);

/* ---------- маршруты ---------- */
const routes = [
  { name: 'home', re: /^\/$/, load: () => import('./pages/home.js') },
  { name: 'jobs', re: /^\/jobs(?:\/(?<id>\d+))?$/, load: () => import('./pages/jobs.js') },
  { name: 'companies', re: /^\/companies(?:\/(?<key>[^/]+))?$/, load: () => import('./pages/companies.js') },
  { name: 'pricing', re: /^\/pricing$/, load: () => import('./pages/pricing.js') },
  { name: 'login', re: /^\/login$/, load: () => import('./pages/auth.js'), mode: 'login' },
  { name: 'register', re: /^\/register$/, load: () => import('./pages/auth.js'), mode: 'register' },
  { name: 'account', re: /^\/account$/, load: () => import('./pages/account.js') },
  { name: 'devpay', re: /^\/dev\/pay\/(?<order>[^/]+)$/, load: () => import('./pages/devpay.js') },
];

let current = null; // { name, inst }
let token = 0;

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) { location.href = to; return; }
  const next = url.pathname + url.search;
  if (next !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState']({}, '', next);
  return render();
}

async function render() {
  const my = ++token;
  const path = decodeURIComponent(location.pathname).replace(/(.)\/+$/, '$1');
  const query = new URLSearchParams(location.search);
  let match = null; let params = {};
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { match = r; params = m.groups || {}; break; }
  }
  const ctx = { params, query, path, navigate, mode: match && match.mode };
  renderHeader();
  if (current && match && current.name === match.name && current.inst && current.inst.update) {
    current.inst.update(ctx);
    return;
  }
  if (current && current.inst && current.inst.destroy) current.inst.destroy();
  current = null;
  mount(mainEl, h('div', { class: 'loading' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Загрузка' })));
  window.scrollTo(0, 0);
  try {
    if (!match) {
      mount(mainEl, h('div', { class: 'wrap section' }, h('h1', { class: 'h2' }, 'Страница не найдена'), h('p', { class: 'lead' }, 'Такого адреса нет. Возможно, вакансия уже закрыта.'), h('p', { style: { 'margin-top': '24px' } }, h('a', { class: 'btn btn--hot', href: '/jobs' }, 'К вакансиям'))));
      document.title = 'Не найдено — Вектор';
      return;
    }
    const mod = await match.load();
    if (my !== token) return;
    const holder = h('div');
    const inst = (await mod.default(holder, ctx)) || {};
    if (my !== token) return;
    mount(mainEl, ...holder.childNodes.length ? [...holder.childNodes] : []);
    // страницы, которым нужен живой контейнер (jobs), получают mainEl напрямую
    current = { name: match.name, inst };
    if (inst.mounted) inst.mounted(mainEl);
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    mount(mainEl, h('div', { class: 'wrap section' }, h('h1', { class: 'h2' }, 'Что-то пошло не так'), h('p', { class: 'lead' }, e.message || 'Не удалось загрузить страницу.'), h('p', { style: { 'margin-top': '24px' } }, h('button', { class: 'btn', onclick: () => render() }, 'Повторить'))));
  }
}

/* ---------- шапка ---------- */
const NAV = [['/jobs', 'Вакансии'], ['/companies', 'Радар компаний'], ['/pricing', 'Тарифы']];
let navOpen = false;

function renderHeader() {
  const u = user();
  const here = location.pathname;
  const nav = h('nav', { class: 'nav' + (navOpen ? ' is-open' : ''), id: 'nav', 'aria-label': 'Основное меню' },
    NAV.map(([href, label]) => h('a', { href, 'aria-current': here === href || here.startsWith(href + '/') ? 'page' : null }, label)));
  const right = h('div', { class: 'header__right' },
    u
      ? [u.pro ? h('span', { class: 'pro-badge' }, 'Pro') : null, h('a', { class: 'btn btn--sm', href: '/account' }, u.name || u.email.split('@')[0])]
      : [h('a', { class: 'btn btn--sm btn--plain btn--login', href: '/login' }, 'Войти'), h('a', { class: 'btn btn--sm btn--hot', href: '/register' }, 'Начать')],
    h('button', { class: 'btn btn--sm burger', 'aria-label': 'Меню', 'aria-expanded': String(navOpen), 'aria-controls': 'nav', onclick: () => { navOpen = !navOpen; renderHeader(); } }, icon('menu')));
  mount(headerEl, h('div', { class: 'wrap header__in' },
    h('a', { class: 'logo', href: '/', 'aria-label': 'Вектор — на главную' }, h('span', { class: 'logo__mark' }, icon('arrow')), 'Вектор'),
    nav, right));
  navOpen = false;
}

/* ---------- лента ---------- */
async function renderTape() {
  try {
    const r = await api('/jobs?limit=14');
    if (!r.items.length) { tapeEl.classList.add('hidden'); return; }
    const items = r.items.map((j) => h('a', { class: 'tape__item', href: `/jobs/${j.id}` }, h('b', null, j.title), h('span', null, j.company), h('i', null, timeAgo(j.posted_at))));
    const track = h('div', { class: 'tape__track' }, items, items.map((n) => n.cloneNode(true)));
    mount(tapeEl, h('div', { class: 'tape__in' }, h('div', { class: 'tape__label' }, 'Новое'), track));
  } catch { tapeEl.classList.add('hidden'); }
}

/* ---------- подвал ---------- */
function renderFooter() {
  const sources = (state.stats && state.stats.sources) || [];
  mount(footerEl, h('div', { class: 'wrap' },
    h('div', { class: 'footer__grid' },
      h('div', null,
        h('a', { class: 'logo', href: '/' }, h('span', { class: 'logo__mark' }, icon('arrow')), 'Вектор'),
        h('p', null, 'Сам находит вакансии и компании, которым нужны ИИ-разработчики. Отклик — всегда на сайте оригинального источника.')),
      h('div', null, h('h4', null, 'Разделы'), h('ul', null,
        NAV.map(([href, label]) => h('li', null, h('a', { href }, label))),
        h('li', null, h('a', { href: '/account' }, 'Личный кабинет')))),
      h('div', null, h('h4', null, 'Источники вакансий'), h('ul', null,
        sources.filter((s) => s.enabled).map((s) => h('li', null, h('a', { href: s.site, target: '_blank', rel: 'noopener' }, s.name)))))),
    h('small', null,
      'Вакансии собираются из открытых API перечисленных источников; права на тексты вакансий принадлежат их авторам. ',
      'Оплата принимается через платёжный шлюз RollyPay — данные карт и СБП на наши серверы не попадают. ',
      `© ${new Date().getFullYear()} Вектор.`,
      state.session && state.session.contact ? ` Связь: ${state.session.contact}` : '')));
}

/* ---------- старт ---------- */
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', () => render());

export async function refreshSession() {
  await loadSession();
  renderHeader();
}
window.__vk = { navigate, refreshSession };

(async function boot() {
  try {
    await loadSession();
  } catch (e) {
    toast('Не удалось связаться с сервером', true);
  }
  try { state.stats = await api('/stats'); demoEl.classList.toggle('hidden', !state.stats.demo); } catch { /* не критично */ }
  renderFooter();
  renderTape();
  await render();
})();

export { isPro };
