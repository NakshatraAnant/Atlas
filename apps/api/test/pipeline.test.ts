import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { computeAdjusted } from '../src/pipeline/calc/adjust.js';
import { validatePriceRow } from '../src/pipeline/handlers/prices.js';
import { ingestFile } from '../src/pipeline/ingest.js';
import { buildBriefing } from '../src/modules/market/briefing.js';
import { checkClaims } from '../src/modules/ai/claims.js';
import { loadPit, lastFourQuarters } from '../src/modules/fundamentals/pit.js';
import { sharesOn } from '../src/pipeline/calc/daily.js';
import { detectEvents, dispatchAlerts, ALERT_CAP_PER_DAY } from '../src/modules/alerts/alerts.js';
import { fixtureContext, FIXTURE } from './fixture.js';

let ctx: AppContext;
beforeAll(async () => {
  ctx = await fixtureContext();
});
afterAll(async () => ctx?.db.close());

const pctx = () => ({ db: ctx.db, store: ctx.store, cfg: ctx.cfg, log: ctx.log, now: ctx.clock });

describe('price validation rules (Blueprint §5.3)', () => {
  const base = { isin: 'XXSSYN00001X', symbol: 'X', date: '2026-10-13', open: 100, high: 105, low: 99, close: 104, prev_close: 100, volume: 1000, trades: 10, delivery_qty: 500, traded_value: 1000 * ((105 + 99 + 104) / 3) };
  const ctxV = { tradingDays: new Set(['2026-10-13']), asOf: '2026-10-13', actionDates: new Set<string>() };
  it('accepts a clean row', () => expect(validatePriceRow(base, ctxV)).toEqual({ failed: [], warned: [] }));
  it('quarantines OHLC integrity failures', () => expect(validatePriceRow({ ...base, high: 98 }, ctxV).failed).toContain('ohlc_integrity'));
  it('quarantines inconsistent traded value', () => expect(validatePriceRow({ ...base, traded_value: 1 }, ctxV).failed).toContain('value_consistency'));
  it('quarantines dates off the calendar or in the future', () => expect(validatePriceRow({ ...base, date: '2026-10-18' }, ctxV).failed).toContain('timestamp_sanity'));
  it('quarantines a >50% jump without a corporate action, and warns beyond the band', () => {
    expect(validatePriceRow({ ...base, prev_close: 50, low: 99 }, ctxV).failed).toContain('price_jump');
    expect(validatePriceRow({ ...base, prev_close: 80 }, ctxV).warned).toContain('price_band');
    expect(validatePriceRow({ ...base, prev_close: 50 }, { ...ctxV, actionDates: new Set(['XXSSYN00001X|2026-10-13']) }).failed).toEqual([]);
  });
});

