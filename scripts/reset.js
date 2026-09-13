#!/usr/bin/env node
'use strict';

/**
 * npm run reset            — wipe the database and seed a fresh one
 * npm run reset -- --all   — also drop generated keys, identity and notes
 *
 * Nothing is required from server/db before the files are removed, so no
 * handle is left open on the database we are deleting.
 */

const fs = require('node:fs');
const path = require('node:path');

const config = require('../server/config');

const wipeAll = process.argv.includes('--all') || process.argv.includes('-a');

const targets = [
  config.dbFile,
  config.dbFile + '-wal',
  config.dbFile + '-shm',
  config.dbFile + '-journal'
];

if (wipeAll) {
  targets.push(
    path.join(config.dataDir, 'session.key'),
    path.join(config.dataDir, 'license.key'),
    path.join(config.dataDir, 'server-identity.key'),
    path.join(config.dataDir, 'server-identity.pem'),
    path.join(config.dataDir, 'server-identity.pub.pem'),
    path.join(config.dataDir, 'seed-credentials.txt')
  );
}

console.log('');
console.log('Sanction — reset' + (wipeAll ? ' (полный)' : ''));
console.log('─'.repeat(60));

let removed = 0;
for (const file of targets) {
  try {
    fs.rmSync(file, { force: true });
    console.log('  удалено  ' + path.relative(config.root, file));
    removed += 1;
  } catch (err) {
    console.log('  пропуск  ' + path.relative(config.root, file) + ' (' + err.message + ')');
  }
}
if (!removed) console.log('  нечего удалять');

// Re-create schema + defaults + staff in the same run.
const seed = require('../server/lib/seed');
const { created } = seed.ensure();

const db = require('../server/db');
console.log('');
console.log('  база создана: ' + path.relative(config.root, config.dbFile));
console.log('  аккаунты:     ' + (created.length ? created.join(', ') : '—'));

const note = path.join(config.dataDir, 'seed-credentials.txt');
if (fs.existsSync(note)) {
  console.log('');
  console.log('  Пароли разработчика:');
  for (const raw of fs.readFileSync(note, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || !l.includes(':')) continue;
    console.log('    ' + l.replace(/^#\s*/, ''));
  }
}

console.log('');
console.log('Готово. Запуск: npm start');
console.log('─'.repeat(60));
console.log('');

process.exit(0);
