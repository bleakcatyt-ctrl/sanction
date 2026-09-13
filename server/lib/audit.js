'use strict';

const db = require('../db');
const { now, jsonStringify, clientIp } = require('./util');

/**
 * Append-only audit trail. Every privileged action goes through here.
 */
function log(actorType, actorId, action, { targetType = null, targetId = null, meta = null, ip = null } = {}) {
  try {
    db.run(
      `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, meta, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      actorType,
      actorId === null || actorId === undefined ? null : String(actorId),
      action,
      targetType,
      targetId === null || targetId === undefined ? null : String(targetId),
      meta ? jsonStringify(meta) : null,
      ip,
      now()
    );
  } catch (err) {
    console.error('[audit] failed to write:', err.message);
  }
}

/** Convenience: pull actor info straight from the request. */
function fromReq(req, action, opts = {}) {
  const user = req.user || null;
  return log(user ? 'admin' : 'system', user ? user.id : null, action, { ip: clientIp(req), ...opts });
}

function list({ limit = 200, offset = 0, action = null, actorType = null } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  if (actorType) { where.push('actor_type = ?'); params.push(actorType); }
  const sql = `SELECT a.*, u.username AS actor_name
               FROM audit_log a LEFT JOIN users u ON u.id = CAST(a.actor_id AS INTEGER)
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY a.id DESC LIMIT ? OFFSET ?`;
  return db.all(sql, ...params, limit, offset);
}

function count({ action = null, actorType = null } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  if (actorType) { where.push('actor_type = ?'); params.push(actorType); }
  return db.pluck(`SELECT COUNT(*) FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params) || 0;
}

module.exports = { log, fromReq, list, count };
