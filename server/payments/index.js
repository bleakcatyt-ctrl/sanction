'use strict';

/**
 * Payment gateway registry.
 *
 * Credentials resolve in this order:
 *   1. admin panel settings (table `settings`, key = payment.<gateway>.<field>)
 *   2. environment variables (.env)
 * So you can wire a real gateway without redeploying.
 */

const config = require('../config');
const db = require('../db');

const sandbox = require('./sandbox');
const lava = require('./lava');
const yookassa = require('./yookassa');
const enot = require('./enot');

const REGISTRY = { sandbox, lava, yookassa, enot };

const OVERRIDE_MAP = {
  lava: { projectId: 'payment.lava.project_id', secretKey: 'payment.lava.secret_key', apiUrl: 'payment.lava.api_url' },
  yookassa: { shopId: 'payment.yookassa.shop_id', secretKey: 'payment.yookassa.secret_key', apiUrl: 'payment.yookassa.api_url' },
  enot: {
    projectId: 'payment.enot.project_id', wallet: 'payment.enot.wallet',
    secretKey1: 'payment.enot.secret_key_1', secretKey2: 'payment.enot.secret_key_2', apiUrl: 'payment.enot.api_url'
  }
};

/** Pull admin-set credentials into the config singleton. */
function applyOverrides() {
  for (const [gateway, map] of Object.entries(OVERRIDE_MAP)) {
    for (const [field, key] of Object.entries(map)) {
      const v = db.setting(key, null);
      if (v !== null && String(v).length) config.payments[gateway][field] = v;
    }
  }
  const methods = db.setting('payments.enabled', null);
  if (methods) config.payments.enabled = methods.split(',').map((s) => s.trim()).filter(Boolean);
  const cur = db.setting('payments.currency', null);
  if (cur) config.payments.currency = cur;
}

function get(method) {
  const gw = REGISTRY[String(method || '').toLowerCase()];
  if (!gw) return null;
  return gw;
}

function list() {
  return Object.values(REGISTRY)
    .filter((gw) => config.payments.enabled.includes(gw.id))
    .map((gw) => gw.describe());
}

function listReady() {
  return list().filter((d) => d.ready || !d.requiresSetup);
}

async function createCheckout({ order, user, method, returnUrl, webhookUrl }) {
  const gw = get(method || order.method);
  if (!gw) throw Object.assign(new Error('unsupported_method'), { status: 400 });
  if (!gw.available()) throw Object.assign(new Error('method_not_configured'), { status: 409 });
  const result = await gw.createCheckout({ order, user, returnUrl, webhookUrl });
  if (!result || !result.paymentUrl) throw Object.assign(new Error('gateway_no_url'), { status: 502 });
  return result;
}

function webhookUrlFor(method) {
  return `${config.publicUrl}/api/payments/webhook/${method}`;
}

module.exports = { REGISTRY, get, list, listReady, createCheckout, applyOverrides, webhookUrlFor };
