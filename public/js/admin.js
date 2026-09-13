/* ============================================================
   SANCTION — admin panel
   Single page, everything rendered from /api/admin/*.
   Sections are filtered by the granular permission set.
   ============================================================ */
(function () {
  'use strict';

  const S = window.SNC;
  const esc = S.esc;
  const perms = new Set(S.perms || []);
  const can = (p) => perms.has(p);

  const host = document.getElementById('secHost');
  const toolsHost = document.getElementById('secTools');
  const titleEl = document.getElementById('secTitle');
  const crumbEl = document.getElementById('crumbSec');
  const navEl = document.getElementById('admNav');

  /* ---------------------------------------------------------- utilities -- */

  const SVG = {
    key: '<path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3z"/>',
    check: '<path d="M4.5 12.6l4.8 4.8L19.5 7.2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    copy: '<rect x="8.6" y="8.6" width="12" height="12" rx="2.2"/><path d="M15.4 5.6a2 2 0 00-2-2H5.6a2 2 0 00-2 2v7.8a2 2 0 002 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M16.6 3.9a2.1 2.1 0 013 3L8.4 18.1l-4 1 1-4L16.6 3.9z"/>',
    ban: '<circle cx="12" cy="12" r="8.6"/><path d="M6 6l12 12"/>',
    refresh: '<path d="M20.2 11.4A8.2 8.2 0 006.3 6.6L3.8 9"/><path d="M3.8 4.6V9h4.4"/><path d="M3.8 12.6a8.2 8.2 0 0013.9 4.8l2.5-2.4"/><path d="M20.2 19.4V15h-4.4"/>',
    eye: '<path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.3 2"/>',
    users: '<circle cx="9.4" cy="8.4" r="3.4"/><path d="M3.2 19.6a6.2 6.2 0 0112.4 0"/><path d="M16.2 5.4a3.4 3.4 0 010 6.5"/>',
    alert: '<path d="M12 4.2L2.9 19.4h18.2L12 4.2z"/><path d="M12 10v3.6"/>',
    card: '<rect x="2.8" y="5.5" width="18.4" height="13" rx="2.4"/><path d="M2.8 10h18.4"/>',
    download: '<path d="M12 3.5v11"/><path d="M7.8 10.5l4.2 4.2 4.2-4.2"/><path d="M4.5 17v2.2a1.3 1.3 0 001.3 1.3h12.4a1.3 1.3 0 001.3-1.3V17"/>',
    power: '<path d="M12 3.4v8.4"/><path d="M17.6 6.6a8 8 0 11-11.2 0"/>',
    trash: '<path d="M4.6 6.8h14.8"/><path d="M9.4 6.8V4.9a1.4 1.4 0 011.4-1.4h2.4a1.4 1.4 0 011.4 1.4v1.9"/><path d="M6.6 6.8l.9 12.2a1.8 1.8 0 001.8 1.6h5.4a1.8 1.8 0 001.8-1.6l.9-12.2"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.5 15.5l4.3 4.3"/>',
    sliders: '<path d="M4.4 6.4h9.2M17.6 6.4h2M4.4 12h2M10.4 12h9.2M4.4 17.6h9.2M17.6 17.6h2"/><circle cx="15.6" cy="6.4" r="2"/><circle cx="8.4" cy="12" r="2"/><circle cx="15.6" cy="17.6" r="2"/>',
    chart: '<path d="M3.5 20.2h17"/><rect x="5.2" y="11.5" width="3.4" height="6.2" rx="1"/><rect x="10.3" y="7.2" width="3.4" height="10.5" rx="1"/><rect x="15.4" y="13.6" width="3.4" height="4.1" rx="1"/>',
    fingerprint: '<path d="M12 4.5a7.5 7.5 0 00-7.5 7.5v1.5"/><path d="M19.5 12a7.5 7.5 0 00-4.2-6.7"/><path d="M7.5 12a4.5 4.5 0 019 0v2.5"/><path d="M12 12v3.5"/>',
    box: '<path d="M20.4 8.1v7.8a1.7 1.7 0 01-.9 1.5l-6.6 3.5a1.7 1.7 0 01-1.6 0l-6.6-3.5a1.7 1.7 0 01-.9-1.5V8.1a1.7 1.7 0 01.9-1.5l6.6-3.5a1.7 1.7 0 011.6 0l6.6 3.5a1.7 1.7 0 01.9 1.5z"/>',
    ticket: '<path d="M3.4 8.6V6.8a1.6 1.6 0 011.6-1.6h14a1.6 1.6 0 011.6 1.6v1.8a2.6 2.6 0 000 5.2v1.8a1.6 1.6 0 01-1.6 1.6H5a1.6 1.6 0 01-1.6-1.6v-1.8a2.6 2.6 0 000-5.2z"/>',
    server: '<rect x="3.2" y="4.2" width="17.6" height="6.4" rx="2"/><rect x="3.2" y="13.4" width="17.6" height="6.4" rx="2"/>'
  };
  const svg = (n, cls) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' + (cls ? ' class="' + cls + '"' : '') + '>' + (SVG[n] || '') + '</svg>';

  function money(minor, cur) {
    const v = (Number(minor) || 0) / 100;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v) + ' ' + (cur || '₽');
  }
  function date(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function rel(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ч назад';
    return Math.floor(h / 24) + ' дн назад';
  }

  const STATUS = {
    active: ['chip-ok', 'активна'],
    pending: ['chip-info', 'ожидает запуска'],
    expired: ['chip-err', 'истекла'],
    revoked: ['chip-err', 'отозвана'],
    banned: ['chip-err', 'заблокирована']
  };
  const ORDER = {
    created: ['chip-mute', 'создан'], pending: ['chip-warn', 'ожидает'], paid: ['chip-ok', 'оплачен'],
    failed: ['chip-err', 'ошибка'], refunded: ['chip-err', 'возврат'], cancelled: ['chip-mute', 'отменён'], expired: ['chip-mute', 'истёк']
  };
  const chip = (map, key, extra) => {
    const c = map[key] || ['chip-mute', key];
    return '<span class="chip ' + c[0] + (extra ? ' ' + extra : '') + '">' + esc(c[1]) + '</span>';
  };

  function statTile(label, value, sub, iconName, cls) {
    return '<div class="stat ticks"><div class="l">' + svg(iconName) + ' ' + esc(label) + '</div>' +
      '<div class="v ' + (cls || '') + '">' + value + '</div>' +
      (sub ? '<div class="d">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function pager(state, total, onChange) {
    const pages = Math.max(1, Math.ceil(total / state.per_page));
    return '<div class="pager"><span>Показано ' + Math.min(state.per_page, total) + ' из ' + total + ' · страница ' + state.page + ' из ' + pages + '</span>' +
      '<span class="btns">' +
      '<button class="btn btn-ghost btn-sm" data-page="prev"' + (state.page <= 1 ? ' disabled' : '') + '>Назад</button>' +
      '<button class="btn btn-ghost btn-sm" data-page="next"' + (state.page >= pages ? ' disabled' : '') + '>Вперёд</button>' +
      '</span></div>';
  }

  function bindPager(root, state, reload) {
    root.querySelectorAll('[data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.page = b.dataset.page === 'next' ? state.page + 1 : Math.max(1, state.page - 1);
        reload();
      });
    });
  }

  function bindCopy(root) {
    root.querySelectorAll('[data-copy]').forEach(function (el) {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', async function () {
        const ok = await S.copy(el.dataset.copy);
        S.toast(ok ? 'ok' : 'err', ok ? 'Скопировано' : 'Ошибка копирования', ok ? el.dataset.copy.slice(0, 46) : '');
      });
    });
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms || 320);
    };
  }

  function spinner() { host.innerHTML = '<div class="empty"><div class="spinner-ring"></div></div>'; }

  function setTools(html) { toolsHost.innerHTML = html || ''; }
  function setTitle(t, crumb) { titleEl.textContent = t; crumbEl.textContent = crumb || t.toLowerCase(); }

  async function post(url, body) {
    return S.api(url, { method: 'POST', body: body || {} });
  }

  /* ========================================================== DASHBOARD == */

  const dashboard = {
    title: 'Дашборд',
    async render() {
      spinner();
      const r = await S.api('/api/admin/summary');
      const u = r.users, l = r.licenses, rev = r.revenue, ld = r.loader;

      setTitle('Дашборд', 'dashboard');
      setTools(
        '<span class="chip chip-mono">' + svg('server') + ' ' + esc(ld.latest_version) + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="sweepBtn">' + svg('refresh') + ' Пересчитать истёкшие</button>'
      );

      const maxDay = Math.max(1, ...rev.daily.map((d) => d.sum));
      const spark = rev.daily.length
        ? '<div class="spark">' + rev.daily.map((d) => '<i style="height:' + Math.max(6, Math.round((d.sum / maxDay) * 100)) + '%" title="' + esc(d.d + ' · ' + money(d.sum)) + '"></i>').join('') + '</div>'
        : '<div class="dim" style="font-size:12.4px">Данных за 30 дней пока нет.</div>';

      host.innerHTML =
        '<div class="grid stat-grid" style="margin-bottom:18px">' +
          statTile('Выручка всего', money(rev.total), 'оплаченных заказов: ' + rev.count, 'chart') +
          statTile('За 30 дней', money(rev.month), 'за 7 дней: ' + money(rev.week), 'card') +
          statTile('Активных лицензий', l.active, 'истекают за 7 дней: ' + l.expiring7d, 'key', 'ok') +
          statTile('Онлайн в лоадере', ld.online, 'сессий за 24 ч: ' + ld.sessions24h, 'server') +
        '</div>' +

        '<div class="grid stat-grid" style="margin-bottom:20px">' +
          statTile('Пользователей', u.total, 'новых за 24 ч: ' + u.today, 'users') +
          statTile('Ожидают запуска', l.pending, 'ключи выданы, но не активированы', 'clock', 'warn') +
          statTile('Истекло', l.expired, 'отозвано: ' + l.revoked, 'alert', 'err') +
          statTile('Сотрудников', u.staff, 'сессий активно: ' + u.activeSessions, 'sliders') +
        '</div>' +

        '<div class="grid dashAdmGrid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:18px">' +
          '<div class="panel ticks"><div class="panel-hd"><h3>Выручка за 30 дней</h3><div class="sub">по оплаченным заказам</div></div>' +
            '<div class="panel-bd">' + spark +
              '<div class="divider"></div>' +
              '<div class="table-wrap"><table class="table"><thead><tr><th>Тариф</th><th>Заказов</th><th>Сумма</th></tr></thead><tbody>' +
              (rev.byPlan.length ? rev.byPlan.map((p) => '<tr><td class="mono"><b>' + esc(p.plan_code) + '</b></td><td class="mono">' + p.c + '</td><td class="mono">' + money(p.sum) + '</td></tr>').join('') : '<tr><td colspan="3" class="dim">нет данных</td></tr>') +
              '</tbody></table></div>' +
            '</div></div>' +

          '<div class="panel ticks"><div class="panel-hd"><h3>Состояние системы</h3></div><div class="panel-bd">' +
            '<div class="kv">' +
              '<dt>Статус сайта</dt><dd>' + chip({ online: ['chip-ok', 'online'], maintenance: ['chip-warn', 'maintenance'], detected: ['chip-err', 'detected'] }, r.system.site_status) + '</dd>' +
              '<dt>Активация ключей</dt><dd class="mono">' + esc(r.system.activation_mode === 'on_first_login' ? 'с первого запуска' : 'с момента покупки') + '</dd>' +
              '<dt>Повторные покупки</dt><dd class="mono">' + esc(r.system.stack_purchases === 'extend' ? 'продлевают остаток' : 'создают новый ключ') + '</dd>' +
              '<dt>Kill switch</dt><dd>' + (ld.killswitch ? '<span class="chip chip-err">' + svg('power') + ' включён</span>' : '<span class="chip chip-ok">выключен</span>') + '</dd>' +
              '<dt>Мин. сборка</dt><dd class="mono">' + esc(ld.min_version) + '</dd>' +
              '<dt>Ошибок входа 24ч</dt><dd class="mono">' + ld.authFailures24h + '</dd>' +
            '</div>' +
            '<div class="divider"></div>' +
            '<div class="label">Платёжные способы</div>' +
            r.system.payment_methods.map((m) => '<div class="row-between" style="padding:7px 0;border-bottom:1px solid rgba(125,175,255,.05)">' +
              '<span style="font-size:13px">' + esc(m.label) + '</span>' +
              '<span class="chip ' + (m.ready || !m.requiresSetup ? 'chip-ok' : 'chip-mute') + '">' + (m.ready || !m.requiresSetup ? 'готов' : 'не настроен') + '</span></div>').join('') +
          '</div></div>' +
        '</div>';

      document.getElementById('sweepBtn').addEventListener('click', async function () {
        const res = await post('/api/admin/sweep');
        S.toast('ok', 'Пересчитано', 'Истекло лицензий: ' + res.expired_licenses + ', очищено сессий: ' + (res.purged_site_sessions + res.purged_loader_sessions));
        dashboard.render();
      });
    }
  };

  /* ============================================================= USERS == */

  const usersState = { page: 1, per_page: 25, search: '', status: '' };
  const users = {
    title: 'Пользователи',
    async render() {
      setTitle('Пользователи', 'users');
      setTools(
        '<div class="search-box">' + svg('search') + '<input class="input" id="uSearch" placeholder="Логин, e-mail или id" value="' + esc(usersState.search) + '"></div>' +
        '<div class="seg" id="uStatus">' +
          ['', 'active', 'banned'].map((s) => '<button data-v="' + s + '" class="' + (usersState.status === s ? 'active' : '') + '">' + (s === '' ? 'Все' : (s === 'active' ? 'Активные' : 'Бан')) + '</button>').join('') +
        '</div>'
      );

      const reload = async function () { spinner(); await users.render(); };

      document.getElementById('uSearch').addEventListener('input', debounce(function (e) {
        usersState.search = e.target.value.trim(); usersState.page = 1; reload();
      }, 380));
      document.querySelectorAll('#uStatus button').forEach(function (b) {
        b.addEventListener('click', function () { usersState.status = b.dataset.v; usersState.page = 1; reload(); });
      });

      spinner();
      const q = new URLSearchParams({ page: usersState.page, per_page: usersState.per_page, search: usersState.search, status: usersState.status });
      const r = await S.api('/api/admin/users?' + q);

      host.innerHTML = '<div class="panel ticks"><div class="table-wrap"><table class="table">' +
        '<thead><tr><th>ID</th><th>Логин</th><th>E-mail</th><th>Роль</th><th>Статус</th><th>Лицензий</th><th>Оплат</th><th>Потрачено</th><th>Регистрация</th><th>Последний вход</th><th></th></tr></thead><tbody>' +
        (r.users.length ? r.users.map((u) =>
          '<tr>' +
            '<td class="mono dim">' + u.id + '</td>' +
            '<td><b>' + esc(u.username) + '</b>' + (u.is_admin || u.role === 'owner' ? ' <span class="chip chip-info" style="padding:1px 7px">staff</span>' : '') + '</td>' +
            '<td class="dim">' + esc(u.email) + '</td>' +
            '<td class="mono">' + esc(u.role) + '</td>' +
            '<td>' + (u.status === 'banned' ? '<span class="chip chip-err">' + svg('ban') + ' бан</span>' : '<span class="chip chip-ok">' + svg('check') + ' активен</span>') + '</td>' +
            '<td class="mono">' + u.licenses_count + '</td>' +
            '<td class="mono">' + u.paid_orders + '</td>' +
            '<td class="mono">' + money(u.total_spent) + '</td>' +
            '<td class="dim" style="font-size:12px">' + date(u.created_at) + '</td>' +
            '<td class="dim" style="font-size:12px">' + (u.last_login_at ? rel(u.last_login_at) : '—') + '</td>' +
            '<td class="actions">' +
              '<button class="btn btn-quiet btn-sm" data-user="' + u.id + '" title="Открыть карточку">' + svg('eye') + '</button>' +
            '</td>' +
          '</tr>').join('') : '<tr><td colspan="11" class="table-empty">Никого не найдено</td></tr>') +
        '</tbody></table></div>' + pager(usersState, r.total) + '</div>';

      bindPager(host, usersState, reload);
      bindPager(host.querySelector('.pager') || host, usersState, reload);
      host.querySelectorAll('[data-user]').forEach(function (b) {
        b.addEventListener('click', function () { users.open(Number(b.dataset.user)); });
      });
    },

    async open(id) {
      spinner();
      const r = await S.api('/api/admin/users/' + id);
      const u = r.user;
      setTitle(u.username, 'users / ' + u.id);
      setTools('<button class="btn btn-ghost btn-sm" id="backUsers">' + svg('x') + ' К списку</button>');
      document.getElementById('backUsers').addEventListener('click', function () { users.render(); });

      host.innerHTML =
        '<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:18px" class="dashAdmGrid">' +
          '<div class="panel ticks"><div class="panel-hd"><h3>Аккаунт</h3>' + (u.status === 'banned' ? '<span class="chip chip-err">бан</span>' : '<span class="chip chip-ok">активен</span>') + '</div>' +
          '<div class="panel-bd"><div class="kv">' +
            '<dt>ID</dt><dd class="mono">' + u.id + '</dd>' +
            '<dt>Логин</dt><dd><b>' + esc(u.username) + '</b></dd>' +
            '<dt>E-mail</dt><dd>' + esc(u.email) + '</dd>' +
            '<dt>Роль</dt><dd class="mono">' + esc(u.role) + '</dd>' +
            '<dt>Создан</dt><dd>' + u.created_label + '</dd>' +
            '<dt>Последний вход</dt><dd>' + esc(u.last_login_ip || '—') + '</dd>' +
          '</div>' +
          '<div class="divider"></div>' +
          '<div class="row" style="gap:8px;flex-wrap:wrap">' +
            (u.status === 'banned'
              ? '<button class="btn btn-ok btn-sm" data-act="unban">' + svg('check') + ' Разбанить</button>'
              : '<button class="btn btn-danger btn-sm" data-act="ban">' + svg('ban') + ' Заблокировать</button>') +
            '<button class="btn btn-ghost btn-sm" data-act="resetpw">' + svg('key') + ' Сбросить пароль</button>' +
            (can('users.permissions') ? '<button class="btn btn-ghost btn-sm" data-act="perms">' + svg('sliders') + ' Права панели</button>' : '') +
          '</div></div></div>' +

          '<div class="grid" style="gap:18px">' +
            '<div class="panel ticks"><div class="panel-hd"><h3>Лицензии</h3><div class="sub">' + r.licenses.length + ' шт.</div></div>' +
              '<div class="table-wrap"><table class="table"><thead><tr><th>Ключ</th><th>Тариф</th><th>Статус</th><th>До</th><th></th></tr></thead><tbody>' +
              (r.licenses.length ? r.licenses.map((l) => '<tr><td class="mono">' + esc(l.license_key) + '</td><td class="mono">' + esc(l.plan_code) + '</td><td>' + chip(STATUS, l.status) + '</td><td class="dim" style="font-size:12px">' + l.expires_label + '</td>' +
                '<td class="actions"><button class="btn btn-quiet btn-sm" data-lic="' + l.id + '">' + svg('eye') + '</button></td></tr>').join('') : '<tr><td colspan="5" class="table-empty">Нет лицензий</td></tr>') +
              '</tbody></table></div></div>' +

            '<div class="panel ticks"><div class="panel-hd"><h3>Заказы</h3><div class="sub">' + r.orders.length + ' шт.</div></div>' +
              '<div class="table-wrap"><table class="table"><thead><tr><th>Номер</th><th>Тариф</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead><tbody>' +
              (r.orders.length ? r.orders.map((o) => '<tr><td class="mono">' + esc(o.public_id) + '</td><td class="mono">' + esc(o.plan_code) + '</td><td class="mono">' + money(o.amount, o.currency) + '</td><td>' + chip(ORDER, o.status) + '</td><td class="dim" style="font-size:12px">' + date(o.created_at) + '</td></tr>').join('') : '<tr><td colspan="5" class="table-empty">Нет заказов</td></tr>') +
              '</tbody></table></div></div>' +
          '</div>' +
        '</div>';

      host.querySelectorAll('[data-lic]').forEach(function (b) {
        b.addEventListener('click', function () { licenses.open(Number(b.dataset.lic)); });
      });

      const ban = host.querySelector('[data-act="ban"]');
      if (ban) ban.addEventListener('click', async function () {
        const ok = await S.confirm('Заблокировать ' + u.username + '?', 'Пользователь потеряет доступ к сайту, все его лицензии будут отозваны, а сессии лоадера закрыты.', { okText: 'Заблокировать', danger: true });
        if (!ok) return;
        await post('/api/admin/users/' + u.id + '/status', { status: 'banned', reason: 'manual' });
        S.toast('ok', 'Пользователь заблокирован');
        users.open(u.id);
      });
      const unban = host.querySelector('[data-act="unban"]');
      if (unban) unban.addEventListener('click', async function () {
        await post('/api/admin/users/' + u.id + '/status', { status: 'active' });
        S.toast('ok', 'Бан снят', 'Лицензии нужно восстановить вручную в разделе «Лицензии».');
        users.open(u.id);
      });
      const rp = host.querySelector('[data-act="resetpw"]');
      if (rp) rp.addEventListener('click', async function () {
        const ok = await S.confirm('Сбросить пароль?', 'Будет сгенерирован новый пароль, все сессии пользователя закроются. Пароль показывается один раз.', { okText: 'Сбросить' });
        if (!ok) return;
        const r2 = await post('/api/admin/users/' + u.id + '/password');
        showSecret('Новый пароль ' + u.username, r2.password);
      });
      const pp = host.querySelector('[data-act="perms"]');
      if (pp) pp.addEventListener('click', function () { openPermissions(u); });
    }
  };

  function showSecret(title, value) {
    const body = document.createElement('div');
    body.innerHTML =
      '<p class="muted" style="font-size:13px;margin-bottom:14px">Значение показывается один раз. Скопируйте и передайте владельцу аккаунта.</p>' +
      '<div class="cred-item"><div class="v" style="font-size:16px">' + esc(value) + '</div>' +
      '<div class="cred-actions"><button class="btn btn-quiet btn-sm" data-copy="' + esc(value) + '">' + svg('copy') + ' Копировать</button></div></div>';
    S.modal({ title: title, body: body, okText: 'Готово', cancelText: null, onMount: bindCopy });
  }

  /* ------------------------------------------------------- permissions -- */

  async function openPermissions(user) {
    const cat = await S.api('/api/admin/permissions/catalog');
    const current = new Set(user.permissions || []);
    const groups = {};
    cat.catalog.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });

    const body = document.createElement('div');
    body.innerHTML =
      '<div class="panel panel-flat" style="padding:12px 14px;margin-bottom:16px">' +
        '<div class="row" style="gap:9px;flex-wrap:wrap"><span class="chip chip-info">' + svg('users') + ' ' + esc(user.username) + '</span>' +
        '<span class="chip chip-mute mono">роль: ' + esc(user.role) + '</span>' +
        '<span class="grow"></span>' +
        '<span class="dim" style="font-size:12px">Отмеченные права применяются сразу</span></div>' +
      '</div>' +
      '<div class="row" style="gap:7px;flex-wrap:wrap;margin-bottom:14px">' +
        Object.keys(cat.presets).map(function (k) {
          const labels = { support: 'Поддержка', manager: 'Менеджер', moderator: 'Модератор', billing: 'Биллинг', full: 'Полный доступ' };
          return '<button class="btn btn-ghost btn-sm" data-preset="' + k + '">' + svg('sliders') + ' ' + (labels[k] || k) + '</button>';
        }).join('') +
        '<button class="btn btn-quiet btn-sm" data-preset="none">' + svg('x') + ' Снять все</button>' +
      '</div>' +
      Object.keys(groups).map(function (g) {
        return '<div class="perm-grp"><h5>' + esc(g) + '</h5><div class="perm-grid">' +
          groups[g].map(function (p) {
            const key = p.key === 'panel.access' ? 'panel.access' : p.key;
            return '<label class="check"><input type="checkbox" name="perm" value="' + key + '" ' + (current.has(key) ? 'checked' : '') + '>' +
              '<span class="box">' + svg('check') + '</span>' +
              '<span class="txt"><b>' + esc(p.label) + '</b><small>' + esc(p.hint || '') + '</small><small class="mono" style="opacity:.6">' + esc(key) + '</small></span></label>';
          }).join('') + '</div></div>';
      }).join('');

    body.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        const key = b.dataset.preset;
        const set = key === 'none' ? [] : (cat.presets[key] || []);
        body.querySelectorAll('input[name="perm"]').forEach(function (i) { i.checked = set.indexOf(i.value) >= 0; });
      });
    });

    const ok = await S.modal({
      title: 'Права доступа — ' + user.username,
      body: body, wide: true, okText: 'Сохранить права',
      onMount: function (box) { box.style.maxWidth = '820px'; }
    });
    if (!ok) return;

    const chosen = Array.prototype.slice.call(body.querySelectorAll('input[name="perm"]:checked')).map(function (i) { return i.value; });
    if (chosen.length && chosen.indexOf('panel.access') < 0) {
      const fix = await S.confirm('Добавить доступ к панели?', 'Вы отметили права, но не отметили panel.access — без него пользователь не сможет открыть панель вообще.', { okText: 'Добавить' });
      if (fix) chosen.unshift('panel.access');
    }
    try {
      const r = await post('/api/admin/users/' + user.id + '/permissions', { permissions: chosen });
      S.toast('ok', 'Права сохранены', 'Выдано прав: ' + r.permissions.length);
      users.open(user.id);
    } catch (err) {
      S.toast('err', 'Не сохранено', err.message);
    }
  }

  /* ========================================================== LICENSES == */

  const licState = { page: 1, per_page: 25, search: '', status: '' };
  const licenses = {
    title: 'Лицензии и ключи',
    async render() {
      setTitle('Лицензии и ключи', 'licenses');
      setTools(
        '<div class="search-box">' + svg('search') + '<input class="input" id="lSearch" placeholder="Ключ, логин, HWID или user id" value="' + esc(licState.search) + '"></div>' +
        '<div class="seg" id="lStatus">' +
          ['', 'active', 'pending', 'expired', 'revoked'].map((s) => '<button data-v="' + s + '" class="' + (licState.status === s ? 'active' : '') + '">' + ({ '': 'Все', active: 'Активные', pending: 'Не запущены', expired: 'Истекли', revoked: 'Отозваны' })[s] + '</button>').join('') +
        '</div>' +
        (can('licenses.generate') ? '<button class="btn btn-primary btn-sm" id="genBtn">' + svg('plus') + ' Выдать ключи</button>' : '')
      );

      const reload = async function () { spinner(); await licenses.render(); };
      document.getElementById('lSearch').addEventListener('input', debounce(function (e) { licState.search = e.target.value.trim(); licState.page = 1; reload(); }, 380));
      document.querySelectorAll('#lStatus button').forEach(function (b) { b.addEventListener('click', function () { licState.status = b.dataset.v; licState.page = 1; reload(); }); });
      const gen = document.getElementById('genBtn');
      if (gen) gen.addEventListener('click', openGenerate);

      spinner();
      const q = new URLSearchParams({ page: licState.page, per_page: licState.per_page, search: licState.search, status: licState.status });
      const r = await S.api('/api/admin/licenses?' + q);

      host.innerHTML = '<div class="panel ticks"><div class="table-wrap"><table class="table">' +
        '<thead><tr><th>ID</th><th>Ключ</th><th>Логин лоадера</th><th>Владелец</th><th>Тариф</th><th>Статус</th><th>HWID</th><th>Сбросов</th><th>До</th><th>Последний вход</th><th></th></tr></thead><tbody>' +
        (r.licenses.length ? r.licenses.map((l) =>
          '<tr>' +
            '<td class="mono dim">' + l.id + '</td>' +
            '<td class="mono"><b>' + esc(l.license_key) + '</b><button class="btn btn-quiet btn-icon" style="width:24px;height:24px;margin-left:4px" data-copy="' + esc(l.license_key) + '" title="Копировать">' + svg('copy') + '</button></td>' +
            '<td class="mono">' + esc(l.loader_login) + '</td>' +
            '<td>' + esc(l.username || '—') + ' <span class="dim mono" style="font-size:11px">#' + l.user_id + '</span></td>' +
            '<td class="mono">' + esc(l.plan_code) + '</td>' +
            '<td>' + chip(STATUS, l.status) + '</td>' +
            '<td class="mono dim" style="font-size:11.6px">' + (l.hwid_short || 'не привязан') + '</td>' +
            '<td class="mono">' + l.hwid_resets_left + '</td>' +
            '<td class="dim" style="font-size:12px">' + l.expires_label + '</td>' +
            '<td class="dim" style="font-size:12px">' + (l.last_seen_at ? rel(l.last_seen_at) : 'никогда') + '</td>' +
            '<td class="actions"><button class="btn btn-quiet btn-sm" data-lic="' + l.id + '">' + svg('eye') + '</button></td>' +
          '</tr>').join('') : '<tr><td colspan="11" class="table-empty">Лицензий не найдено</td></tr>') +
        '</tbody></table></div>' + pager(licState, r.total) + '</div>';

      bindCopy(host);
      bindPager(host, licState, reload);
      host.querySelectorAll('[data-lic]').forEach(function (b) { b.addEventListener('click', function () { licenses.open(Number(b.dataset.lic)); }); });
    },

    async open(id) {
      spinner();
      const r = await S.api('/api/admin/licenses/' + id);
      const l = r.license;
      setTitle('Лицензия #' + l.id, 'licenses / ' + l.id);
      setTools('<button class="btn btn-ghost btn-sm" id="backLic">' + svg('x') + ' К списку</button>');
      document.getElementById('backLic').addEventListener('click', function () { licenses.render(); });

      const actions = [];
      if (can('licenses.extend')) actions.push('<button class="btn btn-ghost btn-sm" data-act="extend">' + svg('clock') + ' Продлить</button>');
      if (can('licenses.extend')) actions.push('<button class="btn btn-ghost btn-sm" data-act="plan">' + svg('sliders') + ' Сменить тариф</button>');
      if (can('hwid.reset')) actions.push('<button class="btn btn-ghost btn-sm" data-act="hwid">' + svg('refresh') + ' Сбросить HWID</button>');
      if (can('licenses.credentials')) actions.push('<button class="btn btn-ghost btn-sm" data-act="rotate">' + svg('key') + ' Новый пароль</button>');
      if (can('licenses.revoke')) {
        actions.push(l.status === 'revoked'
          ? '<button class="btn btn-ok btn-sm" data-act="restore">' + svg('check') + ' Восстановить</button>'
          : '<button class="btn btn-danger btn-sm" data-act="revoke">' + svg('ban') + ' Отозвать</button>');
      }

      host.innerHTML =
        '<div class="grid" style="grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:18px" class="dashAdmGrid">' +
          '<div class="panel ticks cred-card"><div class="glow"></div>' +
            '<div class="panel-hd"><h3>' + esc(l.plan_code) + ' · ' + l.days + ' дней</h3><div class="grow"></div>' + chip(STATUS, l.status) + '</div>' +
            '<div class="panel-bd">' +
              '<div class="cred-grid">' +
                '<div class="cred-item"><div class="k">' + svg('key') + ' Лицензионный ключ</div><div class="v">' + esc(l.license_key) + '</div><div class="cred-actions"><button class="btn btn-quiet btn-sm" data-copy="' + esc(l.license_key) + '">' + svg('copy') + ' Копировать</button></div></div>' +
                '<div class="cred-item"><div class="k">' + svg('users') + ' Владелец</div><div class="v" style="font-size:15px">' + esc(l.user ? l.user.username : '—') + '</div><div class="cred-actions"><span class="chip chip-mute mono">' + esc(l.user ? l.user.email : '') + '</span></div></div>' +
                '<div class="cred-item"><div class="k">' + svg('users') + ' Логин лоадера</div><div class="v">' + esc(l.loader.login) + '</div><div class="cred-actions"><button class="btn btn-quiet btn-sm" data-copy="' + esc(l.loader.login) + '">' + svg('copy') + ' Копировать</button></div></div>' +
                '<div class="cred-item"><div class="k">' + svg('key') + ' Пароль лоадера</div><div class="v">' + (l.loader.password ? esc(l.loader.password) : '<span class="dim">нет права licenses.credentials</span>') + '</div>' + (l.loader.password ? '<div class="cred-actions"><button class="btn btn-quiet btn-sm" data-copy="' + esc(l.loader.password) + '">' + svg('copy') + ' Копировать</button></div>' : '') + '</div>' +
              '</div>' +
              '<div class="divider"></div>' +
              '<div class="kv">' +
                '<dt>Создана</dt><dd>' + l.created_label + '</dd>' +
                '<dt>Активирована</dt><dd>' + (l.activated_at ? date(l.activated_at) : 'ещё не запускалась') + '</dd>' +
                '<dt>Действует до</dt><dd><b>' + l.expires_label + '</b></dd>' +
                '<dt>Осталось</dt><dd class="mono">' + esc(l.days_left_label || '—') + '</dd>' +
                '<dt>HWID</dt><dd class="mono">' + (l.hwid ? esc(l.hwid) : 'не привязан') + '</dd>' +
                '<dt>Метка устройства</dt><dd>' + esc(l.hwid_label || '—') + '</dd>' +
                '<dt>Сбросов осталось</dt><dd class="mono">' + l.hwid_resets_left + '</dd>' +
                '<dt>Последний вход</dt><dd>' + (l.last_seen_at ? date(l.last_seen_at) + ' · ' + esc(l.last_seen_ip || '') : 'никогда') + '</dd>' +
                '<dt>Версия лоадера</dt><dd class="mono">' + esc(l.loader_version || '—') + '</dd>' +
                '<dt>Заказ</dt><dd class="mono">' + esc(l.order ? l.order.public_id : 'выдан вручную') + '</dd>' +
                (l.revoked_reason ? '<dt>Причина отзыва</dt><dd class="mono" style="color:#fda4af">' + esc(l.revoked_reason) + '</dd>' : '') +
                (l.note ? '<dt>Заметка</dt><dd>' + esc(l.note) + '</dd>' : '') +
              '</div>' +
              '<div class="divider"></div>' +
              '<div class="row" style="gap:8px;flex-wrap:wrap">' + actions.join('') + '</div>' +
            '</div></div>' +

          '<div class="grid" style="gap:18px">' +
            '<div class="panel ticks"><div class="panel-hd"><h3>Устройства</h3><div class="sub">' + r.devices.length + ' записей</div></div>' +
              '<div class="table-wrap"><table class="table"><thead><tr><th>HWID</th><th>Метка</th><th>Привязан</th><th>Снят</th></tr></thead><tbody>' +
              (r.devices.length ? r.devices.map((d) => '<tr><td class="mono" style="font-size:11.4px">' + esc(String(d.hwid).slice(0, 20)) + '…</td><td>' + esc(d.label || '—') + '</td><td class="dim" style="font-size:12px">' + date(d.bound_at) + '</td><td class="dim" style="font-size:12px">' + (d.revoked_at ? date(d.revoked_at) : '—') + '</td></tr>').join('') : '<tr><td colspan="4" class="table-empty">Нет привязок</td></tr>') +
              '</tbody></table></div></div>' +

            '<div class="panel ticks"><div class="panel-hd"><h3>Сессии лоадера</h3><div class="sub">' + r.sessions.length + ' последних</div></div>' +
              '<div class="table-wrap"><table class="table"><thead><tr><th>Статус</th><th>Сборка</th><th>IP</th><th>Heartbeat</th></tr></thead><tbody>' +
              (r.sessions.length ? r.sessions.slice(0, 10).map((s) => '<tr><td>' + (s.state === 'authed' ? '<span class="chip chip-ok">' + svg('check') + ' authed</span>' : '<span class="chip chip-mute">' + esc(s.state) + '</span>') + '</td><td class="mono">' + esc(s.build || '—') + '</td><td class="mono dim" style="font-size:11.6px">' + esc(s.ip || '—') + '</td><td class="dim" style="font-size:12px">' + (s.last_heartbeat ? rel(s.last_heartbeat) : '—') + '</td></tr>').join('') : '<tr><td colspan="4" class="table-empty">Сессий не было</td></tr>') +
              '</tbody></table></div></div>' +

            '<div class="panel ticks"><div class="panel-hd"><h3>События</h3></div><div class="panel-bd" style="max-height:280px;overflow:auto;padding:8px 12px">' +
              (r.events.length ? r.events.map((e) => '<div class="log-line"><span class="t">' + date(e.created_at) + '</span><span class="a">' + esc(e.action) + '</span><span class="m">' + esc(e.ip || '') + '</span></div>').join('') : '<div class="empty" style="padding:20px">Событий нет</div>') +
            '</div></div>' +
          '</div>' +
        '</div>';

      bindCopy(host);

      const act = host.querySelector.bind(host);
      const extend = act('[data-act="extend"]');
      if (extend) extend.addEventListener('click', async function () {
        const body = document.createElement('div');
        body.innerHTML = '<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
          [7, 30, 90, 180].map((d) => '<button class="btn btn-ghost btn-sm" data-d="' + d + '">+' + d + ' дней</button>').join('') +
          '<button class="btn btn-quiet btn-sm" data-d="-30">−30 дней</button></div>' +
          '<div class="field"><label class="label">Дней</label><input class="input" id="extDays" type="number" value="30"></div>' +
          '<div class="field"><label class="label">Заметка</label><input class="input" id="extNote" placeholder="например: компенсация за простой"></div>';
        body.querySelectorAll('[data-d]').forEach(function (b) {
          b.addEventListener('click', function () { body.querySelector('#extDays').value = b.dataset.d; });
        });
        const ok = await S.modal({ title: 'Продлить лицензию #' + l.id, body: body, okText: 'Продлить' });
        if (!ok) return;
        try {
          const res = await post('/api/admin/licenses/' + l.id + '/extend', { days: Number(body.querySelector('#extDays').value), note: body.querySelector('#extNote').value });
          S.toast('ok', 'Готово', res.message);
          licenses.open(l.id);
        } catch (err) { S.toast('err', 'Ошибка', err.message); }
      });

      const plan = act('[data-act="plan"]');
      if (plan) plan.addEventListener('click', async function () {
        const body = document.createElement('div');
        body.innerHTML = '<div class="field"><label class="label">Тариф</label><select class="select" id="newPlan">' +
          ['SANCTION-30', 'SANCTION-90', 'SANCTION-180'].map((p) => '<option value="' + p + '"' + (p === l.plan_code ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
          '<p class="hint">Срок пересчитывается при следующем продлении. Текущая дата окончания не меняется.</p>';
        const ok = await S.modal({ title: 'Сменить тариф', body: body, okText: 'Применить' });
        if (!ok) return;
        await post('/api/admin/licenses/' + l.id + '/plan', { plan: body.querySelector('#newPlan').value });
        S.toast('ok', 'Тариф изменён');
        licenses.open(l.id);
      });

      const hw = act('[data-act="hwid"]');
      if (hw) hw.addEventListener('click', async function () {
        const ok = await S.confirm('Сбросить HWID принудительно?', 'Привязка будет снята без расхода лимита пользователя, активные сессии лоадера закроются.', { okText: 'Сбросить', danger: true });
        if (!ok) return;
        try {
          await post('/api/admin/licenses/' + l.id + '/hwid-reset', { force: true });
          S.toast('ok', 'HWID сброшен');
          licenses.open(l.id);
        } catch (err) { S.toast('err', 'Ошибка', err.message); }
      });

      const rot = act('[data-act="rotate"]');
      if (rot) rot.addEventListener('click', async function () {
        const ok = await S.confirm('Выпустить новый пароль лоадера?', 'Старый пароль перестанет действовать немедленно, все сессии лоадера будут закрыты.', { okText: 'Выпустить' });
        if (!ok) return;
        const r2 = await post('/api/admin/licenses/' + l.id + '/credentials/rotate');
        showSecret('Новый пароль лоадера', r2.loader.password);
        licenses.open(l.id);
      });

      const rev = act('[data-act="revoke"]');
      if (rev) rev.addEventListener('click', async function () {
        const body = document.createElement('div');
        body.innerHTML = '<div class="field"><label class="label">Причина</label><select class="select" id="revReason">' +
          ['revoked_by_admin', 'refund', 'chargeback', 'sharing_account', 'cheating_policy', 'hwid_blacklisted'].map((x) => '<option value="' + x + '">' + x + '</option>').join('') + '</select></div>';
        const ok = await S.modal({ title: 'Отозвать лицензию #' + l.id, body: body, okText: 'Отозвать', danger: true });
        if (!ok) return;
        await post('/api/admin/licenses/' + l.id + '/revoke', { reason: body.querySelector('#revReason').value });
        S.toast('ok', 'Лицензия отозвана', 'Лоадер потеряет доступ на ближайшем heartbeat.');
        licenses.open(l.id);
      });

      const res = act('[data-act="restore"]');
      if (res) res.addEventListener('click', async function () {
        await post('/api/admin/licenses/' + l.id + '/restore');
        S.toast('ok', 'Лицензия восстановлена');
        licenses.open(l.id);
      });
    }
  };

  async function openGenerate() {
    const body = document.createElement('div');
    body.innerHTML =
      '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="field"><label class="label">Тариф</label><select class="select" id="gPlan">' +
          ['SANCTION-30', 'SANCTION-90', 'SANCTION-180'].map((p) => '<option value="' + p + '"' + (p === 'SANCTION-90' ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></div>' +
        '<div class="field"><label class="label">Количество</label><input class="input" id="gCount" type="number" value="1" min="1" max="200"></div>' +
        '<div class="field"><label class="label">Срок (дней), 0 = по тарифу</label><input class="input" id="gDays" type="number" value="0"></div>' +
        '<div class="field"><label class="label">Кому выдать</label><input class="input" id="gUser" placeholder="логин, e-mail или id (пусто = вам)"></div>' +
      '</div>' +
      '<div class="field"><label class="label">Заметка</label><input class="input" id="gNote" placeholder="конкурс, компенсация, партнёр"></div>' +
      '<label class="check" style="margin-top:6px"><input type="checkbox" id="gActivate"><span class="box">' + svg('check') + '</span>' +
      '<span class="txt"><b>Запустить отсчёт сразу</b><small>Иначе срок начнётся с первого входа в лоадер</small></span></label>';

    const ok = await S.modal({ title: 'Выдача ключей', body: body, okText: 'Создать', onMount: function (b) { b.style.maxWidth = '620px'; } });
    if (!ok) return;

    try {
      const r = await post('/api/admin/licenses/generate', {
        plan: body.querySelector('#gPlan').value,
        count: Number(body.querySelector('#gCount').value) || 1,
        days: Number(body.querySelector('#gDays').value) || null,
        username: body.querySelector('#gUser').value.trim(),
        note: body.querySelector('#gNote').value.trim(),
        activate: body.querySelector('#gActivate').checked
      });
      S.toast('ok', 'Создано ключей: ' + r.count, 'Назначено пользователю ' + r.assigned_to);
      showGenerated(r.licenses);
      licenses.render();
    } catch (err) {
      S.toast('err', 'Не удалось выдать ключи', err.message);
    }
  }

  function showGenerated(list) {
    const body = document.createElement('div');
    body.innerHTML =
      '<p class="muted" style="font-size:13px;margin-bottom:14px">Пароли лоадера показываются один раз — они уже синхронизированы с базой, к которой обращается клиент.</p>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Ключ</th><th>Логин</th><th>Пароль</th><th>Тариф</th><th></th></tr></thead><tbody>' +
      list.map(function (l, i) {
        return '<tr><td class="mono">' + esc(l.license_key) + '</td><td class="mono">' + esc(l.loader_login) + '</td><td class="mono">' + esc(l.loader_password) + '</td><td class="mono">' + esc(l.plan_code) + '</td>' +
          '<td class="actions"><button class="btn btn-quiet btn-sm" data-copyrow="' + i + '">' + svg('copy') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="row" style="gap:8px;margin-top:14px"><button class="btn btn-ghost btn-sm" id="copyAll">' + svg('copy') + ' Скопировать всё</button>' +
      '<button class="btn btn-ghost btn-sm" id="dlCsv">' + svg('download') + ' Скачать CSV</button></div>';

    const csv = list.map(function (l) { return [l.license_key, l.loader_login, l.loader_password, l.plan_code, l.days, l.status].join(','); }).join('\n');
    const all = list.map(function (l) { return l.license_key + ' | ' + l.loader_login + ' | ' + l.loader_password; }).join('\n');

    S.modal({
      title: 'Создано ключей: ' + list.length, body: body, okText: 'Закрыть', cancelText: null, wide: true,
      onMount: function (box) {
        box.style.maxWidth = '760px';
        bindCopy(box);
        box.querySelectorAll('[data-copyrow]').forEach(function (b) {
          b.addEventListener('click', function () {
            const l = list[Number(b.dataset.copyrow)];
            S.copy(l.license_key + ' | ' + l.loader_login + ' | ' + l.loader_password).then(function (ok2) {
              S.toast(ok2 ? 'ok' : 'err', ok2 ? 'Строка скопирована' : 'Ошибка');
            });
          });
        });
        box.querySelector('#copyAll').addEventListener('click', function () {
          S.copy(all).then(function (o) { S.toast(o ? 'ok' : 'err', o ? 'Скопировано' : 'Ошибка'); });
        });
        box.querySelector('#dlCsv').addEventListener('click', function () {
          const blob = new Blob(['license_key,loader_login,loader_password,plan,days,status\n' + csv], { type: 'text/csv;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'sanction-keys-' + Date.now() + '.csv';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        });
      }
    });
  }

  /* ============================================================ ORDERS == */

  const ordState = { page: 1, per_page: 25, search: '', status: '' };
  const ordersSec = {
    title: 'Заказы',
    async render() {
      setTitle('Заказы', 'orders');
      setTools(
        '<div class="search-box">' + svg('search') + '<input class="input" id="oSearch" placeholder="Номер заказа или тариф" value="' + esc(ordState.search) + '"></div>' +
        '<div class="seg" id="oStatus">' +
          ['', 'paid', 'pending', 'failed', 'refunded'].map((s) => '<button data-v="' + s + '" class="' + (ordState.status === s ? 'active' : '') + '">' + ({ '': 'Все', paid: 'Оплачены', pending: 'Ожидают', failed: 'Ошибки', refunded: 'Возвраты' })[s] + '</button>').join('') +
        '</div>'
      );
      const reload = async function () { spinner(); await ordersSec.render(); };
      document.getElementById('oSearch').addEventListener('input', debounce(function (e) { ordState.search = e.target.value.trim(); ordState.page = 1; reload(); }, 380));
      document.querySelectorAll('#oStatus button').forEach(function (b) { b.addEventListener('click', function () { ordState.status = b.dataset.v; ordState.page = 1; reload(); }); });

      spinner();
      const q = new URLSearchParams({ page: ordState.page, per_page: ordState.per_page, search: ordState.search, status: ordState.status });
      const r = await S.api('/api/admin/orders?' + q);
      const rev = r.revenue;

      host.innerHTML =
        '<div class="grid stat-grid" style="margin-bottom:18px">' +
          statTile('Выручка всего', money(rev.total), rev.count + ' оплаченных заказов', 'chart') +
          statTile('Сегодня', money(rev.today), 'за 24 часа', 'card') +
          statTile('Неделя', money(rev.week), 'за 7 дней', 'ticket') +
          statTile('Месяц', money(rev.month), 'за 30 дней', 'server') +
        '</div>' +
        '<div class="panel ticks"><div class="table-wrap"><table class="table">' +
        '<thead><tr><th>Заказ</th><th>Пользователь</th><th>Тариф</th><th>Скидка</th><th>Сумма</th><th>Способ</th><th>Статус</th><th>Создан</th><th>Оплачен</th><th></th></tr></thead><tbody>' +
        (r.orders.length ? r.orders.map((o) =>
          '<tr>' +
            '<td class="mono"><b>' + esc(o.public_id) + '</b></td>' +
            '<td>' + esc(o.username || '—') + ' <span class="dim mono" style="font-size:11px">#' + o.user_id + '</span></td>' +
            '<td class="mono">' + esc(o.plan_code) + '</td>' +
            '<td class="mono">' + (o.discount ? '−' + money(o.discount, o.currency) : '—') + (o.coupon_code ? ' <span class="chip chip-mute chip-mono">' + esc(o.coupon_code) + '</span>' : '') + '</td>' +
            '<td class="mono"><b>' + money(o.amount, o.currency) + '</b></td>' +
            '<td><span class="chip chip-mute chip-mono">' + esc(o.method) + '</span></td>' +
            '<td>' + chip(ORDER, o.status) + '</td>' +
            '<td class="dim" style="font-size:12px">' + date(o.created_at) + '</td>' +
            '<td class="dim" style="font-size:12px">' + o.paid_label + '</td>' +
            '<td class="actions">' +
              (o.status !== 'paid' && can('orders.mark_paid') ? '<button class="btn btn-ok btn-sm" data-pay="' + esc(o.public_id) + '">' + svg('check') + '</button>' : '') +
              (o.status === 'paid' && can('orders.refund') ? '<button class="btn btn-danger btn-sm" data-refund="' + esc(o.public_id) + '" title="Возврат">' + svg('refresh') + '</button>' : '') +
            '</td>' +
          '</tr>').join('') : '<tr><td colspan="10" class="table-empty">Заказов нет</td></tr>') +
        '</tbody></table></div>' + pager(ordState, r.total) + '</div>';

      bindPager(host, ordState, reload);
      host.querySelectorAll('[data-pay]').forEach(function (b) {
        b.addEventListener('click', async function () {
          const ok = await S.confirm('Отметить оплаченным?', 'Заказ ' + b.dataset.pay + ' будет помечен оплаченным вручную. Лицензия создастся или продлится так же, как при вебхуке шлюза.', { okText: 'Отметить' });
          if (!ok) return;
          try {
            const r2 = await post('/api/admin/orders/' + b.dataset.pay + '/mark-paid');
            S.toast('ok', 'Доступ выдан', r2.stacked ? 'Дни добавлены к существующей лицензии.' : 'Создана новая лицензия #' + r2.license_id);
            ordersSec.render();
          } catch (err) { S.toast('err', 'Ошибка', err.message); }
        });
      });
      host.querySelectorAll('[data-refund]').forEach(function (b) {
        b.addEventListener('click', async function () {
          const ok = await S.confirm('Оформить возврат?', 'Заказ получит статус refunded, а выданная по нему лицензия будет отозвана.', { okText: 'Возврат', danger: true });
          if (!ok) return;
          await post('/api/admin/orders/' + b.dataset.refund + '/refund', { reason: 'admin_refund' });
          S.toast('ok', 'Возврат оформлен');
          ordersSec.render();
        });
      });
    }
  };

  /* =========================================================== COUPONS == */

  const coupons = {
    title: 'Промокоды',
    async render() {
      setTitle('Промокоды', 'coupons');
      setTools(can('coupons.manage') ? '<button class="btn btn-primary btn-sm" id="addCoupon">' + svg('plus') + ' Создать промокод</button>' : '');
      const add = document.getElementById('addCoupon');
      if (add) add.addEventListener('click', createCoupon);

      spinner();
      const r = await S.api('/api/admin/coupons');
      host.innerHTML = '<div class="panel ticks"><div class="table-wrap"><table class="table">' +
        '<thead><tr><th>Код</th><th>Скидка</th><th>Тариф</th><th>Использований</th><th>Лимит</th><th>На пользователя</th><th>До</th><th>Статус</th><th></th></tr></thead><tbody>' +
        (r.coupons.length ? r.coupons.map((c) =>
          '<tr><td class="mono"><b>' + esc(c.code) + '</b><button class="btn btn-quiet btn-icon" style="width:24px;height:24px;margin-left:4px" data-copy="' + esc(c.code) + '">' + svg('copy') + '</button></td>' +
          '<td class="mono">' + (c.kind === 'percent' ? c.value + ' %' : money(c.value * 100)) + '</td>' +
          '<td class="mono dim">' + esc(c.plan_code || 'любой') + '</td>' +
          '<td class="mono">' + c.used + '</td>' +
          '<td class="mono">' + (c.max_uses ? c.max_uses : '∞') + '</td>' +
          '<td class="mono">' + c.per_user + '</td>' +
          '<td class="dim" style="font-size:12px">' + date(c.expires_at) + '</td>' +
          '<td>' + (c.active ? '<span class="chip chip-ok">включён</span>' : '<span class="chip chip-mute">выключен</span>') + '</td>' +
          '<td class="actions"><button class="btn btn-quiet btn-sm" data-toggle="' + c.id + '" title="Переключить">' + svg('power') + '</button></td></tr>').join('')
          : '<tr><td colspan="9" class="table-empty">Промокодов пока нет</td></tr>') +
        '</tbody></table></div></div>';

      bindCopy(host);
      host.querySelectorAll('[data-toggle]').forEach(function (b) {
        b.addEventListener('click', async function () { await post('/api/admin/coupons/' + b.dataset.toggle + '/toggle'); coupons.render(); });
      });
    }
  };

  async function createCoupon() {
    const body = document.createElement('div');
    body.innerHTML =
      '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="field"><label class="label">Код</label><input class="input input-mono" id="cCode" placeholder="SANCTION10"></div>' +
        '<div class="field"><label class="label">Тип</label><select class="select" id="cKind"><option value="percent">Проценты</option><option value="fixed">Фиксированная сумма, ₽</option></select></div>' +
        '<div class="field"><label class="label">Значение</label><input class="input" id="cValue" type="number" value="10"></div>' +
        '<div class="field"><label class="label">Тариф</label><select class="select" id="cPlan"><option value="">Любой</option><option value="SANCTION-30">SANCTION-30</option><option value="SANCTION-90">SANCTION-90</option><option value="SANCTION-180">SANCTION-180</option></select></div>' +
        '<div class="field"><label class="label">Максимум использований (0 = без лимита)</label><input class="input" id="cMax" type="number" value="0"></div>' +
        '<div class="field"><label class="label">Действует дней (0 = бессрочно)</label><input class="input" id="cExp" type="number" value="30"></div>' +
      '</div>';
    const ok = await S.modal({ title: 'Новый промокод', body: body, okText: 'Создать', onMount: function (b) { b.style.maxWidth = '620px'; } });
    if (!ok) return;
    try {
      const r = await post('/api/admin/coupons', {
        code: body.querySelector('#cCode').value.trim(),
        kind: body.querySelector('#cKind').value,
        value: Number(body.querySelector('#cValue').value),
        plan: body.querySelector('#cPlan').value || null,
        max_uses: Number(body.querySelector('#cMax').value) || 0,
        expires_days: Number(body.querySelector('#cExp').value) || 0
      });
      S.toast('ok', 'Промокод создан', r.coupon.code);
      coupons.render();
    } catch (err) { S.toast('err', 'Ошибка', err.message); }
  }

  /* ============================================================ LOADER == */

  const loaderSec = {
    title: 'Лоадер',
    async render() {
      setTitle('Сессии и сборки', 'loader');
      setTools(
        '<button class="btn btn-ghost btn-sm" id="reloadSessions">' + svg('refresh') + ' Обновить</button>' +
        (can('loader.killswitch') ? '<button class="btn btn-danger btn-sm" id="killBtn">' + svg('power') + ' Kill switch</button>' : '')
      );

      spinner();
      const r = await S.api('/api/admin/loader/sessions');
      const online = r.sessions.filter((s) => s.online).length;

      document.getElementById('reloadSessions').addEventListener('click', function () { loaderSec.render(); });
      const kill = document.getElementById('killBtn');
      if (kill) kill.addEventListener('click', toggleKill);

      host.innerHTML =
        '<div class="panel ticks" style="margin-bottom:18px"><div class="panel-hd"><h3>Политика сборок</h3><div class="sub">Отзывает устаревшие и слитые бинарники</div></div>' +
        '<div class="panel-bd"><div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:12px" class="dashAdmGrid">' +
          '<div class="field"><label class="label">Актуальная сборка</label><input class="input input-mono" id="bLatest" placeholder="1.0.4"></div>' +
          '<div class="field"><label class="label">Минимальная сборка</label><input class="input input-mono" id="bMin" placeholder="1.0.0"></div>' +
          '<div class="field"><label class="label">Выдача загрузок</label><select class="select" id="bDl"><option value="1">Включена</option><option value="0">Отключена</option></select></div>' +
        '</div>' +
        '<div class="row" style="gap:9px;margin-top:14px;flex-wrap:wrap">' +
          (can('loader.build') ? '<button class="btn btn-primary btn-sm" id="saveBuild">' + svg('check') + ' Сохранить политику</button>' : '') +
          (can('loader.killswitch') ? '<button class="btn btn-ghost btn-sm" id="revokeAll">' + svg('ban') + ' Закрыть все сессии</button>' : '') +
        '</div></div></div>' +

        '<div class="grid stat-grid" style="margin-bottom:18px">' +
          statTile('Онлайн сейчас', online, 'heartbeat за ' + r.heartbeat_ttl + ' с', 'server', 'ok') +
          statTile('Всего сессий', r.sessions.length, 'последние 200', 'box') +
          statTile('Отозвано', r.sessions.filter((s) => s.state === 'revoked').length, 'kill switch, бан, истечение', 'ban', 'err') +
          statTile('Рукопожатий', r.sessions.filter((s) => s.state === 'handshake').length, 'не дошли до авторизации', 'clock', 'warn') +
        '</div>' +

        '<div class="panel ticks"><div class="panel-hd"><h3>Сессии лоадера</h3><div class="sub">живые и недавние подключения</div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Статус</th><th>Логин</th><th>Ключ</th><th>Пользователь</th><th>Тариф</th><th>Сборка</th><th>IP</th><th>Создана</th><th>Heartbeat</th><th></th></tr></thead><tbody>' +
        (r.sessions.length ? r.sessions.map((s) =>
          '<tr>' +
            '<td>' + (s.state === 'authed'
              ? (s.online ? '<span class="chip chip-ok"><span class="dot"></span> online</span>' : '<span class="chip chip-warn">authed · тихо</span>')
              : '<span class="chip chip-mute">' + esc(s.state) + '</span>') + '</td>' +
            '<td class="mono">' + esc(s.loader_login || '—') + '</td>' +
            '<td class="mono dim" style="font-size:11.4px">' + esc(s.license_key ? String(s.license_key).slice(0, 14) + '…' : '—') + '</td>' +
            '<td>' + esc(s.username || '—') + '</td>' +
            '<td class="mono">' + esc(s.plan_code || '—') + '</td>' +
            '<td class="mono">' + esc(s.build || '—') + '</td>' +
            '<td class="mono dim" style="font-size:11.4px">' + esc(s.ip || '—') + '</td>' +
            '<td class="dim" style="font-size:12px">' + s.created_label + '</td>' +
            '<td class="dim" style="font-size:12px">' + s.last_heartbeat_label + '</td>' +
            '<td class="actions">' +
              (s.license_id && can('loader.killswitch') ? '<button class="btn btn-danger btn-sm" data-kill="' + s.license_id + '" title="Закрыть сессии лицензии">' + svg('ban') + '</button>' : '') +
              (s.license_id && can('licenses.view') ? '<button class="btn btn-quiet btn-sm" data-open="' + s.license_id + '">' + svg('eye') + '</button>' : '') +
            '</td>' +
          '</tr>').join('') : '<tr><td colspan="10" class="table-empty">Сессий пока нет</td></tr>') +
        '</tbody></table></div></div>';

      // fill policy inputs from summary (single extra call keeps the panel honest)
      try {
        const s = await S.api('/api/admin/summary');
        const bl = document.getElementById('bLatest'); if (bl) bl.value = s.loader.latest_version;
        const bm = document.getElementById('bMin'); if (bm) bm.value = s.loader.min_version;
      } catch { /* ignore */ }

      const save = document.getElementById('saveBuild');
      if (save) save.addEventListener('click', async function () {
        try {
          await post('/api/admin/loader/build', {
            latest_version: document.getElementById('bLatest').value.trim(),
            min_version: document.getElementById('bMin').value.trim(),
            download_enabled: document.getElementById('bDl').value === '1'
          });
          S.toast('ok', 'Политика сборок сохранена');
        } catch (err) { S.toast('err', 'Ошибка', err.message); }
      });

      const revAll = document.getElementById('revokeAll');
      if (revAll) revAll.addEventListener('click', async function () {
        const ok = await S.confirm('Закрыть все сессии лоадера?', 'Все активные подключения будут разорваны. Клиенты переподключатся автоматически при следующем запуске.', { okText: 'Закрыть все', danger: true });
        if (!ok) return;
        const r2 = await post('/api/admin/loader/sessions/revoke');
        S.toast('ok', 'Закрыто сессий: ' + r2.revoked);
        loaderSec.render();
      });

      host.querySelectorAll('[data-kill]').forEach(function (b) {
        b.addEventListener('click', async function () {
          const ok = await S.confirm('Закрыть сессии этой лицензии?', 'Активные подключения лицензии будут разорваны немедленно.', { okText: 'Закрыть', danger: true });
          if (!ok) return;
          const r2 = await post('/api/admin/loader/sessions/revoke', { license_id: Number(b.dataset.kill) });
          S.toast('ok', 'Закрыто: ' + r2.revoked);
          loaderSec.render();
        });
      });
      host.querySelectorAll('[data-open]').forEach(function (b) {
        b.addEventListener('click', function () { licenses.open(Number(b.dataset.open)); });
      });
    }
  };

  async function toggleKill() {
    const s = await S.api('/api/admin/summary');
    const on = s.loader.killswitch;
    const ok = await S.confirm(
      on ? 'Выключить kill switch?' : 'Включить kill switch?',
      on
        ? 'Лоадеры снова смогут проходить рукопожатие и авторизацию.'
        : 'Все активные сессии будут разорваны сразу, новые рукопожатия отклоняются. Используйте при утечке сборки или атаке.',
      { okText: on ? 'Выключить' : 'Включить', danger: !on }
    );
    if (!ok) return;
    const r = await post('/api/admin/loader/killswitch', { enabled: !on });
    S.toast('ok', r.message);
    loaderSec.render();
  }

  /* ============================================================== HWID == */

  const hwidSec = {
    title: 'HWID',
    async render() {
      setTitle('HWID', 'hwid');
      setTools(can('hwid.blacklist') ? '<button class="btn btn-danger btn-sm" id="addBlack">' + svg('plus') + ' В чёрный список</button>' : '');
      const add = document.getElementById('addBlack');
      if (add) add.addEventListener('click', addBlacklist);

      spinner();
      const [bl, lics] = await Promise.all([
        S.api('/api/admin/hwid/blacklist'),
        can('licenses.view') ? S.api('/api/admin/licenses?per_page=50&search=') : Promise.resolve({ licenses: [] })
      ]);

      host.innerHTML =
        '<div class="panel ticks" style="margin-bottom:18px"><div class="panel-hd"><h3>Чёрный список устройств</h3>' +
          '<div class="sub">' + bl.entries.length + ' записей · лицензии с таким HWID отзываются автоматически</div></div>' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>HWID</th><th>Причина</th><th>Добавлен</th><th></th></tr></thead><tbody>' +
          (bl.entries.length ? bl.entries.map((e) =>
            '<tr><td class="mono" style="font-size:11.6px">' + esc(e.hwid) + '<button class="btn btn-quiet btn-icon" style="width:24px;height:24px;margin-left:6px" data-copy="' + esc(e.hwid) + '">' + svg('copy') + '</button></td>' +
            '<td>' + esc(e.reason || '—') + '</td><td class="dim" style="font-size:12px">' + date(e.created_at) + '</td>' +
            '<td class="actions">' + (can('hwid.blacklist') ? '<button class="btn btn-quiet btn-sm" data-unblack="' + esc(e.hwid) + '">' + svg('x') + '</button>' : '') + '</td></tr>').join('')
            : '<tr><td colspan="4" class="table-empty">Список пуст</td></tr>') +
          '</tbody></table></div></div>' +

        '<div class="panel ticks"><div class="panel-hd"><h3>Привязанные устройства</h3><div class="sub">последние лицензии</div></div>' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>Ключ</th><th>Владелец</th><th>HWID</th><th>Метка</th><th>Привязан</th><th>Сбросов</th><th></th></tr></thead><tbody>' +
          (lics.licenses.length ? lics.licenses.filter((l) => l.hwid).map((l) =>
            '<tr><td class="mono">' + esc(l.license_key) + '</td><td>' + esc(l.username || '—') + '</td>' +
            '<td class="mono dim" style="font-size:11.4px">' + esc(String(l.hwid).slice(0, 22)) + '…</td>' +
            '<td>' + esc(l.hwid_label || '—') + '</td><td class="dim" style="font-size:12px">' + (l.hwid_bound_at ? date(l.hwid_bound_at) : '—') + '</td>' +
            '<td class="mono">' + l.hwid_resets_left + '</td>' +
            '<td class="actions">' +
              (can('hwid.reset') ? '<button class="btn btn-quiet btn-sm" data-reset="' + l.id + '" title="Сбросить">' + svg('refresh') + '</button>' : '') +
              (can('hwid.blacklist') ? '<button class="btn btn-danger btn-sm" data-ban="' + esc(l.hwid) + '" title="В чёрный список">' + svg('ban') + '</button>' : '') +
            '</td></tr>').join('') : '<tr><td colspan="7" class="table-empty">Привязок пока нет</td></tr>') +
          '</tbody></table></div></div>';

      bindCopy(host);
      host.querySelectorAll('[data-reset]').forEach(function (b) {
        b.addEventListener('click', async function () {
          const ok = await S.confirm('Сбросить HWID?', 'Привязка будет снята принудительно, сессии лоадера закроются.', { okText: 'Сбросить', danger: true });
          if (!ok) return;
          await post('/api/admin/licenses/' + b.dataset.reset + '/hwid-reset', { force: true });
          S.toast('ok', 'HWID сброшен');
          hwidSec.render();
        });
      });
      host.querySelectorAll('[data-ban]').forEach(function (b) {
        b.addEventListener('click', async function () {
          const ok = await S.confirm('Заблокировать устройство?', 'Все лицензии с этим HWID будут отозваны, вход с такого железа закроется навсегда.', { okText: 'Заблокировать', danger: true });
          if (!ok) return;
          const r = await post('/api/admin/hwid/blacklist', { hwid: b.dataset.ban, reason: 'manual' });
          S.toast('ok', 'Устройство заблокировано', r.message);
          hwidSec.render();
        });
      });
      host.querySelectorAll('[data-unblack]').forEach(function (b) {
        b.addEventListener('click', async function () {
          await post('/api/admin/hwid/blacklist/remove', { hwid: b.dataset.unblack });
          S.toast('ok', 'Удалено из чёрного списка');
          hwidSec.render();
        });
      });
    }
  };

  async function addBlacklist() {
    const body = document.createElement('div');
    body.innerHTML = '<div class="field"><label class="label">HWID</label><input class="input input-mono" id="bHwid" placeholder="64 hex символа"></div>' +
      '<div class="field"><label class="label">Причина</label><input class="input" id="bReason" placeholder="слив ключа, шаринг, чист"></div>' +
      '<p class="hint">Все действующие лицензии с этим отпечатком будут отозваны, а их сессии лоадера закрыты.</p>';
    const ok = await S.modal({ title: 'HWID в чёрный список', body: body, okText: 'Заблокировать', danger: true });
    if (!ok) return;
    try {
      const r = await post('/api/admin/hwid/blacklist', { hwid: body.querySelector('#bHwid').value.trim(), reason: body.querySelector('#bReason').value.trim() });
      S.toast('ok', 'Добавлено', r.message);
      hwidSec.render();
    } catch (err) { S.toast('err', 'Ошибка', err.message); }
  }

  /* =========================================================== CONTENT == */

  const content = {
    title: 'Контент',
    async render() {
      setTitle('Контент', 'content');
      setTools(can('content.posts') ? '<button class="btn btn-primary btn-sm" id="addPost">' + svg('plus') + ' Новая запись</button>' : '');
      const add = document.getElementById('addPost');
      if (add) add.addEventListener('click', function () { editPost(null); });

      spinner();
      const r = await S.api('/api/admin/posts');
      host.innerHTML = '<div class="panel ticks"><div class="panel-hd"><h3>Новости и журнал изменений</h3><div class="sub">показываются на сайте и в кабинете</div></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Заголовок</th><th>Тег</th><th>Slug</th><th>Дата</th><th></th></tr></thead><tbody>' +
        (r.posts.length ? r.posts.map((p) =>
          '<tr><td><b>' + esc(p.title) + '</b><div class="dim" style="font-size:12px;max-width:52ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.body) + '</div></td>' +
          '<td><span class="chip chip-info">' + esc(p.tag) + '</span></td>' +
          '<td class="mono dim">' + esc(p.slug) + '</td>' +
          '<td class="dim" style="font-size:12px">' + date(p.created_at) + '</td>' +
          '<td class="actions"><button class="btn btn-quiet btn-sm" data-edit="' + p.id + '">' + svg('edit') + '</button>' +
          '<button class="btn btn-danger btn-sm" data-del="' + p.id + '">' + svg('trash') + '</button></td></tr>').join('')
          : '<tr><td colspan="5" class="table-empty">Записей нет</td></tr>') +
        '</tbody></table></div></div>';

      host.querySelectorAll('[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () { editPost(r.posts.find((p) => String(p.id) === b.dataset.edit)); });
      });
      host.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', async function () {
          const ok = await S.confirm('Удалить запись?', 'Она исчезнет с сайта и из журнала обновлений.', { okText: 'Удалить', danger: true });
          if (!ok) return;
          await post('/api/admin/posts/' + b.dataset.del + '/delete');
          S.toast('ok', 'Удалено');
          content.render();
        });
      });
    }
  };

  async function editPost(p) {
    const body = document.createElement('div');
    body.innerHTML =
      '<div class="field"><label class="label">Заголовок</label><input class="input" id="pTitle" value="' + esc(p ? p.title : '') + '"></div>' +
      '<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="field"><label class="label">Тег</label><input class="input" id="pTag" value="' + esc(p ? p.tag : 'update') + '" placeholder="update / release / policy"></div>' +
        '<div class="field"><label class="label">Slug</label><input class="input input-mono" id="pSlug" value="' + esc(p ? p.slug : '') + '" placeholder="loader-1-0-5"></div>' +
      '</div>' +
      '<div class="field"><label class="label">Текст</label><textarea class="textarea" id="pBody" rows="6">' + esc(p ? p.body : '') + '</textarea></div>';
    const ok = await S.modal({ title: p ? 'Редактировать запись' : 'Новая запись', body: body, okText: 'Сохранить', onMount: function (b) { b.style.maxWidth = '640px'; } });
    if (!ok) return;
    try {
      await post('/api/admin/posts', {
        title: body.querySelector('#pTitle').value.trim(),
        tag: body.querySelector('#pTag').value.trim(),
        slug: body.querySelector('#pSlug').value.trim(),
        body: body.querySelector('#pBody').value.trim()
      });
      S.toast('ok', 'Сохранено');
      content.render();
    } catch (err) { S.toast('err', 'Ошибка', err.message); }
  }

  /* ========================================================== SETTINGS == */

  const settings = {
    title: 'Настройки',
    async render() {
      setTitle('Настройки', 'settings');
      setTools('');
      spinner();
      const r = await S.api('/api/admin/settings');
      const s = r.settings;
      const summary = await S.api('/api/admin/summary');

      const field = (key, label, hint, type) =>
        '<div class="field"><label class="label">' + esc(label) + '</label>' +
        (type === 'textarea'
          ? '<textarea class="textarea" data-k="' + key + '" rows="3">' + esc(s[key] || '') + '</textarea>'
          : '<input class="input' + (key.includes('secret') || key.includes('key_') ? ' input-mono' : '') + '" data-k="' + key + '" value="' + esc(s[key] || '') + '"' + (type === 'password' ? ' type="password"' : '') + '>') +
        (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';

      host.innerHTML =
        '<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:18px" class="dashAdmGrid">' +
          '<div class="panel ticks"><div class="panel-hd"><h3>Сайт</h3><div class="sub">название, статус, контакты</div></div><div class="panel-bd">' +
            field('site.title', 'Название', 'Показывается в шапке и title страниц') +
            field('site.tagline', 'Подпись', 'Мелкая строка под логотипом') +
            '<div class="field"><label class="label">Режим работы</label><select class="select" data-k="site.status">' +
              ['online', 'maintenance', 'detected'].map((v) => '<option value="' + v + '"' + (s['site.status'] === v ? ' selected' : '') + '>' + v + '</option>').join('') +
            '</select><div class="hint">maintenance закрывает сайт для всех, кроме сотрудников</div></div>' +
            field('site.status_text', 'Текст статуса', 'Виден в шапке и на странице статуса') +
            field('site.announcement', 'Объявление', 'Полоса над тарифами, пусто = не показывать', 'textarea') +
            field('maintenance.message', 'Сообщение техработ', 'Показывается вместо сайта') +
          '</div></div>' +

          '<div class="panel ticks"><div class="panel-hd"><h3>Лицензии и биллинг</h3></div><div class="panel-bd">' +
            '<div class="field"><label class="label">Начало отсчёта</label><select class="select" data-k="license.activation_mode">' +
              '<option value="on_first_login"' + (s['license.activation_mode'] === 'on_first_login' ? ' selected' : '') + '>С первого запуска лоадера</option>' +
              '<option value="on_purchase"' + (s['license.activation_mode'] === 'on_purchase' ? ' selected' : '') + '>С момента покупки</option>' +
            '</select><div class="hint">30/90/180 дней считаются от выбранной точки</div></div>' +
            '<div class="field"><label class="label">Повторная покупка того же тарифа</label><select class="select" data-k="billing.stack_purchases">' +
              '<option value="extend"' + (s['billing.stack_purchases'] === 'extend' ? ' selected' : '') + '>Добавлять дни к остатку</option>' +
              '<option value="new"' + (s['billing.stack_purchases'] === 'new' ? ' selected' : '') + '>Создавать новый ключ</option>' +
            '</select></div>' +
            '<div class="field"><label class="label">Регистрация</label><select class="select" data-k="signup.enabled">' +
              '<option value="1"' + (String(s['signup.enabled']) === '1' ? ' selected' : '') + '>Открыта</option>' +
              '<option value="0"' + (String(s['signup.enabled']) === '0' ? ' selected' : '') + '>Закрыта</option>' +
            '</select></div>' +
            '<div class="field"><label class="label">Выдача сборок</label><select class="select" data-k="loader.download_enabled">' +
              '<option value="1"' + (String(s['loader.download_enabled']) === '1' ? ' selected' : '') + '>Включена</option>' +
              '<option value="0"' + (String(s['loader.download_enabled']) === '0' ? ' selected' : '') + '>Отключена</option>' +
            '</select></div>' +
            '<div class="divider"></div>' +
            '<div class="label">Контакты</div>' +
            field('site.support', 'Почта поддержки') +
            field('site.discord', 'Ссылка на Discord') +
            field('site.telegram', 'Ссылка на Telegram') +
          '</div></div>' +

          '<div class="panel ticks"><div class="panel-hd"><h3>Платёжные шлюзы</h3><div class="sub">значения из базы перекрывают .env</div></div><div class="panel-bd">' +
            '<div class="label">Lava.ru</div>' +
            field('payment.lava.project_id', 'Project ID') +
            field('payment.lava.secret_key', 'Secret key', 'Заполните, чтобы способ стал активным', 'password') +
            '<div class="divider"></div>' +
            '<div class="label">ЮKassa</div>' +
            field('payment.yookassa.shop_id', 'shopId') +
            field('payment.yookassa.secret_key', 'Секретный ключ', '', 'password') +
            '<div class="divider"></div>' +
            '<div class="label">ENOT.io</div>' +
            field('payment.enot.project_id', 'merchant_id') +
            field('payment.enot.wallet', 'Кошелёк') +
            field('payment.enot.secret_key_1', 'Secret key 1', 'подпись создания счёта', 'password') +
            field('payment.enot.secret_key_2', 'Secret key 2', 'подпись вебхука', 'password') +
            '<div class="divider"></div>' +
            '<div class="row" style="gap:8px;flex-wrap:wrap">' +
              summary.system.payment_methods.map((m) => '<span class="chip ' + (m.ready || !m.requiresSetup ? 'chip-ok' : 'chip-mute') + '">' + esc(m.label) + ' · ' + (m.ready || !m.requiresSetup ? 'готов' : 'не настроен') + '</span>').join('') +
            '</div>' +
          '</div></div>' +

          '<div class="panel ticks"><div class="panel-hd"><h3>Опасная зона</h3></div><div class="panel-bd">' +
            '<div class="kv" style="margin-bottom:16px">' +
              '<dt>Kill switch</dt><dd>' + (summary.loader.killswitch ? '<span class="chip chip-err">включён</span>' : '<span class="chip chip-ok">выключен</span>') + '</dd>' +
              '<dt>Актуальная сборка</dt><dd class="mono">' + esc(summary.loader.latest_version) + '</dd>' +
              '<dt>Минимальная сборка</dt><dd class="mono">' + esc(summary.loader.min_version) + '</dd>' +
              '<dt>Онлайн лоадеров</dt><dd class="mono">' + summary.loader.online + '</dd>' +
            '</div>' +
            '<div class="row" style="gap:8px;flex-wrap:wrap">' +
              (can('loader.killswitch') ? '<button class="btn btn-danger btn-sm" id="sKill">' + svg('power') + ' ' + (summary.loader.killswitch ? 'Выключить kill switch' : 'Включить kill switch') + '</button>' : '') +
              (can('system.stats') ? '<button class="btn btn-ghost btn-sm" id="sSweep">' + svg('refresh') + ' Пересчитать истёкшие</button>' : '') +
            '</div>' +
            '<p class="hint" style="margin-top:14px">Пароль панели задаётся переменной окружения ADMIN_GATE_PASSWORD и не отображается здесь.</p>' +
          '</div></div>' +
        '</div>' +

        '<div class="row" style="gap:10px;margin-top:20px;position:sticky;bottom:0;padding:14px 0;background:linear-gradient(0deg,rgba(4,7,14,.95),transparent)">' +
          '<button class="btn btn-primary" id="saveSettings">' + svg('check') + ' Сохранить настройки</button>' +
          '<button class="btn btn-ghost" id="resetSettings">' + svg('refresh') + ' Отменить изменения</button>' +
        '</div>';

      document.getElementById('saveSettings').addEventListener('click', async function () {
        const payload = {};
        host.querySelectorAll('[data-k]').forEach(function (el) { payload[el.dataset.k] = el.value; });
        try {
          const res = await post('/api/admin/settings', payload);
          S.toast('ok', 'Сохранено', 'Изменено полей: ' + res.changed.length);
          settings.render();
        } catch (err) { S.toast('err', 'Ошибка', err.message); }
      });
      document.getElementById('resetSettings').addEventListener('click', function () { settings.render(); });

      const sk = document.getElementById('sKill');
      if (sk) sk.addEventListener('click', toggleKill);
      const ss = document.getElementById('sSweep');
      if (ss) ss.addEventListener('click', async function () {
        const res = await post('/api/admin/sweep');
        S.toast('ok', 'Готово', 'Истекло лицензий: ' + res.expired_licenses);
      });
    }
  };

  /* ============================================================= AUDIT == */

  const auditState = { limit: 120, action: '' };
  const auditSec = {
    title: 'Журнал событий',
    async render() {
      setTitle('Журнал событий', 'audit');
      setTools(
        '<div class="search-box">' + svg('search') + '<input class="input" id="aSearch" placeholder="фильтр по действию, например loader." value="' + esc(auditState.action) + '"></div>' +
        '<button class="btn btn-ghost btn-sm" id="aReload">' + svg('refresh') + ' Обновить</button>'
      );
      const reload = async function () { spinner(); await auditSec.render(); };
      document.getElementById('aSearch').addEventListener('input', debounce(function (e) { auditState.action = e.target.value.trim(); reload(); }, 380));
      document.getElementById('aReload').addEventListener('click', reload);

      spinner();
      const q = new URLSearchParams({ limit: auditState.limit, action: auditState.action });
      const r = await S.api('/api/admin/audit?' + q);

      const kindOf = (a) => a.indexOf('failed') >= 0 || a.indexOf('error') >= 0 || a.indexOf('denied') >= 0 || a.indexOf('revoked') >= 0 || a.indexOf('mismatch') >= 0 || a.indexOf('invalid') >= 0
        ? 'chip-err' : (a.indexOf('expired') >= 0 || a.indexOf('blocked') >= 0 ? 'chip-warn' : 'chip-ok');

      host.innerHTML = '<div class="panel ticks"><div class="panel-hd"><h3>Журнал</h3><div class="sub">' + r.total + ' записей · показано ' + r.entries.length + '</div></div>' +
        '<div class="panel-bd" style="padding:6px 10px;max-height:70vh;overflow:auto">' +
        (r.entries.length ? r.entries.map((e) =>
          '<div class="log-line" style="grid-template-columns:130px 210px 1fr auto">' +
            '<span class="t">' + date(e.created_at) + '</span>' +
            '<span><span class="chip ' + kindOf(e.action) + ' chip-mono" style="font-size:10.4px">' + esc(e.action) + '</span></span>' +
            '<span class="m">' + esc(e.actor_type) + (e.actor_name ? ' · ' + esc(e.actor_name) : (e.actor_id ? ' #' + esc(e.actor_id) : '')) +
              (e.target_type ? ' → ' + esc(e.target_type) + ' ' + esc(e.target_id || '') : '') +
              (e.meta ? ' <span class="mono" style="opacity:.65">' + esc(JSON.stringify(e.meta).slice(0, 120)) + '</span>' : '') + '</span>' +
            '<span class="mono dim" style="font-size:11px">' + esc(e.ip || '') + '</span>' +
          '</div>').join('') : '<div class="empty">Записей нет</div>') +
        '</div></div>';
    }
  };

  /* ============================================================ ROUTER == */

  const ROUTES = {
    dashboard: { perm: 'system.stats', sec: dashboard },
    users: { perm: 'users.view', sec: users },
    licenses: { perm: 'licenses.view', sec: licenses },
    orders: { perm: 'orders.view', sec: ordersSec },
    coupons: { perm: 'coupons.manage', sec: coupons },
    loader: { perm: 'loader.view', sec: loaderSec },
    hwid: { perm: 'hwid.view', sec: hwidSec },
    content: { perm: 'content.posts', sec: content },
    settings: { perm: 'content.settings', sec: settings },
    audit: { perm: 'audit.view', sec: auditSec }
  };

  // hide nav items the user has no right for
  navEl.querySelectorAll('a[data-perm]').forEach(function (a) {
    if (!can(a.dataset.perm)) a.remove();
  });
  navEl.querySelectorAll('.grp').forEach(function (g) {
    let visible = 0;
    let n = g.nextElementSibling;
    while (n && !n.classList.contains('grp')) {
      if (n.tagName === 'A') visible += 1;
      n = n.nextElementSibling;
    }
    if (!visible) g.remove();
  });

  function firstAvailable() {
    const keys = Object.keys(ROUTES);
    const hash = (location.hash || '').replace('#', '');
    if (ROUTES[hash] && can(ROUTES[hash].perm)) return hash;
    for (const k of keys) if (can(ROUTES[k].perm)) return k;
    return null;
  }

  async function route() {
    const key = firstAvailable();
    if (!key) {
      setTitle('Нет доступа', 'admin');
      setTools('');
      host.innerHTML = '<div class="panel ticks empty">' + svg('ban') + '<h4>Недостаточно прав</h4>' +
        '<p>Вашему аккаунту не выдано ни одного права панели. Попросите владельца добавить нужные разделы.</p></div>';
      return;
    }
    navEl.querySelectorAll('a[data-sec]').forEach(function (a) { a.classList.toggle('active', a.dataset.sec === key); });
    try {
      await ROUTES[key].sec.render();
    } catch (err) {
      host.innerHTML = '<div class="panel ticks empty">' + svg('alert') + '<h4>Не удалось загрузить раздел</h4><p>' + esc(err.message) + '</p></div>';
      if (err.status === 401 || err.status === 403) {
        S.toast('err', 'Требуется пароль панели', err.message);
        setTimeout(function () { location.href = '/admin/login'; }, 1200);
      }
    }
  }

  window.addEventListener('hashchange', route);
  navEl.querySelectorAll('a[data-sec]').forEach(function (a) {
    a.addEventListener('click', function () { setTimeout(route, 20); });
  });

  const gateExit = document.getElementById('gateExit');
  if (gateExit) {
    gateExit.addEventListener('click', async function () {
      const ok = await S.confirm('Закрыть панель?', 'Потребуется снова ввести пароль администратора.', { okText: 'Закрыть панель' });
      if (!ok) return;
      await post('/api/admin/gate/exit');
      location.href = '/dashboard';
    });
  }

  route();
})();
