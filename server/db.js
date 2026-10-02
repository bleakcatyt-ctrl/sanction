'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

/** Все запросы в проекте — только параметризованные (prepare + bind). Конкатенации SQL с пользовательским вводом нет. */

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    pro_until     INTEGER NOT NULL DEFAULT 0,
    stack         TEXT NOT NULL DEFAULT '[]',
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE orders (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan          TEXT NOT NULL,
    amount        TEXT NOT NULL,
    currency      TEXT NOT NULL DEFAULT 'RUB',
    days          INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'created',
    test          INTEGER NOT NULL DEFAULT 0,
    payment_id    TEXT,
    pay_url       TEXT,
    created_at    INTEGER NOT NULL,
    paid_at       INTEGER,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
  CREATE TABLE webhook_events (
    id          INTEGER PRIMARY KEY,
    payment_id  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    UNIQUE(payment_id, event_type)
  );
  CREATE TABLE jobs (
    id           INTEGER PRIMARY KEY,
    source       TEXT NOT NULL,
    ext_id       TEXT NOT NULL,
    title        TEXT NOT NULL,
    company      TEXT NOT NULL,
    company_key  TEXT NOT NULL,
    location     TEXT NOT NULL DEFAULT '',
    remote       INTEGER NOT NULL DEFAULT 0,
    url          TEXT NOT NULL,
    salary_text  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'dev',
    level        TEXT NOT NULL DEFAULT 'middle',
    ai_score     INTEGER NOT NULL DEFAULT 0,
    stack        TEXT NOT NULL DEFAULT '[]',
    description  TEXT NOT NULL DEFAULT '',
    posted_at    INTEGER NOT NULL,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    UNIQUE(source, ext_id)
  );
  CREATE INDEX idx_jobs_posted ON jobs(posted_at DESC);
  CREATE INDEX idx_jobs_company ON jobs(company_key);
  CREATE INDEX idx_jobs_ai ON jobs(ai_score, posted_at DESC);
  CREATE TABLE saved_jobs (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id   INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, job_id)
  );
  CREATE TABLE saved_searches (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    query      TEXT NOT NULL,
    last_seen  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_searches_user ON saved_searches(user_id);
  CREATE TABLE crawl_runs (
    id         INTEGER PRIMARY KEY,
    source     TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    ok         INTEGER NOT NULL DEFAULT 0,
    fetched    INTEGER NOT NULL DEFAULT 0,
    kept       INTEGER NOT NULL DEFAULT 0,
    inserted   INTEGER NOT NULL DEFAULT 0,
    error      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_crawl_source ON crawl_runs(source, started_at DESC);
  `,
];

function open(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cur = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (file !== ':memory:') {
    for (const f of [file, file + '-wal', file + '-shm']) {
      try { fs.chmodSync(f, 0o600); } catch { /* файла может не быть */ }
    }
  }
  return db;
}

/** Выполнить fn в транзакции (немедленная блокировка записи — защита от гонок при вебхуках). */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* уже откатилась */ }
    throw e;
  }
}

module.exports = { open, tx, defaultFile: () => path.join(config.dataDir, 'vektor.db') };
