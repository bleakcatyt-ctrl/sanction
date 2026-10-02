'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* ---------- заголовки безопасности ---------- */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/* ---------- ответы ---------- */
function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

/* ---------- клиентский IP ---------- */
function clientIp(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '');
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    // proxy дописывает реальный адрес клиента последним — левые значения подделываются клиентом
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

/* ---------- тело запроса ---------- */
function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) return reject(new HttpError(413, 'Слишком большой запрос'));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Ожидается application/json');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

/* ---------- cookie ---------- */
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { /* пропускаем битые */ }
  }
  return out;
}

function serializeCookie(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (config.secureCookies) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

/* ---------- CSRF: Origin + токен ---------- */
function checkOrigin(req) {
  const origin = req.headers.origin;
  const allowed = new URL(config.appUrl).origin;
  if (origin) {
    if (origin !== allowed) throw new HttpError(403, 'Недопустимый Origin');
    return;
  }
  // Нет Origin (старые клиенты/curl): требуем Sec-Fetch-Site не cross-site
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') throw new HttpError(403, 'Межсайтовый запрос отклонён');
}

/* ---------- rate limit (в памяти, скользящее окно) ---------- */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    const retry = Math.ceil((windowMs - (t - arr[0])) / 1000);
    throw new HttpError(429, 'Слишком много запросов. Попробуйте позже.', { retryAfter: retry });
  }
  arr.push(t);
  buckets.set(key, arr);
}
function rateLimitPeek(key, max, windowMs) {
  const t = Date.now();
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  return arr.length >= max;
}
function rateLimitReset(key) { buckets.delete(key); }
setInterval(() => {
  const t = Date.now();
  for (const [k, arr] of buckets) if (!arr.length || t - arr[arr.length - 1] > 3600_000) buckets.delete(k);
}, 600_000).unref();

/* ---------- статика (только /web) ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const WEB_REAL = fs.existsSync(config.WEB_DIR) ? fs.realpathSync(config.WEB_DIR) : config.WEB_DIR;

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Bad path'); }
  if (rel.includes('\0')) throw new HttpError(400, 'Bad path');
  // любые скрытые сегменты (/.env, /.git/…) — сразу 404, даже без расширения
  if (rel.split('/').some((seg) => seg.startsWith('.'))) throw new HttpError(404, 'Не найдено');
  const ext = path.extname(rel).toLowerCase();
  // Любой путь без расширения — страница SPA
  let file = ext ? path.join(WEB_REAL, rel) : path.join(WEB_REAL, 'index.html');
  // Скрытые файлы и «не веб» расширения не раздаём вообще
  const base = path.basename(file);
  if (base.startsWith('.') || (ext && !MIME[ext])) throw new HttpError(404, 'Не найдено');
  let real;
  try { real = fs.realpathSync(file); } catch { throw new HttpError(404, 'Не найдено'); }
  if (!(real === WEB_REAL || real.startsWith(WEB_REAL + path.sep))) throw new HttpError(404, 'Не найдено');
  const st = fs.statSync(real);
  if (!st.isFile()) throw new HttpError(404, 'Не найдено');
  const type = MIME[path.extname(real).toLowerCase()] || 'application/octet-stream';
  const isFont = type === 'font/woff2';
  const isHtml = type.startsWith('text/html');
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    ETag: etag,
    'Cache-Control': isHtml ? 'no-cache' : isFont ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(real).pipe(res);
}

module.exports = {
  HttpError, securityHeaders, sendJson, clientIp, readBody, readJson, parseCookies, serializeCookie,
  checkOrigin, rateLimit, rateLimitPeek, rateLimitReset, serveStatic,
};
