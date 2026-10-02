import { h, icon, num, plural, timeAgo, monogram } from '../dom.js';
import { api, state, user } from '../api.js';
import { pricingBlock } from './pricing.js';

const FAQ = [
  ['Откуда берутся вакансии?', 'Сайт сам обходит открытые API job-бордов (Remotive, Arbeitnow, Jobicy, Remote OK, Himalayas, а при подключении токена — HeadHunter) каждые несколько часов. Каждая вакансия проходит через классификатор: определяем, относится ли она к ИИ, категорию (LLM, MLOps, CV…), уровень и технологический стек. Кнопка «Откликнуться» всегда ведёт на оригинальную страницу вакансии.'],
  ['Если вакансии открытые, за что я плачу?', 'За то, чего нет на самих job-бордах: радар компаний (кто и как активно нанимает, какой у них стек, все их открытые роли в одном месте), процент совпадения вакансии с вашим стеком и сохранённые поиски со счётчиком новых вакансий. Сами вакансии и ссылки на отклик остаются бесплатными.'],
  ['Как проходит оплата?', 'Через платёжный шлюз RollyPay: вы нажимаете «Оплатить», попадаете на защищённую страницу шлюза и платите по СБП (или другим включённым способом). Мы получаем только подтверждение оплаты — подписанное и перепроверенное через API. Подписка разовая, автопродления нет.'],
  ['Что с безопасностью моих данных?', 'Пароли хранятся только в виде хэша scrypt с индивидуальной солью, сессии — в HttpOnly-cookie, запросы защищены от CSRF, а ключи платёжного шлюза и база данных физически лежат вне папки сайта и недоступны из интернета. Платёжные данные мы не видим и не храним.'],
  ['Можно ли пользоваться без регистрации?', 'Да. Лента вакансий, поиск, фильтры и превью радара доступны всем. Аккаунт нужен, чтобы сохранять вакансии и оформлять Pro.'],
];

