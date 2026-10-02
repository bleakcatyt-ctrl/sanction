'use strict';
const config = require('./config');
const { HttpError, securityHeaders, sendJson, clientIp, serveStatic } = require('./http');
const { handleApi } = require('./api');

function createApp(db) {
  return async function app(req, res) {
    securityHeaders(res);
    try {
      let url;
      try { url = new URL(req.url, 'http://local'); } catch { throw new HttpError(400, 'Bad request'); }
      const ctx = { req, res, url, db, ip: clientIp(req), session: null, user: null, pro: false };
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается');
        return await handleApi(ctx);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
      if (url.pathname.startsWith('/dev/') && !config.rollypay.fake) throw new HttpError(404, 'Не найдено');
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) {
        const headers = e.extra && e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
        if (req.url.startsWith('/api/')) return sendJson(res, e.status, { error: e.message, code: e.extra && e.extra.code }, headers);
        res.writeHead(e.status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
        return res.end(e.status === 404 ? 'Страница не найдена' : e.message);
      }
      console.error('[server] необработанная ошибка:', e);
      if (req.url.startsWith('/api/')) return sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Внутренняя ошибка сервера');
    }
  };
}
module.exports = { createApp };
