'use strict';
const crypto = require('node:crypto');

const now = () => Date.now();
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // выравниваем время
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', copy: '©' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → безопасный plain text. На сайте описание выводится только через textContent. */
function htmlToText(html, max = 8000) {
  if (!html) return '';
  let s = String(html);
  s = fixMojibake(s);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\s*li[^>]*>/gi, '\n• ');
  s = s.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/ul|\/ol|\/tr)\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[\u00a0\u200b]/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return s;
}

/** Некоторые API отдают UTF-8, прочитанный как latin1 («â\u0080\u0099»). Чиним. */
function fixMojibake(s) {
  if (!/[\u00c2\u00c3\u00e2][\u0080-\u00bf]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('\ufffd') ? s : fixed;
  } catch { return s; }
}

function cleanLine(s, max = 200) {
  return decodeEntities(String(s ?? '')).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Только http(s)-ссылки (защита от javascript:/data: в данных внешних источников). */
function safeUrl(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString().slice(0, 1000);
  } catch { return ''; }
}

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|gmbh|ag|corp|corporation|co|company|plc|sa|bv|oy|ab|ооо|зао|ао|пао|ип)\b\.?/gi;
function companyKey(name) {
  return String(name).toLowerCase().replace(COMPANY_SUFFIX, ' ').replace(/[^a-z0-9а-яё]+/gi, '').slice(0, 80) || 'unknown';
}

module.exports = { now, randomToken, safeEqual, htmlToText, cleanLine, safeUrl, companyKey, fixMojibake, decodeEntities };
