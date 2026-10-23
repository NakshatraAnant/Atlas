import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Db } from '../../db/db.js';
import { freshnessOf } from '../../lib/freshness.js';
import { parse } from '../../lib/http.js';
import { admit, categoryFor, record } from '../../lib/providerGate.js';
import { requireUser } from '../auth/service.js';
import type { FetchFn } from '../equity/providers.js';

// Indian agricultural market (mandi) prices from data.gov.in (Open Government Data Platform India),
// dataset "Current Daily Price of Various Commodities from Various Markets (Mandi)" (Agmarknet),
// resource 9ef84268-d588-465a-a308-a864a43d0070, under the Government Open Data License – India
// (commercial and non-commercial use with attribution). These are physical spot prices reported by
// markets, in rupees per quintal; they are not futures prices. The resource carries the current day's
// reports only, so ATLAS builds history by storing each day it retrieves.
// Status: implemented against the documented field names; NOT yet verified with a real response (needs
// your own DATA_GOV_IN_API_KEY; the shared sample key answered HTTP 429 on 23 Oct 2026).

export const MANDI_RESOURCE = '9ef84268-d588-465a-a308-a864a43d0070';
export const MANDI_COMMODITIES = ['Onion', 'Potato', 'Tomato', 'Wheat', 'Rice', 'Soyabean', 'Cotton', 'Mustard'];
export const MANDI_ATTRIBUTION = 'Source: Agmarknet, via Open Government Data Platform India (data.gov.in), Government Open Data License – India.';

export interface MandiRow { arrival_date: string; state: string; district: string; market: string; commodity: string; variety: string; grade: string; min_price: number | null; max_price: number | null; modal_price: number }

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Parses one page; rows without a valid date or modal price are rejected (counted), never repaired. */
export function parseMandi(body: string): { rows: MandiRow[]; total: number | null; rejected: number } {
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    throw new Error('data.gov.in returned a response that is not JSON.');
  }
  if (!Array.isArray(j?.records)) throw new Error(`data.gov.in response has no records${j?.error ? `: ${String(j.error).slice(0, 120)}` : ''}.`);
  let rejected = 0;
  const rows: MandiRow[] = [];
  for (const r of j.records) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r?.arrival_date ?? ''));
    const modal = num(r?.modal_price);
    if (!m || modal === null || modal <= 0 || !r?.market || !r?.commodity) { rejected++; continue; }
    rows.push({ arrival_date: `${m[3]}-${m[2]}-${m[1]}`, state: String(r.state ?? ''), district: String(r.district ?? ''), market: String(r.market), commodity: String(r.commodity), variety: String(r.variety ?? ''), grade: String(r.grade ?? ''), min_price: num(r.min_price), max_price: num(r.max_price), modal_price: modal });
  }
  const total = num(j.total);
  return { rows, total, rejected };
}

export async function importMandi(db: Db, fetchFn: FetchFn, key: string, commodity: string, now: Date): Promise<{ commodity: string; stored: number; rejected: number; error: string | null }> {
  const out = { commodity, stored: 0, rejected: 0, error: null as string | null };
  if (!key) { out.error = 'data.gov.in is not configured (DATA_GOV_IN_API_KEY).'; return out; }
  for (let offset = 0, page = 0; page < 10; page++) {
    const a = await admit(db, 'data_gov_in', now, 'mandi', `mandi:${commodity}`);
    if (!a.allowed) { out.error = `data.gov.in requests are paused (${a.reason}).`; return out; }
    const url = `https://api.data.gov.in/resource/${MANDI_RESOURCE}?api-key=${encodeURIComponent(key)}&format=json&limit=1000&offset=${offset}&filters[commodity]=${encodeURIComponent(commodity)}`;
    let status = 0;
    try {
      const r = await fetchFn(url, { headers: { accept: 'application/json', 'user-agent': 'ATLAS-local-research/0.1' } });
      status = r.status;
      const body = await r.text();
      if (status >= 400) {
        await record(db, 'data_gov_in', now, { endpoint: 'mandi', http_status: status, ok: false, category: categoryFor(status), message: `HTTP ${status}` });
        out.error = `data.gov.in answered HTTP ${status}.`;
        return out;
      }
      const p = parseMandi(body);
      await record(db, 'data_gov_in', now, { endpoint: 'mandi', http_status: status, ok: true });
      out.rejected += p.rejected;
      for (const row of p.rows) {
        await db.query(`INSERT INTO commodity.mandi_prices (arrival_date, state, district, market, commodity, variety, grade, min_price, max_price, modal_price, retrieved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (arrival_date, state, district, market, commodity, variety, grade) DO UPDATE SET min_price=EXCLUDED.min_price, max_price=EXCLUDED.max_price, modal_price=EXCLUDED.modal_price, retrieved_at=EXCLUDED.retrieved_at`,
          [row.arrival_date, row.state, row.district, row.market, row.commodity, row.variety, row.grade, row.min_price, row.max_price, row.modal_price, now.toISOString()]);
        out.stored++;
      }
      offset += 1000;
      if (p.total === null || offset >= p.total || !p.rows.length) break;
    } catch (err) {
      await record(db, 'data_gov_in', now, { endpoint: 'mandi', http_status: status || null, ok: false, category: 'malformed', message: (err as Error).message.replace(/api-key=[^&\s]+/g, 'api-key=REDACTED') });
      out.error = (err as Error).message.replace(/api-key=[^&\s]+/g, 'api-key=REDACTED').slice(0, 200);
      return out;
    }
  }
  return out;
}

