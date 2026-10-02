import { h, num } from '../dom.js';
import { api, state } from '../api.js';

// Локальная заглушка платёжной страницы. Работает только при VEKTOR_DEV_FAKE_PAYMENTS=1 (в production сервер отдаёт 404).
export default async function devpay(box, ctx) {
  document.title = 'DEV-шлюз — Вектор';
  if (!state.session.user) { ctx.navigate('/login?next=' + encodeURIComponent(location.pathname)); return; }
  const id = ctx.params.order;
  let o;
  try { o = (await api('/dev/orders/' + encodeURIComponent(id))).order; } catch (e) {
    box.append(h('div', { class: 'wrap section' }, h('h1', { class: 'h2' }, 'Заказ не найден'), h('p', { class: 'lead' }, e.message))); return;
  }
  const err = h('div', { class: 'alert alert--bad hidden' });
  async function act(outcome) {
    try {
      await api('/dev/pay/simulate', { method: 'POST', body: { order_id: id, outcome } });
      ctx.navigate(outcome === 'paid' ? `/account?order=${encodeURIComponent(id)}` : `/pricing?failed=${encodeURIComponent(id)}`);
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  }
  box.append(h('div', { class: 'card devpay' },
    h('span', { class: 'tag tag--hot', style: { 'justify-self': 'start' } }, 'DEV · тестовый шлюз'),
    h('h1', { style: { 'font-size': '1.6rem' } }, 'Имитация страницы RollyPay'),
    h('p', { class: 'muted' }, 'Это локальная заглушка. Настоящий платёж уходит на pay.rollypay.io. Вебхук формируется и подписывается так же, как у шлюза, и проходит через боевой обработчик.'),
    h('div', { class: 'alert' }, h('b', null, o.plan_title), ` — ${num(Number(o.amount))} ₽`, h('div', { class: 'mono muted', style: { 'font-size': '12px', 'margin-top': '4px' } }, o.id)),
    err,
    h('button', { class: 'btn btn--hot btn--lg btn--block', onclick: () => act('paid') }, 'Симулировать успешную оплату'),
    h('button', { class: 'btn btn--block', onclick: () => act('failed') }, 'Отменить платёж')));
}
