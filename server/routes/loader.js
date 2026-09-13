'use strict';

/**
 * Loader API (v1).
 *
 *   POST /api/loader/v1/bootstrap   -> session id + challenge + server ephemeral pub
 *   POST /api/loader/v1/handshake   -> ECDH, encrypted auth (login/password/HWID)
 *   POST /api/loader/v1/rpc         -> encrypted multiplexed calls (heartbeat, license, download…)
 *   GET  /api/loader/v1/pubkey      -> server identity public key (embedded in the build)
 *   GET  /dl/loader                 -> artifact download with a signed one-time ticket
 *
 * Design rule: a client that has no active, HWID-bound, non-expired license
 * receives NOTHING but an error code. There is no payload to unpack, no key to
 * extract, no offline fallback — the server is the only source of truth.
 */

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const db = require('../db');
const proto = require('../lib/protocol');
const passwords = require('../lib/passwords');
const licenseSvc = require('../lib/license');
const audit = require('../lib/audit');
const ratelimit = require('../lib/ratelimit');
const util = require('../lib/util');

const { now, sec, clientIp, compareVersions, sha256 } = util;

const router = express.Router();
const EPHEMERAL_PURPOSE = 'loader-ephemeral';
const SESSION_KEY_PURPOSE = 'loader-session';

const HEARTBEAT_INTERVAL = 60;

/* ------------------------------------------------------------- helpers ---- */

function deny(res, code, message, status = 403, extra = {}) {
  return res.status(status).json({ ok: false, code, message, server_time: sec(), ...extra });
}

function siteStatus() {
  return {
    status: db.setting('site.status', 'online'),
    status_text: db.setting('site.status_text', ''),
    announcement: db.setting('site.announcement', ''),
    killswitch: db.settingBool('loader.killswitch', false)
  };
}

function buildPolicy() {
  return {
    latest: db.setting('loader.latest_version', config.build.latestVersion),
    min: db.setting('loader.min_version', config.build.minVersion)
  };
}

function featuresFor(planCode) {
  // Feature flags are resolved server-side per plan; the client only renders them.
  const base = ['session', 'auto_update', 'support'];
  if (planCode === 'SANCTION-90') return [...base, 'private_channel'];
  if (planCode === 'SANCTION-180') return [...base, 'private_channel', 'dedicated_support', 'early_builds'];
  return base;
}

function loaderPayload(license, st, { sessionId = null, hwid = null, build = null } = {}) {
  const policy = buildPolicy();
  const status = siteStatus();
  const ticket = st.usable ? proto.issueDownloadToken({ license, hwid, build: policy.latest }) : null;
  const downloadEnabled = db.settingBool('loader.download_enabled', true) && fs.existsSync(config.build.artifactPath);

  return {
    ok: true,
    state: st.status,
    license: {
      plan: license.plan_code,
      days: license.days,
      status: st.status,
      activated_at: license.activated_at || null,
      expires_at: license.expires_at || null,
      expires_at_unix: license.expires_at ? Math.floor(license.expires_at / 1000) : null,
      remaining_ms: st.remaining_ms,
      remaining_days: st.remaining_days,
      hwid_bound: st.hwid_bound,
      hwid_resets_left: license.hwid_resets_left,
      max_devices: license.max_devices,
      features: featuresFor(license.plan_code)
    },
    session: {
      sid: sessionId ? sha256(sessionId).slice(0, 16) : null,
      heartbeat_interval: HEARTBEAT_INTERVAL,
      server_time: sec(),
      expires_at: null
    },
    token: st.usable ? proto.issueLicenseToken({ license, hwid, sessionId, build, features: featuresFor(license.plan_code) }).token : null,
    download: st.usable && downloadEnabled
      ? { enabled: true, build: policy.latest, url: `${config.publicUrl}/dl/loader?t=${encodeURIComponent(ticket.token)}`, ttl: config.security.downloadTokenTtlSeconds }
      : { enabled: false, reason: !downloadEnabled ? 'artifact_missing' : 'not_entitled' },
    site: { status: status.status, status_text: status.status_text, announcement: status.announcement }
  };
}

/* ------------------------------------------------------------- bootstrap -- */

