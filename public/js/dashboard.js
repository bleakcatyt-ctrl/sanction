/* Personal dashboard: tabs, credentials, HWID, downloads, orders, profile. */
(function () {
  'use strict';
  const S = window.SNC;

  const revealed = {};   // licenseId -> password
  let overviewLicenseId = null;

  /* ------------------------------------------------------------- tabs --- */

  const navLinks = Array.prototype.slice.call(document.querySelectorAll('#dashNav a[data-tab]'));

  function activate(tab) {
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.add('active');
    navLinks.forEach(function (a) { a.classList.toggle('active', a.dataset.tab === tab); });
  }

  function tabFromHash() {
    const h = (location.hash || '').replace('#', '');
    return ['overview', 'license', 'orders', 'notifications', 'settings'].indexOf(h) >= 0 ? h : 'overview';
  }

  window.addEventListener('hashchange', function () { activate(tabFromHash()); });
  navLinks.forEach(function (a) {
    a.addEventListener('click', function () { setTimeout(function () { activate(tabFromHash()); }, 10); });
  });
  document.querySelectorAll('[data-goto-tab]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      location.hash = '#' + el.dataset.gotoTab;
      activate(el.dataset.gotoTab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  activate(tabFromHash());

  /* ------------------------------------------------------ credentials --- */

  async function fetchPassword(id) {
    if (revealed[id]) return revealed[id];
    const data = await S.api('/api/me/licenses/' + id + '/reveal', { method: 'POST', body: {} });
    revealed[id] = data.loader.password;
    return revealed[id];
  }

  function paintPassword(id) {
    const value = revealed[id];
    document.querySelectorAll('[data-pass-for="' + id + '"]').forEach(function (el) {
      el.textContent = value;
      el.classList.remove('masked');
    });
  }

  document.querySelectorAll('[data-reveal]').forEach(function (btn) {
    const id = btn.dataset.reveal;
    let shown = false;
    const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/></svg>';
    const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A9.8 9.8 0 0112 5c6 0 9.4 6.1 9.4 6.1a17 17 0 01-2.7 3.7M6.3 6.6A16.6 16.6 0 002.6 11.1S6 17.2 12 17.2a9.5 9.5 0 003.6-.7"/><path d="M10.1 10.2a2.8 2.8 0 003.9 3.9"/><path d="M3.4 3.4l17.2 17.2"/></svg>';

    function setFields(value) {
      document.querySelectorAll('[data-pass-for="' + id + '"]').forEach(function (el) {
        el.textContent = value;
        el.classList.toggle('masked', value === null);
      });
    }

    btn.addEventListener('click', async function () {
      if (shown) {
        shown = false;
        setFields('••••••••••••');
        btn.innerHTML = EYE + ' Показать';
        return;
      }
      S.loading(btn, true);
      try {
        const pw = await fetchPassword(id);
        shown = true;
        setFields(pw);
        btn.innerHTML = EYE_OFF + ' Скрыть';
      } catch (err) {
        S.toast('err', 'Не удалось показать пароль', err.message);
      } finally {
        S.loading(btn, false);
      }
    });
  });

  document.querySelectorAll('[data-copy-pass]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        const pw = await fetchPassword(btn.dataset.copyPass);
        const ok = await S.copy(pw);
        S.toast(ok ? 'ok' : 'err', ok ? 'Пароль скопирован' : 'Не удалось скопировать', ok ? 'Вставьте его в поле пароля лоадера.' : '');
      } catch (err) {
        S.toast('err', 'Ошибка', err.message);
      }
    });
  });

  // overview card
  const ovLogin = document.getElementById('ovLogin');
  const ovReveal = document.getElementById('ovReveal');
  const ovPass = document.getElementById('ovPass');
  const ovCopy = document.getElementById('ovCopyPass');
  if (ovPass) overviewLicenseId = ovPass.dataset.license;

  if (ovReveal && overviewLicenseId) {
    ovReveal.addEventListener('click', async function () {
      try {
        const pw = await fetchPassword(overviewLicenseId);
        if (ovPass.classList.contains('masked')) {
          ovPass.textContent = pw;
          ovPass.classList.remove('masked');
          ovReveal.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A9.8 9.8 0 0112 5c6 0 9.4 6.1 9.4 6.1a17 17 0 01-2.7 3.7M6.3 6.6A16.6 16.6 0 002.6 11.1S6 17.2 12 17.2a9.5 9.5 0 003.6-.7"/><path d="M10.1 10.2a2.8 2.8 0 003.9 3.9"/><path d="M3.4 3.4l17.2 17.2"/></svg> Скрыть';
        } else {
          ovPass.textContent = '••••••••••••';
          ovPass.classList.add('masked');
          ovReveal.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/></svg> Показать';
        }
        S.bind(document);
      } catch (err) {
        S.toast('err', 'Не удалось показать пароль', err.message);
      }
    });
  }
  if (ovCopy && overviewLicenseId) {
    ovCopy.addEventListener('click', async function () {
      try {
        const pw = await fetchPassword(overviewLicenseId);
        const ok = await S.copy(pw);
        S.toast(ok ? 'ok' : 'err', ok ? 'Пароль скопирован' : 'Не удалось скопировать');
      } catch (err) { S.toast('err', 'Ошибка', err.message); }
    });
  }

  /* --------------------------------------------------------- downloads -- */

  async function download(licenseId, btn) {
    if (btn) S.loading(btn, true);
    try {
      const data = await S.api('/api/me/licenses/' + licenseId + '/download', { method: 'POST', body: {} });
      S.toast('ok', 'Ссылка готова', 'Загрузка ' + data.file_name + ' начнётся автоматически.');
      const a = document.createElement('a');
      a.href = data.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      S.toast('err', 'Загрузка недоступна', err.message);
    } finally {
      if (btn) S.loading(btn, false);
    }
  }

  document.querySelectorAll('[data-download]').forEach(function (btn) {
    btn.addEventListener('click', function () { download(btn.dataset.download, btn); });
  });
  const dlBtn = document.getElementById('dlBtn');
  if (dlBtn) dlBtn.addEventListener('click', function () { download(dlBtn.dataset.license, dlBtn); });

  /* --------------------------------------------------------- hwid reset - */

  document.querySelectorAll('[data-hwid-reset]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const ok = await S.confirm(
        'Сбросить привязку HWID?',
        'Текущее устройство будет отвязано, а активная сессия лоадера закрыта. Следующий вход привяжет новое железо и потратит один сброс. Действие необратимо.',
        { okText: 'Сбросить', danger: true }
      );
      if (!ok) return;
      S.loading(btn, true);
      try {
        const r = await S.api('/api/me/licenses/' + btn.dataset.hwidReset + '/hwid-reset', { method: 'POST', body: {} });
        S.toast('ok', 'HWID сброшен', r.message);
        setTimeout(function () { location.reload(); }, 900);
      } catch (err) {
        S.loading(btn, false);
        S.toast('err', 'Сброс не выполнен', err.message);
      }
    });
  });

  /* ------------------------------------------------------- cancel order - */

  document.querySelectorAll('[data-cancel-order]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const ok = await S.confirm('Отменить заказ?', 'Заказ ' + btn.dataset.cancelOrder + ' будет отменён. Оплатить его позже уже не получится.', { okText: 'Отменить заказ', danger: true });
      if (!ok) return;
      try {
        await S.api('/api/billing/orders/' + btn.dataset.cancelOrder + '/cancel', { method: 'POST', body: {} });
        S.toast('ok', 'Заказ отменён');
        setTimeout(function () { location.reload(); }, 800);
      } catch (err) {
        S.toast('err', 'Ошибка', err.message);
      }
    });
  });

  /* ------------------------------------------------------- notifications */

  const markAll = document.getElementById('markAllRead');
  if (markAll) {
    markAll.addEventListener('click', async function () {
      try {
        await S.api('/api/me/notifications/read', { method: 'POST', body: {} });
        document.querySelectorAll('#notifList .notif.unread').forEach(function (n) { n.classList.remove('unread'); });
        const badge = document.querySelector('#dashNav .badge-n');
        if (badge) badge.remove();
        S.toast('ok', 'Все уведомления прочитаны');
      } catch (err) { S.toast('err', 'Ошибка', err.message); }
    });
  }

  /* ------------------------------------------------------------ profile - */

  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = profileForm.querySelector('button[type="submit"]');
      S.loading(btn, true);
      try {
        const r = await S.api('/api/me/profile', {
          method: 'PUT',
          body: { username: document.getElementById('pUsername').value.trim(), email: document.getElementById('pEmail').value.trim() }
        });
        S.user = r.user;
        S.toast('ok', 'Профиль обновлён');
        setTimeout(function () { location.reload(); }, 700);
      } catch (err) {
        S.loading(btn, false);
        const msg = err.data && err.data.field_errors ? err.data.field_errors.map(function (f) { return f.message; }).join(' · ') : err.message;
        S.toast('err', 'Не сохранено', msg);
      }
    });
  }

  const pwForm = document.getElementById('passwordForm');
  if (pwForm) {
    pwForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = pwForm.querySelector('button[type="submit"]');
      S.loading(btn, true);
      try {
        const r = await S.api('/api/auth/password', {
          method: 'POST',
          body: {
            current: document.getElementById('curPass').value,
            next: document.getElementById('newPass').value,
            next2: document.getElementById('newPass2').value
          }
        });
        S.toast('ok', 'Пароль изменён', r.message);
        pwForm.reset();
      } catch (err) {
        const msg = err.data && err.data.field_errors ? err.data.field_errors.map(function (f) { return f.message; }).join(' · ') : err.message;
        S.toast('err', 'Не получилось', msg);
      } finally {
        S.loading(btn, false);
      }
    });
  }

  const killBtn = document.getElementById('logoutEverywhere');
  if (killBtn) {
    killBtn.addEventListener('click', async function () {
      const ok = await S.confirm('Завершить другие сессии?', 'Текущая сессия останется активной, все остальные выйдут из аккаунта.', { okText: 'Завершить', danger: true });
      if (!ok) return;
      try {
        const r = await S.api('/api/me/sessions/kill', { method: 'POST', body: {} });
        S.toast('ok', r.message);
        loadSessions();
      } catch (err) { S.toast('err', 'Ошибка', err.message); }
    });
  }

  const logout2 = document.getElementById('logoutBtn2');
  if (logout2) {
    logout2.addEventListener('click', async function () {
      try { await S.api('/api/auth/logout', { method: 'POST', body: {} }); location.href = '/'; }
      catch (err) { S.toast('err', 'Ошибка выхода', err.message); }
    });
  }

  async function loadSessions() {
    const el = document.getElementById('sessCount');
    if (!el) return;
    try {
      const r = await S.api('/api/me/sessions');
      el.textContent = r.count;
    } catch { el.textContent = '—'; }
  }
  loadSessions();
})();
