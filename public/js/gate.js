/* Admin gate (second factor). */
(function () {
  'use strict';
  const S = window.SNC;
  const form = document.getElementById('gateForm');
  if (!form) return;

  const btn = document.getElementById('submitBtn');
  const host = document.getElementById('formError');
  const input = document.getElementById('gate');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    host.innerHTML = '';
    S.loading(btn, true);
    try {
      const r = await S.api('/api/admin/gate', { method: 'POST', body: { password: input.value } });
      S.toast('ok', 'Доступ разрешён', 'Открываем панель…');
      setTimeout(function () { location.href = r.redirect || '/admin'; }, 420);
    } catch (err) {
      S.loading(btn, false);
      const box = document.createElement('div');
      box.className = 'err-text';
      box.style.marginTop = '12px';
      box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 8v4.6"/><circle cx="12" cy="15.8" r=".8" fill="currentColor" stroke="none"/></svg><span></span>';
      box.querySelector('span').textContent = err.message;
      host.appendChild(box);
      input.classList.add('is-error');
      input.select();
      if (err.status === 429) btn.disabled = true;
    }
  });

  setTimeout(function () { input.focus(); }, 80);
})();