describe('ingestion integrity', () => {
  it('stores raw files once: a re-delivered identical file is a duplicate (idempotent)', async () => {
    const file = await ctx.vendor.fetch('risk_free', { asOf: FIXTURE.asOf, mode: 'history' });
    const r1 = await ingestFile(pctx(), file!, true);
    const r2 = await ingestFile(pctx(), file!, true);
    expect(['duplicate', 'succeeded']).toContain(r1.status);
    expect(r2.status).toBe('duplicate');
  });
  it('quarantines a corrupted row and keeps the rest', async () => {
    const file = await ctx.vendor.fetch('eod_prices', { asOf: FIXTURE.asOf, mode: 'daily', since: '2026-10-13' });
    const body = JSON.parse(file!.body);
    body.records[0].high = body.records[0].low - 1;
    body.records.push({ ...body.records[1] }); // duplicate row
    const r = await ingestFile(pctx(), { ...file!, body: JSON.stringify(body), fileName: 'corrupt.json' }, true);
    expect(r.status).toBe('partial');
    expect(r.result!.rowsQuarantined).toBe(1);
    expect(r.result!.checks.find((c) => c.check === 'duplicates')!.count).toBe(1);
    const q = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM market.price_quarantine`);
    expect(q.n).toBeGreaterThanOrEqual(1);
  });
  it('blocks a dataset when completeness falls below 99.5%', async () => {
    const file = await ctx.vendor.fetch('eod_prices', { asOf: FIXTURE.asOf, mode: 'daily', since: '2026-10-13' });
    const body = JSON.parse(file!.body);
    body.records = body.records.slice(0, Math.floor(body.records.length / 2));
    const r = await ingestFile(pctx(), { ...file!, body: JSON.stringify(body), fileName: 'partial.json' }, true);
    expect(r.status).toBe('blocked');
    const alert = await ctx.db.maybeOne(`SELECT 1 FROM ops.ops_alerts WHERE kind='dataset_blocked'`);
    expect(alert).toBeTruthy();
  });
  it('refuses synthetic vendors where synthetic data is not allowed', async () => {
    const file = await ctx.vendor.fetch('risk_free', { asOf: FIXTURE.asOf, mode: 'history' });
    await expect(ingestFile({ ...pctx(), cfg: { allowSyntheticData: false } }, file!, true)).rejects.toThrow(/refused/);
  });
  it('reconciles breadth: advances + declines + unchanged = traded (MKT-03)', async () => {
    const rows = await ctx.db.query<{ a: number; d: number; u: number; t: number }>(`SELECT advances a, declines d, unchanged u, traded t FROM calc.market_daily`);
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) expect(r.a + r.d + r.u).toBe(r.t);
  });
  it('records a conflict when vendor and XBRL values differ beyond tolerance (CMP-12)', async () => {
    const c = await ctx.db.maybeOne<{ details: { vendor_value: number; xbrl_value: number; tolerance_rule: string } }>(`SELECT details FROM calc.quality_issues WHERE kind='conflict' AND details ? 'xbrl_value' LIMIT 1`);
    expect(c).toBeTruthy();
    expect(Math.abs(c!.details.xbrl_value / c!.details.vendor_value - 1)).toBeGreaterThan(0.005);
    expect(c!.details.tolerance_rule).toMatch(/0.5%/);
  });
});

describe('corporate actions and adjusted series (BKT-09, Blueprint §5.4)', () => {
  it('split and bonus series produce continuous adjusted returns', () => {
    const bars = [
      { trade_date: '2026-01-01', open: 1000, high: 1000, low: 1000, close: 1000, volume: 100, traded_value: 1e5 },
      { trade_date: '2026-01-02', open: 1010, high: 1010, low: 1010, close: 1010, volume: 100, traded_value: 1e5 },
      { trade_date: '2026-01-05', open: 203, high: 203, low: 203, close: 204, volume: 500, traded_value: 1e5 }, // 5:1 split
      { trade_date: '2026-01-06', open: 102, high: 103, low: 102, close: 103, volume: 1000, traded_value: 1e5 }, // 1:1 bonus
    ];
    const actions = [
      { action_id: 's', action_type: 'split', ex_date: '2026-01-05', ratio_num: 5, ratio_den: 1, cash_amount: null, subscription_price: null, adj_factor: null },
      { action_id: 'b', action_type: 'bonus', ex_date: '2026-01-06', ratio_num: 1, ratio_den: 1, cash_amount: null, subscription_price: null, adj_factor: null },
    ];
    const { bars: adj } = computeAdjusted(bars, actions);
    const rets = adj.slice(1).map((b, i) => b.adj_close / adj[i]!.adj_close - 1);
    expect(rets.every((r) => Math.abs(r) < 0.02)).toBe(true);
    expect(adj[0]!.cum_factor).toBeCloseTo(0.1, 12);
    expect(adj[3]!.cum_factor).toBe(1);
  });
  it('rights factor uses TERP ÷ cum price', () => {
    const bars = [{ trade_date: '2026-01-01', open: 100, high: 100, low: 100, close: 100, volume: 1, traded_value: 100 }, { trade_date: '2026-01-02', open: 95, high: 95, low: 95, close: 95, volume: 1, traded_value: 95 }];
    const { factors } = computeAdjusted(bars, [{ action_id: 'r', action_type: 'rights', ex_date: '2026-01-02', ratio_num: 1, ratio_den: 5, cash_amount: null, subscription_price: 70, adj_factor: null }]);
    expect(factors.get('r')).toBeCloseTo((5 * 100 + 70) / 6 / 100, 12);
  });
  it('adjusted closes in the fixture have no unexplained jumps above 25%', async () => {
    const r = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT adj_close / lag(adj_close) OVER (PARTITION BY security_id ORDER BY trade_date) - 1 AS r FROM market.adjusted_price_cache) x WHERE abs(r) > 0.25`);
    expect(r.n).toBe(0);
  });
  it('share counts follow later splits and bonuses', () => {
    const acts = [{ ex_date: '2026-04-20', action_type: 'bonus', factor: 0.5, ratio_num: 1, ratio_den: 1 }];
    expect(sharesOn(1000, '2026-03-31', '2026-05-01', acts)).toBe(2000);
    expect(sharesOn(2000, '2026-06-30', '2026-01-01', acts)).toBe(1000);
  });
});

