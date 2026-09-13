/* Checkout result page: polling, download, cancel. */
(function () {
  'use strict';
  const S = window.SNC;

  /* ---------------------------------------------------------- download -- */
  document.querySelectorAll('[data-download]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      S.loading(btn, true);
      try {
        const data = await S.api('/api/me/licenses/' + btn.dataset.download + '/download', { method: 'POST', body: {} });
        S.toast('ok', 'Ссылка готова', 'Загрузка ' + data.file_name + ' начнётся автоматически.');
        const a = document.createElement('a');
        a.href = data.url;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        S.toast('err', 'Загрузка недоступна', err.message);
      } finally {
        S.loading(btn, false);
      }
    });
  });

  /* ------------------------------------------------------------ cancel -- */
  const cancel = document.getElementById('cancelHere');
  const polled = document.querySelector('[data-poll]');
  if (cancel && polled) {
    cancel.addEventListener('click', async function () {
      const ok = await S.confirm('Отменить заказ?', 'Заказ будет закрыт, оплатить его позже не получится.', { okText: 'Отменить', danger: true });
      if (!ok) return;
      try {
        await S.api('/api/billing/orders/' + polled.dataset.poll + '/cancel', { method: 'POST', body: {} });
        location.reload();
      } catch (err) { S.toast('err', 'Ошибка', err.message); }
    });
  }

  /* ----------------------------------------------------------- polling -- */
  if (!polled) return;
  const pid = polled.dataset.poll;
  let tries = 0;
  const timer = setInterval(async function () {
    tries += 1;
    if (tries > 200) { clearInterval(timer); return; }
    try {
      const r = await S.api('/api/billing/orders/' + pid);
      if (r.order.status === 'paid') {
        clearInterval(timer);
        S.toast('ok', 'Оплата подтверждена', 'Загружаем ваши данные…');
        setTimeout(function () { location.reload(); }, 700);
      } else if (['failed', 'cancelled', 'refunded', 'expired'].indexOf(r.order.status) >= 0) {
        clearInterval(timer);
        location.reload();
      }
    } catch { /* keep polling */ }
  }, 3000);
})();
