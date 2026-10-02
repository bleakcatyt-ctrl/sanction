// Мини-хелпер DOM. Весь пользовательский/внешний текст попадает на страницу только через textContent
// (createTextNode) — innerHTML для данных не используется нигде, поэтому XSS через вакансии невозможен.

const BLOCKED_URL = /^\s*(javascript|data|vbscript):/i;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if ((k === 'href' || k === 'src') && BLOCKED_URL.test(String(v))) continue;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); return append(el, children); }

/* ---------- иконки (статические константы) ---------- */
const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M6 18 18 6M8 6h10v10"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.800-8 11-8 11z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M19 12H5m6-6-6 6 6 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"><path d="M12 3 4 6v6c0 5 3.500 8 8 9 4.500-1 8-4 8-9V6z"/></svg>',
};
export function icon(name, cls = '') {
  const doc = new DOMParser().parseFromString(ICONS[name].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  return svg;
}

/* ---------- форматирование ---------- */
export const plural = (n, [one, few, many]) => {
  const a = Math.abs(n) % 100; const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
export const num = (n) => new Intl.NumberFormat('ru-RU').format(n);

export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} ч назад`;
  const d = Math.round(hr / 24);
  if (d === 1) return 'вчера';
  if (d < 31) return `${d} ${plural(d, ['день', 'дня', 'дней'])} назад`;
  return new Date(ms).toLocaleDateString('ru-RU');
}
export const fmtDate = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

const COLORS = ['#f5e26a', '#ffb59e', '#b9d8c4', '#c9c3ef', '#f2c98a', '#a9d3e6', '#e6b8d4', '#d7e08a'];
export function monogram(name) {
  let hsh = 0;
  for (const ch of name) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  const letter = (name.match(/[\p{L}\p{N}]/u) || ['•'])[0].toUpperCase();
  return h('div', { class: 'mono-logo', 'aria-hidden': 'true', style: { '--c': COLORS[hsh % COLORS.length] } }, letter);
}

const LEVEL = { intern: 'Стажёр', junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead' };
export const levelLabel = (l) => LEVEL[l] || l;

export function toast(msg, bad = false) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' + (bad ? ' toast--bad' : '') }, msg);
  box.append(t);
  setTimeout(() => t.remove(), 4500);
}
