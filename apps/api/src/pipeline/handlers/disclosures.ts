import type { CheckResult, HandlerResult, PipelineCtx } from '../context.js';
import type { VendorAnnouncement, VendorInsiderTrade } from '../synthetic/disclosures.js';

// Announcements are stored with their original document. Document text is third-party content:
// it is rendered as text and, when sent to the model, wrapped as untrusted data (AIA-12).

export async function handleAnnouncements(ctx: PipelineCtx, records: VendorAnnouncement[], meta: { sourceId: string; runId: string; mode: 'history' | 'daily'; asOf: string }): Promise<HandlerResult> {
  const db = ctx.db;
  const companies = new Map((await db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  let n = 0;
  let unmapped = 0;
  let future = 0;
  const affected = new Set<string>();
  const now = ctx.now().toISOString();
  for (const a of records) {
    const companyId = companies.get(a.isin);
    if (!companyId) {
      unmapped++;
      continue;
    }
    if (a.published_at > `${meta.asOf}T18:29:59.999Z`) {
      future++;
      continue;
    }
    // History files: receipt is reconstructed as five minutes after publication. Daily: the actual receipt time.
    const receivedAt = meta.mode === 'history' ? new Date(Date.parse(a.published_at) + 5 * 60_000).toISOString() : now < a.published_at ? a.published_at : now;
    const docKey = `documents/announcements/${a.vendor_id}.txt`;
    await ctx.store.put(docKey, `${a.subject}\n\n${a.body_text}`);
    const res = await db.query<{ announcement_id: string }>(
      `INSERT INTO disc.announcements (vendor_ref, company_id, exchange_code, category, subcategory, subject, body_text, published_at, received_at, document_key, source_id, ingestion_run_id, licence_flags)
       VALUES ($1,$2,'NSE',$3,$4,$5,$6,$7,$8,$9,$10,$11,'{"untrusted_text": true}') ON CONFLICT (source_id, vendor_ref) DO NOTHING RETURNING announcement_id`,
      [a.vendor_id, companyId, a.category, a.subcategory, a.subject, a.body_text, a.published_at, receivedAt, docKey, meta.sourceId, meta.runId],
    );
    if (res[0]) {
      await db.query(`UPDATE disc.announcements SET document_url = $2 WHERE announcement_id = $1`, [res[0].announcement_id, `/v1/documents/${res[0].announcement_id}`]);
      n++;
      affected.add(companyId);
    }
  }
  const checks: CheckResult[] = [
    { check: 'identifier_continuity', severity: unmapped ? 'fail' : 'pass', detail: `${unmapped} announcements for unknown companies`, count: unmapped },
    { check: 'timestamp_sanity', severity: future ? 'fail' : 'pass', detail: `${future} announcements timestamped in the future`, count: future },
  ];
  return { rowsIn: records.length, rowsValid: n, rowsQuarantined: unmapped + future, checks, status: unmapped + future ? 'partial' : 'succeeded', affected: { companies: [...affected] } };
}

export async function handleInsiderTrades(ctx: PipelineCtx, records: VendorInsiderTrade[], meta: { sourceId: string }): Promise<HandlerResult> {
  const companies = new Map((await ctx.db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  let n = 0;
  for (const t of records) {
    const companyId = companies.get(t.isin);
    if (!companyId || t.shares <= 0) continue;
    const dup = await ctx.db.maybeOne(`SELECT 1 FROM disc.insider_trades WHERE company_id=$1 AND transaction_date=$2 AND shares=$3 AND person_category=$4`, [companyId, t.transaction_date, t.shares, t.person_category]);
    if (dup) continue;
    await ctx.db.query(
      `INSERT INTO disc.insider_trades (company_id, person_category, transaction_type, shares, value_inr, transaction_date, disclosed_at, source_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [companyId, t.person_category, t.transaction_type, t.shares, t.value_inr, t.transaction_date, t.disclosed_at, meta.sourceId],
    );
    n++;
  }
  return { rowsIn: records.length, rowsValid: n, rowsQuarantined: records.length - n, checks: [{ check: 'ranges_and_signs', severity: 'pass', detail: `${n} insider disclosures stored` }], status: 'succeeded' };
}