let refreshing = false;
let lastRun = 0;
/** Once every 12 hours at most (the resource carries the current day's reports). */
export async function refreshMandi(db: Db, fetchFn: FetchFn, key: string, now: Date): Promise<{ attempted: number }> {
  if (!key || refreshing || now.getTime() - lastRun < 12 * 3_600_000) return { attempted: 0 };
  refreshing = true;
  lastRun = now.getTime();
  try {
    let n = 0;
    for (const c of MANDI_COMMODITIES) {
      const r = await importMandi(db, fetchFn, key, c, now);
      n++;
      if (r.error && /paused/.test(r.error)) break;
    }
    return { attempted: n };
  } finally {
    refreshing = false;
  }
}

export async function mandiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/commodities/mandi', async (req) => {
    requireUser(req);
    const q = parse(z.object({ commodity: z.string().max(40).optional() }), req.query);
    const configured = !!ctx.cfg.DATA_GOV_IN_API_KEY;
    const summary = await ctx.db.query<{ commodity: string; latest: string; markets: number; median_modal: number; days: number }>(
      `WITH latest AS (SELECT commodity, max(arrival_date) AS d FROM commodity.mandi_prices GROUP BY commodity)
       SELECT m.commodity, to_char(l.d,'YYYY-MM-DD') AS latest, count(*)::int AS markets, percentile_cont(0.5) WITHIN GROUP (ORDER BY m.modal_price)::float8 AS median_modal,
              (SELECT count(DISTINCT arrival_date)::int FROM commodity.mandi_prices x WHERE x.commodity=m.commodity) AS days
         FROM commodity.mandi_prices m JOIN latest l ON l.commodity=m.commodity AND l.d=m.arrival_date GROUP BY m.commodity, l.d ORDER BY m.commodity`);
    const series = q.commodity ? await ctx.db.query<{ d: string; median: number; markets: number }>(`SELECT to_char(arrival_date,'YYYY-MM-DD') AS d, percentile_cont(0.5) WITHIN GROUP (ORDER BY modal_price)::float8 AS median, count(*)::int AS markets FROM commodity.mandi_prices WHERE commodity=$1 GROUP BY arrival_date ORDER BY arrival_date`, [q.commodity]) : [];
    return {
      configured, verified: false,
      status_note: configured ? 'Implemented to the documented dataset schema; the first successful import will verify it.' : 'Not connected: needs your free data.gov.in API key (DATA_GOV_IN_API_KEY in .env.local).',
      summary: summary.map((s) => ({ ...s, freshness: freshnessOf(s.latest, 'daily', ctx.clock()) })), series,
      units: 'Rupees per quintal (100 kg), modal price as reported by each market.', attribution: MANDI_ATTRIBUTION,
      method: 'Median of the modal prices reported by all markets for a commodity on a date; markets and varieties differ from day to day, so the median describes what was reported, not one market.',
    };
  });
}
