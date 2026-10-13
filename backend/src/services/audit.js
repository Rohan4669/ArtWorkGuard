import { AuditLog } from '../models/AuditLog.js';

/** Audit records hold ids and counts only. Failures to audit never break the request but are surfaced in logs. */
export function createAudit(log) {
  return async (req, action, target = {}, meta = {}) => {
    try {
      await AuditLog.create({ actor: req?.user?._id, action, targetType: target.type, targetId: target.id ? String(target.id) : undefined, ip: req?.ip, meta });
    } catch (e) { log.error({ err: e.message, action }, 'audit write failed'); }
  };
}
