import { h, mount, clear, icon, timeAgo, monogram, levelLabel, plural, num, toast } from '../dom.js';
import { api, state, user, isPro } from '../api.js';

const DEFAULTS = { q: '', focus: 'ai', category: '', level: '', source: '', remote: false, salary: false, stack: '', sort: 'new' };
const LIMIT = 20;
const desktop = () => matchMedia('(min-width: 1101px)').matches;

function parseQuery(sp) {
  return {
    q: sp.get('q') || '', focus: sp.get('focus') === 'all' ? 'all' : 'ai', category: sp.get('category') || '', level: sp.get('level') || '',
    source: sp.get('source') || '', remote: sp.get('remote') === '1', salary: sp.get('salary') === '1', stack: sp.get('stack') || '',
    sort: ['new', 'ai', 'match'].includes(sp.get('sort')) ? sp.get('sort') : 'new',
  };
}
function toQs(f, extra = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) {
    if (v === DEFAULTS[k] || v === '' || v === false || v == null) continue;
    sp.set(k, v === true ? '1' : v);
  }
  const s = sp.toString();
  return s ? '?' + s : '';
}
const same = (a, b) => Object.keys(DEFAULTS).every((k) => a[k] === b[k]);

export default async function jobsPage(box, ctx) {
  document.title = 'Вакансии для ИИ-разработчиков — Вектор';
  let f = parseQuery(ctx.query);
  let selectedId = ctx.params.id ? Number(ctx.params.id) : null;
  let shownId = null;
  let items = []; let total = 0; let page = 1; let busy = false; let seq = 0;
  const meta = state.session.meta;
  const stats = state.stats;

  /* ----- фильтры ----- */
  const qInput = h('input', { type: 'search', placeholder: 'Должность, компания, технология…', 'aria-label': 'Поиск', maxlength: 100, autocomplete: 'off' });
  const stackInput = h('input', { type: 'text', placeholder: 'Стек: python, rag', 'aria-label': 'Технологии через запятую', list: 'stacklist', maxlength: 80, class: 'sel', style: { 'padding-right': '12px', 'min-width': '170px', 'background-image': 'none' } });
  const stackList = h('datalist', { id: 'stacklist' }, ((stats && stats.top_stack) || []).map((s) => h('option', { value: s.name })));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Фокус' },
    h('button', { type: 'button', 'data-v': 'ai' }, 'Только ИИ'), h('button', { type: 'button', 'data-v': 'all' }, 'Вся разработка'));
  const opt = (v, l, extra) => h('option', { value: v, ...extra }, l);
  const catSel = h('select', { class: 'sel', 'aria-label': 'Направление' }, opt('', 'Все направления'), meta.categories.map((c) => opt(c.id, c.label)));
  const lvlSel = h('select', { class: 'sel', 'aria-label': 'Уровень' }, opt('', 'Любой уровень'), meta.levels.map((l) => opt(l, levelLabel(l))));
  const srcSel = h('select', { class: 'sel', 'aria-label': 'Источник' }, opt('', 'Все источники'), meta.sources.map((s) => opt(s.id, s.name)), stats && stats.demo ? opt('demo', 'Демо-данные') : null);
  const sortSel = h('select', { class: 'sel', 'aria-label': 'Сортировка' }, opt('new', 'Сначала новые'), opt('ai', 'По релевантности ИИ'), opt('match', isPro() ? 'По совпадению со стеком' : 'По совпадению со стеком · Pro'));
  const remote = h('input', { type: 'checkbox' }); const salary = h('input', { type: 'checkbox' });
  const chk = (inp, label) => h('label', { class: 'chk' }, inp, label);
  const resetBtn = h('button', { type: 'button', class: 'btn btn--sm btn--plain' }, 'Сбросить');
  const saveBtn = h('button', { type: 'button', class: 'btn btn--sm' }, 'Сохранить поиск');

  function syncControls() {
    qInput.value = f.q; stackInput.value = f.stack; catSel.value = f.category; lvlSel.value = f.level; srcSel.value = f.source; sortSel.value = f.sort;
    remote.checked = f.remote; salary.checked = f.salary;
    for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.v === f.focus));
  }
  function readControls() {
    f = { q: qInput.value.trim(), focus: f.focus, category: catSel.value, level: lvlSel.value, source: srcSel.value, remote: remote.checked, salary: salary.checked, stack: stackInput.value.trim(), sort: sortSel.value };
  }
  function apply({ push = false } = {}) {
    readControls();
    if (f.sort === 'match' && !isPro()) { f.sort = 'new'; sortSel.value = 'new'; toast('Сортировка по стеку — в тарифе Pro'); }
    const url = '/jobs' + toQs(f);
    history[push ? 'pushState' : 'replaceState']({}, '', url);
    selectedId = null;
    reload();
  }
  let t;
  qInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => apply(), 350); });
  stackInput.addEventListener('change', () => apply());
  for (const el of [catSel, lvlSel, srcSel, sortSel, remote, salary]) el.addEventListener('change', () => apply());
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; f.focus = b.dataset.v; syncControls(); apply(); });
  resetBtn.addEventListener('click', () => { f = { ...DEFAULTS }; syncControls(); apply(); });
  saveBtn.addEventListener('click', async () => {
    if (!user()) { ctx.navigate('/login?next=' + encodeURIComponent('/jobs' + toQs(f))); return; }
    if (!isPro()) { toast('Сохранённые поиски — в тарифе Pro'); ctx.navigate('/pricing'); return; }
    readControls();
    const cat = meta.categories.find((c) => c.id === f.category);
    try {
      await api('/searches', { method: 'POST', body: { name: f.q || (cat && cat.label) || 'Мой поиск', query: f } });
      toast('Поиск сохранён — новые вакансии будут считаться в кабинете');
    } catch (e) { toast(e.message, true); }
  });

  const filters = h('section', { class: 'card filters', 'aria-label': 'Фильтры' },
    h('div', { class: 'filters__row' }, h('label', { class: 'finput' }, icon('search'), qInput), seg),
    h('div', { class: 'filters__row' }, catSel, lvlSel, srcSel, stackInput, stackList, chk(remote, 'Удалённо'), chk(salary, 'С зарплатой'), sortSel,
      h('span', { style: { 'margin-left': 'auto' }, class: 'row' }, resetBtn, saveBtn)));

  /* ----- список и детали ----- */
  const countEl = h('b', null, '');
  const listEl = h('div', { class: 'list', 'aria-live': 'polite' });
  const moreWrap = h('div', { class: 'pager' });
  const detailEl = h('aside', { class: 'card detail', 'aria-label': 'Вакансия' });
  const bar = h('div', { class: 'results-bar' }, countEl, h('span', { class: 'mono muted', style: { 'font-size': '12.5px' } }, stats && stats.updated_at ? `данные обновлены ${timeAgo(stats.updated_at)}` : ''));

  function row(j) {
    const heart = h('button', {
      type: 'button', class: 'heart', 'aria-pressed': String(!!j.saved), 'aria-label': 'В избранное',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleSave(j, heart); },
    }, icon('heart'));
    return h('a', { class: 'job', href: `/jobs/${j.id}${toQs(f)}`, 'aria-current': String(j.id === (selectedId ?? shownId)), dataset: { id: j.id } },
      monogram(j.company),
      h('div', null,
        h('h3', null, j.title),
        h('div', { class: 'job__co' }, `${j.company} · ${j.remote ? 'удалённо' : j.location || '—'}`),
        h('div', { class: 'tags' }, h('span', { class: 'tag tag--ink' }, levelLabel(j.level)), j.stack.slice(0, 3).map((s) => h('span', { class: 'tag' + (j.match_stack && j.match_stack.includes(s) ? ' tag--mark' : '') }, s)), j.stack.length > 3 ? h('span', { class: 'tag tag--soft' }, `+${j.stack.length - 3}`) : null)),
      h('div', { class: 'job__side' },
        j.match !== undefined ? h('div', { class: 'match', style: { '--p': String(j.match) }, title: 'Совпадение со стеком' }, h('span', null, `${j.match}`)) : null,
        j.salary ? h('span', { class: 'job__sal' }, j.salary) : null,
        h('span', null, timeAgo(j.posted_at)),
        user() ? heart : null));
  }

  async function toggleSave(j, btn) {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    try { await api(`/saved/${j.id}`, { method: on ? 'PUT' : 'DELETE' }); j.saved = on; } catch (e) { btn.setAttribute('aria-pressed', String(!on)); toast(e.message, true); }
  }

  function renderList(append = false) {
    if (!append) clear(listEl);
    const start = append ? listEl.children.length : 0;
    for (const j of items.slice(start)) listEl.append(row(j));
    countEl.textContent = total ? `${num(total)} ${plural(total, ['вакансия', 'вакансии', 'вакансий'])}` : 'Ничего не найдено';
    clear(moreWrap);
    if (items.length < total) moreWrap.append(h('button', { class: 'btn', type: 'button', onclick: () => load(page + 1) }, `Показать ещё (${total - items.length})`));
    if (!total) {
      const emptyDb = !stats || stats.jobs === 0;
      listEl.append(h('div', { class: 'empty' },
        h('h3', null, emptyDb ? 'База пока пуста' : 'Под эти фильтры ничего нет'),
        h('p', { class: 'muted' }, emptyDb ? 'Первый сбор вакансий запускается автоматически после старта сервера. Загляните через несколько минут.' : 'Попробуйте убрать часть фильтров или переключиться на «Вся разработка».'),
        emptyDb ? null : h('p', { style: { 'margin-top': '18px' } }, h('button', { class: 'btn', type: 'button', onclick: () => { f = { ...DEFAULTS }; syncControls(); apply(); } }, 'Сбросить фильтры'))));
    }
  }

  async function load(p = 1) {
    if (busy && p === 1) seq++;
    const my = ++seq; busy = true;
    if (p === 1) { clear(listEl); for (let i = 0; i < 6; i++) listEl.append(h('div', { class: 'job job--skel skel' })); }
    try {
      const sp = new URLSearchParams(toQs(f).slice(1)); sp.set('page', p); sp.set('limit', LIMIT);
      const r = await api('/jobs?' + sp.toString());
      if (my !== seq) return;
      page = p; total = r.total; items = p === 1 ? r.items : items.concat(r.items);
      renderList(p > 1);
      if (p === 1) {
        if (!selectedId && desktop() && items[0]) showDetail(items[0].id, { auto: true });
        else if (!items.length && !selectedId) mount(detailEl, h('div', { class: 'detail__body' }, h('p', { class: 'muted' }, 'Здесь появится описание выбранной вакансии.')));
      }
    } catch (e) {
      if (my !== seq) return;
      clear(listEl); listEl.append(h('div', { class: 'empty' }, h('h3', null, 'Не удалось загрузить'), h('p', { class: 'muted' }, e.message)));
    } finally { if (my === seq) busy = false; }
  }

  function markSelected() {
    for (const el of listEl.children) if (el.dataset && el.dataset.id) el.setAttribute('aria-current', String(Number(el.dataset.id) === (selectedId ?? shownId)));
  }

  function descNodes(text) {
    const out = []; let ul = null;
    for (const line of String(text).split('\n')) {
      const s = line.trim();
      if (!s) { ul = null; continue; }
      if (s.startsWith('• ')) { if (!ul) { ul = h('ul'); out.push(ul); } ul.append(h('li', null, s.slice(2))); } else { ul = null; out.push(h('p', null, s)); }
    }
    return out;
  }

  async function showDetail(id, { auto = false } = {}) {
    shownId = id; markSelected();
    detailEl.classList.toggle('is-open', !!selectedId && !auto);
    mount(detailEl, h('div', { class: 'detail__body' }, h('div', { class: 'skel', style: { height: '28px', width: '70%' } }), h('div', { class: 'skel', style: { height: '14px', width: '40%', 'margin-top': '14px' } }), h('div', { class: 'skel', style: { height: '160px', 'margin-top': '24px' } })));
    try {
      const j = await api('/jobs/' + id);
      if (shownId !== id) return;
      document.title = `${j.title} — ${j.company} — Вектор`;
      const heart = h('button', { type: 'button', class: 'heart', 'aria-pressed': String(!!j.saved), 'aria-label': 'В избранное', onclick: () => {
        if (!user()) { ctx.navigate('/login'); return; } toggleSave(j, heart);
      } }, icon('heart'));
      const mine = new Set(j.match_stack || []);
      const matchLine = j.match !== undefined
        ? h('p', { class: 'alert alert--info', style: { 'margin-bottom': '20px' } }, `Совпадение с вашим стеком: ${j.match}%`, mine.size ? ` — ${[...mine].join(', ')}` : '')
        : (!isPro() ? h('p', { class: 'alert', style: { 'margin-bottom': '20px', display: 'flex', gap: '10px', 'align-items': 'center' } }, icon('lock', 'x'), h('span', null, 'В Pro покажем совпадение этой вакансии с вашим стеком. ', h('a', { href: '/pricing' }, 'Подробнее'))) : null);
      mount(detailEl,
        h('div', { class: 'detail__head' },
          h('div', { class: 'tags' }, h('span', { class: 'tag tag--hot' }, j.category_label), h('span', { class: 'tag tag--ink' }, levelLabel(j.level)), j.remote ? h('span', { class: 'tag' }, 'Удалённо') : null, j.source === 'demo' ? h('span', { class: 'tag tag--mark' }, 'Демо') : null),
          h('h2', { style: { 'margin-top': '14px' } }, j.title),
          h('div', { class: 'detail__co' }, monogram(j.company), h('div', null, h('div', null, j.company), h('div', { class: 'muted', style: { 'font-size': '14px', 'font-weight': '400' } }, `${j.location || '—'} · опубликовано ${timeAgo(j.posted_at)}`))),
          j.salary ? h('p', null, h('span', { class: 'job__sal mono' }, j.salary)) : null,
          h('div', { class: 'detail__cta' },
            h('a', { class: 'btn btn--hot btn--lg', href: j.url, target: '_blank', rel: 'noopener' }, j.source === 'demo' ? 'Открыть демо-вакансию' : `Откликнуться на ${j.source_name}`, icon('arrow')),
            heart,
            selectedId ? h('a', { class: 'btn btn--plain', href: '/jobs' + toQs(f) }, icon('back'), 'К списку') : null)),
        h('div', { class: 'detail__body' },
          matchLine,
          j.stack.length ? [h('h4', null, 'Стек из описания'), h('div', { class: 'tags', style: { 'margin-bottom': '26px' } }, j.stack.map((s) => h('span', { class: 'tag' + (mine.has(s) ? ' tag--mark' : '') }, s)))] : null,
          h('h4', null, 'Описание'),
          h('div', { class: 'desc' }, descNodes(j.description)),
          h('div', { class: 'attrib' },
            `Источник: ${j.source_name}. `, j.source === 'demo' ? 'Это демонстрационная вакансия, ссылка ведёт на example.com. ' : 'Вакансия опубликована на сайте источника, отклик происходит там же. ',
            j.company_other_roles ? h('span', null, ' У компании есть ещё ', h('a', { href: isPro() ? `/companies/${encodeURIComponent(j.company_key)}` : '/pricing' }, `${j.company_other_roles} ${plural(j.company_other_roles, ['вакансия', 'вакансии', 'вакансий'])}${isPro() ? '' : ' (Pro)'}`), '.') : null)));
      detailEl.scrollTop = 0;
    } catch (e) {
      mount(detailEl, h('div', { class: 'detail__body' }, h('h2', { style: { 'font-size': '1.3rem' } }, 'Вакансия недоступна'), h('p', { class: 'muted', style: { 'margin-top': '10px' } }, e.message), h('p', { style: { 'margin-top': '16px' } }, h('a', { class: 'btn', href: '/jobs' + toQs(f) }, 'К списку'))));
    }
  }

  box.append(
    h('div', { class: 'wrap' },
      h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Лента'), h('h1', { style: { 'margin-top': '12px' } }, 'Вакансии для ИИ-разработчиков'), filters, bar),
      h('div', { class: 'split' }, h('div', null, listEl, moreWrap), detailEl)));

  syncControls();
  await load(1);
  if (selectedId) showDetail(selectedId);

  return {
    update(c) {
      const nf = parseQuery(c.query);
      const id = c.params.id ? Number(c.params.id) : null;
      if (!same(nf, f)) { f = nf; syncControls(); selectedId = id; reload(); return; }
      selectedId = id;
      if (id) showDetail(id);
      else { detailEl.classList.remove('is-open'); markSelected(); document.title = 'Вакансии для ИИ-разработчиков — Вектор'; if (desktop() && items[0]) showDetail(items[0].id, { auto: true }); }
    },
  };

  function reload() { shownId = null; return load(1).then(() => { if (selectedId) showDetail(selectedId); }); }
}
