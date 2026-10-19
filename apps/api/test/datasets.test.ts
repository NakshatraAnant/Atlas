import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { parseCsv, parseDate, parseNumber, suggestMapping, validatePrices } from '../src/modules/datasets/csv.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

const CSV = ['Date,Open,High,Low,Close,Volume', '2026-01-01,100,110,95,105,1000', '02-01-2026,105,112,104,110,"1,200"', '05-Jan-2026,110,111,99,100,900', '2026-01-06,100,100,100,100,0'].join('\r\n');

describe('CSV parsing and validation', () => {
  it('parses quoted fields, escaped quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(() => parseCsv('a,"b')).toThrow(/Unterminated/);
  });
  it('accepts the documented date formats and rejects impossible dates', () => {
    expect(parseDate('2026-10-14')).toBe('2026-10-14');
    expect(parseDate('14-10-2026')).toBe('2026-10-14');
    expect(parseDate('14/10/2026')).toBe('2026-10-14');
    expect(parseDate('14-Oct-2026')).toBe('2026-10-14');
    expect(parseDate('31-02-2026')).toBeNull();
    expect(parseDate('Oct 14 2026')).toBeNull();
  });
  it('parses plain and Indian-grouped numbers, never guesses', () => {
    expect(parseNumber('1,23,456.50')).toBe(123456.5);
    expect(parseNumber('12e3')).toBeNull();
    expect(parseNumber('₹100')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
  it('suggests a mapping from common header names', () => {
    expect(suggestMapping(['Trade Date', 'Open Price', 'High', 'Low', 'Close Price', 'Total Traded Quantity'])).toEqual({ date: 'Trade Date', open: 'Open Price', high: 'High', low: 'Low', close: 'Close Price', volume: 'Total Traded Quantity' });
  });
  it('validates every rule and reports rejected rows with reasons', () => {
    const rows = parseCsv(['Date,Open,High,Low,Close,Volume', '2026-01-01,100,110,95,105,1000', '2026-01-02,100,90,95,92,10', '2026-01-02,100,110,95,105,10', '2026-01-03,-5,110,95,105,10', '2026-01-04,100,110,95,105,1.5', '2099-01-01,100,110,95,105,10', 'not a date,100,110,95,105,10', '2026-01-01,101,110,95,105,1000'].join('\n'));
    const { valid, report } = validatePrices(rows, suggestMapping(rows[0]!), '2026-10-19');
    expect(valid.map((v) => v.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(report.rows_in).toBe(8);
    expect(report.rows_rejected).toBe(6);
    const reasons = (row: number) => report.issues.find((i) => i.row === row)!.reasons.join(' ');
    expect(reasons(3)).toMatch(/OHLC/);
    expect(reasons(5)).toMatch(/open must be a positive/);
    expect(reasons(6)).toMatch(/volume must be/);
    expect(reasons(7)).toMatch(/future/);
    expect(reasons(8)).toMatch(/not a valid date/);
    expect(reasons(9)).toMatch(/duplicate/);
    expect(() => validatePrices(rows, { date: 'Date' }, '2026-10-19')).toThrow(/Map these columns/);
  });
});

describe('datasets API (private, labelled, deterministic analysis)', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  beforeAll(async () => {
    ctx = await fixtureContext();
    app = await buildApp(ctx);
  });
  afterAll(async () => {
    await app?.close();
    await ctx?.db.close();
  });
  const signedIn = async (email: string) => {
    const c = new Client(app);
    await c.login(email, DEV_PASSWORD);
    return c;
  };
  const meta = { name: 'My broker export', instrument_label: 'Example Ltd', source_description: 'Contract notes and broker statement I downloaded', rights_attested: true };

  it('previews with a suggested mapping, then stores only valid rows after the rights attestation', async () => {
    const u = await signedIn('pro@atlas.test');
    const p = await u.post('/v1/datasets/preview', { csv: CSV });
    expect(p.json.suggested_mapping).toEqual({ date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' });
    expect(p.json.label).toMatch(/User-provided data/);
    expect((await u.post('/v1/datasets', { csv: CSV, mapping: p.json.suggested_mapping, ...meta, rights_attested: false })).status).toBe(400);
    const r = await u.post('/v1/datasets', { csv: CSV, mapping: p.json.suggested_mapping, ...meta });
    expect(r.status).toBe(200);
    expect(r.json.report).toMatchObject({ rows_in: 4, rows_valid: 4, rows_rejected: 0, first_date: '2026-01-01', last_date: '2026-01-06' });
    expect((await u.post('/v1/datasets', { csv: CSV, mapping: p.json.suggested_mapping, ...meta })).status).toBe(409);
    const d = await u.get(`/v1/datasets/${r.json.dataset_id}`);
    expect(d.json.prices).toHaveLength(4);
    expect(d.json.prices[1]).toMatchObject({ trade_date: '2026-01-02', volume: 1200 });
    // 105 → 110 → 100 → 100: total return (100/105 − 1) = −4.7619%; max drawdown 100/110 − 1 = −9.0909%.
    expect(d.json.analysis.total_return_pct).toBeCloseTo(-4.7619, 4);
    expect(d.json.analysis.max_drawdown_pct).toBeCloseTo(-9.0909, 4);
    expect(d.json.analysis.cagr_pct).toBeNull();
    expect(d.json.label).toMatch(/never sent to an external AI/);
  });

  it('is private: another user cannot list, read or delete it', async () => {
    const owner = await signedIn('plus@atlas.test');
    const other = await signedIn('pro@atlas.test');
    const csv = CSV.replace('105,1000', '105,1001');
    const r = await owner.post('/v1/datasets', { csv, mapping: { date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close' }, ...meta });
    expect(r.status).toBe(200);
    expect((await other.get(`/v1/datasets/${r.json.dataset_id}`)).status).toBe(404);
    expect((await other.del(`/v1/datasets/${r.json.dataset_id}`)).status).toBe(404);
    expect((await other.get('/v1/datasets')).json.datasets.some((x: any) => x.dataset_id === r.json.dataset_id)).toBe(false);
    expect((await owner.del(`/v1/datasets/${r.json.dataset_id}`)).json.deleted).toBe(true);
    expect((await owner.get(`/v1/datasets/${r.json.dataset_id}`)).status).toBe(404);
    expect(await ctx.db.query(`SELECT 1 FROM app.user_dataset_prices WHERE dataset_id=$1`, [r.json.dataset_id])).toEqual([]);
  });

  it('rejects malformed input safely and refuses to save a file with no valid rows', async () => {
    const u = await signedIn('pro@atlas.test');
    expect((await u.post('/v1/datasets/preview', { csv: 'a,"b' })).status).toBe(400);
    const bad = 'Date,Open,High,Low,Close\nnope,1,1,1,1';
    const r = await u.post('/v1/datasets', { csv: bad, mapping: { date: 'Date', open: 'Open', high: 'High', low: 'Low', close: 'Close' }, ...meta });
    expect(r.status).toBe(400);
    expect(r.json.report.rows_rejected).toBe(1);
    expect((await new Client(app).post('/v1/datasets/preview', { csv: CSV })).status).toBe(401);
  });

  it('the database rejects inconsistent rows even if validation were bypassed', async () => {
    const id = (await ctx.db.one<{ dataset_id: string }>(`SELECT dataset_id FROM app.user_datasets LIMIT 1`)).dataset_id;
    await expect(ctx.db.query(`INSERT INTO app.user_dataset_prices (dataset_id, trade_date, open, high, low, close) VALUES ($1, '2026-02-01', 100, 90, 95, 92)`, [id])).rejects.toThrow();
  });
});
