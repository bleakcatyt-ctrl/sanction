'use strict';

/**
 * Reference loader client in Node.
 * Mirrors loader/Sanction.Loader (C#) step by step — used by the e2e tests and
 * as a live specification of the wire protocol.
 */

const crypto = require('node:crypto');

const INFO = 'sanction-loader-v1';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

class LoaderClient {
  constructor(baseUrl, opts = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.build = opts.build || '1.0.4';
    this.hwid = opts.hwid || crypto.createHash('sha256').update('test-machine-' + Math.random()).digest('hex');
    this.hwidLabel = opts.hwidLabel || 'TEST-RIG';
    this.sid = null;
    this.key = null;
    this.counter = 0;
    this.lastPayload = null;
    this.lastError = null;
    this.publicKeyPem = opts.publicKeyPem || null;
  }

  async _post(path, body) {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Loader-Build': this.build },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async _get(path) {
    const res = await fetch(this.baseUrl + path);
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
  }

  /* ---------------------------------------------------------- handshake -- */

  async bootstrap() {
    const r = await this._post('/api/loader/v1/bootstrap', { build: this.build });
    this.bootstrapResponse = r.json;
    if (!r.json.ok) { this.lastError = r.json; return r; }
    this.sid = r.json.sid;
    this.challenge = r.json.challenge;
    this.serverPub = r.json.server_pub;
    return r;
  }

  _encrypt(plain) {
    this.counter += 1;
    const iv = crypto.randomBytes(12);
    const aad = Buffer.from(`1|${this.sid}|${this.counter}`, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]);
    return {
      v: 1,
      sid: this.sid,
      n: this.counter,
      ts: Math.floor(Date.now() / 1000),
      p: Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
    };
  }

  _decrypt(envelope) {
    const raw = Buffer.from(envelope.p, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const aad = Buffer.from(`1|${envelope.sid}|${envelope.n}`, 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
  }

  /** Verify a signed payload with the server identity public key. */
  verifySignature(signed) {
    if (!this.publicKeyPem) throw new Error('public key not loaded');
    const [bodyB64, sigB64] = String(signed).split('.');
    const ok = crypto.verify(
      'sha256',
      Buffer.from(bodyB64, 'utf8'),
      { key: crypto.createPublicKey(this.publicKeyPem), dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigB64, 'base64url')
    );
    if (!ok) return null;
    return JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  }

  async loadPublicKey() {
    const r = await this._get('/api/loader/v1/pubkey');
    this.publicKeyPem = r.text;
    return r;
  }

  async auth(login, password, opts = {}) {
    if (!this.sid) await this.bootstrap();
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const clientPub = ecdh.getPublicKey('hex');
    const shared = ecdh.computeSecret(Buffer.from(this.serverPub, 'hex'));
    this.key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(this.challenge, 'utf8'), Buffer.from(INFO, 'utf8'), 32));

    const inner = {
      challenge: this.challenge,
      login,
      password,
      hwid: opts.hwid || this.hwid,
      hwid_label: opts.hwidLabel || this.hwidLabel,
      build: this.build
    };
    const envelope = this._encrypt(inner);
    const r = await this._post('/api/loader/v1/handshake', { sid: this.sid, client_pub: clientPub, ...envelope });
    if (r.json.ok && r.json.envelope) {
      this.lastPayload = this._decrypt(r.json.envelope);
      this.lastError = null;
    } else {
      this.lastError = r.json;
      this.lastPayload = null;
    }
    return r;
  }

  async call(action, extra = {}) {
    if (!this.key) throw new Error('not authenticated');
    const envelope = this._encrypt({ action, ...extra });
    const r = await this._post('/api/loader/v1/rpc', envelope);
    if (r.json.ok && r.json.envelope) {
      this.lastPayload = this._decrypt(r.json.envelope);
      this.lastError = null;
    } else {
      this.lastError = r.json;
      this.lastPayload = null;
    }
    return r;
  }

  async heartbeat() { return this.call('heartbeat'); }
  async license() { return this.call('license'); }
  async download() { return this.call('download'); }
  async logout() { return this.call('logout'); }
}

module.exports = { LoaderClient, canonicalJson, INFO };
