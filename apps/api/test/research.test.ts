import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import type { Db } from '../src/db/db.js';
import { importEquityPrices } from '../src/modules/equity/ingest.js';
import type { FetchFn } from '../src/modules/equity/providers.js';
import { evaluateAlerts } from '../src/modules/research/objectRoutes.js';
import { DEV_PASSWORD } from '../src/seed.js';
import { Client } from './http.js';
import { fixtureContext } from './fixture.js';

// Cross-asset research API. Price histories here are GENERATED test data inserted into the throwaway
// test database (deterministic formulas), so calculations can be checked over long windows. They never
// leave the test.

const DAY = 86_400_000;
let clockMs = Date.parse('2026-10-23T12:00:00Z');
const T0 = Date.parse('2025-01-01T00:00:00Z');

async function seedCrypto(db: Db, key: string, name: string, days: number, f: (i: number) => number, skip: number[] = []) {
  const a = await db.one<{ asset_id: string }>(`INSERT INTO crypto.assets (canonical_key, name, symbol, metadata_source, market_cap_rank) VALUES ($1,$2,$3,'coingecko',$4) RETURNING asset_id`, [key, name, name.slice(0, 3).toUpperCase(), key === 'bitcoin' ? 1 : 2]);
  const s = await db.one<{ series_id: string }>(`INSERT INTO crypto.price_series (source_id, kind, asset_id, quote_currency, interval) VALUES ('coingecko','reference_close',$1,'USD','1d') RETURNING series_id`, [a.asset_id]);
  for (let i = 0; i < days; i++) {
    if (skip.includes(i)) continue;
    await db.query(`INSERT INTO crypto.ohlcv (series_id, open_time, close, volume, transform_version) VALUES ($1,$2,$3,$4,'test')`, [s.series_id, new Date(T0 + i * DAY).toISOString(), f(i), 1000 + (i % 7) * 10]);
  }
  await db.query(`UPDATE crypto.price_series SET first_open_time=(SELECT min(open_time) FROM crypto.ohlcv WHERE series_id=$1), last_open_time=(SELECT max(open_time) FROM crypto.ohlcv WHERE series_id=$1), observations=(SELECT count(*) FROM crypto.ohlcv WHERE series_id=$1) WHERE series_id=$1`, [s.series_id]);
  return s.series_id;
}

let ctx: AppContext;
let app: FastifyInstance;
let c: Client;
let other: Client;
beforeAll(async () => {
  ctx = await fixtureContext({ clock: () => new Date(clockMs) });
  const days = Math.floor((clockMs - T0) / DAY);
  await seedCrypto(ctx.db, 'bitcoin', 'Bitcoin', days, (i) => 50000 * Math.exp(0.0008 * i + 0.08 * Math.sin(i / 17)));
  await seedCrypto(ctx.db, 'ethereum', 'Ethereum', days, (i) => 3000 * Math.exp(0.0006 * i + 0.1 * Math.sin(i / 17) + 0.02 * Math.cos(i / 3)), [400, 401]);
  // Equity: weekday sessions through the real import path (generated EODHD-format rows).
  const rows: Record<string, unknown>[] = [];
  for (let t = T0; t <= clockMs - DAY; t += DAY) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const i = rows.length;
    const p = Math.round(1500 * Math.exp(0.0003 * i + 0.05 * Math.sin(i / 11)) * 100) / 100;
    rows.push({ date: d.toISOString().slice(0, 10), open: p, high: p, low: p, close: p, adjusted_close: p, volume: 2e6 });
  }
  const f: FetchFn = async () => ({ status: 200, ok: true, text: async () => JSON.stringify(rows) });
  await importEquityPrices(ctx.db, f, { eodhd: 'test', alphavantage: '' }, { provider: 'eodhd', exchange: 'NSE', symbol: 'TESTCO', kind: 'equity', name: 'Generated test instrument' }, new Date(clockMs));
  app = await buildApp(ctx);
  c = new Client(app);
  other = new Client(app);
  expect((await c.login('pro@atlas.test', DEV_PASSWORD)).status).toBe(200);
  expect((await other.login('plus@atlas.test', DEV_PASSWORD)).status).toBe(200);
});
afterAll(async () => {
  await app?.close();
  await ctx?.db.close();
});

