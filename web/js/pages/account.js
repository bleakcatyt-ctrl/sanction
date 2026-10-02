import { h, mount, clear, fmtDate, num, plural, timeAgo, monogram, levelLabel, toast } from '../dom.js';
import { api, state, user, isPro, setCsrf } from '../api.js';

const STATUS = { created: 'Ожидает оплаты', processing: 'В обработке', paid: 'Оплачен', canceled: 'Отменён', expired: 'Истёк', refunded: 'Возврат', chargeback: 'Чарджбек' };

export default async function account(box, ctx) {
  document.title = 'Личный кабинет — Вектор';
  if (!user()) { ctx.navigate('/login?next=/account', { replace: true }); return; }
  const orderId = ctx.query.get('order');
  let stop = false;

  const banner = h('div');
  const subBlock = h('section', { class: 'card block' });
  const profileBlock = h('section', { class: 'card block' });
  const savedBlock = h('section', { class: 'card block' });
  const searchBlock = h('section', { class: 'card block' });
  const ordersBlock = h('section', { class: 'card block' });
  const secBlock = h('section', { class: 'card block' });
  const who = h('div', { class: 'card acc__who' });

  /* ----- подписка ----- */
  function renderSub() {
    const u = user();
    mount(who, h('span', { class: 'eyebrow' }, 'Аккаунт'), h('b', null, u.name || u.email), u.name ? h('span', { class: 'muted' }, u.email) : null, u.pro ? h('span', { class: 'pro-badge', style: { 'justify-self': 'start' } }, 'Pro') : h('span', { class: 'tag', style: { 'justify-self': 'start' } }, 'Тариф «Старт»'));
    mount(subBlock, h('h2', null, 'Подписка'), h('div', { class: 'sub' },
      h('div', null, h('div', { class: 'sub__state' }, u.pro ? 'Pro активен' : 'Тариф «Старт»'), h('p', { class: 'muted', style: { 'margin-top': '6px' } }, u.pro ? `Действует до ${fmtDate(u.pro_until)}` : 'Откройте радар компаний, совпадение со стеком и сохранённые поиски.')),
      h('a', { class: 'btn ' + (u.pro ? '' : 'btn--hot'), href: '/pricing' }, u.pro ? 'Продлить' : 'Перейти на Pro')));
  }

  /* ----- заказ после оплаты ----- */
  async function watchOrder() {
    mount(banner, h('div', { class: 'alert alert--info', role: 'status', style: { display: 'flex', gap: '12px', 'align-items': 'center' } }, h('span', { class: 'spinner' }), 'Проверяем оплату…'));
    for (let i = 0; i < 25 && !stop; i++) {
      try {
        const r = await api('/billing/orders/' + encodeURIComponent(orderId));
        const st = r.order.status;
        if (st === 'paid') {
          await window.__vk.refreshSession(); renderSub();
          mount(banner, h('div', { class: 'alert alert--ok', role: 'status' }, `Оплата прошла. Pro активен до ${fmtDate(r.pro_until)}. Спасибо!`));
          loadOrders(); return;
        }
        if (['canceled', 'expired', 'refunded', 'chargeback', 'failed'].includes(st)) {
          mount(banner, h('div', { class: 'alert alert--bad', role: 'status' }, `Платёж не завершён: ${STATUS[st] || st}. Деньги не списаны или будут возвращены.`)); loadOrders(); return;
        }
      } catch (e) { mount(banner, h('div', { class: 'alert alert--bad' }, e.message)); return; }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!stop) mount(banner, h('div', { class: 'alert alert--info' }, 'Платёж ещё обрабатывается. Подписка включится автоматически, как только шлюз подтвердит оплату — обновите страницу через минуту.'));
  }

  /* ----- профиль / стек ----- */
  function renderProfile() {
    let stack = [...user().stack];
    const nameIn = h('input', { type: 'text', value: user().name, maxlength: 60, id: 'pname' });
    const list = h('div', { class: 'stack-edit' });
    const add = h('input', { type: 'text', placeholder: stack.length ? '' : 'Python, PyTorch, RAG…', 'aria-label': 'Добавить технологию', maxlength: 30, list: 'stk' });
    const dl = h('datalist', { id: 'stk' }, ((state.stats && state.stats.top_stack) || []).map((s) => h('option', { value: s.name })));
    function draw() {
      clear(list);
      stack.forEach((s) => list.append(h('span', { class: 'tag' }, s, h('button', { type: 'button', 'aria-label': `Убрать ${s}`, onclick: () => { stack = stack.filter((x) => x !== s); draw(); } }, '×'))));
      list.append(add, dl);
    }
    const push = () => { const v = add.value.replace(/,+$/, '').trim(); if (v && !stack.includes(v) && stack.length < 20) stack.push(v); add.value = ''; draw(); add.focus(); };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); push(); } if (e.key === 'Backspace' && !add.value) { stack.pop(); draw(); add.focus(); } });
    add.addEventListener('change', push);
    draw();
    const save = h('button', { class: 'btn btn--hot', type: 'button', onclick: async () => {
      push();
      try {
        const r = await api('/profile', { method: 'PUT', body: { name: nameIn.value, stack } });
        state.session.user.stack = r.stack; state.session.user.name = r.name;
        toast('Профиль сохранён'); renderSub();
      } catch (e) { toast(e.message, true); }
    } }, 'Сохранить');
    mount(profileBlock, h('h2', null, 'Профиль и стек'),
      h('div', { class: 'field', style: { 'margin-bottom': '18px', 'max-width': '420px' } }, h('label', { for: 'pname' }, 'Имя'), nameIn),
      h('div', { class: 'field' }, h('label', null, 'Ваш стек'), list, h('small', null, isPro() ? 'Enter или запятая — добавить. По нему считается совпадение с вакансиями.' : 'Стек сохраняется, а процент совпадения с вакансиями показывается в Pro.')),
      h('div', { style: { 'margin-top': '18px' } }, save));
  }

  /* ----- избранное ----- */
  async function loadSaved() {
    mount(savedBlock, h('h2', null, 'Избранные вакансии'), h('div', { class: 'loading', style: { padding: '24px' } }, h('span', { class: 'spinner' })));
    try {
      const r = await api('/saved');
      mount(savedBlock, h('h2', null, `Избранные вакансии · ${r.items.length}`),
        r.items.length ? h('div', { class: 'list' }, r.items.map((j) => h('a', { class: 'job', href: `/jobs/${j.id}` }, monogram(j.company),
          h('div', null, h('h3', null, j.title), h('div', { class: 'job__co' }, `${j.company} · ${j.remote ? 'удалённо' : j.location || '—'}`), h('div', { class: 'tags' }, h('span', { class: 'tag tag--ink' }, levelLabel(j.level)), j.stack.slice(0, 3).map((s) => h('span', { class: 'tag' }, s)))),
          h('div', { class: 'job__side' }, j.salary ? h('span', { class: 'job__sal' }, j.salary) : null, h('span', null, timeAgo(j.posted_at))))))
          : h('p', { class: 'muted' }, 'Нажмите ♥ в ленте, чтобы сохранить вакансию.'));
    } catch (e) { mount(savedBlock, h('h2', null, 'Избранные вакансии'), h('p', { class: 'muted' }, e.message)); }
  }

  /* ----- сохранённые поиски ----- */
  async function loadSearches() {
    if (!isPro()) {
      mount(searchBlock, h('h2', null, 'Сохранённые поиски'), h('p', { class: 'muted' }, 'Сохраняйте фильтры и смотрите, сколько новых вакансий появилось с прошлого визита.'), h('p', { style: { 'margin-top': '14px' } }, h('a', { class: 'btn btn--sm btn--hot', href: '/pricing' }, 'Доступно в Pro')));
      return;
    }
    try {
      const r = await api('/searches');
      const href = (q) => { const sp = new URLSearchParams(); Object.entries(q).forEach(([k, v]) => { if (v && !(Array.isArray(v) && !v.length) && !(k === 'focus' && v === 'ai')) sp.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : v); }); const s = sp.toString(); return '/jobs' + (s ? '?' + s : ''); };
      mount(searchBlock, h('h2', null, 'Сохранённые поиски'),
        r.items.length ? r.items.map((s) => h('div', { class: 'srch' },
          h('div', null, h('a', { href: href(s.query), onclick: () => { api('/searches/' + s.id + '/seen', { method: 'POST' }).catch(() => {}); } }, h('b', null, s.name)), h('div', { class: 'muted', style: { 'font-size': '13px' } }, s.new_count ? `${s.new_count} ${plural(s.new_count, ['новая вакансия', 'новые вакансии', 'новых вакансий'])}` : 'Новых нет')),
          h('button', { class: 'btn btn--sm btn--plain', type: 'button', onclick: async () => { await api('/searches/' + s.id, { method: 'DELETE' }); loadSearches(); } }, 'Удалить')))
          : h('p', { class: 'muted' }, 'Настройте фильтры в ленте и нажмите «Сохранить поиск».'));
    } catch (e) { mount(searchBlock, h('h2', null, 'Сохранённые поиски'), h('p', { class: 'muted' }, e.message)); }
  }

  /* ----- платежи ----- */
  async function loadOrders() {
    try {
      const r = await api('/billing/orders');
      mount(ordersBlock, h('h2', null, 'История платежей'),
        r.items.length ? h('div', { style: { 'overflow-x': 'auto' } }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['Дата', 'Тариф', 'Сумма', 'Статус'].map((t) => h('th', null, t)))),
          h('tbody', null, r.items.map((o) => h('tr', null, h('td', null, new Date(o.created_at).toLocaleString('ru-RU')), h('td', null, o.plan_title, o.test ? h('span', { class: 'tag tag--soft', style: { 'margin-left': '8px' } }, 'тест') : null), h('td', null, `${num(Number(o.amount))} ₽`), h('td', null, STATUS[o.status] || o.status))))))
          : h('p', { class: 'muted' }, 'Платежей пока нет.'));
    } catch (e) { mount(ordersBlock, h('h2', null, 'История платежей'), h('p', { class: 'muted' }, e.message)); }
  }

  /* ----- безопасность ----- */
  function renderSecurity() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', id: 'cur', maxlength: 200 });
    const nxt = h('input', { type: 'password', autocomplete: 'new-password', id: 'nxt', minlength: 10, maxlength: 200 });
    const msg = h('div', { class: 'alert hidden', role: 'status' });
    const show = (t, bad) => { msg.className = 'alert ' + (bad ? 'alert--bad' : 'alert--ok'); msg.textContent = t; };
    mount(secBlock, h('h2', null, 'Безопасность'),
      h('form', { class: 'form', style: { width: 'min(100%, 420px)' }, onsubmit: async (e) => {
        e.preventDefault();
        try { await api('/auth/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); cur.value = ''; nxt.value = ''; show('Пароль изменён. На других устройствах выполнен выход.'); } catch (ex) { show(ex.message, true); }
      } }, msg,
      h('div', { class: 'field' }, h('label', { for: 'cur' }, 'Текущий пароль'), cur),
      h('div', { class: 'field' }, h('label', { for: 'nxt' }, 'Новый пароль'), nxt, h('small', null, 'Не короче 10 символов')),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Сменить пароль'))),
      h('hr', { style: { border: 0, 'border-top': '2px dashed var(--ink)', margin: '28px 0' } }),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { await api('/auth/logout', { method: 'POST' }); setCsrf(null); await window.__vk.refreshSession(); ctx.navigate('/'); } }, 'Выйти'),
        h('button', { class: 'btn btn--plain', type: 'button', style: { color: 'var(--bad)' }, onclick: async () => {
          const pw = prompt('Удаление аккаунта необратимо. Введите пароль для подтверждения:');
          if (!pw) return;
          try { await api('/account', { method: 'DELETE', body: { password: pw } }); setCsrf(null); await window.__vk.refreshSession(); toast('Аккаунт удалён'); ctx.navigate('/'); } catch (ex) { toast(ex.message, true); }
        } }, 'Удалить аккаунт')));
  }

  renderSub(); renderProfile(); renderSecurity();
  loadSaved(); loadSearches(); loadOrders();
  if (orderId) watchOrder();

  box.append(h('div', { class: 'wrap' }, h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Личный кабинет'), h('h1', { style: { 'margin-top': '12px' } }, 'Ваш кабинет')),
    h('div', { class: 'acc' }, h('div', { class: 'acc__nav' }, who),
      h('div', { class: 'acc__main' }, banner, subBlock, profileBlock, savedBlock, searchBlock, ordersBlock, secBlock))));
  return { destroy() { stop = true; } };
}
