'use strict';

/**
 * First-boot seeding: staff accounts, default settings, starter content.
 * Idempotent — safe to run on every start.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const users = require('./users');
const perms = require('./permissions');
const passwords = require('./passwords');
const audit = require('./audit');
const { now } = require('./util');

const DEFAULT_SETTINGS = {
  'site.title': config.brand.name,
  'site.tagline': config.brand.tagline,
  'site.status': 'online',                 // online | maintenance | detected
  'site.status_text': 'All systems operational',
  'site.announcement': '',
  'site.support': config.brand.support,
  'site.discord': config.brand.discord,
  'site.telegram': config.brand.telegram,
  'license.activation_mode': 'on_first_login', // on_first_login | on_purchase
  'billing.stack_purchases': 'extend',         // extend | new
  'payments.enabled': config.payments.enabled.join(','),
  'payments.currency': config.payments.currency,
  'loader.killswitch': '0',
  'loader.min_version': config.build.minVersion,
  'loader.latest_version': config.build.latestVersion,
  'loader.download_enabled': '1',
  'signup.enabled': '1',
  'maintenance.message': 'Технические работы. Вернёмся через несколько минут.'
};

const DEFAULT_POSTS = [
  {
    slug: 'sanction-launch',
    title: 'Sanction is live',
    tag: 'release',
    body: 'Платформа запущена: личный кабинет, выдача ключей, привязка HWID и лоадер с проверкой лицензии на сервере. Подписки 30 / 90 / 180 дней, продление складывается с остатком.'
  },
  {
    slug: 'loader-1-0-4',
    title: 'Loader 1.0.4',
    tag: 'update',
    body: 'Зашифрованный канал ECDH P-256 + AES-256-GCM, подпись лицензионного токена ECDSA, привязка к железу, heartbeat каждые 60 секунд и мгновенный отзыв сессии со стороны сервера.'
  },
  {
    slug: 'hwid-policy',
    title: 'HWID policy',
    tag: 'policy',
    body: 'Одна лицензия — одно устройство. Количество сбросов зависит от тарифа: 3 для 30 дней, 5 для 90 дней, 8 для 180. Между сбросами действует кулдаун 72 часа.'
  }
];

function setDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = db.setting(key, null);
    if (existing === null) db.setSetting(key, value);
  }
}

function refreshAdminGateHash() {
  const plain = config.security.adminGatePassword;
  const marker = `gate:${crypto.createHash('sha256').update(plain).digest('hex').slice(0, 16)}`;
  if (db.setting('admin_gate_marker', null) !== marker) {
    db.setSetting('admin_gate_hash', passwords.hashPassword(plain));
    db.setSetting('admin_gate_marker', marker);
  }
}

function verifyAdminGate(input) {
  const hash = db.setting('admin_gate_hash', null);
  if (!hash) return false;
  return passwords.verifyPassword(String(input ?? ''), hash);
}

function seedStaff() {
  const staffPassword = process.env.SEED_ADMIN_PASSWORD || 'Sanction!2026';
  const staff = [
    { username: 'tiran', email: 'tiran@sanction.local', role: 'owner' },
    { username: 'drake', email: 'drake@sanction.local', role: 'owner' }
  ];
  const created = [];

  for (const s of staff) {
    let user = users.byUsername(s.username);
    if (!user) {
      const res = db.run(
        `INSERT INTO users (username, email, password_hash, role, status, email_verified, is_admin, created_at, updated_at, avatar_seed)
         VALUES (?, ?, ?, ?, 'active', 1, 1, ?, ?, ?)`,
        s.username, s.email, passwords.hashPassword(staffPassword), s.role, now(), now(),
        crypto.createHash('sha256').update(s.username).digest('hex').slice(0, 12)
      );
      user = users.byId(res.id);
      created.push(user.username);
    }
    if (s.role === 'owner' && !perms.effectiveFor(user).size) {
      perms.replaceSet(user.id, perms.PRESETS.full, user.id);
    }
  }

  // Demo buyer so the purchase flow can be tested without registering first.
  if (!users.byUsername('demo')) {
    db.run(
      `INSERT INTO users (username, email, password_hash, role, status, email_verified, is_admin, created_at, updated_at, avatar_seed)
       VALUES ('demo', 'demo@sanction.local', ?, 'user', 'active', 1, 0, ?, ?, ?)`,
      passwords.hashPassword('Demo!2026'), now(), now(), crypto.randomBytes(6).toString('hex')
    );
    created.push('demo');
  }

  if (created.length) {
    audit.log('system', null, 'seed.staff_created', { meta: { users: created } });
    writeCredentialNote(staffPassword, created);
  }
  return created;
}

function writeCredentialNote(staffPassword, created) {
  const file = path.join(config.dataDir, 'seed-credentials.txt');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  const stamp = new Date().toISOString();
  text += `\n# ${stamp}\n`;
  text += `# Seeded accounts: ${created.join(', ')}\n`;
  if (created.includes('tiran') || created.includes('drake')) {
    text += `# Admin site password : ${staffPassword}\n`;
    text += `# Admin gate password : ${config.security.adminGatePassword}\n`;
  }
  if (created.includes('demo')) text += `# Demo buyer password : Demo!2026\n`;
  fs.writeFileSync(file, text.trim() + '\n', { mode: 0o600 });
}

function seedPosts() {
  for (const p of DEFAULT_POSTS) {
    if (!db.get('SELECT id FROM posts WHERE slug = ?', p.slug)) {
      db.run('INSERT INTO posts (slug, title, tag, body, published, author_id, created_at) VALUES (?, ?, ?, ?, 1, NULL, ?)',
        p.slug, p.title, p.tag, p.body, now());
    }
  }
}

function ensure() {
  setDefaults();
  refreshAdminGateHash();
  const created = seedStaff();
  seedPosts();
  return { created };
}

module.exports = { ensure, verifyAdminGate, DEFAULT_SETTINGS, DEFAULT_POSTS };