const activity = async (kind: string) => (await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM research.activity WHERE kind=$1`, [kind])).n;

describe('instruments and workbench', () => {
  it('search finds crypto and real equities; synthetic companies are not selectable', async () => {
    const r = (await c.get('/v1/research/instruments?q=')).json;
    const keys = r.results.map((x: { key: string }) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['crypto:bitcoin', 'crypto:ethereum', 'equity:NSE:TESTCO']));
    expect(keys.some((k: string) => k.startsWith('demo:'))).toBe(false);
    expect(r.excluded).toMatch(/Synthetic/);
  });
  it('crypto vs an equity aligns on shared session dates and annualises with 252', async () => {
    const r = await c.post('/v1/research/workbench', { keys: ['crypto:ethereum', 'equity:NSE:TESTCO'], benchmark: 'crypto:bitcoin', range: '1y' });
    expect(r.status).toBe(200);
    expect(r.json.alignment.calendar).toBe('sessions');
    expect(r.json.alignment.annualisation).toBe(252);
    for (const s of r.json.series.slice(0, 20)) expect([0, 6]).not.toContain(new Date(`${s.t}T00:00:00Z`).getUTCDay());
    expect(r.json.series[0].values).toEqual([1, 1, 1]);
    expect(r.json.instruments.map((i: { classification: string }) => i.classification)).toEqual(['REAL_UNVERIFIED', 'REAL_UNVERIFIED', 'REAL_UNVERIFIED']);
    const eth = r.json.metrics.find((m: { key: string }) => m.key.startsWith('crypto:ethereum'));
    expect(eth.aligned.correlation).toBeGreaterThan(0.5);
    expect(eth.own.annualisation).toBe(365); // its own metrics keep the crypto convention
  });
  it('a benchmark comparison is recorded once however often it is repeated', async () => {
    await c.post('/v1/research/workbench', { keys: ['equity:NSE:TESTCO', 'crypto:ethereum'], benchmark: 'crypto:bitcoin', range: '3y' });
    expect(await activity('benchmark_comparison')).toBe(1);
  });
  it('rejects malformed keys and other users’ uploads', async () => {
    expect((await c.post('/v1/research/workbench', { keys: ['demo:123'] })).status).toBe(400);
    const ds = await ctx.db.one<{ dataset_id: string }>(`INSERT INTO app.user_datasets (user_id, name, kind, instrument_label, source_description, rights_attested_at, mapping, report, file_sha256, rows_valid) SELECT user_id, 'mine', 'daily_prices', 'X', 'test file', now(), '{}', '{}', 'abc', 0 FROM app.users WHERE email='plus@atlas.test' RETURNING dataset_id`);
    expect((await c.post('/v1/research/workbench', { keys: [`upload:${ds.dataset_id}`] })).status).toBe(404);
  });
});

describe('screener, factors, correlation, regimes, walk-forward, integrity, discovery', () => {
  it('screener excludes assets whose filtered metric is unavailable instead of treating it as zero', async () => {
    const r = (await c.post('/v1/research/screener', { filters: [{ metric: 'market_cap', op: '>=', value: 0 }] })).json;
    expect(r.matched).toBe(0); // no market-cap snapshots for the generated assets
    expect(r.excluded_missing_values).toBe(r.universe);
    const v = (await c.post('/v1/research/screener', { filters: [{ metric: 'vol_90d', op: '>=', value: 0 }], sort: 'vol_90d' })).json;
    expect(v.matched).toBe(3);
  });
  it('factor ranks cover crypto only and state that equity factors do not transfer', async () => {
    const r = (await c.get('/v1/research/factors')).json;
    expect(r.factors.find((f: { name: string }) => f.name === 'momentum_90d').n).toBe(2);
    expect(r.caveats.join(' ')).toMatch(/value and quality/);
  });
  it('rolling correlation returns points with sample counts and is recorded as a study', async () => {
    const r = (await c.post('/v1/research/correlation/rolling', { a: 'crypto:bitcoin', b: 'crypto:ethereum', window: 90 })).json;
    expect(r.rolling.length).toBeGreaterThan(100);
    expect(r.rolling[0].n).toBeGreaterThanOrEqual(r.min_aligned_returns);
    expect(await activity('correlation_study')).toBe(1);
  });
  it('regimes report the method and transitions', async () => {
    const r = (await c.post('/v1/research/regimes', { key: 'crypto:bitcoin' })).json;
    expect(r.result.current).toMatch(/trend/);
    expect(r.method).toMatch(/200-observation/);
  });
  it('walk-forward runs on crypto (calendar days) and on equities (trading sessions)', async () => {
    const ok = await c.post('/v1/research/walkforward', { key: 'crypto:bitcoin', train_days: 250, test_days: 60, grid: [{ fast: 10, slow: 50 }, { fast: 20, slow: 100 }], fee_bps: 10, slippage_bps: 5 });
    expect(ok.status).toBe(200);
    expect(ok.json.folds.length).toBeGreaterThan(1);
    for (const f of ok.json.folds) expect(f.test_from > f.train_to).toBe(true);
    expect(ok.json.config.calendar).toBe('days');
    const eq = await c.post('/v1/research/walkforward', { key: 'equity:NSE:TESTCO', train_days: 250, test_days: 60, grid: [{ fast: 10, slow: 50 }], fee_bps: 10, slippage_bps: 5 });
    expect(eq.status, JSON.stringify(eq.json)).toBe(200);
    expect(eq.json.config).toMatchObject({ calendar: 'sessions', engine: 'sma-trend-walkforward-sessions-1' });
    expect(eq.json.assumptions.join(' ')).toMatch(/trading sessions/);
    expect((await c.post('/v1/research/walkforward', { key: 'equity:NSE:TESTCO', train_days: 2000, test_days: 700, grid: [{ fast: 10, slow: 50 }], fee_bps: 10, slippage_bps: 5 })).status).toBe(400);
  });
  it('integrity lists the real gap; a finding must match it', async () => {
    const r = (await c.post('/v1/research/integrity', { key: 'crypto:ethereum' })).json;
    expect(r.gap_count).toBe(1);
    const gapDate = r.gaps[0].from;
    expect((await c.post('/v1/research/integrity/finding', { key: 'crypto:ethereum', finding: 'gap', date: '2025-03-01', explanation: 'I think a day is missing here but it is not.' })).status).toBe(400);
    expect((await c.post('/v1/research/integrity/finding', { key: 'crypto:ethereum', finding: 'gap', date: gapDate, explanation: 'Two consecutive days are missing from the stored series.' })).status).toBe(200);
    expect(await activity('data_issue_investigated')).toBe(1);
  });
  it('discovery states rules, baselines and limitations for each finding', async () => {
    const r = (await c.get('/v1/research/discoveries')).json;
    expect(r.rules.length).toBe(5);
    for (const f of r.findings) for (const k of ['what', 'baseline', 'period', 'sources', 'robustness', 'limitations']) expect(f[k], k).toBeTruthy();
  });
});

describe('portfolios and scenarios', () => {
  let id = '';
  it('weights must add to 100%', async () => {
    expect((await c.post('/v1/research/portfolios', { name: 'Bad', holdings: [{ instrument_key: 'crypto:bitcoin', weight: 0.5 }] })).status).toBe(400);
  });
  it('analysis: contributions, concentration and benchmark; private to the owner', async () => {
    const p = await c.post('/v1/research/portfolios', { name: 'Mixed', benchmark_key: 'crypto:bitcoin', rebalance: 'monthly', holdings: [{ instrument_key: 'crypto:ethereum', weight: 0.4 }, { instrument_key: 'equity:NSE:TESTCO', weight: 0.6 }] });
    expect(p.status).toBe(200);
    id = p.json.portfolio_id;
    const a = (await c.get(`/v1/research/portfolios/${id}/analysis?range=1y`)).json;
    expect(a.result.concentration.hhi).toBeCloseTo(0.4 ** 2 + 0.6 ** 2, 9);
    expect(a.result.exposure).toEqual({ crypto: 0.4, equity: 0.6 });
    expect(a.result.benchmark.key).toMatch(/^crypto:bitcoin/);
    expect(a.alignment.calendar).toBe('sessions');
    expect(a.disclaimer).toMatch(/Hypothetical/);
    expect((await other.get(`/v1/research/portfolios/${id}/analysis`)).status).toBe(404);
    expect(await activity('portfolio_risk_review')).toBe(1);
  });
  it('a scenario applies the user’s shocks and labels them as assumptions', async () => {
    const s = (await c.post(`/v1/research/portfolios/${id}/scenario`, { shocks: { 'crypto:ethereum': -0.3, 'equity:NSE:TESTCO': -0.1 }, vol_multiplier: 1.5, correlation_shift: 0.2 })).json;
    expect(s.shock_return).toBeCloseTo(0.4 * -0.3 + 0.6 * -0.1, 12);
    expect(s.stressed_vol).toBeGreaterThan(s.baseline_vol);
    expect(s.labels.inputs).toBe('User assumptions');
  });
});

describe('notebook, hypotheses, reports', () => {
  it('a hypothesis needs a future review date; its thesis is frozen; review needs time to pass', async () => {
    expect((await c.post('/v1/research/notebook', { kind: 'hypothesis', title: 'h', thesis: 'x', review_date: '2026-01-01' })).status).toBe(400);
    const h = await c.post('/v1/research/notebook', { kind: 'hypothesis', title: 'ETH vs BTC', thesis: 'Ethereum will move with bitcoin over the next quarter.', evidence_for: 'Rolling 90-day correlation has stayed above 0.8 this year.', evidence_against: 'Correlations have dropped sharply in past stress episodes.', review_date: '2027-01-15', instruments: ['crypto:ethereum'] });
    expect(h.status).toBe(200);
    expect(await activity('hypothesis_recorded')).toBe(1);
    const upd = await c.put(`/v1/research/notebook/${h.json.entry_id}`, { title: 'ETH vs BTC', thesis: 'Changed after the fact', body: '' });
    expect(upd.json.thesis).toBe('Ethereum will move with bitcoin over the next quarter.');
    expect((await c.post(`/v1/research/notebook/${h.json.entry_id}/review`, { outcome: 'Correlation stayed high, at about 0.85.', lessons: 'My evidence against did not materialise in this window.' })).status).toBe(400);
    clockMs += 2 * DAY;
    expect((await c.post(`/v1/research/notebook/${h.json.entry_id}/review`, { outcome: 'Correlation stayed high, at about 0.85.', lessons: 'My evidence against did not materialise in this window.' })).status).toBe(200);
    expect(await activity('hypothesis_reviewed')).toBe(1);
    expect((await other.get('/v1/research/notebook')).json.rows).toEqual([]);
    const md = await c.get('/v1/research/notebook/export');
    expect(md.headers['content-type']).toMatch(/markdown/);
    expect(md.body).toContain('**Thesis:** Ethereum will move with bitcoin');
  });
  it('a short note does not earn research credit; a substantive one does, once', async () => {
    await c.post('/v1/research/notebook', { kind: 'note', title: 'short', body: 'ok' });
    expect(await activity('note_written')).toBe(0);
    const n = await c.post('/v1/research/notebook', { kind: 'note', title: 'Volatility note', body: 'Thirty-day volatility of the test series rose after the second quarter, mostly from three large daily moves.' });
    await c.put(`/v1/research/notebook/${n.json.entry_id}`, { title: 'Volatility note', body: n.json.body + ' Edited.' });
    expect(await activity('note_written')).toBe(1);
  });
  it('a report separates calculations from interpretations and lists limitations and parameters', async () => {
    const r = await c.post('/v1/research/reports', { title: 'Test report', question: 'How did ethereum behave relative to bitcoin this year?', keys: ['crypto:ethereum'], benchmark: 'crypto:bitcoin', range: '1y' });
    expect(r.status).toBe(200);
    expect(r.json.findings.some((f: { kind: string }) => f.kind === 'calculation')).toBe(true);
    expect(r.json.findings.filter((f: { kind: string }) => f.kind === 'interpretation').every((f: { text: string }) => f.text.startsWith('Interpretation:'))).toBe(true);
    expect(r.json.reproducible_parameters.range).toBe('1y');
    const md = await c.get(`/v1/research/reports/${r.json.report_id}/markdown`);
    expect(md.body).toContain('## Limitations');
    expect((await other.get(`/v1/research/reports/${r.json.report_id}`)).status).toBe(404);
  });
});

describe('alerts', () => {
  it('triggers once per observation, respects the cooldown, and notifies in-app', async () => {
    const last = (await c.post('/v1/research/workbench', { keys: ['crypto:bitcoin'], range: '90d' })).json.instruments[0].last;
    expect(last).toBeTruthy();
    const r = await c.post('/v1/research/alerts', { kind: 'price_above', instrument_key: 'crypto:bitcoin', threshold: 1, cooldown_minutes: 60 });
    expect(r.status).toBe(200);
    const e1 = await evaluateAlerts(ctx.db, new Date(clockMs));
    expect(e1.triggered).toBe(1);
    const e2 = await evaluateAlerts(ctx.db, new Date(clockMs + 61 * 60_000));
    expect(e2.triggered).toBe(0); // same observation: deduplicated even after the cooldown
    const n = await ctx.db.query(`SELECT title FROM app.notifications WHERE kind='research_alert'`);
    expect(n.length).toBe(1);
    const list = (await c.get('/v1/research/alerts')).json;
    expect(list.events.length).toBe(1);
    expect((await other.get('/v1/research/alerts')).json.rules).toEqual([]);
  });
  it('a source outage alert needs an existing source; a stale-data alert fires on old data', async () => {
    expect((await c.post('/v1/research/alerts', { kind: 'source_unhealthy', source_id: 'nope' })).status).toBe(400);
    await c.post('/v1/research/alerts', { kind: 'data_stale', instrument_key: 'crypto:ethereum' });
    const e = await evaluateAlerts(ctx.db, new Date(clockMs + 10 * DAY));
    expect(e.triggered).toBeGreaterThanOrEqual(1);
  });
});

describe('research progress (XP, cap, achievements, rank)', () => {
  it('research earns XP from the server ledger, capped at 3 per kind per day', async () => {
    for (let i = 0; i < 5; i++) await c.post('/v1/research/notebook', { kind: 'note', title: `Note ${i}`, body: `A substantive observation number ${i} about the volatility of the generated test series over the last quarter.` });
    const me = (await c.get('/v1/academy/me')).json;
    const notes = me.recent.filter((e: { kind: string }) => e.kind === 'research_note');
    const all = await ctx.db.query<{ kind: string }>(`SELECT kind FROM acad.learning_events e JOIN app.users u USING (user_id) WHERE u.email='pro@atlas.test' AND kind='research_note'`);
    expect(await activity('note_written')).toBe(6);
    // 6 notes recorded on two local days (one earlier, five today): at most 3 per day earn XP.
    expect(all.length).toBe(3); // six substantive notes on one local day (Asia/Kolkata): only three earn XP
    expect(notes.length).toBeGreaterThan(0);
  });
  it('achievements unlock from recorded research with their evidence; rank needs mastery as well as XP', async () => {
    const me = (await c.get('/v1/academy/me')).json;
    const unlocked = me.achievements.filter((a: { unlocked_at: string | null }) => a.unlocked_at).map((a: { id: string }) => a.id);
    expect(unlocked, JSON.stringify({ xp: me.xp, a: me.achievements.slice(0, 3), n: me.achievements.length })).toEqual(expect.arrayContaining(['first-research-note', 'benchmark-builder', 'data-detective', 'backtest-auditor', 'thesis-reviewer', 'first-report', 'risk-analyst']));
    expect(me.xp.xp).toBeGreaterThan(100);
    expect(me.rank.rank).toBeLessThanOrEqual(2); // no mastered objectives yet
    expect(me.rank.next.mastered_ok).toBe(false);
    expect(me.skill_map.map((s: { id: string }) => s.id)).toEqual(['foundations', 'statements', 'equity', 'crypto', 'microstructure', 'quant', 'risk', 'data', 'commodities', 'communication']);
    expect(me.skill_map.find((s: { id: string }) => s.id === 'data').practices[0].done).toBe(true);
    expect(me.missions.some((m: { id: string }) => m.id.startsWith('research-'))).toBe(true);
  });
  it('the client has no way to award XP, ranks or achievements', async () => {
    for (const [m, u] of [['POST', '/v1/academy/me'], ['POST', '/v1/academy/xp'], ['PATCH', '/v1/academy/me']] as const) expect((await c.req(m, u, { xp: 99999 })).status).toBe(404);
  });
});

describe('default series choice', () => {
  it('a stale series is not chosen by default when a current one exists', async () => {
    // An older, longer venue-style history that stopped updating two years ago.
    const asset = await ctx.db.one<{ asset_id: string }>(`SELECT asset_id FROM crypto.assets WHERE canonical_key='bitcoin'`);
    const s = await ctx.db.one<{ series_id: string }>(`INSERT INTO crypto.price_series (source_id, kind, asset_id, quote_currency, interval) VALUES ('binance','reference_close',$1,'USDT','1d') RETURNING series_id`, [asset.asset_id]).catch(async () => ctx.db.one<{ series_id: string }>(`INSERT INTO crypto.price_series (source_id, kind, asset_id, quote_currency, interval) VALUES ('coinbase','reference_close',$1,'USD','1d') RETURNING series_id`, [asset.asset_id]));
    for (let i = 0; i < 900; i++) await ctx.db.query(`INSERT INTO crypto.ohlcv (series_id, open_time, close, transform_version) VALUES ($1,$2,$3,'test')`, [s.series_id, new Date(Date.parse('2022-01-01T00:00:00Z') + i * DAY).toISOString(), 100 + i]);
    await ctx.db.query(`UPDATE crypto.price_series SET observations=900, first_open_time='2022-01-01', last_open_time='2024-06-18' WHERE series_id=$1`, [s.series_id]);
    const r = (await c.post('/v1/research/workbench', { keys: ['crypto:bitcoin'], range: '90d' })).json;
    expect(r.instruments[0].key).not.toContain(s.series_id);
    expect(r.instruments[0].last.slice(0, 10) > '2026-01-01').toBe(true); // the current series, not the one that stopped in 2024
  });
});

describe('input safety', () => {
  it('notebook sources accept only http(s) links (no javascript: URLs)', async () => {
    expect((await c.post('/v1/research/notebook', { kind: 'note', title: 'x', sources: [{ title: 's', url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await c.post('/v1/research/notebook', { kind: 'note', title: 'x', sources: [{ title: 's', url: 'https://example.org/a' }] })).status).toBe(200);
  });
  it('signed-out requests to research endpoints are refused', async () => {
    const anon = new Client(app);
    for (const u of ['/v1/research/notebook', '/v1/research/portfolios', '/v1/research/alerts', '/v1/research/discoveries', '/v1/research/instruments?q=b', '/v1/equity/status']) expect((await anon.get(u)).status, u).toBe(401);
  });
});
