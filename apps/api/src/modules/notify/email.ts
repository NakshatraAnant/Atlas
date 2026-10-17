import type { Db } from '../../db/db.js';

// Email service (Blueprint §4.2). All mail is written to app.email_outbox first; a transport
// delivers it. Development uses the outbox only (viewable in the admin console). Marketing and
// product-update mail requires consent (ACC-08); service, billing and security mail does not.

export type EmailCategory = 'service' | 'billing' | 'security' | 'briefing' | 'alert' | 'marketing' | 'product_updates';

export interface EmailTransport {
  readonly name: string;
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export class OutboxOnlyTransport implements EmailTransport {
  readonly name = 'outbox';
  async send(): Promise<void> {
    // Delivery is the outbox row itself in development; nothing leaves the machine.
  }
}

export async function queueEmail(db: Db, msg: { to: string; userId?: string | null; template: string; category: EmailCategory; subject: string; text: string }): Promise<string | null> {
  const suppressed = await db.maybeOne(`SELECT 1 FROM app.email_suppressions WHERE lower(email) = lower($1)`, [msg.to]);
  if (msg.userId && (msg.category === 'marketing' || msg.category === 'product_updates')) {
    const kind = msg.category === 'marketing' ? 'marketing' : 'product_updates';
    const consent = await db.maybeOne<{ granted: boolean }>(`SELECT granted FROM app.consents WHERE user_id=$1 AND kind=$2 ORDER BY at DESC LIMIT 1`, [msg.userId, kind]);
    if (!consent?.granted) return null;
  }
  const row = await db.one<{ email_id: string }>(
    `INSERT INTO app.email_outbox (to_email, user_id, template, category, subject, body_text, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING email_id`,
    [msg.to, msg.userId ?? null, msg.template, msg.category, msg.subject, msg.text, suppressed ? 'suppressed' : 'queued'],
  );
  return row.email_id;
}

/** Deliver queued mail with retries (max 5 attempts). Returns counts. */
export async function deliverOutbox(db: Db, transport: EmailTransport, limit = 200): Promise<{ sent: number; failed: number }> {
  const queued = await db.query<{ email_id: string; to_email: string; subject: string; body_text: string; attempts: number }>(
    `SELECT email_id, to_email, subject, body_text, attempts FROM app.email_outbox WHERE status='queued' ORDER BY created_at LIMIT $1`,
    [limit],
  );
  let sent = 0;
  let failed = 0;
  for (const m of queued) {
    try {
      await transport.send({ to: m.to_email, subject: m.subject, text: m.body_text });
      await db.query(`UPDATE app.email_outbox SET status='sent', sent_at=now(), attempts=attempts+1 WHERE email_id=$1`, [m.email_id]);
      sent++;
    } catch (err) {
      failed++;
      await db.query(`UPDATE app.email_outbox SET attempts=attempts+1, error=$2, status=CASE WHEN attempts+1 >= 5 THEN 'failed' ELSE 'queued' END WHERE email_id=$1`, [m.email_id, err instanceof Error ? err.message : String(err)]);
    }
  }
  return { sent, failed };
}
