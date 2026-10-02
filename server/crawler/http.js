'use strict';
const config = require('../config');

const MAX_BYTES = 30 * 1024 * 1024;

/** Загрузка JSON из внешнего API: таймаут, лимит размера, запрет редиректов на другие схемы. */
async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': `VektorJobsBot/1.0 (+${config.appUrl})`, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('response too large');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('response too large'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

module.exports = { getJson };
