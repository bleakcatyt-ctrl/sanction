import { h } from '../dom.js';
import { api, setCsrf, state } from '../api.js';

const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/api') ? n : '/jobs');

export default async function auth(box, ctx) {
  const reg = ctx.mode === 'register';
  document.title = (reg ? 'Регистрация' : 'Вход') + ' — Вектор';
  if (state.session.user) { ctx.navigate('/account', { replace: true }); return; }
  const next = safeNext(ctx.query.get('next'));
  const plan = ctx.query.get('plan');
  const err = h('div', { class: 'alert alert--bad hidden', role: 'alert' });
  const email = h('input', { id: 'email', type: 'email', name: 'email', autocomplete: 'email', required: true, maxlength: 254 });
  const pass = h('input', { id: 'pass', type: 'password', name: 'password', autocomplete: reg ? 'new-password' : 'current-password', required: true, minlength: reg ? 10 : 1, maxlength: 200 });
  const name = h('input', { id: 'name', type: 'text', name: 'name', autocomplete: 'name', maxlength: 60 });
  const btn = h('button', { class: 'btn btn--hot btn--lg btn--block', type: 'submit' }, reg ? 'Создать аккаунт' : 'Войти');

  async function submit(e) {
    e.preventDefault();
    err.classList.add('hidden'); btn.disabled = true;
    try {
      const r = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: reg ? { email: email.value, password: pass.value, name: name.value } : { email: email.value, password: pass.value } });
      setCsrf(r.csrf);
      await window.__vk.refreshSession();
      ctx.navigate(plan ? `/pricing?plan=${encodeURIComponent(plan)}` : next);
    } catch (ex) {
      err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false;
    }
  }

  const form = h('form', { class: 'form', onsubmit: submit, novalidate: false },
    h('div', { class: 'eyebrow' }, reg ? 'Новый аккаунт' : 'С возвращением'),
    h('h1', null, reg ? 'Создайте аккаунт' : 'Вход в Вектор'),
    err,
    reg ? h('div', { class: 'field' }, h('label', { for: 'name' }, 'Имя (необязательно)'), name) : null,
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Пароль'), pass, reg ? h('small', null, 'Не короче 10 символов. Хранится только в виде хэша.') : null),
    btn,
    h('p', { class: 'muted' }, reg ? 'Уже есть аккаунт? ' : 'Нет аккаунта? ',
      h('a', { href: (reg ? '/login' : '/register') + (ctx.query.toString() ? '?' + ctx.query.toString() : '') }, reg ? 'Войти' : 'Зарегистрироваться')));

  box.append(h('div', { class: 'auth' },
    h('div', { class: 'auth__side' },
      h('h2', null, 'Охотьтесь на роли, а не на вкладки'),
      h('ul', null, ['Избранные вакансии и сохранённые поиски', 'Радар компаний с динамикой найма', 'Совпадение каждой вакансии с вашим стеком'].map((t) => h('li', null, t))),
      h('p', { class: 'mono', style: { 'font-size': '12px', color: '#a79f8b' } }, 'Пароль → scrypt · сессия → HttpOnly · платежи → RollyPay')),
    h('div', { class: 'auth__main' }, form)));
}
