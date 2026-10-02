import { h, mount, clear, icon, timeAgo, monogram, levelLabel, plural, num, toast } from '../dom.js';
import { api, user, isPro } from '../api.js';

function card(c, ctx) {
  const pro = isPro();
  const el = h(pro ? 'a' : 'button', { class: 'card co', ...(pro ? { href: `/companies/${encodeURIComponent(c.key)}` } : { type: 'button', onclick: () => { toast('Страница компании — в тарифе Pro'); ctx.navigate('/pricing'); } }) },
    h('div', { class: 'co__top' }, monogram(c.name),
      h('div', null, h('h3', null, c.name), h('div', { class: 'muted', style: { 'font-size': '13px' } }, c.sources.join(' · '))),
      h('div', { class: 'co__n' }, String(c.roles), h('small', null, plural(c.roles, ['роль', 'роли', 'ролей'])))),
    h('div', { class: 'tags' },
      c.new_7d ? h('span', { class: 'tag tag--hot' }, `+${c.new_7d} за неделю`) : h('span', { class: 'tag tag--soft' }, `последняя ${timeAgo(c.latest)}`),
      c.remote_roles ? h('span', { class: 'tag' }, `${c.remote_roles} удалённо`) : null,
      c.stack.map((s) => h('span', { class: 'tag tag--soft' }, s))),
    h('div', { class: 'co__titles' }, c.sample_titles.map((t) => h('span', null, t))));
  return el;
}

function ghost() {
  return h('div', { class: 'card co co--lock', 'aria-hidden': 'true' },
    h('div', { class: 'co__top' }, h('div', { class: 'mono-logo' }, '?'), h('div', null, h('h3', null, '████████ ████'), h('div', { class: 'muted' }, 'Источник · Источник')), h('div', { class: 'co__n' }, '8', h('small', null, 'ролей'))),
    h('div', { class: 'tags' }, h('span', { class: 'tag' }, '+3 за неделю'), h('span', { class: 'tag' }, 'Python'), h('span', { class: 'tag' }, 'PyTorch')),
    h('div', { class: 'co__titles' }, h('span', null, 'Senior ML Engineer'), h('span', null, 'LLM Engineer')));
}

export default async function companies(box, ctx) {
  if (ctx.params.key) return companyPage(box, ctx);
  document.title = 'Радар компаний — Вектор';
  const pro = isPro();
  let q = ''; let page = 1;
  const grid = h('div', { class: 'cgrid' });
  const info = h('span', { class: 'mono muted', style: { 'font-size': '13px' } });
  const pager = h('div', { class: 'pager' });
  const lock = h('div');
  const search = h('input', { type: 'search', placeholder: 'Найти компанию…', 'aria-label': 'Поиск компании', maxlength: 60 });
  let tm;
  search.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { q = search.value.trim(); page = 1; load(); }, 300); });

  async function load() {
    const r = await api(`/companies?page=${page}${q ? '&q=' + encodeURIComponent(q) : ''}`);
    clear(grid); clear(pager); clear(lock);
    r.items.forEach((c) => grid.append(card(c, ctx)));
    if (!r.items.length) grid.append(h('div', { class: 'empty', style: { 'grid-column': '1 / -1' } }, h('h3', null, 'Компании не найдены'), h('p', { class: 'muted' }, 'Радар заполняется по мере сбора вакансий.')));
    info.textContent = `${num(r.total)} ${plural(r.total, ['компания', 'компании', 'компаний'])}`;
    if (!r.pro && r.locked > 0) {
      for (let i = 0; i < 3; i++) grid.append(ghost());
      lock.append(h('div', { class: 'card lockbar' },
        h('div', null, h('h3', null, `Ещё ${num(r.locked)} ${plural(r.locked, ['компания', 'компании', 'компаний'])} ждут в Pro`), h('p', { style: { 'margin-top': '8px', 'max-width': '52ch' } }, 'Полный радар: поиск по компаниям, динамика найма, стек и все открытые роли каждой компании.')),
        h('a', { class: 'btn btn--ink btn--lg', href: user() ? '/pricing' : '/register?next=/pricing' }, icon('lock'), 'Открыть радар')));
    }
    if (r.pro && r.pages > 1) {
      pager.append(h('button', { class: 'btn btn--sm', disabled: page <= 1, onclick: () => { page--; load(); window.scrollTo(0, 0); } }, '← Назад'), h('span', null, `${page} / ${r.pages}`), h('button', { class: 'btn btn--sm', disabled: page >= r.pages, onclick: () => { page++; load(); window.scrollTo(0, 0); } }, 'Дальше →'));
    }
  }
  await load();
  box.append(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Радар компаний'), h('h1', { style: { 'margin-top': '12px', 'max-width': '20ch' } }, 'Кто нанимает ИИ-разработчиков прямо сейчас'),
      h('p', { class: 'lead' }, 'Мы группируем вакансии по работодателям и сортируем по активности найма: новые роли за неделю, число открытых позиций и стек.'),
      h('div', { class: 'row', style: { 'margin-top': '26px' } }, pro ? h('label', { class: 'finput', style: { 'max-width': '420px' } }, icon('search'), search) : h('span', { class: 'tag tag--mark' }, 'Превью · топ-6'), info)),
    grid, lock, pager, h('div', { style: { height: '90px' } })));
}

