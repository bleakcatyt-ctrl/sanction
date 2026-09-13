/* ============================================================
   SANCTION — shared front-end core
   No frameworks, no build step. Everything is plain DOM.
   ============================================================ */
(function () {
  'use strict';

  const S = (window.SNC = window.SNC || { csrf: '', user: null });

  /* ------------------------------------------------------------ toasts --- */

  const ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6l4.8 4.8L19.5 7.2"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.2L2.9 19.4h18.2L12 4.2z"/><path d="M12 10v3.6"/><circle cx="12" cy="16.6" r=".8" fill="currentColor" stroke="none"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><circle cx="12" cy="8.1" r=".8" fill="currentColor" stroke="none"/></svg>'
  };

  function toast(type, title, message, ttl) {
    let host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      host.className = 'toasts';
      document.body.appendChild(host);
    }
    const kind = ICONS[type] ? type : 'info';
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="ic">' + ICONS[kind] + '</div>' +
      '<div class="grow"><b></b>' + (message ? '<p></p>' : '') + '</div>';
    el.querySelector('b').textContent = title || '';
    if (message) el.querySelector('p').textContent = message;
    host.appendChild(el);

    const life = ttl || (kind === 'err' ? 6200 : 4200);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, life);
    el.addEventListener('click', function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 240); });
    return el;
  }

  /* --------------------------------------------------------------- api --- */

  /** Re-read the CSRF token for the live session (stale tab recovery). */
  async function refreshCsrf() {
    try {
      const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!res.ok) return false;
      const data = await res.json();
      if (data && data.csrf) { S.csrf = data.csrf; return true; }
    } catch { /* offline — let the caller surface the original error */ }
    return false;
  }

  async function api(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || 'GET',
      headers: Object.assign(
        { Accept: 'application/json' },
        opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        opts.headers || {},
        opts.method && opts.method !== 'GET' && S.csrf ? { 'X-CSRF-Token': S.csrf } : {}
      ),
      credentials: 'same-origin'
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

    let res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      throw Object.assign(new Error('Сеть недоступна. Проверьте соединение.'), { network: true });
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { ok: false, message: text.slice(0, 200) }; }
    }
    if (data && data.csrf) S.csrf = data.csrf;

    if (!res.ok) {
      // The page may carry a token that predates the current session (stale tab,
      // session recreated server side). Refresh it once and replay the request
      // instead of dead-ending the user with "Сессия устарела".
      if (res.status === 403 && data && data.error === 'csrf_failed' && !opts._retried) {
        if (await refreshCsrf()) return api(path, Object.assign({}, opts, { _retried: true }));
      }
      const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data || {};
      throw err;
    }
    return data || { ok: true };
  }

  /* ------------------------------------------------------------ buttons -- */

  function loading(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.prevHtml = btn.innerHTML;
      btn.classList.add('is-loading');
      btn.disabled = true;
      if (!btn.querySelector('.spin')) {
        const s = document.createElement('span');
        s.className = 'spin';
        btn.prepend(s);
      }
      if (label) btn.setAttribute('aria-label', label);
    } else {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      if (btn.dataset.prevHtml) btn.innerHTML = btn.dataset.prevHtml;
    }
  }

  /* --------------------------------------------------------------- modal - */

  function modal(opts) {
    return new Promise(function (resolve) {
      const o = opts || {};
      const back = document.createElement('div');
      back.className = 'modal-back open';
      const box = document.createElement('div');
      box.className = 'modal' + (o.wide ? ' wide' : '');
      box.innerHTML =
        '<div class="modal-hd"><h3></h3><button class="x" type="button" aria-label="Закрыть">' + ICONS.err + '</button></div>' +
        '<div class="modal-bd"></div>' +
        '<div class="modal-ft"></div>';
      box.querySelector('h3').textContent = o.title || '';
      const bd = box.querySelector('.modal-bd');
      if (typeof o.body === 'string') bd.innerHTML = o.body;
      else if (o.body) bd.appendChild(o.body);

      const ft = box.querySelector('.modal-ft');
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-ghost btn-sm';
      cancel.type = 'button';
      cancel.textContent = o.cancelText || 'Отмена';
      const ok = document.createElement('button');
      ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + ' btn-sm';
      ok.type = 'button';
      ok.textContent = o.okText || 'Подтвердить';
      if (o.cancelText !== null) ft.appendChild(cancel);
      ft.appendChild(ok);

      back.appendChild(box);
      document.body.appendChild(back);
      document.body.style.overflow = 'hidden';

      function close(value) {
        document.body.style.overflow = '';
        back.classList.remove('open');
        setTimeout(function () { back.remove(); }, 180);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter' && !o.noEnter) close(true);
      }
      back.addEventListener('mousedown', function (e) { if (e.target === back) close(false); });
      cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click', function () { close(o.returnValue === undefined ? true : o.returnValue); });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { const f = box.querySelector('input,select,textarea,button'); if (f) f.focus(); }, 60);
      o.onMount && o.onMount(box, close);
    });
  }

  function confirmDialog(title, message, opts) {
    const o = opts || {};
    return modal({
      title: title,
      body: '<p class="muted" style="font-size:13.6px;line-height:1.66">' + escapeHtml(message) + '</p>' +
        (o.extra || ''),
      okText: o.okText || 'Подтвердить',
      danger: !!o.danger
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* -------------------------------------------------------------- copy --- */

  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function bindCopyButtons(root) {
    (root || document).querySelectorAll('[data-copy]').forEach(function (el) {
      if (el.dataset.copyBound) return;
      el.dataset.copyBound = '1';
      el.addEventListener('click', async function () {
        const value = el.dataset.copyValue || (el.dataset.copyTarget ? (document.querySelector(el.dataset.copyTarget) || {}).textContent : '') || el.textContent;
        const ok = await copy(String(value).trim());
        toast(ok ? 'ok' : 'err', ok ? 'Скопировано' : 'Не удалось скопировать', ok ? String(value).trim().slice(0, 46) : 'Скопируйте значение вручную.');
      });
    });
  }

  /* ------------------------------------------------------------ reveal --- */

  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) { items.forEach(function (i) { i.classList.add('in'); }); return; }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    items.forEach(function (i) { io.observe(i); });
  }

  /* --------------------------------------------------------------- faq --- */

  function initFaq() {
    document.querySelectorAll('.faq-item').forEach(function (item) {
      const q = item.querySelector('.faq-q');
      const a = item.querySelector('.faq-a');
      if (!q || !a) return;
      q.addEventListener('click', function () {
        const open = item.classList.contains('open');
        item.parentElement.querySelectorAll('.faq-item.open').forEach(function (o) {
          o.classList.remove('open');
          const oa = o.querySelector('.faq-a');
          if (oa) oa.style.maxHeight = '0px';
        });
        if (!open) {
          item.classList.add('open');
          a.style.maxHeight = a.scrollHeight + 'px';
        }
      });
    });
    const target = location.hash.slice(1);
    if (target) {
      const el = document.getElementById(target);
      if (el && el.classList.contains('faq-item')) setTimeout(function () { el.querySelector('.faq-q').click(); }, 120);
    }
  }

  /* ---------------------------------------------------------- formatting - */

  function humanMs(ms) {
    if (ms == null) return '—';
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return d + 'д ' + h + 'ч ' + m + 'м';
    if (h > 0) return h + 'ч ' + m + 'м ' + s + 'с';
    if (m > 0) return m + 'м ' + s + 'с';
    return s + 'с';
  }

  function initCountdowns() {
    const els = document.querySelectorAll('[data-countdown]');
    if (!els.length) return;
    function tick() {
      els.forEach(function (el) {
        const target = Number(el.dataset.countdown);
        if (!target) return;
        const left = target - Date.now();
        el.textContent = left > 0 ? humanMs(left) : 'истекло';
        if (left <= 0) el.classList.add('dim');
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  /* -------------------------------------------------------------- chrome - */

  function initChrome() {
    const burger = document.getElementById('burger');
    const nav = document.getElementById('nav');
    if (burger && nav) {
      burger.addEventListener('click', function () {
        const open = nav.classList.toggle('open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    const logout = document.getElementById('logoutBtn');
    if (logout) {
      logout.addEventListener('click', async function () {
        loading(logout, true);
        try {
          await api('/api/auth/logout', { method: 'POST', body: {} });
          location.href = '/';
        } catch (err) {
          loading(logout, false);
          toast('err', 'Ошибка выхода', err.message);
        }
      });
    }

    // password visibility toggles
    document.querySelectorAll('.toggle-eye').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const sel = btn.dataset.target;
        const input = sel ? document.querySelector(sel) : btn.parentElement.querySelector('input');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.dataset.icon = show ? 'on' : 'off';
        btn.innerHTML = show
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.2A9.8 9.8 0 0112 5c6 0 9.4 6.1 9.4 6.1a17 17 0 01-2.7 3.7M6.3 6.6A16.6 16.6 0 002.6 11.1S6 17.2 12 17.2a9.5 9.5 0 003.6-.7"/><path d="M10.1 10.2a2.8 2.8 0 003.9 3.9"/><path d="M3.4 3.4l17.2 17.2"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/></svg>';
      });
    });

    bindCopyButtons();
  }

  /* --------------------------------------------------------------- init -- */

  function boot() {
    initChrome();
    initReveal();
    initFaq();
    initCountdowns();
    document.addEventListener('snc:bind', function (e) { bindCopyButtons(e.detail && e.detail.root); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* public surface */
  S.api = api;
  S.toast = toast;
  S.modal = modal;
  S.confirm = confirmDialog;
  S.loading = loading;
  S.copy = copy;
  S.esc = escapeHtml;
  S.humanMs = humanMs;
  S.bind = bindCopyButtons;
})();
