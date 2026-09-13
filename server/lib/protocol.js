'use strict';

/**
 * Loader wire protocol primitives.
 *
 * Everything is built from algorithms that exist natively in BOTH
 * Node.js and .NET 8, so the C# loader needs zero third-party packages:
 *
 *   ECDH  prime256v1 (NIST P-256)  -> per-session shared secret
 *   HKDF  SHA-256                  -> AES key derivation
 *   AES   256-GCM                  -> envelope encryption
 *   ECDSA P-256 (IEEE P1363 sig)   -> server identity + license tokens
 *
 * Wire format of an encrypted request body:
 *   { "v":1, "sid":"<session id>", "n":<counter>, "ts":<unix sec>, "p":"<base64url(iv|tag|ct)>" }
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { sec, base64url, fromBase64url, safeEqual, sha256 } = require('./util');

const CURVE = 'prime256v1';
const PROTOCOL_INFO = 'sanction-loader-v1';
const PROTOCOL_VERSION = 1;

/* -------------------------------------------------- server identity (ECDSA) */

const identityPath = path.join(config.dataDir, 'server-identity.pem');
const publicPath = path.join(config.dataDir, 'server-identity.pub.pem');

let _identity = null;

function identity() {
  if (_identity) return _identity;
  if (fs.existsSync(identityPath)) {
    _identity = crypto.createPrivateKey(fs.readFileSync(identityPath));
  } else {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    fs.writeFileSync(identityPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    _identity = privateKey;
  }
  const publicKey = crypto.createPublicKey(_identity);
  fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return _identity;
}

/** PEM of the server public key — embedded into the C# loader build. */
function identityPublicKeyPem() {
  identity();
  return fs.readFileSync(publicPath, 'utf8');
}

function identityFingerprint() {
  identity();
  const der = crypto.createPublicKey(identity()).export({ type: 'spki', format: 'der' });
  return sha256(der).slice(0, 16);
}

function signBuffer(buf) {
  return crypto.sign('sha256', buf, { key: identity(), dsaEncoding: 'ieee-p1363' });
}

function verifyBuffer(buf, signature) {
  try {
    return crypto.verify('sha256', buf, { key: crypto.createPublicKey(identity()), dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------- canonical JSON --- */

/** Deterministic JSON so both sides sign/verify the exact same bytes. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/* ------------------------------------------------------------ ECDH / HKDF -- */

function newEphemeral() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return {
    ecdh,
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex') // 04 || X || Y  (uncompressed, 65 bytes)
  };
}

function ecdhFromPrivate(privateKeyHex) {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
  return ecdh;
}

function deriveKey(sharedSecretHex, salt) {
  const hkdf = crypto.hkdfSync('sha256', Buffer.from(sharedSecretHex, 'hex'), Buffer.from(salt, 'utf8'), Buffer.from(PROTOCOL_INFO, 'utf8'), 32);
  return Buffer.from(hkdf);
}

/* --------------------------------------------------------------- envelope -- */

function encryptEnvelope(key, sessionId, counter, plaintextObj) {
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${PROTOCOL_VERSION}|${sessionId}|${counter}`, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(JSON.stringify(plaintextObj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: PROTOCOL_VERSION,
    sid: sessionId,
    n: counter,
    ts: sec(),
    p: base64url(Buffer.concat([iv, tag, ct]))
  };
}

function decryptEnvelope(key, envelope) {
  if (!envelope || envelope.v !== PROTOCOL_VERSION) throw new Error('bad_protocol_version');
  if (typeof envelope.sid !== 'string' || typeof envelope.n !== 'number') throw new Error('bad_envelope');
  const ts = Number(envelope.ts);
  if (!Number.isFinite(ts) || Math.abs(sec() - ts) > config.security.maxClockSkewSeconds) throw new Error('clock_skew');

  const raw = fromBase64url(envelope.p);
  if (raw.length < 29) throw new Error('bad_payload');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const aad = Buffer.from(`${PROTOCOL_VERSION}|${envelope.sid}|${envelope.n}`, 'utf8');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

/* ------------------------------------------------------------ signed data -- */

/**
 * Compact signed payload:  base64url(canonicalJson(body)) + "." + base64url(signature)
 * The C# loader verifies it with the embedded server public key.
 */
function signPayload(body) {
  const canonical = canonicalJson(body);
  const bodyB64 = base64url(Buffer.from(canonical, 'utf8'));
  const sig = signBuffer(Buffer.from(bodyB64, 'utf8'));
  return `${bodyB64}.${base64url(sig)}`;
}

function verifyPayload(signed) {
  const [bodyB64, sigB64] = String(signed || '').split('.');
  if (!bodyB64 || !sigB64) return null;
  if (!verifyBuffer(Buffer.from(bodyB64, 'utf8'), fromBase64url(sigB64))) return null;
  try { return JSON.parse(fromBase64url(bodyB64).toString('utf8')); } catch { return null; }
}

/**
 * License token handed to the loader after a successful auth.
 * Short lived, bound to HWID + loader session, verified offline by the client
 * with the embedded public key so a proxied/patched server cannot forge it.
 */
function issueLicenseToken({ license, hwid, sessionId, build, features }) {
  const issued = sec();
  const body = {
    typ: 'license',
    ver: PROTOCOL_VERSION,
    iss: 'sanction',
    sub: sha256(String(license.id)).slice(0, 24),
    login: license.loader_login,
    plan: license.plan_code,
    days: license.days,
    status: license.status,
    hwid: hwid ? sha256(hwid).slice(0, 32) : null,
    sid: sessionId ? sha256(sessionId).slice(0, 16) : null,
    build: build || null,
    features: features || [],
    iat: issued,
    nbf: issued,
    exp: issued + config.security.licenseTokenTtlSeconds,
    jti: crypto.randomBytes(12).toString('base64url')
  };
  return { token: signPayload(body), claims: body };
}

/** One-time download ticket for the loader artifact. */
function issueDownloadToken({ license, hwid, build }) {
  const issued = sec();
  const body = {
    typ: 'download',
    ver: PROTOCOL_VERSION,
    iss: 'sanction',
    lic: sha256(String(license.id)).slice(0, 24),
    login: license.loader_login,
    hwid: hwid ? sha256(hwid).slice(0, 32) : null,
    build,
    iat: issued,
    exp: issued + config.security.downloadTokenTtlSeconds,
    jti: crypto.randomBytes(12).toString('base64url')
  };
  return { token: signPayload(body), claims: body };
}

function newChallenge() {
  return crypto.randomBytes(24).toString('base64url');
}

function constantTimeCompareHex(a, b) {
  return safeEqual(a, b);
}

module.exports = {
  PROTOCOL_VERSION,
  PROTOCOL_INFO,
  CURVE,
  identity,
  identityPublicKeyPem,
  identityFingerprint,
  signBuffer,
  verifyBuffer,
  canonicalJson,
  newEphemeral,
  ecdhFromPrivate,
  deriveKey,
  encryptEnvelope,
  decryptEnvelope,
  signPayload,
  verifyPayload,
  issueLicenseToken,
  issueDownloadToken,
  newChallenge,
  constantTimeCompareHex
};