async function companyPage(box, ctx) {
  if (!user()) { ctx.navigate('/login?next=' + encodeURIComponent(location.pathname)); return; }
  let c;
  try { c = await api('/companies/' + encodeURIComponent(ctx.params.key)); } catch (e) {
    if (e.code === 'pro_required') {
      box.append(h('div', { class: 'wrap section' }, h('a', { class: 'back', href: '/companies' }, icon('back'), 'К радару'), h('div', { class: 'card lockbar' }, h('div', null, h('h3', null, 'Страница компании доступна в Pro'), h('p', { style: { 'margin-top': '8px' } }, 'Все открытые роли, стек и динамика найма компании.')), h('a', { class: 'btn btn--ink btn--lg', href: '/pricing' }, 'Открыть Pro'))));
      return;
    }
    box.append(h('div', { class: 'wrap section' }, h('a', { class: 'back', href: '/companies' }, icon('back'), 'К радару'), h('h1', { class: 'h2' }, 'Компания не найдена'), h('p', { class: 'lead' }, e.message)));
    return;
  }
  document.title = `${c.name} — Радар — Вектор`;
  const counts = new Map();
  c.jobs.forEach((j) => j.stack.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  box.append(h('div', { class: 'wrap', style: { 'padding-bottom': '90px' } },
    h('div', { class: 'page-head' },
      h('a', { class: 'back', href: '/companies' }, icon('back'), 'К радару'),
      h('div', { class: 'row', style: { gap: '18px' } }, monogram(c.name), h('h1', null, c.name)),
      h('p', { class: 'lead' }, `${c.jobs.length} ${plural(c.jobs.length, ['открытая роль', 'открытые роли', 'открытых ролей'])}. Откликайтесь сразу на несколько — так выше шанс.`),
      top.length ? h('div', { class: 'tags', style: { 'margin-top': '18px' } }, top.map(([s, n]) => h('span', { class: 'tag' }, `${s} · ${n}`))) : null),
    h('div', { class: 'list', style: { 'margin-top': '28px', 'max-width': '860px' } }, c.jobs.map((j) =>
      h('a', { class: 'job', href: `/jobs/${j.id}` }, monogram(j.company),
        h('div', null, h('h3', null, j.title), h('div', { class: 'job__co' }, `${j.remote ? 'удалённо' : j.location || '—'} · ${j.source_name}`),
          h('div', { class: 'tags' }, h('span', { class: 'tag tag--ink' }, levelLabel(j.level)), j.stack.slice(0, 4).map((s) => h('span', { class: 'tag' + (j.match_stack && j.match_stack.includes(s) ? ' tag--mark' : '') }, s)))),
        h('div', { class: 'job__side' }, j.match !== undefined ? h('div', { class: 'match', style: { '--p': String(j.match) } }, h('span', null, String(j.match))) : null, j.salary ? h('span', { class: 'job__sal' }, j.salary) : null, h('span', null, timeAgo(j.posted_at))))))));
}
