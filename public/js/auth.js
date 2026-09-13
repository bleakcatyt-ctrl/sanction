/* Auth forms: login + register. */
(function () {
  'use strict';
  const S = window.SNC;

  function showErrors(host, list, fallback) {
    host.innerHTML = '';
    const items = Array.isArray(list) && list.length ? list : [{ message: fallback || 'Проверьте данные.' }];
    const box = document.createElement('div');
    box.className = 'err-text';
    box.style.marginTop = '12px';
    box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 8v4.6"/><circle cx="12" cy="15.8" r=".8" fill="currentColor" stroke="none"/></svg><span></span>';
    box.querySelector('span').textContent = items.map(function (i) { return i.message; }).join(' · ');
    host.appendChild(box);
    items.forEach(function (i) {
      if (!i.field) return;
      const el = document.querySelector('[name="' + i.field + '"], #' + i.field);
      if (el) el.classList.add('is-error');
    });
  }

  function clearErrors(host) {
    host.innerHTML = '';
    document.querySelectorAll('.is-error').forEach(function (el) { el.classList.remove('is-error'); });
  }

  /* ---------------------------------------------------------------- login */
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    const host = document.getElementById('formError');
    const btn = document.getElementById('submitBtn');
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearErrors(host);
      S.loading(btn, true);
      try {
        const data = await S.api('/api/auth/login', {
          method: 'POST',
          body: {
            login: document.getElementById('login').value.trim(),
            password: document.getElementById('password').value,
            next: loginForm.querySelector('[name="next"]').value
          }
        });
        S.toast('ok', 'Добро пожаловать', 'Перенаправляем в кабинет…');
        location.href = data.redirect || '/dashboard';
      } catch (err) {
        S.loading(btn, false);
        showErrors(host, err.data && err.data.field_errors, err.message);
        S.toast('err', 'Вход не выполнен', err.message);
        if (err.status === 423 || err.status === 429) btn.disabled = true;
      }
    });
  }

  /* ------------------------------------------------------------- register */
  const regForm = document.getElementById('registerForm');
  if (regForm) {
    const host = document.getElementById('formError');
    const btn = document.getElementById('submitBtn');
    const pw = document.getElementById('password');
    const meter = document.getElementById('pwMeter');
    const hint = document.getElementById('pwHint');

    function score(v) {
      let s = 0;
      if (v.length >= 8) s += 25;
      if (v.length >= 12) s += 15;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s += 20;
      if (/\d/.test(v)) s += 20;
      if (/[^A-Za-z0-9]/.test(v)) s += 20;
      return Math.min(100, s);
    }

    pw.addEventListener('input', function () {
      const s = score(pw.value);
      meter.style.width = s + '%';
      meter.style.background = s < 40 ? 'linear-gradient(90deg,#fb7185,#ef4444)' : (s < 70 ? 'linear-gradient(90deg,#fbbf24,#f97316)' : 'var(--grad)');
      hint.textContent = s < 40 ? 'Слабый пароль — добавьте длину и символы.' : (s < 70 ? 'Средний пароль. Ещё лучше — цифры и регистр.' : 'Надёжный пароль.');
    });

    regForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearErrors(host);
      if (!document.getElementById('terms').checked) {
        showErrors(host, [{ message: 'Нужно принять условия использования.' }]);
        return;
      }
      S.loading(btn, true);
      try {
        const data = await S.api('/api/auth/register', {
          method: 'POST',
          body: {
            username: document.getElementById('username').value.trim(),
            email: document.getElementById('email').value.trim(),
            password: pw.value,
            password2: document.getElementById('password2').value
          }
        });
        S.toast('ok', 'Аккаунт создан', 'Теперь выберите тариф — доступ выдаётся автоматически.');
        location.href = data.redirect || '/dashboard';
      } catch (err) {
        S.loading(btn, false);
        showErrors(host, err.data && err.data.field_errors, err.message);
      }
    });
  }
})();