describe('point-in-time fundamentals (BKT-09)', () => {
  it('a restated year shows the original before its restatement filing', async () => {
    const pits = await loadPit(ctx.db);
    const restated = [...pits.values()].find((p) => p.all.some((x) => x.version > 1));
    expect(restated).toBeTruthy();
    const v2 = restated!.all.find((x) => x.version > 1)!;
    const before = restated!.asOf(new Date(Date.parse(v2.filed_at) - 1000).toISOString(), v2.basis).find((x) => x.fiscal_year === v2.fiscal_year && x.period_type === v2.period_type);
    const after = restated!.asOf(v2.filed_at, v2.basis).find((x) => x.fiscal_year === v2.fiscal_year && x.period_type === v2.period_type);
    expect(before!.version).toBe(1);
    expect(after!.version).toBe(2);
  });
  it('results filed after a session close do not change that session’s valuation', async () => {
    const row = await ctx.db.maybeOne<{ security_id: number; filed_at: string }>(`SELECT s.security_id, fp.filed_at FROM fund.financial_periods fp JOIN ref.securities s USING (company_id) WHERE fp.period_type='Q' AND fp.filed_at > '2025-06-01' ORDER BY fp.filed_at LIMIT 1`);
    const day = new Date(Date.parse(row!.filed_at) + 330 * 60_000).toISOString().slice(0, 10);
    const d = await ctx.db.maybeOne<{ fundamentals_as_of: string | null }>(`SELECT fundamentals_as_of FROM calc.security_daily WHERE security_id=$1 AND trade_date=$2`, [row!.security_id, day]);
    if (d?.fundamentals_as_of) expect(d.fundamentals_as_of <= `${day}T10:00:00.000Z`).toBe(true);
  });
  it('TTM needs four consecutive quarters', async () => {
    const pits = await loadPit(ctx.db);
    const p = [...pits.values()][0]!;
    const q = p.asOf('2030-01-01').filter((x) => x.period_type === 'Q');
    expect(lastFourQuarters(q)).toHaveLength(4);
    expect(lastFourQuarters(q.slice(-3))).toBeNull();
  });
});

describe('post-close briefing (MKT-08, MKT-11)', () => {
  it('is published with every number matched to evidence', async () => {
    const b = await ctx.db.one<{ status: string; checks: { name: string; passed: boolean }[]; content: { claims: { value: number }[]; sections: { items: { text: string; type: string }[] }[] } }>(`SELECT status, checks, content FROM calc.briefings WHERE trade_date=$1`, [FIXTURE.asOf]);
    expect(b.status).toBe('published');
    expect(b.checks.every((c) => c.passed)).toBe(true);
    const texts = b.content.sections.flatMap((s) => s.items.map((i) => i.text));
    expect(texts.length).toBeGreaterThan(5);
    const explanations = b.content.sections.flatMap((s) => s.items).filter((i) => i.type === 'possible_explanation');
    for (const e of explanations) expect(e.text).toMatch(/possible explanation|no explanation is offered/i);
  });
  it('is held with a delay notice when the day’s data is missing', async () => {
    const r = await buildBriefing(ctx.db, '2026-10-15');
    expect(r.status).toBe('held');
    expect(JSON.stringify(r.content)).toMatch(/held/);
  });
  it('reports a holiday with the next session date', async () => {
    const r = await buildBriefing(ctx.db, '2026-10-17');
    expect(r.status).toBe('holiday');
    expect((r.content as { next_session: string }).next_session).toBe('2026-10-19');
  });
  it('the claim checker would have held a briefing with an invented figure', () => {
    expect(checkClaims('Demo index closed at 99,999.99.', [{ id: 'c', value: 45000, label: 'x', evidenceId: 'e' }]).passed).toBe(false);
  });
});

describe('material-change alerts (ALR-01, ALR-03)', () => {
  it('deduplicates, honours pause and caps emails at 20 per user per day', async () => {
    const user = await ctx.db.one<{ user_id: string }>(`SELECT user_id FROM app.users WHERE email='pro@atlas.test'`);
    const company = await ctx.db.one<{ company_id: string }>(`SELECT company_id FROM ref.companies WHERE coverage='full' LIMIT 1`);
    const wl = await ctx.db.one<{ watchlist_id: string }>(`INSERT INTO app.watchlists (user_id, name) VALUES ($1,'Alerts test') RETURNING watchlist_id`, [user.user_id]);
    await ctx.db.query(`INSERT INTO app.watchlist_items (watchlist_id, company_id) VALUES ($1,$2)`, [wl.watchlist_id, company.company_id]);
    const rule = await ctx.db.one<{ rule_id: string }>(`INSERT INTO app.alert_rules (user_id, watchlist_id, kind) VALUES ($1,$2,'material_change') RETURNING rule_id`, [user.user_id, wl.watchlist_id]);
    const events = Array.from({ length: 25 }, (_, i) => ({ companyId: company.company_id, kind: 'announcement' as const, ref: `test-${i}`, title: `Test ${i}`, evidenceHref: '/x', ingestedAt: new Date().toISOString(), category: 'Credit Rating' }));
    const now = new Date();
    const r1 = await dispatchAlerts(ctx.db, events, now);
    expect(r1.emailed).toBe(ALERT_CAP_PER_DAY);
    expect(r1.suppressed).toBe(5);
    const r2 = await dispatchAlerts(ctx.db, events, now);
    expect(r2.created).toBe(0);
    await ctx.db.query(`UPDATE app.alert_rules SET status='paused' WHERE rule_id=$1`, [rule.rule_id]);
    const r3 = await dispatchAlerts(ctx.db, [{ ...events[0]!, ref: 'paused-1' }], now);
    expect(r3.emailed).toBe(0);
    expect(await detectEvents(ctx.db, new Date(Date.now() + 86_400_000).toISOString())).toEqual([]);
  });
});
