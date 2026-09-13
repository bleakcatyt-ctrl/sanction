'use strict';

/**
 * SQLite access layer (node:sqlite — zero native dependencies).
 * Schema is created idempotently on boot; every migration is additive.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/* ---------------------------------------------------------------- schema -- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  username          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT    NOT NULL,
  role              TEXT    NOT NULL DEFAULT 'user',        -- user | moderator | admin | owner
  status            TEXT    NOT NULL DEFAULT 'active',      -- active | banned | pending
  email_verified    INTEGER NOT NULL DEFAULT 0,
  is_admin          INTEGER NOT NULL DEFAULT 0,
  admin_gate_ok_at  INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_login_at     INTEGER,
  last_login_ip     TEXT,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      INTEGER,
  avatar_seed       TEXT
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  TEXT    NOT NULL,
  granted_by  INTEGER,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, permission)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  admin_gate  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS licenses (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id              INTEGER,
  license_key           TEXT    NOT NULL UNIQUE,
  loader_login          TEXT    NOT NULL UNIQUE,
  loader_password_enc   TEXT    NOT NULL,   -- AES-256-GCM, so the user can read it in the dashboard
  loader_password_hash  TEXT    NOT NULL,   -- scrypt, used to verify loader logins
  plan_code             TEXT    NOT NULL,
  days                  INTEGER NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'pending', -- pending | active | expired | revoked | banned
  created_at            INTEGER NOT NULL,
  activated_at          INTEGER,
  expires_at            INTEGER,
  hwid                  TEXT,
  hwid_label            TEXT,
  hwid_bound_at         INTEGER,
  hwid_resets_left      INTEGER NOT NULL DEFAULT 0,
  hwid_reset_at         INTEGER,
  max_devices           INTEGER NOT NULL DEFAULT 1,
  last_seen_at          INTEGER,
  last_seen_ip          TEXT,
  loader_version        TEXT,
  fail_count            INTEGER NOT NULL DEFAULT 0,
  locked_until          INTEGER,
  revoked_reason        TEXT,
  note                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_lic_user   ON licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_lic_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_lic_exp    ON licenses(expires_at);

CREATE TABLE IF NOT EXISTS license_devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id  INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  hwid        TEXT    NOT NULL,
  label       TEXT,
  bound_at    INTEGER NOT NULL,
  revoked_at  INTEGER,
  UNIQUE (license_id, hwid)
);

CREATE TABLE IF NOT EXISTS hwid_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id  INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  old_hwid    TEXT,
  new_hwid    TEXT,
  actor       TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id          TEXT    NOT NULL UNIQUE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code          TEXT    NOT NULL,
  amount             INTEGER NOT NULL,   -- minor units (kopecks) when RUB
  currency           TEXT    NOT NULL DEFAULT 'RUB',
  discount           INTEGER NOT NULL DEFAULT 0,
  coupon_code        TEXT,
  method             TEXT    NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'created', -- created|pending|paid|failed|refunded|cancelled|expired
  gateway_payment_id TEXT,
  checkout_url       TEXT,
  created_at         INTEGER NOT NULL,
  paid_at            INTEGER,
  expires_at         INTEGER,
  ip                 TEXT,
  meta               TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS payment_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER,
  gateway     TEXT,
  event       TEXT,
  payload     TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  kind        TEXT    NOT NULL DEFAULT 'percent', -- percent | fixed
  value       INTEGER NOT NULL,
  plan_code   TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
  used        INTEGER NOT NULL DEFAULT 0,
  per_user    INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  expires_at  INTEGER,
  created_by  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_uses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id   INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loader_sessions (
  id              TEXT    PRIMARY KEY,
  license_id      INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
  server_pub      TEXT    NOT NULL,
  client_pub      TEXT,
  shared_key_enc  TEXT,
  state           TEXT    NOT NULL DEFAULT 'handshake', -- handshake | authed | revoked
  challenge       TEXT    NOT NULL,
  counter         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  last_heartbeat  INTEGER,
  ip              TEXT,
  build           TEXT,
  revoked_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ls_lic ON loader_sessions(license_id);
CREATE INDEX IF NOT EXISTS idx_ls_exp ON loader_sessions(expires_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL DEFAULT 'info',
  title       TEXT    NOT NULL,
  body        TEXT,
  link        TEXT,
  seen        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, seen);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  tag         TEXT    NOT NULL DEFAULT 'update',
  body        TEXT    NOT NULL,
  published   INTEGER NOT NULL DEFAULT 1,
  author_id   INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type  TEXT    NOT NULL,   -- user | admin | system | loader | gateway
  actor_id    TEXT,
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id  INTEGER,
  user_id     INTEGER,
  build       TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hwid_blacklist (
  hwid        TEXT    PRIMARY KEY,
  reason      TEXT,
  created_by  INTEGER,
  created_at  INTEGER NOT NULL
);
`;

db.exec(SCHEMA);

/* ------------------------------------------------------------ migrations -- */

