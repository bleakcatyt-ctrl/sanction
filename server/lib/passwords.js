'use strict';

/**
 * Password hashing (scrypt) and reversible field encryption (AES-256-GCM).
 * Only the loader credential pair is stored reversibly — the user must be able
 * to read their login/password in the dashboard. Everything else is hashed.
 */

const crypto = require('node:crypto');
const config = require('../config');
const { safeEqual } = require('./util');

const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const derived = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), Buffer.from(hashHex, 'hex').length, {
      N: parseInt(N, 10), r: parseInt(r, 10), p: parseInt(p, 10), maxmem: 256 * 1024 * 1024
    });
    return safeEqual(derived.toString('hex'), hashHex);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ encryption -- */

function masterKey(purpose) {
  return crypto.createHash('sha256')
    .update(config.secrets.license)
    .update(`|${purpose}`)
    .digest();
}

/** AES-256-GCM -> "v1.<iv>.<tag>.<ciphertext>" all base64url */
function encrypt(plaintext, purpose = 'default') {
  const key = masterKey(purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

function decrypt(payload, purpose = 'default') {
  try {
    const [v, ivB64, tagB64, ctB64] = String(payload).split('.');
    if (v !== 'v1') return null;
    const key = masterKey(purpose);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, encrypt, decrypt };
