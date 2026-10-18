import { bulkInsert } from '../../lib/bulk.js';
import type { VendorMacroEvent, VendorRiskFree } from '../synthetic/disclosures.js';
import type { VendorMasterRecord } from '../synthetic/generator.js';
import type { CheckResult, HandlerResult, PipelineCtx } from '../context.js';

const TEMPLATES = new Set(['standard', 'bank', 'nbfc', 'insurance']);

export async function handleMaster(ctx: PipelineCtx, records: VendorMasterRecord[], sourceId: string, isSynthetic: boolean): Promise<HandlerResult> {
  const checks: CheckResult[] = [];
  let valid = 0;
  let quarantined = 0;
  const seenIsin = new Set<string>();
  const seenSymbol = new Map<string, string>();
  await ctx.db.tx(async (db) => {
    for (const m of records) {
      const problems: string[] = [];
      if (seenIsin.has(m.isin)) problems.push('duplicate ISIN in file');
      if (!TEMPLATES.has(m.template)) problems.push(`unknown template ${m.template}`);
      for (const s of m.symbols.filter((x) => !x.valid_to)) {
        const owner = seenSymbol.get(s.symbol);
        if (owner && owner !== m.isin) problems.push(`symbol ${s.symbol} maps to two securities`);
        seenSymbol.set(s.symbol, m.isin);
      }
      if (problems.length) {
        quarantined++;
        checks.push({ check: 'identifier_continuity', severity: 'fail', detail: `${m.isin}: ${problems.join('; ')}` });
        continue;
      }
      seenIsin.add(m.isin);
      const existing = await db.maybeOne<{ security_id: number; company_id: string }>(`SELECT security_id, company_id FROM ref.securities WHERE isin = $1`, [m.isin]);
      let companyId: string;
      let securityId: number;
      if (!existing) {
        const c = await db.one<{ company_id: string }>(
          `INSERT INTO ref.companies (legal_name, short_name, former_names, cin, sector, industry, sector_template, status, coverage, description, description_source_id, description_as_of, segments_reported, is_synthetic)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING company_id`,
          [m.company_name, m.short_name, m.former_names, m.cin, m.sector, m.industry, m.template, m.status, m.coverage, m.description, sourceId, m.listed_on, m.segments_reported, isSynthetic],
        );
        companyId = c.company_id;
        const s = await db.one<{ security_id: number }>(
          `INSERT INTO ref.securities (company_id, isin, listed_on, delisted_on, face_value, is_synthetic) VALUES ($1,$2,$3,$4,$5,$6) RETURNING security_id`,
          [companyId, m.isin, m.listed_on, m.delisted_on, m.face_value, isSynthetic],
        );
        securityId = s.security_id;
      } else {
        companyId = existing.company_id;
        securityId = existing.security_id;
        await db.query(
          `UPDATE ref.companies SET legal_name=$2, short_name=$3, former_names=$4, status=$5, coverage=$6, sector=$7, industry=$8, updated_at=now() WHERE company_id=$1`,
          [companyId, m.company_name, m.short_name, m.former_names, m.status, m.coverage, m.sector, m.industry],
        );
        await db.query(`UPDATE ref.securities SET delisted_on=$2, face_value=$3 WHERE security_id=$1`, [securityId, m.delisted_on, m.face_value]);
      }
      for (const s of m.symbols) {
        await db.query(
          `INSERT INTO ref.security_identifiers (security_id, exchange_code, symbol, series, valid_from, valid_to) VALUES ($1,'NSE',$2,'EQ',$3,$4)
           ON CONFLICT (security_id, exchange_code, valid_from) DO UPDATE SET valid_to = EXCLUDED.valid_to, symbol = EXCLUDED.symbol`,
          [securityId, s.symbol, s.valid_from, s.valid_to],
        );
      }
      if (m.bse_code) {
        await db.query(
          `INSERT INTO ref.security_identifiers (security_id, exchange_code, symbol, series, valid_from, valid_to) VALUES ($1,'BSE',$2,'A',$3,NULL) ON CONFLICT (security_id, exchange_code, valid_from) DO NOTHING`,
          [securityId, m.bse_code, m.listed_on],
        );
      }
      valid++;
    }
  });
  checks.unshift({ check: 'schema', severity: 'pass', detail: `${records.length} master records parsed` });
  return { rowsIn: records.length, rowsValid: valid, rowsQuarantined: quarantined, checks, status: quarantined ? 'partial' : 'succeeded' };
}

export async function handleCalendar(ctx: PipelineCtx, records: { date: string; isTradingDay: boolean; note: string | null }[], sourceId: string): Promise<HandlerResult> {
  const rows = records.map((r) => ({ exchange_code: 'NSE', trade_date: r.date, is_trading_day: r.isTradingDay, note: r.note, source_id: sourceId }));
  for (let i = 0; i < rows.length; i += 4000) {
    await ctx.db.query(
      `INSERT INTO ref.trading_calendar (exchange_code, trade_date, is_trading_day, note, source_id)
       SELECT exchange_code, trade_date, is_trading_day, note, source_id FROM json_populate_recordset(NULL::ref.trading_calendar, $1::json)
       ON CONFLICT (exchange_code, trade_date) DO UPDATE SET is_trading_day = EXCLUDED.is_trading_day, note = EXCLUDED.note`,
      [JSON.stringify(rows.slice(i, i + 4000))],
    );
  }
  return { rowsIn: rows.length, rowsValid: rows.length, rowsQuarantined: 0, checks: [{ check: 'schema', severity: 'pass', detail: `${rows.length} calendar days` }], status: 'succeeded' };
}

export async function handleRiskFree(ctx: PipelineCtx, records: VendorRiskFree[], sourceId: string, runId: string): Promise<HandlerResult> {
  const bad = records.filter((r) => !(r.tbill_91d_yield_pct > 0 && r.tbill_91d_yield_pct < 25));
  const good = records.filter((r) => !bad.includes(r));
  await bulkInsert(ctx.db, 'ref.risk_free_rates', good.map((r) => ({ auction_date: r.auction_date, tenor: '91D', yield_pct: r.tbill_91d_yield_pct, source_id: sourceId, ingestion_run_id: runId })), { onConflict: 'ON CONFLICT (auction_date) DO NOTHING' });
  return {
    rowsIn: records.length, rowsValid: good.length, rowsQuarantined: bad.length,
    checks: [{ check: 'ranges_and_signs', severity: bad.length ? 'fail' : 'pass', detail: `${bad.length} yields outside 0–25%` }],
    status: bad.length ? 'partial' : 'succeeded',
  };
}

export async function handleMacroCalendar(ctx: PipelineCtx, records: VendorMacroEvent[], sourceId: string): Promise<HandlerResult> {
  const companies = new Map((await ctx.db.query<{ isin: string; company_id: string }>(`SELECT isin, company_id FROM ref.securities`)).map((r) => [r.isin, r.company_id]));
  let n = 0;
  for (const e of records) {
    await ctx.db.query(
      `INSERT INTO ref.calendar_events (event_date, kind, title, status, company_id, source_id) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (event_date, kind, title) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
      [e.event_date, e.kind, e.title, e.status, e.isin ? companies.get(e.isin) ?? null : null, sourceId],
    );
    n++;
  }
  return { rowsIn: records.length, rowsValid: n, rowsQuarantined: 0, checks: [{ check: 'schema', severity: 'pass', detail: `${n} events` }], status: 'succeeded' };
}
