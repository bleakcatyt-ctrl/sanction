import { h, icon, num, fmtDate, toast } from '../dom.js';
import { api, state, user } from '../api.js';

const FREE = [
  [true, 'Вся лента ИИ-вакансий из всех источников'],
  [true, 'Поиск и фильтры: стек, уровень, удалёнка, зарплата'],
  [true, 'Прямые ссылки на отклик — без ограничений'],
  [true, 'Избранные вакансии'],
  [true, 'Радар компаний: превью топ-6'],
  [false, 'Полный радар компаний и все их вакансии'],
  [false, 'Совпадение со стеком и сортировка по нему'],
  [false, 'Сохранённые поиски со счётчиком новых'],
];
const PRO = [
  'Всё, что в бесплатном тарифе',
  'Радар компаний целиком: поиск, динамика найма, стек, все открытые роли',
  'Процент совпадения каждой вакансии с вашим стеком + сортировка',
  'Сохранённые поиски: сколько новых вакансий с прошлого визита',
  'Поддержка проекта и его источников',
];

export function pricingBlock(ctx, { highlight } = {}) {
  const s = state.session;
  const plans = s.plans;
  let selected = (highlight && plans.find((p) => p.id === highlight)) ? highlight : 'pro_quarter';
  const u = user();
  const buttons = new Map();
  const total = h('span', null);
  const cta = h('button', { class: 'btn btn--hot btn--lg btn--block' });

  function refresh() {
    const p = plans.find((x) => x.id === selected);
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === selected));
    total.textContent = `${num(p.price)} ₽ за ${p.days === 365 ? '12 месяцев' : p.days === 90 ? '3 месяца' : '1 месяц'}`;
    cta.replaceChildren(u && u.pro ? 'Продлить Pro' : 'Оплатить через RollyPay', icon('arrow'));
  }

  async function pay() {
    if (!user()) { ctx.navigate(`/register?next=${encodeURIComponent('/pricing')}&plan=${selected}`); return; }
    cta.disabled = true;
    try {
      const r = await api('/billing/checkout', { method: 'POST', body: { plan: selected } });
      location.href = r.pay_url; // страница оплаты на домене шлюза (адрес проверен сервером)
    } catch (e) {
      cta.disabled = false;
      toast(e.message, true);
    }
  }
  cta.addEventListener('click', pay);

  const opts = h('div', { class: 'options', role: 'group', 'aria-label': 'Срок подписки' }, plans.map((p) => {
    const b = h('button', { type: 'button', class: 'opt', 'aria-pressed': 'false', onclick: () => { selected = p.id; refresh(); } },
      h('em', null, p.badge || ' '), h('b', null, `${num(p.price)} ₽`), h('span', null, p.title.replace('Pro · ', '')), h('span', { class: 'mono', style: { 'font-size': '12px', opacity: '.75' } }, `≈ ${num(p.per_month)} ₽/мес`));
    buttons.set(p.id, b);
    return b;
  }));

  const pay_ = state.session.payments;
  const note = h('p', { class: 'paynote' }, icon('shield', 'x'),
    h('span', null, pay_.fake ? 'DEV-режим: платёж проводится в локальной заглушке шлюза, деньги не списываются.'
      : pay_.test ? 'Тестовый режим RollyPay: реальные деньги не списываются.'
        : 'Оплата на защищённой странице RollyPay (СБП и др.). Данные платежа мы не видим и не храним. Автопродления нет.'));

  const status = u && u.pro ? h('div', { class: 'alert alert--ok' }, `Pro активен до ${fmtDate(u.pro_until)}. Продление добавится к текущему сроку.`) : null;
  const unavailable = !pay_.live && !pay_.fake ? h('div', { class: 'alert alert--bad' }, 'Оплата сейчас недоступна: платёжный шлюз не настроен на сервере.') : null;

  const el = h('div', { class: 'pricing' },
    h('article', { class: 'card plan' },
      h('h3', null, 'Старт'), h('div', { class: 'plan__price' }, '0 ₽', h('small', null, ' навсегда')),
      h('ul', null, FREE.map(([on, t]) => h('li', { class: on ? '' : 'off' }, t))),
      h('div', { style: { 'margin-top': 'auto' } }, h('a', { class: 'btn btn--block', href: u ? '/jobs' : '/register' }, u ? 'К вакансиям' : 'Создать аккаунт'))),
    h('article', { class: 'card plan plan--pro' },
      h('div', { class: 'row', style: { 'justify-content': 'space-between' } }, h('h3', null, 'Pro'), h('span', { class: 'pro-badge' }, 'Для охоты')),
      status, unavailable, opts,
      h('div', { class: 'plan__price' }, total),
      h('ul', null, PRO.map((t) => h('li', null, t))),
      cta, note));
  refresh();
  return el;
}

export default async function pricing(box, ctx) {
  document.title = 'Тарифы — Вектор';
  const failed = ctx.query.get('failed');
  box.append(h('div', { class: 'wrap section', style: { 'padding-top': '48px' } },
    h('div', { class: 'eyebrow' }, 'Тарифы'),
    h('h1', { class: 'h2', style: { 'max-width': '22ch' } }, 'Платите за аналитику, а не за доступ к вакансиям'),
    failed ? h('div', { class: 'alert alert--bad', style: { 'margin-top': '24px', 'max-width': '640px' } }, 'Оплата не была завершена. Вы можете попробовать ещё раз — деньги не списаны.') : null,
    h('div', { style: { 'margin-top': '8px' } }, pricingBlock(ctx, { highlight: ctx.query.get('plan') }))));
}