/**
 * Additive migrations keyed by PRAGMA user_version.
 * Keep every step idempotent and cheap — they run on boot.
 */
const MIGRATIONS = [
  {
    // v1: loader_sessions.license_id must be nullable — a handshake exists
    // before we know which license it belongs to.
    version: 1,
    run() {
      const cols = db.prepare('PRAGMA table_info(loader_sessions)').all();
      const col = cols.find((c) => c.name === 'license_id');
      if (!col || !col.notnull) return false;
      db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE loader_sessions RENAME TO loader_sessions_legacy;
        CREATE TABLE loader_sessions (
          id              TEXT    PRIMARY KEY,
          license_id      INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
          server_pub      TEXT    NOT NULL,
          client_pub      TEXT,
          shared_key_enc  TEXT,
          state           TEXT    NOT NULL DEFAULT 'handshake',
          challenge       TEXT    NOT NULL,
          counter         INTEGER NOT NULL DEFAULT 0,
          created_at      INTEGER NOT NULL,
          expires_at      INTEGER NOT NULL,
          last_heartbeat  INTEGER,
          ip              TEXT,
          build           TEXT,
          revoked_reason  TEXT
        );
        INSERT INTO loader_sessions
          SELECT id, NULLIF(license_id, 0), server_pub, client_pub, shared_key_enc, state,
                 challenge, counter, created_at, expires_at, last_heartbeat, ip, build, revoked_reason
          FROM loader_sessions_legacy;
        DROP TABLE loader_sessions_legacy;
        CREATE INDEX IF NOT EXISTS idx_ls_lic ON loader_sessions(license_id);
        CREATE INDEX IF NOT EXISTS idx_ls_exp ON loader_sessions(expires_at);
        PRAGMA foreign_keys = ON;
      `);
      return true;
    }
  }
];

(function migrate() {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const changed = m.run();
    db.exec(`PRAGMA user_version = ${m.version}`);
    if (changed) console.log(`[db] migration v${m.version} applied`);
  }
})();

/* ------------------------------------------------------------- statements -- */

const cache = new Map();
function q(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

const store = {
  raw: db,

  run(sql, ...params) {
    const r = q(sql).run(...params);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
  get(sql, ...params) {
    return q(sql).get(...params) || null;
  },
  all(sql, ...params) {
    return q(sql).all(...params);
  },
  pluck(sql, ...params) {
    const row = q(sql).get(...params);
    if (!row) return null;
    const values = Object.values(row);
    return values.length ? values[0] : null;
  },
  transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  },
  exec(sql) { db.exec(sql); },

  /* ------------------------------------------------------------ settings -- */
  setting(key, fallback = null) {
    const row = store.get('SELECT value FROM settings WHERE key = ?', key);
    return row ? row.value : fallback;
  },
  settingInt(key, fallback = 0) {
    const v = store.setting(key, null);
    if (v === null) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  },
  settingBool(key, fallback = false) {
    const v = store.setting(key, null);
    if (v === null) return fallback;
    return v === '1' || v === 'true';
  },
  setSetting(key, value) {
    store.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key, value === null ? null : String(value), Date.now()
    );
  }
};

module.exports = store;