router.post('/v1/bootstrap', ratelimit.middleware({ scope: 'loader', limit: config.security.rateLimit.loader, windowMs: config.security.rateLimit.windowMs }), (req, res) => {
  const body = req.body || {};
  const build = String(body.build || body.version || '').slice(0, 32);
  const policy = buildPolicy();
  const status = siteStatus();

  if (status.killswitch) return deny(res, 'killswitch', 'Сервис временно недоступен.', 503);
  if (status.status === 'maintenance') return deny(res, 'maintenance', status.status_text || 'Технические работы.', 503);
  if (build && compareVersions(build, policy.min) < 0) {
    return deny(res, 'build_outdated', `Требуется сборка ${policy.min} или новее.`, 426, { latest: policy.latest });
  }

  const eph = proto.newEphemeral();
  const sid = crypto.randomBytes(18).toString('base64url');
  const challenge = proto.newChallenge();
  const ttl = config.security.loaderSessionTtlSeconds * 1000;

  db.run(
    `INSERT INTO loader_sessions (id, license_id, server_pub, client_pub, shared_key_enc, state, challenge, counter, created_at, expires_at, ip, build)
     VALUES (?, NULL, ?, NULL, ?, 'handshake', ?, 0, ?, ?, ?, ?)`,
    sid,
    eph.publicKeyHex,
    passwords.encrypt(JSON.stringify({ priv: eph.privateKeyHex, sid, created: now() }), EPHEMERAL_PURPOSE),
    challenge, now(), now() + ttl, clientIp(req), build || null
  );

  res.json({
    ok: true,
    protocol: proto.PROTOCOL_VERSION,
    curve: 'P-256',
    cipher: 'AES-256-GCM',
    kdf: 'HKDF-SHA256',
    sid,
    challenge,
    server_pub: eph.publicKeyHex,
    identity: { kid: proto.identityFingerprint(), alg: 'ECDSA-P256' },
    expires_at: Math.floor((now() + ttl) / 1000),
    server_time: sec(),
    heartbeat_interval: HEARTBEAT_INTERVAL,
    build: policy
  });
});

/** Server identity public key — embedded into the C# build at compile time. */
router.get('/v1/pubkey', (req, res) => {
  res.type('text/plain').send(proto.identityPublicKeyPem());
});

router.get('/v1/pubkey.json', (req, res) => {
  res.json({
    ok: true,
    kid: proto.identityFingerprint(),
    alg: 'ECDSA-P256',
    sig_format: 'ieee-p1363',
    hash: 'SHA-256',
    encoding: 'canonical-json + base64url',
    pem: proto.identityPublicKeyPem()
  });
});

/* ------------------------------------------------------------- handshake -- */

