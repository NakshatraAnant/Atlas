import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { bulkInsert } from '../../lib/bulk.js';
import { badRequest, conflict, notFound, parse } from '../../lib/http.js';
import { requireVerified, requireUser } from '../auth/service.js';
import { maxDrawdown } from '../backtest/metrics.js';
import { realisedVol, sma } from '../calc/indicators.js';
import { MAX_CSV_BYTES, parseCsv, PRICE_FIELDS, suggestMapping, validatePrices } from './csv.js';

// User-provided datasets (PRD data-access principle: lawful data only). Private to the uploader;
// every response labels the data as user-provided and unverified by ATLAS.

export const USER_DATA_LABEL = 'User-provided data. ATLAS has not verified it; it is visible only to you and is never sent to an external AI model.';
const mappingSchema = z.object(Object.fromEntries(PRICE_FIELDS.map((f) => [f, z.string().max(80).optional()])) as Record<(typeof PRICE_FIELDS)[number], z.ZodOptional<z.ZodString>>);
const csvSchema = z.string().min(1).max(MAX_CSV_BYTES);
const today = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export async function datasetRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const csvOrBad = (text: string) => {
    try {
      return parseCsv(text);
    } catch (e) {
      throw badRequest(`The file could not be read as CSV: ${(e as Error).message}.`);
    }
  };

  app.post('/v1/datasets/preview', async (req) => {
    requireUser(req);
    const { csv } = parse(z.object({ csv: csvSchema }), req.body);
    const rows = csvOrBad(csv);
    if (rows.length < 2) throw badRequest('The file needs a header row and at least one data row.');
    const headers = rows[0]!;
    const mapping = suggestMapping(headers);
    let sample = null;
    try {
      sample = validatePrices(rows.slice(0, 51), mapping, today(ctx.clock())).report;
    } catch (e) {
      sample = { error: (e as Error).message };
    }
    return { headers, suggested_mapping: mapping, rows: rows.length - 1, sample_report: sample, label: USER_DATA_LABEL };
  });

  app.post('/v1/datasets', async (req) => {
    const u = requireVerified(req);
    const body = parse(z.object({
      csv: csvSchema, mapping: mappingSchema, name: z.string().trim().min(1).max(120), instrument_label: z.string().trim().min(1).max(120),
      currency: z.string().regex(/^[A-Z]{3}$/).default('INR'), source_description: z.string().trim().min(3).max(500), rights_attested: z.literal(true),
    }), req.body);
    const rows = csvOrBad(body.csv);
    let result: ReturnType<typeof validatePrices>;
    try {
      result = validatePrices(rows, body.mapping, today(ctx.clock()));
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    if (result.valid.length === 0) throw badRequest('No row passed validation; nothing was saved.', { report: result.report });
    const sha = createHash('sha256').update(body.csv).digest('hex');
    if (await db.maybeOne(`SELECT 1 FROM app.user_datasets WHERE user_id=$1 AND file_sha256=$2 AND deleted_at IS NULL`, [u.userId, sha])) throw conflict('You already uploaded this exact file.');
    const id = await db.tx(async (t) => {
      const row = await t.one<{ dataset_id: string }>(
        `INSERT INTO app.user_datasets (user_id, name, kind, instrument_label, currency, source_description, rights_attested_at, mapping, report, file_sha256, rows_valid, first_date, last_date)
         VALUES ($1,$2,'daily_prices',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING dataset_id`,
        [u.userId, body.name, body.instrument_label, body.currency, body.source_description, ctx.clock().toISOString(), JSON.stringify(body.mapping), JSON.stringify(result.report), sha, result.valid.length, result.report.first_date, result.report.last_date],
      );
      await bulkInsert(t, 'app.user_dataset_prices', result.valid.map((r) => ({ dataset_id: row.dataset_id, trade_date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })), { chunk: 2000 });
      return row.dataset_id;
    });
    return { dataset_id: id, report: result.report, label: USER_DATA_LABEL };
  });

  app.get('/v1/datasets', async (req) => {
    const u = requireUser(req);
    return { datasets: await db.query(`SELECT dataset_id, name, instrument_label, currency, rows_valid, first_date, last_date, created_at FROM app.user_datasets WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [u.userId]), label: USER_DATA_LABEL };
  });

  const own = async (userId: string, id: string) => {
    const d = await db.maybeOne<Record<string, unknown> & { dataset_id: string }>(`SELECT dataset_id, name, instrument_label, currency, source_description, rights_attested_at, mapping, report, rows_valid, first_date, last_date, created_at FROM app.user_datasets WHERE dataset_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, userId]);
    if (!d) throw notFound();
    return d;
  };

  app.get('/v1/datasets/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const d = await own(u.userId, id);
    const prices = await db.query<{ trade_date: string; open: number; high: number; low: number; close: number; volume: number | null }>(`SELECT trade_date, open, high, low, close, volume FROM app.user_dataset_prices WHERE dataset_id=$1 ORDER BY trade_date`, [id]);
    const closes = prices.map((p) => p.close);
    const vol = realisedVol(closes, Math.min(20, Math.max(2, closes.length - 1)));
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const n = closes.length;
    const years = n > 1 ? (Date.parse(prices[n - 1]!.trade_date) - Date.parse(prices[0]!.trade_date)) / (365.25 * 86_400_000) : 0;
    const analysis = {
      // Deterministic calculations on the uploaded closes (unadjusted: ATLAS cannot know your series' corporate actions).
      sessions: n,
      total_return_pct: n > 1 ? (closes[n - 1]! / closes[0]! - 1) * 100 : null,
      cagr_pct: n > 1 && years >= 1 ? (Math.pow(closes[n - 1]! / closes[0]!, 1 / years) - 1) * 100 : null,
      volatility_20d_annualised_pct: vol[n - 1] === null || vol[n - 1] === undefined ? null : vol[n - 1]! * 100,
      max_drawdown_pct: n > 1 ? maxDrawdown(closes).dd * 100 : null,
      sma_50: s50[n - 1] ?? null,
      sma_200: s200[n - 1] ?? null,
      caveats: ['Prices are as uploaded and not adjusted for splits, bonuses or dividends.', 'CAGR is shown only for periods of at least one year.', 'Missing sessions in the upload are not filled in.'],
    };
    return { ...d, prices, analysis, label: USER_DATA_LABEL };
  });

  app.delete('/v1/datasets/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await own(u.userId, id);
    await db.tx(async (t) => {
      await t.query(`DELETE FROM app.user_dataset_prices WHERE dataset_id=$1`, [id]);
      await t.query(`UPDATE app.user_datasets SET deleted_at=$2 WHERE dataset_id=$1`, [id, ctx.clock().toISOString()]);
    });
    return { deleted: true };
  });
}
