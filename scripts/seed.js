#!/usr/bin/env node
'use strict';

/**
 * npm run seed
 *
 * Idempotent: creates the schema, default settings, the admin gate hash, the
 * staff accounts (tiran / drake), the demo buyer and the news posts when they
 * are missing. Prints everything an operator needs for the first login.
 */

const path = require('node:path');
const fs = require('node:fs');

const config = require('../server/config');
const db = require('../server/db');
const seed = require('../server/lib/seed');
const util = require('../server/lib/util');
const orders = require('../server/lib/orders');
const permissions = require('../server/lib/permissions');

const { created } = seed.ensure();

const line = (k, v) => console.log('  ' + String(k).padEnd(22, ' ') + v);
const rule = '─'.repeat(60);

console.log('');
console.log('Sanction — seeding');
console.log(rule);
line('env', config.env);
line('data dir', config.dataDir);
line('database', config.dbFile);
line('public url', config.publicUrl);
line('listen', `${config.host}:${config.port}`);
line('created accounts', created.length ? created.join(', ') : 'none (already seeded)');

const staff = db.all(`SELECT * FROM users WHERE is_admin = 1 OR role IN ('admin','owner') ORDER BY id`);
line('staff', staff.map((u) => `${u.username} (${u.role}, ${permissions.effectiveFor(u).size}/${permissions.ALL_KEYS.length} прав)`).join(', ') || '—');

const note = path.join(config.dataDir, 'seed-credentials.txt');
if (fs.existsSync(note)) line('credentials file', note);

console.log('');
console.log('  Plans');
for (const p of config.plans) {
  line('', `${p.code.padEnd(15, ' ')} ${String(p.days).padStart(3, ' ')} дней   ${util.money(orders.minor(p.price))}`);
}

const coupons = db.all('SELECT code, kind, value, max_uses, used, expires_at, active FROM coupons ORDER BY id LIMIT 12');
if (coupons.length) {
  console.log('');
  console.log('  Coupons');
  for (const c of coupons) {
    const val = c.kind === 'percent' ? `-${c.value}%` : `-${util.money(c.value)}`;
    const state = !c.active ? 'выключен' : (c.expires_at && c.expires_at < Date.now() ? 'истёк' : 'активен');
    const uses = `${c.used}/${c.max_uses || '∞'}`;
    line('', `${c.code.padEnd(16, ' ')} ${val.padEnd(10, ' ')} ${uses.padEnd(7, ' ')} ${state}`);
  }
}

const counts = {
  users: db.pluck('SELECT COUNT(*) FROM users'),
  licenses: db.pluck('SELECT COUNT(*) FROM licenses'),
  orders: db.pluck('SELECT COUNT(*) FROM orders'),
  posts: db.pluck('SELECT COUNT(*) FROM posts')
};
console.log('');
console.log('  Database');
line('', Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('   '));

console.log('');
console.log('  Admin gate');
line('password', process.env.ADMIN_GATE_PASSWORD ? 'из ADMIN_GATE_PASSWORD' : 'из конфига (development)');
line('panel url', `${config.publicUrl}/admin`);
console.log('');
console.log('Готово. Запуск: npm start');
console.log(rule);
console.log('');

process.exit(0);