function loadSession(sid) {
  const row = db.get('SELECT * FROM loader_sessions WHERE id = ?', String(sid || ''));
  if (!row) return null;
  if (row.expires_at < now()) { db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='session_expired' WHERE id=?`, row.id); return null; }
  return row;
}

router.post('/v1/handshake', ratelimit.middleware({ scope: 'loader', limit: config.security.rateLimit.loader, windowMs: config.security.rateLimit.windowMs }), (req, res) => {
  const ip = clientIp(req);
  const body = req.body || {};
  const status = siteStatus();
  if (status.killswitch) return deny(res, 'killswitch', 'Сервис временно недоступен.', 503);

  const session = loadSession(body.sid);
  if (!session) return deny(res, 'session_not_found', 'Сессия не найдена или истекла. Перезапустите лоадер.', 404);
  if (session.state !== 'handshake') return deny(res, 'session_state', 'Рукопожатие уже завершено.', 409);

  // 1. ECDH
  let sharedHex;
  let clientPub = String(body.client_pub || '').toLowerCase();
  try {
    const stored = JSON.parse(passwords.decrypt(session.shared_key_enc, EPHEMERAL_PURPOSE) || 'null');
    if (!stored || !stored.priv) return deny(res, 'session_broken', 'Материалы сессии повреждены.', 500);
    const ecdh = proto.ecdhFromPrivate(stored.priv);
    if (!/^04[0-9a-f]{128}$/.test(clientPub)) return deny(res, 'bad_client_pub', 'Некорректный публичный ключ клиента.', 400);
    sharedHex = ecdh.computeSecret(Buffer.from(clientPub, 'hex')).toString('hex');
  } catch (err) {
    return deny(res, 'handshake_failed', 'Не удалось выполнить обмен ключами.', 400);
  }

  const key = proto.deriveKey(sharedHex, session.challenge);

  // 2. Decrypt the first envelope
  let inner;
  try {
    inner = proto.decryptEnvelope(key, { v: body.v, sid: body.sid, n: body.n, ts: body.ts, p: body.p });
  } catch (err) {
    audit.log('loader', null, 'loader.handshake_decrypt_failed', { ip, meta: { sid: body.sid, err: err.message } });
    return deny(res, 'decrypt_failed', 'Не удалось расшифровать пакет.', 400);
  }

  if (inner.challenge !== session.challenge) return deny(res, 'challenge_mismatch', 'Проверка вызова не пройдена.', 400);
  if (Number(body.n) !== 1) return deny(res, 'bad_counter', 'Некорректный счётчик.', 400);

  const login = String(inner.login || inner.license_key || '').trim();
  const password = String(inner.password || '');
  const hwidRaw = String(inner.hwid || '');
  const hwidLabel = String(inner.hwid_label || '').slice(0, 120);
  const build = String(inner.build || session.build || '').slice(0, 32);

  // 3. Resolve the license (loader login or license key)
  let license = null;
  if (/^[A-Z0-9]{3,}(-[A-Z0-9]{3,})+$/i.test(login)) license = licenseSvc.byKey(login);
  if (!license) license = licenseSvc.byLogin(login);

  if (!license) {
    audit.log('loader', null, 'loader.auth_unknown', { ip, meta: { login: util.truncate(login, 40) } });
    db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='unknown_login' WHERE id=?`, session.id);
    return deny(res, 'invalid_credentials', 'Аккаунт не найден.', 401);
  }

  const lockKey = `loaderlogin:${license.id}`;
  if (license.locked_until && license.locked_until > now()) {
    return deny(res, 'locked', `Слишком много попыток. Повторите через ${util.msToHuman(license.locked_until - now())}.`, 423);
  }

  if (!licenseSvc.verifyPassword(license, password)) {
    const fails = (license.fail_count || 0) + 1;
    const lock = fails >= config.security.loaderMaxAttempts ? now() + config.security.loaderLockMinutes * 60_000 : null;
    db.run('UPDATE licenses SET fail_count = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?', fails, lock, license.id);
    audit.log('loader', license.id, 'loader.auth_failed', { targetType: 'license', targetId: String(license.id), ip, meta: { fails } });
    db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='bad_password' WHERE id=?`, session.id);
    return deny(res, 'invalid_credentials', 'Неверный логин или пароль.', 401, { attempts_left: Math.max(0, config.security.loaderMaxAttempts - fails) });
  }

  db.run('UPDATE licenses SET fail_count = 0, locked_until = NULL WHERE id = ?', license.id);
  ratelimit.reset('loader', lockKey);

  // 4. Status gates — checked in strict order so the client gets an exact reason.
  const policy = buildPolicy();
  if (build && compareVersions(build, policy.min) < 0) {
    return deny(res, 'build_outdated', `Сборка ${build} устарела. Минимальная версия ${policy.min}.`, 426, { latest: policy.latest });
  }
  if (license.status === 'banned' || db.get('SELECT id FROM users WHERE id = ? AND status = ?', license.user_id, 'banned')) {
    audit.log('loader', license.id, 'loader.blocked', { targetType: 'license', targetId: String(license.id), ip, meta: { reason: 'banned' } });
    return deny(res, 'account_banned', 'Аккаунт заблокирован.', 403);
  }
  if (license.status === 'revoked') {
    return deny(res, 'license_revoked', license.revoked_reason === 'hwid_reset' ? 'Ключ отозван.' : 'Доступ отозван администрацией.', 403);
  }
  if (license.hwid && licenseSvc.isBlacklisted(license.hwid)) {
    return deny(res, 'hwid_blacklisted', 'Устройство заблокировано.', 403);
  }

  const hwid = licenseSvc.normalizeHwid(hwidRaw);
  if (hwid && licenseSvc.isBlacklisted(hwid)) {
    audit.log('loader', license.id, 'loader.blocked', { targetType: 'license', targetId: String(license.id), ip, meta: { reason: 'hwid_blacklist' } });
    return deny(res, 'hwid_blacklisted', 'Устройство заблокировано.', 403);
  }

  // 5. Activate on first login (starts the 30/90/180 day clock)
  license = licenseSvc.activate(license, { ip, build });

  // 6. HWID binding
  if (hwid) {
    const bind = licenseSvc.bindHwid(license, hwid, { label: hwidLabel, ip });
    if (!bind.ok) {
      if (bind.reason === 'hwid_mismatch') {
        audit.log('loader', license.id, 'loader.hwid_mismatch', { targetType: 'license', targetId: String(license.id), ip, meta: { resets_left: license.hwid_resets_left } });
        return deny(res, 'hwid_mismatch', 'Лицензия привязана к другому устройству. Сбросьте HWID в личном кабинете.', 403, {
          hwid_resets_left: license.hwid_resets_left,
          bound_at: license.hwid_bound_at,
          resets_url: `${config.publicUrl}/dashboard/license`
        });
      }
      return deny(res, bind.reason, 'Устройство не принято.', 403);
    }
    license = licenseSvc.byId(license.id);
  }

  // 7. Expiry
  const st = licenseSvc.state(license);
  if (st.status === 'expired' || (st.expires_at && st.expires_at <= now())) {
    if (license.status !== 'expired') db.run(`UPDATE licenses SET status='expired' WHERE id=?`, license.id);
    audit.log('loader', license.id, 'loader.expired', { targetType: 'license', targetId: String(license.id), ip });
    return deny(res, 'subscription_expired', `Подписка истекла ${util.formatDate(license.expires_at)}. Продлите доступ в личном кабинете.`, 402, {
      expired_at: license.expires_at,
      renew_url: `${config.publicUrl}/pricing`
    });
  }
  if (!st.usable) return deny(res, 'not_entitled', 'Нет активной подписки.', 402);

  // 8. Promote session
  const sessionTtl = Math.min(config.security.loaderSessionTtlSeconds * 1000, Math.max(60_000, st.remaining_ms || 60_000));
  db.run(
    `UPDATE loader_sessions SET license_id = ?, client_pub = ?, shared_key_enc = ?, state = 'authed',
       counter = 1, expires_at = ?, last_heartbeat = ?, ip = ?, build = ?, revoked_reason = NULL WHERE id = ?`,
    license.id, clientPub, passwords.encrypt(key.toString('hex'), SESSION_KEY_PURPOSE),
    now() + sessionTtl, now(), ip, build || null, session.id
  );

  audit.log('loader', license.id, 'loader.auth_ok', { targetType: 'license', targetId: String(license.id), ip, meta: { build, plan: license.plan_code, expires_at: license.expires_at } });

  const payload = loaderPayload(license, licenseSvc.state(licenseSvc.byId(license.id)), { sessionId: session.id, hwid: license.hwid, build });
  payload.session.expires_at = Math.floor((now() + sessionTtl) / 1000);

  const envelope = proto.encryptEnvelope(key, session.id, 1, payload);
  res.json({ ok: true, envelope });
});

/* ------------------------------------------------------------------- rpc -- */

router.post('/v1/rpc', ratelimit.middleware({ scope: 'loader', limit: config.security.rateLimit.loader, windowMs: config.security.rateLimit.windowMs }), (req, res) => {
  const ip = clientIp(req);
  const body = req.body || {};
  const status = siteStatus();

  const session = loadSession(body.sid);
  if (!session) return deny(res, 'session_not_found', 'Сессия не найдена или истекла.', 404);
  if (session.state === 'revoked') {
    // Translate the internal reason into something the client can act on.
    const REVOKED = {
      expired: ['subscription_expired', 402, 'Подписка истекла. Продлите доступ в личном кабинете.'],
      user_banned: ['account_banned', 403, 'Аккаунт заблокирован.'],
      hwid_blacklisted: ['hwid_blacklisted', 403, 'Устройство заблокировано.'],
      hwid_reset: ['hwid_reset', 403, 'Привязка устройства сброшена. Войдите заново.'],
      credentials_rotated: ['invalid_credentials', 401, 'Учётные данные изменены. Войдите заново.'],
      killswitch: ['killswitch', 503, 'Сервис временно недоступен.'],
      client_logout: ['session_closed', 403, 'Сессия закрыта клиентом.']
    };
    const [code, status, message] = REVOKED[session.revoked_reason] || ['license_revoked', 403, 'Доступ отозван.'];
    return deny(res, code, message, status, {
      reason: session.revoked_reason || null,
      ...(code === 'subscription_expired' ? { renew_url: `${config.publicUrl}/pricing` } : {})
    });
  }
  if (session.state !== 'authed') return deny(res, 'session_state', 'Сначала выполните рукопожатие.', 409);
  if (status.killswitch) {
    db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='killswitch' WHERE id=?`, session.id);
    return deny(res, 'killswitch', 'Сервис временно недоступен.', 503);
  }

  const keyHex = passwords.decrypt(session.shared_key_enc, SESSION_KEY_PURPOSE);
  if (!keyHex) return deny(res, 'session_broken', 'Ключ сессии недоступен.', 500);
  const key = Buffer.from(keyHex, 'hex');

  const n = Number(body.n);
  if (!Number.isFinite(n) || n <= session.counter) return deny(res, 'replay_detected', 'Пакет отклонён: счётчик не увеличился.', 400);

  let inner;
  try {
    inner = proto.decryptEnvelope(key, { v: body.v, sid: body.sid, n, ts: body.ts, p: body.p });
  } catch (err) {
    db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='decrypt_failed' WHERE id=?`, session.id);
    audit.log('loader', session.license_id, 'loader.rpc_decrypt_failed', { ip, meta: { err: err.message } });
    return deny(res, 'decrypt_failed', 'Не удалось расшифровать пакет.', 400);
  }

  db.run('UPDATE loader_sessions SET counter = ? WHERE id = ?', n, session.id);

  const license = licenseSvc.byId(session.license_id);
  if (!license) return deny(res, 'license_missing', 'Лицензия не найдена.', 404);

  const action = String(inner.action || 'heartbeat');
  const st = licenseSvc.state(license);
  const replyCounter = n;

  // Inside an established session the transport is always 200: the encrypted
  // envelope carries the semantic result. Non-2xx is reserved for transport
  // level failures (bad session, replay, revoked, expired) where no key
  // material should be handed back at all.
  const respond = (payload) => {
    const envelope = proto.encryptEnvelope(key, session.id, replyCounter, payload);
    return res.status(200).json({ ok: true, envelope });
  };

  /* --- hard gates re-evaluated on every call: expiry, ban, revoke, HWID --- */
  const user = db.get('SELECT id, status FROM users WHERE id = ?', license.user_id);
  if (user && user.status === 'banned') return deny(res, 'account_banned', 'Аккаунт заблокирован.', 403);
  if (license.status === 'revoked') return deny(res, 'license_revoked', 'Доступ отозван.', 403);
  if (license.status === 'banned') return deny(res, 'account_banned', 'Ключ заблокирован.', 403);
  if (st.status === 'expired') {
    db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='expired' WHERE id=?`, session.id);
    return deny(res, 'subscription_expired', `Подписка истекла ${util.formatDate(license.expires_at)}.`, 402, { renew_url: `${config.publicUrl}/pricing` });
  }

  switch (action) {
    case 'heartbeat': {
      db.run('UPDATE loader_sessions SET last_heartbeat = ?, ip = ? WHERE id = ?', now(), ip, session.id);
      db.run('UPDATE licenses SET last_seen_at = ?, last_seen_ip = ? WHERE id = ?', now(), ip, license.id);
      const fresh = licenseSvc.state(licenseSvc.byId(license.id));
      const remaining = Math.min(session.expires_at - now(), 15 * 60_000);
      if (remaining < 30_000) {
        db.run('UPDATE loader_sessions SET expires_at = ? WHERE id = ?', now() + Math.min(config.security.loaderSessionTtlSeconds * 1000, fresh.remaining_ms || 60_000), session.id);
      }
      return respond({
        ok: true,
        action,
        server_time: sec(),
        heartbeat_interval: HEARTBEAT_INTERVAL,
        state: fresh.status,
        expires_at: fresh.expires_at,
        remaining_ms: fresh.remaining_ms,
        site: { status: status.status, status_text: status.status_text, announcement: status.announcement },
        refresh_token: proto.issueLicenseToken({ license, hwid: license.hwid, sessionId: session.id, build: session.build, features: featuresFor(license.plan_code) }).token
      });
    }

    case 'license': {
      const fresh = licenseSvc.state(licenseSvc.byId(license.id));
      return respond(loaderPayload(license, fresh, { sessionId: session.id, hwid: license.hwid, build: session.build }));
    }

    case 'download': {
      const policy = buildPolicy();
      const hasArtifact = fs.existsSync(config.build.artifactPath);
      const enabled = db.settingBool('loader.download_enabled', true);
      if (!st.usable) return respond({ ok: false, action, code: 'not_entitled' });
      if (!enabled) return respond({ ok: false, action, code: 'downloads_disabled' });
      if (!hasArtifact) return respond({ ok: false, action, code: 'artifact_missing', message: 'Сборка не загружена на сервер.' });

      const ticket = proto.issueDownloadToken({ license, hwid: license.hwid, build: policy.latest });
      db.run('INSERT INTO downloads (license_id, user_id, build, ip, created_at) VALUES (?, ?, ?, ?, ?)',
        license.id, license.user_id, policy.latest, ip, now());
      audit.log('loader', license.id, 'loader.download_issued', { targetType: 'license', targetId: String(license.id), ip });
      return respond({
        ok: true,
        action,
        build: policy.latest,
        file_name: config.build.fileName,
        url: `${config.publicUrl}/dl/loader?t=${encodeURIComponent(ticket.token)}`,
        ttl: config.security.downloadTokenTtlSeconds,
        sha256: config.build.sha256 || (hasArtifact ? sha256(fs.readFileSync(config.build.artifactPath)) : null)
      });
    }

    case 'hwid_status': {
      return respond({
        ok: true,
        action,
        hwid_bound: !!license.hwid,
        hwid: license.hwid ? sha256(license.hwid).slice(0, 16) : null,
        label: license.hwid_label,
        resets_left: license.hwid_resets_left,
        cooldown_hours: config.licensing.hwidResetCooldownHours,
        devices: db.all('SELECT hwid, label, bound_at, revoked_at FROM license_devices WHERE license_id = ? ORDER BY id DESC', license.id)
          .map((d) => ({ hwid: sha256(d.hwid).slice(0, 16), label: d.label, bound_at: d.bound_at, revoked_at: d.revoked_at }))
      });
    }

    case 'logout': {
      db.run(`UPDATE loader_sessions SET state='revoked', revoked_reason='client_logout' WHERE id=?`, session.id);
      audit.log('loader', license.id, 'loader.logout', { targetType: 'license', targetId: String(license.id), ip });
      return respond({ ok: true, action, message: 'Сессия закрыта.' });
    }

    case 'extend_check': {
      return respond({ ok: true, action, plan: license.plan_code, expires_at: license.expires_at, renew_url: `${config.publicUrl}/pricing` });
    }

    default:
      return respond({ ok: false, action, code: 'unknown_action' });
  }
});

/* --------------------------------------------------------------- download -- */

const dlRouter = express.Router();

dlRouter.get('/dl/loader', (req, res) => {
  const token = String(req.query.t || '');
  const claims = proto.verifyPayload(token);
  if (!claims || claims.typ !== 'download') return deny(res, 'bad_ticket', 'Недействительный билет загрузки.', 401);
  if (claims.exp < sec()) return deny(res, 'ticket_expired', 'Ссылка истекла. Запросите новую в лоадере.', 410);

  const status = siteStatus();
  if (status.killswitch) return deny(res, 'killswitch', 'Сервис временно недоступен.', 503);

  if (!fs.existsSync(config.build.artifactPath)) {
    return deny(res, 'artifact_missing', 'Сборка не загружена на сервер.', 409);
  }

  const stat = fs.statSync(config.build.artifactPath);
  const digest = sha256(fs.readFileSync(config.build.artifactPath));
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${config.build.fileName}"`);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Build-Sha256', digest);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(config.build.artifactPath).pipe(res);
});

module.exports = router;
module.exports.downloads = dlRouter;
