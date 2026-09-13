'use strict';

/**
 * Sandbox gateway — always available, used for local runs and CI.
 * Produces a checkout page on our own domain with a "confirm" button that
 * fires the very same provisioning path a real gateway webhook would.
 */

const config = require('../config');
const orders = require('../lib/orders');

const id = 'sandbox';

function available() {
  return config.payments.enabled.includes(id);
}

function describe() {
  return {
    id,
    label: 'Тестовая оплата',
    hint: 'Песочница для локальной проверки. Подтверждает заказ мгновенно.',
    icon: 'flask',
    fee: '0 %',
    requiresSetup: false,
    ready: true
  };
}

async function createCheckout({ order, user, returnUrl }) {
  return {
    paymentUrl: `${config.publicUrl}/checkout/sandbox/${order.public_id}`,
    gatewayPaymentId: `sbx_${order.public_id}`,
    meta: { sandbox: true, return_url: returnUrl }
  };
}

/**
 * Sandbox "webhook" is triggered from our own UI, so we build the event here.
 * Signature is the shared session secret over the order id — cheap but enough
 * to stop blind POSTs from provisioning random orders.
 */
function parseWebhook(req) {
  const body = req.body || {};
  const publicId = String(body.order_id || req.params.publicId || '');
  const order = orders.byPublicId(publicId);
  return {
    event: body.event || 'payment.succeeded',
    order,
    orderId: order ? order.id : null,
    publicId,
    status: body.status === 'failed' ? 'failed' : 'paid',
    gatewayPaymentId: body.gateway_payment_id || `sbx_${publicId}`,
    amount: order ? order.amount : Number(body.amount) || 0,
    currency: order ? order.currency : config.payments.currency,
    raw: body,
    // verified later in the route against the HMAC in the x-sandbox-sign header
    signatureValid: null
  };
}

module.exports = { id, available, describe, createCheckout, parseWebhook };