function countUp(el, to) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to < 2) { el.textContent = num(to); return; }
  const t0 = performance.now(); const dur = 900;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = num(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default async function home(box, ctx) {
  const [stats, latest, comps] = await Promise.all([api('/stats'), api('/jobs?limit=5'), api('/companies')]);
  state.stats = stats;
  document.title = 'Вектор — работа для ИИ-разработчиков';
  const srcCount = stats.sources.filter((s) => s.enabled).length;
  const updated = stats.updated_at ? `обновлено ${timeAgo(stats.updated_at)}` : 'ждём первого сбора';

  /* ----- hero ----- */
  const input = h('input', { type: 'search', name: 'q', placeholder: 'Например: LLM, RAG, computer vision…', 'aria-label': 'Поиск вакансий', autocomplete: 'off', maxlength: 100 });
  const form = h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); ctx.navigate('/jobs' + (input.value.trim() ? '?q=' + encodeURIComponent(input.value.trim()) : '')); } },
    input, h('button', { type: 'submit' }, 'Найти'));

  const numEls = [h('b', null, '0'), h('b', null, '0'), h('b', null, '0')];
  const counters = h('div', { class: 'counters' },
    h('div', { class: 'counter' }, numEls[0], h('span', null, plural(stats.jobs, ['вакансия', 'вакансии', 'вакансий']) + ' по ИИ')),
    h('div', { class: 'counter' }, numEls[1], h('span', null, plural(stats.companies, ['компания нанимает', 'компании нанимают', 'компаний нанимают']))),
    h('div', { class: 'counter' }, numEls[2], h('span', null, 'за последние 24 часа')));
  setTimeout(() => { countUp(numEls[0], stats.jobs); countUp(numEls[1], stats.companies); countUp(numEls[2], stats.new_24h); }, 50);

  const slipRows = latest.items.length
    ? latest.items.map((j) => h('a', { class: 'slip__row', href: `/jobs/${j.id}` },
      h('b', null, j.title), h('time', { datetime: new Date(j.posted_at).toISOString() }, timeAgo(j.posted_at)),
      h('small', null, `${j.company} · ${j.remote ? 'удалённо' : j.location || '—'}`), h('span', { class: 'tag tag--soft' }, j.category_label)))
    : [h('div', { class: 'slip__row' }, h('small', null, 'Пока пусто — первый сбор вакансий выполняется после запуска сервера.'))];

  const hero = h('section', { class: 'hero' }, h('div', { class: 'wrap hero__grid' },
    h('div', null,
      h('div', { class: 'eyebrow' }, `Вакансии для ИИ-разработчиков · ${updated}`),
      h('h1', null, 'Работа там, где учат машины ', h('em', { class: 'mark' }, 'думать')),
      h('p', { class: 'lead' }, `Мы сами ищем компании, которым нужны ML-инженеры и LLM-разработчики: ${srcCount} ${plural(srcCount, ['источник', 'источника', 'источников'])}, классификатор ИИ-вакансий и радар найма. Вы только откликаетесь.`),
      form,
      h('div', { class: 'quick' }, h('span', null, 'Популярно'),
        stats.top_stack.slice(0, 6).map((s) => h('a', { href: `/jobs?stack=${encodeURIComponent(s.name)}` }, s.name))),
      counters),
    h('div', { style: { position: 'relative' } },
      h('div', { class: 'stamp', 'aria-hidden': 'true' }, h('span', null, 'Свежая', h('br'), 'лента')),
      h('div', { class: 'card slip' },
        h('div', { class: 'slip__head' }, h('span', null, '№ Сводка дня'), h('span', null, new Date().toLocaleDateString('ru-RU'))),
        slipRows,
        h('div', { class: 'slip__foot' }, h('span', null, `${num(stats.new_7d)} за неделю`), h('a', { href: '/jobs' }, 'Вся лента →'))))));

  /* ----- как это работает ----- */
  const steps = h('section', { class: 'section', style: { 'padding-top': '24px' } }, h('div', { class: 'wrap' },
    h('div', { class: 'eyebrow' }, 'Как это работает'),
    h('h2', { class: 'h2' }, 'Поиск идёт без вас'),
    h('div', { class: 'steps' },
      [['01', 'Собираем', 'Краулер обходит job-борды по расписанию с учётом лимитов и условий каждого источника. Дубли склеиваются, закрытые вакансии уходят.', ['Remotive', 'Arbeitnow', 'Jobicy', 'Remote OK', 'Himalayas']],
        ['02', 'Разбираем', 'Определяем, это ИИ или обычная разработка, к какому направлению относится роль, какой уровень и какой стек требуется.', ['LLM', 'MLOps', 'CV', 'NLP', 'Research']],
        ['03', 'Находим компании', 'Группируем вакансии по работодателям: кто нанимает сразу несколько ML-ролей и кто открыл новые на этой неделе.', ['Радар найма']]]
        .map(([n, t, p, tags]) => h('article', { class: 'card step' }, h('div', { class: 'step__n' }, n), h('h3', null, t), h('p', null, p), h('div', { class: 'tags' }, tags.map((x) => h('span', { class: 'tag' }, x))))))));

  /* ----- радар ----- */
  const rows = comps.items.slice(0, 4).map((c, i) => h('div', { class: 'rrow' },
    h('span', { class: 'rrow__n' }, String(i + 1).padStart(2, '0')),
    h('div', null, h('b', null, c.name), h('small', null, c.stack.slice(0, 3).join(' · ') || c.sample_titles[0] || '')),
    h('div', { class: 'rrow__roles' }, String(c.roles), h('small', null, c.new_7d ? `+${c.new_7d} за 7 дн.` : plural(c.roles, ['роль', 'роли', 'ролей'])))));
  const ghost = ['████████ ███', '██████ ██████', '███████ ████'].map((t, i) => h('div', { class: 'rrow rrow--lock', 'aria-hidden': 'true' },
    h('span', { class: 'rrow__n' }, String(i + 5).padStart(2, '0')), h('div', null, h('b', null, t), h('small', null, 'Python · PyTorch · RAG')), h('div', { class: 'rrow__roles' }, '9', h('small', null, 'ролей'))));
  const radar = h('section', { class: 'section band' }, h('div', { class: 'wrap radar-grid' },
    h('div', null,
      h('div', { class: 'eyebrow' }, 'Радар компаний'),
      h('h2', { class: 'h2' }, 'Не вакансии, а работодатели'),
      h('p', { class: 'lead' }, `Сейчас в базе ${num(stats.companies)} ${plural(stats.companies, ['компания', 'компании', 'компаний'])} с открытыми ИИ-ролями. Радар показывает, кто нанимает активнее всех, какой у них стек и все их вакансии в одном месте — чтобы писать не на одну роль, а в компанию.`),
      h('div', { style: { 'margin-top': '28px' }, class: 'row' }, h('a', { class: 'btn btn--hot btn--lg', href: '/companies' }, 'Открыть радар', icon('arrow')))),
    h('div', { class: 'rtable' }, rows, comps.pro ? null : ghost,
      comps.pro ? null : h('div', { class: 'rlock' }, icon('lock'), h('p', null, `Ещё ${num(comps.locked)} ${plural(comps.locked, ['компания', 'компании', 'компаний'])} — в Pro`), h('a', { class: 'btn btn--sm btn--hot', href: '/pricing' }, 'Открыть все')))));

  /* ----- рынок ----- */
  const max = Math.max(1, ...stats.top_stack.map((s) => s.count));
  const bars = h('div', { class: 'bars' }, stats.top_stack.slice(0, 10).map((s) => {
    const fill = h('div', { class: 'bar__fill' });
    requestAnimationFrame(() => setTimeout(() => { fill.style.width = Math.round((s.count / max) * 100) + '%'; }, 120));
    return h('div', { class: 'bar' }, h('a', { href: `/jobs?stack=${encodeURIComponent(s.name)}` }, s.name), h('div', { class: 'bar__track' }, fill), h('span', { class: 'bar__v' }, String(s.count)));
  }));
  const market = h('section', { class: 'section' }, h('div', { class: 'wrap' },
    h('div', { class: 'eyebrow' }, 'Рынок сейчас'),
    h('h2', { class: 'h2' }, 'Что просят в вакансиях'),
    h('div', { class: 'market' },
      h('div', { class: 'card panel' }, h('h3', null, 'Технологии в ИИ-вакансиях'), stats.top_stack.length ? bars : h('p', { class: 'muted' }, 'Данные появятся после первого сбора.')),
      h('div', { class: 'card panel' }, h('h3', null, 'Направления'), h('div', { class: 'cats' },
        stats.categories.map((c) => h('a', { href: `/jobs?category=${c.id}` }, h('span', null, c.label), h('b', null, String(c.count)))))))));

  /* ----- тарифы ----- */
  const pricing = h('section', { class: 'section', id: 'pricing', style: { 'padding-top': '24px' } }, h('div', { class: 'wrap' },
    h('div', { class: 'eyebrow' }, 'Тарифы'),
    h('h2', { class: 'h2' }, 'Вакансии бесплатно. Радар и аналитика — по подписке'),
    pricingBlock(ctx)));

  /* ----- FAQ ----- */
  const faq = h('section', { class: 'section', style: { 'padding-top': '24px' } }, h('div', { class: 'wrap' },
    h('div', { class: 'eyebrow' }, 'Вопросы'),
    h('h2', { class: 'h2' }, 'Коротко о главном'),
    h('div', { class: 'faq' }, FAQ.map(([q, a]) => h('details', null, h('summary', null, q), h('p', null, a))))));

  box.append(hero, steps, radar, market, pricing, faq);
  void user; void monogram;
}
