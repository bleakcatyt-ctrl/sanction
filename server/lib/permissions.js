'use strict';

/**
 * Granular permission matrix for the admin panel.
 * An admin can hand out individual permissions instead of "full admin".
 */

const db = require('../db');
const { now } = require('./util');

const CATALOG = [
  { key: 'panel.access', group: 'Panel', label: 'Open admin panel', hint: 'Base right — without it nothing else is reachable.' },

  { key: 'users.view', group: 'Users', label: 'View users', hint: 'List, search, open user cards.' },
  { key: 'users.edit', group: 'Users', label: 'Edit users', hint: 'Change email, reset password, add balance notes.' },
  { key: 'users.ban', group: 'Users', label: 'Ban / unban users', hint: 'Blocks site and loader access.' },
  { key: 'users.permissions', group: 'Users', label: 'Grant panel permissions', hint: 'Hand out or revoke individual rights.' },

  { key: 'licenses.view', group: 'Licenses', label: 'View licenses', hint: 'All keys, statuses, HWID, expiry.' },
  { key: 'licenses.generate', group: 'Licenses', label: 'Generate keys', hint: 'Create keys for any plan, bulk generate.' },
  { key: 'licenses.extend', group: 'Licenses', label: 'Extend / change plan', hint: 'Add days, switch plan, re-activate.' },
  { key: 'licenses.revoke', group: 'Licenses', label: 'Revoke / ban keys', hint: 'Kill a key instantly, loader drops on heartbeat.' },
  { key: 'licenses.credentials', group: 'Licenses', label: 'Reveal loader credentials', hint: 'See login/password of a license.' },

  { key: 'hwid.view', group: 'HWID', label: 'View HWID data', hint: 'Bound devices and reset history.' },
  { key: 'hwid.reset', group: 'HWID', label: 'Reset HWID', hint: 'Unbind a device for a user.' },
  { key: 'hwid.blacklist', group: 'HWID', label: 'HWID blacklist', hint: 'Permanently block hardware fingerprints.' },

  { key: 'orders.view', group: 'Billing', label: 'View orders', hint: 'Payments, invoices, gateway logs.' },
  { key: 'orders.mark_paid', group: 'Billing', label: 'Mark order paid', hint: 'Manual provisioning when a payment is confirmed offline.' },
  { key: 'orders.refund', group: 'Billing', label: 'Refund / cancel', hint: 'Refund an order and revoke the license.' },
  { key: 'coupons.manage', group: 'Billing', label: 'Coupons', hint: 'Create and disable promo codes.' },
  { key: 'plans.manage', group: 'Billing', label: 'Plans & prices', hint: 'Change prices and availability of 30/90/180.' },

  { key: 'loader.view', group: 'Loader', label: 'Loader sessions', hint: 'Live sessions, builds, IPs, heartbeats.' },
  { key: 'loader.killswitch', group: 'Loader', label: 'Kill switch / min build', hint: 'Disable all loaders or raise the minimal build.' },
  { key: 'loader.build', group: 'Loader', label: 'Manage builds', hint: 'Upload/replace the loader artifact.' },

  { key: 'content.posts', group: 'Content', label: 'News & changelog', hint: 'Publish posts shown on the site.' },
  { key: 'content.settings', group: 'Content', label: 'Site settings', hint: 'Brand, contacts, announcements, maintenance mode.' },

  { key: 'audit.view', group: 'System', label: 'Audit log', hint: 'Every privileged action with IP and actor.' },
  { key: 'system.stats', group: 'System', label: 'Statistics', hint: 'Revenue, active keys, online loaders.' }
];

const ALL_KEYS = CATALOG.map((p) => p.key);
const GROUPS = [...new Set(CATALOG.map((p) => p.group))];

/** Presets used by the UI when granting access. */
const PRESETS = {
  support: ['panel.access', 'users.view', 'users.edit', 'licenses.view', 'hwid.view', 'hwid.reset', 'loader.view'],
  manager: ['panel.access', 'users.view', 'licenses.view', 'licenses.generate', 'licenses.extend', 'orders.view', 'coupons.manage'],
  moderator: ['panel.access', 'users.view', 'users.ban', 'licenses.view', 'licenses.revoke', 'hwid.view', 'hwid.reset', 'content.posts'],
  billing: ['panel.access', 'orders.view', 'orders.mark_paid', 'orders.refund', 'coupons.manage', 'plans.manage'],
  full: ALL_KEYS
};

const OWNER = ALL_KEYS.slice();

function setForUser(userId) {
  const rows = db.all('SELECT permission FROM user_permissions WHERE user_id = ?', userId);
  return new Set(rows.map((r) => r.permission));
}

function grant(userId, permission, grantedBy = null, note = null) {
  if (!ALL_KEYS.includes(permission)) throw new Error(`unknown permission: ${permission}`);
  db.run(
    `INSERT INTO user_permissions (user_id, permission, granted_by, note, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, permission) DO UPDATE SET granted_by = excluded.granted_by, note = excluded.note`,
    userId, permission, grantedBy, note, now()
  );
}

function revoke(userId, permission) {
  db.run('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?', userId, permission);
}

function replaceSet(userId, permissions, grantedBy = null) {
  const clean = [...new Set((permissions || []).filter((p) => ALL_KEYS.includes(p)))];
  db.transaction(() => {
    db.run('DELETE FROM user_permissions WHERE user_id = ?', userId);
    for (const p of clean) grant(userId, p, grantedBy, 'batch');
    db.run('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?', clean.includes('panel.access') ? 1 : 0, now(), userId);
  });
  return clean;
}

/**
 * Effective permissions of a user object.
 * role = owner  -> everything
 * role = admin  -> everything granted + defaults
 * is_admin flag -> whatever was granted explicitly
 */
function effectiveFor(user) {
  if (!user) return new Set();
  if (user.role === 'owner') return new Set(OWNER);
  if (user.role === 'admin') return new Set([...OWNER.filter((k) => k !== 'users.permissions' || true)]);
  if (!user.is_admin) return new Set();
  return setForUser(user.id);
}

function can(user, permission) {
  return effectiveFor(user).has(permission);
}

module.exports = { CATALOG, ALL_KEYS, GROUPS, PRESETS, setForUser, grant, revoke, replaceSet, effectiveFor, can };
