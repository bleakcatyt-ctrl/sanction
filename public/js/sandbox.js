/* Sandbox payment page. */
(function () {
  'use strict';
  const S = window.SNC;

  async function confirmOrder(btn, status) {
    S.loading(btn, true);
    try {
      const r = await S.api('/api/payments/sandbox/' + btn.dataset.pid + '/confirm', {
        method: 'POST',
        body: { s: btn.dataset.sign, status: status }
      });
      S.toast('ok', status === 'failed' ? 'Отказ принят' : 'Оплата подтверждена', 'Переходим к результату…');
      setTimeout(function () { location.href = r.redirect || ('/checkout/result/' + btn.dataset.pid); }, 650);
    } catch (err) {
      S.loading(btn, false);
      S.toast('err', 'Не получилось', err.message);
    }
  }

  const ok = document.getElementById('confirmPay');
  if (ok) ok.addEventListener('click', function () { confirmOrder(ok, 'paid'); });

  const fail = document.getElementById('failPay');
  if (fail) fail.addEventListener('click', function () { confirmOrder(fail, 'failed'); });
})();
