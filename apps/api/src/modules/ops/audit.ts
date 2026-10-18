import { createHash } from 'node:crypto';
import type { Db } from '../../db/db.js';

// Immutable, hash-chained audit log (PRD ADM-08). Updates and deletes are rejected by a trigger;
// each row stores the hash of the previous row so tampering with history is detectable.

export interface AuditEntry {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string | null;
  details?: Record<string, unknown>;
}

export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.tx(async (t) => {
    // Serialise writers so the chain is linear (advisory lock is held until commit).
    await t.query(`SELECT pg_advisory_xact_lock(4242)`);
    const prev = await t.maybeOne<{ hash: string }>(`SELECT hash FROM ops.audit_log ORDER BY audit_id DESC LIMIT 1`);
    const prevHash = prev?.hash ?? 'genesis';
    const at = new Date().toISOString();
    const body = JSON.stringify([prevHash, at, e.actorUserId, e.actorRole, e.action, e.targetType ?? null, e.targetId ?? null, e.reason ?? null, e.details ?? {}]);
    const hash = createHash('sha256').update(body).digest('hex');
    await t.query(
      `INSERT INTO ops.audit_log (at, actor_user_id, actor_role, action, target_type, target_id, reason, details, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [at, e.actorUserId, e.actorRole, e.action, e.targetType ?? null, e.targetId ?? null, e.reason ?? null, JSON.stringify(e.details ?? {}), prevHash, hash],
    );
  });
}

export async function verifyAuditChain(db: Db): Promise<{ ok: boolean; rows: number; brokenAt?: number }> {
  const rows = await db.query<{ audit_id: number; at: string; actor_user_id: string | null; actor_role: string | null; action: string; target_type: string | null; target_id: string | null; reason: string | null; details: Record<string, unknown>; prev_hash: string; hash: string }>(`SELECT * FROM ops.audit_log ORDER BY audit_id`);
  let prev = 'genesis';
  for (const r of rows) {
    const body = JSON.stringify([prev, r.at, r.actor_user_id, r.actor_role, r.action, r.target_type, r.target_id, r.reason, r.details]);
    const h = createHash('sha256').update(body).digest('hex');
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, rows: rows.length, brokenAt: r.audit_id };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length };
}
