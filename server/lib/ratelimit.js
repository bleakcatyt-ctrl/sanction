'use strict';

/**
 * Tiny in-memory sliding-window limiter. Fine for a single instance;
 * swap the store for Redis when you scale horizontally.
 */

const { clientIp } = require('./util');

const buckets = new Map();

function sweep() {
  const t = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.reset < t) buckets.delete(key);
  }
}
setInterval(sweep, 60_000).unref();

function hit(key, limit, windowMs) {
  const t = Date.now();
  let entry = buckets.get(key);
  if (!entry || entry.reset < t) {
    entry = { count: 0, reset: t + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    limit,
    resetMs: entry.reset - t
  };
}

function middleware({ limit, windowMs = 60_000, scope = 'global', keyFn = null } = {}) {
  return function rateLimit(req, res, next) {
    const identity = keyFn ? keyFn(req) : (req.user ? `u:${req.user.id}` : `ip:${clientIp(req)}`);
    const key = `${scope}:${identity}`;
    const r = hit(key, limit, windowMs);
    res.setHeader('X-RateLimit-Limit', String(r.limit));
    res.setHeader('X-RateLimit-Remaining', String(r.remaining));
    if (!r.allowed) {
      const retry = Math.ceil(r.resetMs / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: `Слишком много запросов. Повторите через ${retry} с.`,
        retry_after: retry
      });
    }
    next();
  };
}

/** One-off check used inside handlers (login attempts, loader auth, etc.). */
function check(scope, identity, limit, windowMs = 60_000) {
  return hit(`${scope}:${identity}`, limit, windowMs);
}

function reset(scope, identity) {
  buckets.delete(`${scope}:${identity}`);
}

module.exports = { middleware, check, reset, hit };
