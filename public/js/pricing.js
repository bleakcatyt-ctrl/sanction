/* Pricing + checkout. */
(function () {
  'use strict';
  const S = window.SNC;

  const selPlan = document.getElementById('selPlan');
  if (!selPlan) return;

  const sumPlan = document.getElementById('sumPlan');
  const sumDiscount = document.getElementById('sumDiscount');
  const sumDays = document.getElementById('sumDays');
  const sumTotal = document.getElementById('sumTotal');
  const couponInput = document.getElementById('coupon');
  const couponBtn = document.getElementById('couponBtn');
  const couponHint = document.getElementById('couponHint');
  const payBtn = document.getElementById('payBtn');

  const plans = {};
  document.querySelectorAll('#planGrid .plan').forEach(function (card) {
    plans[card.dataset.plan] = {
      code: card.dataset.plan,
      days: Number(card.dataset.days),
      price: Number(card.dataset.price),
      card: card
    };
  });

  let appliedCoupon = null;
  let quote = null;

  function money(minor) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(minor / 100) + ' ₽';
  }

  function selectPlan(code) {
    selPlan.value = code;
    Object.values(plans).forEach(function (p) {
      p.card.style.borderColor = p.code === code ? 'rgba(56,189,248,.45)' : '';
      p.card.style.boxShadow = p.code === code ? '0 0 0 1px rgba(56,189,248,.18), 0 26px 60px -34px rgba(56,189,248,.8)' : '';
    });
    refresh();
  }

  async function refresh() {
    const code = selPlan.value;
    const plan = plans[code];
    sumPlan.textContent = plan ? money(plan.price) : '—';
    sumDays.textContent = plan ? plan.days + ' дней' : '—';

    try {
      quote = await S.api('/api/billing/quote', { method: 'POST', body: { plan: code, coupon: appliedCoupon || couponInput.value.trim() || null } });
      sumDiscount.textContent = quote.discount ? '−' + money(quote.discount) : '—';
      sumTotal.textContent = money(quote.total);
      if (quote.coupon) {
        couponHint.innerHTML = '';
        const chip = document.createElement('span');
        chip.className = 'chip chip-ok';
        chip.textContent = 'Промокод ' + quote.coupon.code + ' применён';
        couponHint.appendChild(chip);
        appliedCoupon = quote.coupon.code;
      } else if (quote.coupon_error) {
        couponHint.textContent = 'Промокод не подошёл: ' + humanError(quote.coupon_error);
        couponHint.style.color = '#fda4af';
        appliedCoupon = null;
      } else {
        couponHint.textContent = 'Необязательно. Скидка применяется к любому тарифу или к конкретному.';
        couponHint.style.color = '';
      }
    } catch (err) {
      sumDiscount.textContent = '—';
      sumTotal.textContent = plan ? money(plan.price) : '—';
    }
  }

  function humanError(code) {
    return ({
      coupon_not_found: 'такого кода нет',
      coupon_expired: 'срок действия истёк',
      coupon_plan_mismatch: 'действует на другой тариф',
      coupon_exhausted: 'лимит использований исчерпан',
      coupon_used: 'вы уже использовали этот код'
    })[code] || code;
  }

  Object.values(plans).forEach(function (p) {
    p.card.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      selectPlan(p.code);
    });
    const btn = p.card.querySelector('[data-select]');
    if (btn) btn.addEventListener('click', function (e) { e.stopPropagation(); selectPlan(p.code); document.getElementById('checkoutCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  });

  selPlan.addEventListener('change', function () { selectPlan(selPlan.value); });
  couponBtn.addEventListener('click', refresh);
  couponInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); refresh(); } });

  payBtn.addEventListener('click', async function () {
    if (!S.user) {
      const go = await S.confirm('Нужен аккаунт', 'Чтобы оформить заказ, войдите или создайте аккаунт. Тариф и промокод сохранятся в ссылке.', { okText: 'Перейти к входу' });
      if (go) location.href = '/login?next=' + encodeURIComponent('/pricing#' + selPlan.value);
      return;
    }
    const method = (document.querySelector('input[name="method"]:checked') || {}).value;
    if (!method) { S.toast('warn', 'Выберите способ оплаты', ''); return; }

    S.loading(payBtn, true);
    try {
      const data = await S.api('/api/billing/checkout', {
        method: 'POST',
        body: { plan: selPlan.value, method: method, coupon: appliedCoupon || couponInput.value.trim() || null }
      });
      S.toast('ok', 'Заказ создан', 'Перенаправляем на страницу оплаты…');
      setTimeout(function () { location.href = data.redirect; }, 500);
    } catch (err) {
      S.loading(payBtn, false);
      S.toast('err', 'Не удалось создать заказ', err.message);
    }
  });

  // deep link: /pricing#SANCTION-90 or #p90
  const hash = location.hash.slice(1);
  let initial = null;
  if (plans[hash]) initial = hash;
  else {
    const byId = Object.values(plans).find(function (p) { return p.card.id === hash; });
    if (byId) initial = byId.code;
  }
  selectPlan(initial || selPlan.value);
})();
