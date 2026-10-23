import * as A from '@atlas/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireUser } from '../auth/service.js';
import { recordActivity, studyRef } from './activity.js';
import { isInstrumentKey, resolveInstrument, searchInstruments, type Instrument } from './instruments.js';
import { METRIC_DEFINITIONS, metricsFor, sessionReturns } from './metrics.js';

// Cross-asset research calculations. Inputs are instrument keys (crypto, real equity, user upload);
// synthetic development data cannot be selected. Every response carries the instruments' classification,
// source, basis, calendar and freshness, and every calculation names its method and assumptions.

const DAY = A.DAY;
const keyList = z.array(z.string().refine(isInstrumentKey, 'invalid instrument key')).min(1).max(12);
const RANGES: Record<string, number | null> = { '90d': 90, '1y': 365, '3y': 1095, '5y': 1826, max: null };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const thin = <T>(xs: T[], n = 500) => xs.filter((_, i) => i % Math.max(1, Math.ceil(xs.length / n)) === 0 || i === xs.length - 1);

export function describe(i: Instrument) {
  return { key: i.key, label: i.label, asset_class: i.asset_class, classification: i.classification, source: i.source, basis: i.basis, calendar: i.calendar, currency: i.currency, annualisation: i.annualisation, first: i.first, last: i.last, freshness: i.freshness, notes: i.notes, observations: i.observations.length };
}

/** Alignment note for a set of instruments: what calendar the comparison uses and why. */
export function alignmentNote(insts: Instrument[]): { calendar: 'continuous' | 'sessions'; annualisation: number; max_gap_days: number; note: string; currencies: string[] } {
  const sessions = insts.some((i) => i.calendar === 'sessions');
  const currencies = [...new Set(insts.map((i) => i.currency))];
  return {
    calendar: sessions ? 'sessions' : 'continuous', annualisation: sessions ? 252 : 365, max_gap_days: sessions ? 5 : 1, currencies,
    note: (sessions
      ? 'At least one instrument trades in exchange sessions, so all series are compared on the dates they share (crypto observations on weekends and holidays are dropped) and returns are session-to-session (annualised with √252). Crypto daily observations are stamped 00:00 UTC; Indian sessions close at 10:00 UTC.'
      : 'All instruments trade continuously: series are compared on shared UTC days and annualised with √365.')
      + (currencies.length > 1 ? ` Quote currencies differ (${currencies.join(', ')}); no FX conversion is applied, so currency moves are part of each return.` : ''),
  };
}

export async function crossRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const now = () => ctx.clock();
  const rf = () => ctx.cfg.RESEARCH_RISK_FREE_RATE;
  const load = async (userId: string, keys: string[], range: string) => {
    const days = RANGES[range] ?? null;
    const fromMs = days === null ? undefined : now().getTime() - days * DAY;
    return Promise.all(keys.map((k) => resolveInstrument(db, userId, k, now(), { fromMs })));
  };

  app.get('/v1/research/instruments', async (req) => {
    const u = requireUser(req);
    const q = parse(z.object({ q: z.string().max(60).default('') }), req.query);
    return { results: await searchInstruments(db, u.userId, q.q.trim()), excluded: 'Synthetic development equities are not selectable for research.' };
  });

  // ───────── Feature 1: workbench ─────────
  app.post('/v1/research/workbench', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ keys: keyList, benchmark: z.string().refine(isInstrumentKey).optional(), range: z.enum(['90d', '1y', '3y', '5y', 'max']).default('1y') }), req.body);
    const all = await load(u.userId, b.benchmark ? [...b.keys, b.benchmark] : b.keys, b.range);
    const insts = all.slice(0, b.keys.length);
    const bench = b.benchmark ? all[all.length - 1]! : null;
    const align = alignmentNote(all);
    const aligned = A.alignSeries(all.map((i) => i.observations));
    if (aligned.dates.length < 2) return { instruments: all.map(describe), alignment: align, error: 'The selected instruments share fewer than two dates in this range, so they cannot be compared.', series: [], metrics: [] };
    const rebased = aligned.values.map((v) => v.map((x) => x / v[0]!));
    const rets = aligned.values.map((v) => A.alignedReturns(aligned.dates, v, align.max_gap_days));
    const benchIdx = bench ? all.length - 1 : -1;
    const metrics = all.map((inst, i) => {
      const own = metricsFor(inst, rf());
      const alignedObs = aligned.dates.map((t, k) => ({ t, v: aligned.values[i]![k]! }));
      let rel: Record<string, unknown> = {};
      if (benchIdx >= 0 && i !== benchIdx) {
        const pairs = rets[i]!.map((r, k) => [r, rets[benchIdx]![k]] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
        const corr = pairs.length >= 30 ? A.pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null;
        const mb = A.mean(pairs.map((p) => p[1]));
        const ma = A.mean(pairs.map((p) => p[0]));
        let cov = 0;
        let vb = 0;
        for (const [x, y] of pairs) { cov += (x - ma) * (y - mb); vb += (y - mb) ** 2; }
        const relRet = rebased[i]![rebased[i]!.length - 1]! / rebased[benchIdx]![rebased[benchIdx]!.length - 1]! - 1;
        rel = { aligned_returns: pairs.length, correlation: corr, beta: pairs.length >= 30 && vb > 0 ? cov / vb : null, relative_return: relRet, relative_reason: pairs.length < 30 ? 'needs at least 30 aligned returns' : null };
      }
      const alignedDd = A.drawdowns(alignedObs);
      return { key: inst.key, own, aligned: { total_return: rebased[i]![rebased[i]!.length - 1]! - 1, max_drawdown: alignedDd.ok ? alignedDd.max_drawdown : null, ...rel } };
    });
    if (bench && insts.length) await recordActivity(db, u.userId, 'benchmark_comparison', studyRef([...b.keys, `bench:${b.benchmark}`]), now(), { range: b.range });
    return {
      instruments: all.map(describe), benchmark: bench ? bench.key : null, alignment: { ...align, shared_dates: aligned.dates.length, from: iso(aligned.dates[0]!), to: iso(aligned.dates[aligned.dates.length - 1]!) },
      series: thin(aligned.dates.map((t, k) => ({ t: iso(t), values: rebased.map((r) => r[k]!) }))),
      metrics, definitions: METRIC_DEFINITIONS, risk_free: rf(),
      caveats: ['Rebased to 1.0 on the first shared date. Historical, descriptive figures only; not a forecast or recommendation.', 'Correlation and beta use aligned returns only; they do not establish causation.'],
    };
  });

  // ───────── Feature 2 & 5: screener and factor ranks (crypto universe + imported equities) ─────────
  const universeCache = new Map<string, { version: string; m: ReturnType<typeof metricsFor> }>();
  async function universe(userId: string) {
    const crypto = await db.query<{ canonical_key: string; name: string; symbol: string; market_cap: number | null; category: string | null; series_id: string; last_open_time: string }>(
      `SELECT DISTINCT ON (a.asset_id) a.canonical_key, a.name, a.symbol, m.market_cap::float8 AS market_cap, a.category, s.series_id, s.last_open_time
         FROM crypto.assets a JOIN crypto.price_series s ON s.asset_id=a.asset_id AND s.observations > 0
         LEFT JOIN crypto.market_snapshots m ON m.asset_id=a.asset_id AND m.source_id='coingecko' AND m.quote_currency='usd'
        WHERE a.listing_status='listed' ORDER BY a.asset_id, (s.kind='venue_candle') DESC, s.observations DESC`);
    const equities = await db.query<{ exchange: string; symbol: string; name: string | null; series_id: string; last_date: string }>(
      `SELECT DISTINCT ON (i.instrument_id) i.exchange, i.symbol, i.name, s.series_id, s.last_date FROM equity.instruments i JOIN equity.price_series s USING (instrument_id) WHERE s.observations > 0 ORDER BY i.instrument_id, (s.basis='adjusted_split_dividend') DESC`);
    const out = [];
    const fromMs = now().getTime() - 400 * DAY;
    for (const c of crypto) {
      const key = `crypto:${c.canonical_key}@${c.series_id}`;
      const version = c.last_open_time;
      let hit = universeCache.get(key);
      if (!hit || hit.version !== version) {
        const inst = await resolveInstrument(db, userId, key, now(), { fromMs });
        hit = { version, m: metricsFor(inst, rf()) };
        universeCache.set(key, hit);
      }
      out.push({ key, label: `${c.name} (${c.symbol})`, asset_class: 'crypto', category: c.category, market_cap: c.market_cap, classification: 'REAL_UNVERIFIED', ...hit.m });
    }
    for (const e of equities) {
      const key = `equity:${e.exchange}:${e.symbol}`;
      const inst = await resolveInstrument(db, userId, key, now(), { fromMs });
      out.push({ key: inst.key, label: inst.label, asset_class: inst.asset_class, category: null, market_cap: null, classification: inst.classification, ...metricsFor(inst, rf()) });
    }
    return out;
  }

  const FILTERABLE = ['market_cap', 'return_30d', 'return_90d', 'return_365d', 'vol_90d', 'max_drawdown', 'current_drawdown', 'sma50_gap', 'sma200_gap', 'volume_ratio_30_90', 'sharpe'] as const;
  app.post('/v1/research/screener', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({
      filters: z.array(z.object({ metric: z.enum(FILTERABLE), op: z.enum(['>=', '<=']), value: z.number().finite() })).max(10).default([]),
      asset_class: z.enum(['all', 'crypto', 'equity']).default('all'),
      sort: z.enum(FILTERABLE).default('market_cap'), dir: z.enum(['asc', 'desc']).default('desc'),
    }), req.body);
    const rows = (await universe(u.userId)).filter((r) => b.asset_class === 'all' || (b.asset_class === 'crypto' ? r.asset_class === 'crypto' : r.asset_class !== 'crypto'));
    let excludedMissing = 0;
    const matched = rows.filter((r) => b.filters.every((f) => {
      const v = r[f.metric] as number | null;
      if (v === null || v === undefined) { excludedMissing++; return false; }
      return f.op === '>=' ? v >= f.value : v <= f.value;
    }));
    matched.sort((x, y) => {
      const a = x[b.sort] as number | null;
      const c = y[b.sort] as number | null;
      if (a === null) return 1;
      if (c === null) return -1;
      return b.dir === 'asc' ? a - c : c - a;
    });
    return {
      universe: rows.length, matched: matched.length, excluded_missing_values: excludedMissing, rows: matched.slice(0, 200).map(({ reasons: _r, ...r }) => r), definitions: METRIC_DEFINITIONS, risk_free: rf(),
      notes: ['Metrics use the last ~400 days of each stored series. A filter on a metric that is unavailable for an asset excludes that asset (it is never treated as zero).', 'Crypto: venue series where stored, otherwise the CoinGecko reference series. Equities: only real imported instruments; synthetic data is excluded.', 'Equity valuation metrics are not available: no real fundamentals provider is configured.'],
    };
  });

  app.get('/v1/research/factors', async (req) => {
    const u = requireUser(req);
    const rows = (await universe(u.userId)).filter((r) => r.asset_class === 'crypto');
    const btc = rows.find((r) => r.key.startsWith('crypto:bitcoin@'));
    // Factors: momentum = 90-day return; low volatility = −vol_90d; liquidity proxy = volume ratio; size = market cap.
    const factor = (name: string, val: (r: (typeof rows)[number]) => number | null) => {
      const xs = rows.map((r) => ({ key: r.key, label: r.label, v: val(r) })).filter((x): x is { key: string; label: string; v: number } => x.v !== null && Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
      return { name, n: xs.length, ranked: xs.map((x, i) => ({ ...x, rank: i + 1, quintile: Math.min(5, Math.floor((i / xs.length) * 5) + 1) })) };
    };
    return {
      benchmark: btc ? { key: btc.key, return_90d: btc.return_90d } : null,
      factors: [
        factor('momentum_90d', (r) => r.return_90d),
        factor('relative_strength_vs_btc_90d', (r) => (r.return_90d === null || btc?.return_90d === null || btc?.return_90d === undefined ? null : (1 + r.return_90d) / (1 + btc.return_90d) - 1)),
        factor('low_volatility_90d', (r) => (r.vol_90d === null ? null : -r.vol_90d)),
        factor('volume_trend_30_90', (r) => r.volume_ratio_30_90),
        factor('size_market_cap', (r) => r.market_cap),
      ],
      method: 'Each factor ranks the crypto assets that have the input; quintile 1 is the highest value. Momentum and relative strength use 90 calendar days; low volatility is the negative of 90-day annualised volatility.',
      caveats: ['Equity factors such as value and quality need earnings and book values; tokens generally have neither, so they are not computed.', 'Ranks describe the stored history only; factor returns are not claimed to persist.'],
    };
  });

  // ───────── Feature 6: correlation regime explorer ─────────
  app.post('/v1/research/correlation/rolling', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ a: z.string().refine(isInstrumentKey), b: z.string().refine(isInstrumentKey), window: z.number().int().refine((n) => [30, 60, 90, 180].includes(n)).default(90), range: z.enum(['1y', '3y', '5y', 'max']).default('3y') }), req.body);
    const [x, y] = await load(u.userId, [b.a, b.b], b.range);
    const align = alignmentNote([x!, y!]);
    const al = A.alignSeries([x!.observations, y!.observations]);
    const ra = A.alignedReturns(al.dates, al.values[0]!, align.max_gap_days);
    const rb = A.alignedReturns(al.dates, al.values[1]!, align.max_gap_days);
    // Rolling correlation over the last `window` aligned returns ending at each date.
    const pts: { t: number; v: number; n: number }[] = [];
    const minN = Math.ceil(b.window * (align.calendar === 'sessions' ? 0.6 : 0.8));
    for (let i = 0; i < ra.length; i++) {
      const lo = al.dates[i + 1]! - b.window * DAY;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = i; k >= 0 && al.dates[k + 1]! > lo; k--) if (ra[k] !== null && rb[k] !== null) { xs.push(ra[k]!); ys.push(rb[k]!); }
      if (xs.length >= minN) {
        const v = A.pearson(xs, ys);
        if (Number.isFinite(v)) pts.push({ t: al.dates[i + 1]!, v, n: xs.length });
      }
    }
    const shifts = A.correlationShifts(pts, Math.round(b.window / 2), 0.4);
    if (pts.length) await recordActivity(db, u.userId, 'correlation_study', studyRef([b.a, b.b]) + `|w${b.window}`, now());
    return {
      instruments: [describe(x!), describe(y!)], alignment: { ...align, shared_dates: al.dates.length }, window_days: b.window, min_aligned_returns: minN,
      rolling: thin(pts.map((p) => ({ t: iso(p.t), v: p.v, n: p.n }))),
      latest: pts[pts.length - 1] ? { t: iso(pts[pts.length - 1]!.t), v: pts[pts.length - 1]!.v, n: pts[pts.length - 1]!.n } : null,
      shifts: shifts.map((s) => ({ from: iso(s.from), to: iso(s.to), before: s.before, after: s.after, change: s.change })),
      method: `Pearson correlation of aligned simple returns over a trailing ${b.window}-day window; a point is shown only with at least ${minN} aligned returns. A "shift" is a move of 0.4 or more compared with half a window earlier (descriptive, not a statistical test).`,
      caveats: ['Correlation describes co-movement in the past window; it does not establish causation or predict future relationships.'],
    };
  });

  // ───────── Feature 7: walk-forward backtesting ─────────
  app.post('/v1/research/walkforward', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({
      key: z.string().refine(isInstrumentKey), train_days: z.number().int().min(100).max(2000), test_days: z.number().int().min(30).max(730),
      grid: z.array(z.object({ fast: z.number().int().min(2).max(100), slow: z.number().int().min(3).max(400) })).min(1).max(12),
      fee_bps: z.number().min(0).max(200), slippage_bps: z.number().min(0).max(200),
    }), req.body);
    const [inst] = await load(u.userId, [b.key], 'max');
    // Crypto: calendar days, only consecutive-day observations count as returns. Equities and uploads:
    // exchange sessions, windows counted in sessions, a gap longer than 5 calendar days earns nothing.
    const calendar = inst!.calendar === 'sessions' ? 'sessions' : 'days';
    const r = A.walkForward(inst!.observations, b.grid, b.train_days, b.test_days, { fee_bps: b.fee_bps, slippage_bps: b.slippage_bps, calendar });
    if (!r.ok) throw badRequest(r.reason);
    await recordActivity(db, u.userId, 'walkforward_backtest', `${inst!.key.split('@')[0]}|${b.train_days}|${b.test_days}`, now(), { folds: r.folds.length });
    const config = { ...b, key: inst!.key, engine: calendar === 'sessions' ? 'sma-trend-walkforward-sessions-1' : 'sma-trend-walkforward-1', calendar };
    return {
      instrument: describe(inst!), config, ...r,
      folds: r.folds.map((f) => ({ ...f, train_from: iso(f.train_from), train_to: iso(f.train_to), test_from: iso(f.test_from), test_to: iso(f.test_to) })),
      oos_curve: thin(r.oos_curve).map((p) => ({ t: iso(p.t), v: p.v })),
      disclaimer: 'Educational backtest on stored history. Not a recommendation; historical results do not predict future results.',
    };
  });

  // ───────── Feature 8: event study ─────────
  app.post('/v1/research/event-study', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ event_id: z.string().uuid(), key: z.string().refine(isInstrumentKey), benchmark: z.string().refine(isInstrumentKey).default('crypto:bitcoin'), window: z.number().int().min(1).max(30).default(5) }), req.body);
    const ev = await db.maybeOne<{ event_id: string; headline: string; source_url: string; published_at: string; category: string; verification: string; source_id: string }>(`SELECT event_id, headline, source_url, published_at, category, verification, source_id FROM crypto.events WHERE event_id=$1`, [b.event_id]);
    if (!ev) throw notFound('No such event.');
    const [x, bench] = await load(u.userId, [b.key, b.benchmark], 'max');
    const al = A.alignSeries([x!.observations, bench!.observations]);
    const eventDay = Math.floor(Date.parse(ev.published_at) / DAY) * DAY;
    // Day 0 is the first observation on or after the publication date.
    const i0 = al.dates.findIndex((d) => d >= eventDay);
    if (i0 < 0) throw badRequest('There is no stored observation on or after the event date.');
    const est = 120;
    if (i0 - b.window - est < 1 || i0 + b.window >= al.dates.length) return { event: ev, instruments: [describe(x!), describe(bench!)], result: null, reason: `Needs ${est} days of estimation data before the window and ${b.window} days after the event; not enough stored history around ${iso(eventDay)}.` };
    const ra = A.alignedReturns(al.dates, al.values[0]!, 1);
    const rb = A.alignedReturns(al.dates, al.values[1]!, 1);
    const estPairs: [number, number][] = [];
    for (let k = i0 - b.window - est; k < i0 - b.window; k++) if (ra[k - 1] != null && rb[k - 1] != null) estPairs.push([ra[k - 1]!, rb[k - 1]!]);
    const ma = A.mean(estPairs.map((p) => p[0]));
    const mb = A.mean(estPairs.map((p) => p[1]));
    let cov = 0;
    let vb = 0;
    for (const [p, q] of estPairs) { cov += (p - ma) * (q - mb); vb += (q - mb) ** 2; }
    const beta = vb > 0 ? cov / vb : 1;
    const alpha = ma - beta * mb;
    const resid = estPairs.map(([p, q]) => p - alpha - beta * q);
    const sigma = A.stdev(resid);
    const rows = [];
    let car = 0;
    for (let k = i0 - b.window; k <= i0 + b.window; k++) {
      const r = ra[k - 1];
      const m = rb[k - 1];
      if (r == null || m == null) { rows.push({ day: k - i0, date: iso(al.dates[k]!), ret: null, expected: null, abnormal: null }); continue; }
      const exp = alpha + beta * m;
      car += r - exp;
      rows.push({ day: k - i0, date: iso(al.dates[k]!), ret: r, expected: exp, abnormal: r - exp });
    }
    const n = rows.filter((r) => r.abnormal !== null).length;
    const t = sigma > 0 ? car / (sigma * Math.sqrt(n)) : null;
    return {
      event: ev, instruments: [describe(x!), describe(bench!)],
      result: { beta, alpha_daily: alpha, estimation_days: estPairs.length, window: b.window, rows, car, t_stat: t, robust: t !== null && Math.abs(t) >= 2 },
      method: `Market model: expected return = α + β × benchmark return, estimated over ${est} days ending ${b.window} days before day 0 (the first observation on or after the publication time). Abnormal return = actual − expected; CAR is their sum over days −${b.window} to +${b.window}. t = CAR ÷ (σ_residual × √n).`,
      caveats: ['An observed association around one event is not evidence that the event caused the move.', '|t| ≥ 2 is a rough guide on a single event; crypto returns are fat-tailed and events are often anticipated.'],
    };
  });

  // ───────── Feature 9: regime lab ─────────
  app.post('/v1/research/regimes', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ key: z.string().refine(isInstrumentKey) }), req.body);
    const [inst] = await load(u.userId, [b.key], 'max');
    const r = A.regimes(inst!.observations);
    if (!r.ok) return { instrument: describe(inst!), result: null, reason: r.reason };
    const transitions = r.segments.slice(1).map((s, i) => ({ date: iso(s.from), from: r.segments[i]!.regime, to: s.regime }));
    return {
      instrument: describe(inst!), classified_at: now().toISOString(), as_of: inst!.last,
      result: { current: r.current, median_vol: r.median_vol, share: r.share, segments: r.segments.slice(-40).map((s) => ({ from: iso(s.from), to: iso(s.to), regime: s.regime, days: Math.round((s.to - s.from) / DAY) + 1 })), transitions: transitions.slice(-30), transitions_total: transitions.length },
      method: 'Trend: close above or below its 200-observation simple moving average. Volatility: 30-day realised volatility above or at/below its full-history median. Days without both inputs are unclassified.',
      caveats: ['A descriptive label of the past, not a prediction or a trading signal. Frequent transitions mean the label is unstable near the boundaries.', inst!.calendar === 'sessions' ? 'For session calendars the 200-observation average spans about 10 months, not 200 calendar days.' : 'For crypto, 200 observations are 200 calendar days.'],
    };
  });

  // ───────── Feature 10: data integrity and cross-provider reconciliation ─────────
  async function integrityFor(userId: string, key: string) {
    const [inst] = await load(userId, [key], 'max');
    const obs = inst!.observations;
    const gaps = inst!.calendar === 'continuous' ? A.alignedReturns(obs.map((o) => o.t), obs.map((o) => o.v), 1).flatMap((r, i) => (r === null ? [{ from: iso(obs[i]!.t + DAY), to: iso(obs[i + 1]!.t - DAY), missing: Math.round((obs[i + 1]!.t - obs[i]!.t) / DAY) - 1 }] : [])) : obs.slice(1).flatMap((o, i) => ((o.t - obs[i]!.t) / DAY > 5 ? [{ from: iso(obs[i]!.t + DAY), to: iso(o.t - DAY), missing: null as number | null }] : []));
    const out: Record<string, unknown> = { instrument: describe(inst!), gaps: gaps.slice(-50), gap_count: gaps.length };
    if (inst!.asset_class === 'crypto') {
      const canon = inst!.key.slice(7).split('@')[0]!;
      const seriesId = inst!.key.split('@')[1]!;
      const flags = await db.one<{ suspect: number }>(`SELECT count(*) FILTER (WHERE validation='suspect')::int AS suspect FROM crypto.ohlcv WHERE series_id=$1`, [seriesId]);
      const quarantined = await db.query(`SELECT record_key, reasons, created_at FROM crypto.quarantine WHERE record_key LIKE $1 ORDER BY created_at DESC LIMIT 20`, [`${seriesId}:%`]);
      // Reconciliation: every other stored series of the same asset, compared on shared dates.
      const others = await db.query<{ series_id: string; source_id: string; quote_currency: string; kind: string; product_id: string | null }>(`SELECT s.series_id, s.source_id, s.quote_currency, s.kind, p.product_id FROM crypto.price_series s JOIN crypto.assets a ON a.asset_id=s.asset_id LEFT JOIN crypto.market_pairs p ON p.pair_id=s.pair_id WHERE a.canonical_key=$1 AND s.series_id<>$2 AND s.observations > 0`, [canon, seriesId]);
      const recon = [];
      for (const o of others) {
        const rows = await db.query<{ open_time: string; close: number }>(`SELECT open_time, close::float8 AS close FROM crypto.ohlcv WHERE series_id=$1 ORDER BY open_time`, [o.series_id]);
        // Reference closes are observed at 00:00 UTC of day D, i.e. the venue close of day D−1: shift to compare like with like.
        const shift = o.kind === 'reference_close' ? -DAY : 0;
        const theirs = new Map(rows.map((r) => [Date.parse(r.open_time) + shift, r.close]));
        const ownShift = inst!.source.startsWith('CoinGecko') ? -DAY : 0;
        const devs = obs.flatMap((p) => { const v = theirs.get(p.t + ownShift); return v === undefined ? [] : [{ t: p.t + ownShift, d: p.v / v - 1 }]; });
        if (!devs.length) continue;
        const abs = devs.map((d) => Math.abs(d.d)).sort((a, c) => a - c);
        const big = devs.filter((d) => Math.abs(d.d) > 0.02);
        recon.push({ other: `${o.source_id}${o.product_id ? ` ${o.product_id}` : ''} (${o.quote_currency})`, shared_days: devs.length, median_abs_deviation: abs[Math.floor(abs.length / 2)], max_abs_deviation: abs[abs.length - 1], days_over_2pct: big.length, worst: big.sort((a, c) => Math.abs(c.d) - Math.abs(a.d)).slice(0, 5).map((d) => ({ date: iso(d.t), deviation: d.d })) });
      }
      Object.assign(out, { suspect_observations: flags.suspect, quarantined, reconciliation: recon, reconciliation_rule: 'Series are compared on shared dates without averaging. A deviation above 2% is listed for investigation; differences of a few tenths of a percent are normal between venues and quote currencies (USD vs USDT). Source priority for analysis: the longest venue series, then the reference series; ATLAS never blends them.' });
    } else if (inst!.asset_class === 'equity' || inst!.asset_class === 'index') {
      const [exchange, symbol] = inst!.key.slice(7).split('@')[0]!.split(':');
      const rev = await db.query(`SELECT r.trade_date, r.previous, r.revised_at FROM equity.price_revisions r JOIN equity.price_series s USING (series_id) JOIN equity.instruments i USING (instrument_id) WHERE i.exchange=$1 AND i.symbol=$2 ORDER BY r.revised_at DESC LIMIT 20`, [exchange, symbol]);
      Object.assign(out, { revisions: rev });
    }
    return out;
  }

  app.post('/v1/research/integrity', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ key: z.string().refine(isInstrumentKey) }), req.body);
    return integrityFor(u.userId, b.key);
  });

  app.post('/v1/research/integrity/finding', async (req) => {
    const u = requireUser(req);
    const b = parse(z.object({ key: z.string().refine(isInstrumentKey), finding: z.enum(['gap', 'deviation', 'suspect', 'revision']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), explanation: z.string().trim().min(20).max(2000) }), req.body);
    // The finding must point at something the integrity check actually reports (server re-checks it).
    const integ = (await integrityFor(u.userId, b.key)) as unknown as { gaps: { from: string; to: string }[]; reconciliation?: { worst: { date: string }[] }[]; revisions?: { trade_date: string }[]; suspect_observations?: number };
    const exists = b.finding === 'gap' ? integ.gaps.some((g) => g.from <= b.date && b.date <= g.to)
      : b.finding === 'deviation' ? (integ.reconciliation ?? []).some((r) => r.worst.some((w) => w.date === b.date))
        : b.finding === 'revision' ? (integ.revisions ?? []).some((r) => r.trade_date === b.date)
          : (integ.suspect_observations ?? 0) > 0;
    if (!exists) throw badRequest('That date does not match an issue the integrity check reports for this instrument.');
    const entry = await db.one<{ entry_id: string }>(`INSERT INTO research.notebook_entries (user_id, kind, title, body, instruments, sources) VALUES ($1,'note',$2,$3,$4,$5) RETURNING entry_id`,
      [u.userId, `Data issue: ${b.finding} on ${b.date}`, b.explanation, [b.key], JSON.stringify([{ type: 'integrity_check', key: b.key, finding: b.finding, date: b.date }])]);
    await recordActivity(db, u.userId, 'data_issue_investigated', `${b.key.split('@')[0]}|${b.finding}|${b.date}`, now(), { entry_id: entry.entry_id });
    return { ok: true, entry_id: entry.entry_id };
  });

  // ───────── Feature 20: discovery ─────────
  app.get('/v1/research/discoveries', async (req) => {
    const u = requireUser(req);
    const rows = (await universe(u.userId)).filter((r) => r.asset_class === 'crypto');
    const btcKey = rows.find((r) => r.key.startsWith('crypto:bitcoin@'))?.key;
    const btc = btcKey ? await resolveInstrument(db, u.userId, btcKey, now(), { fromMs: now().getTime() - 400 * DAY }) : null;
    const findings: Record<string, unknown>[] = [];
    for (const r of rows.slice(0, 60)) {
      const inst = await resolveInstrument(db, u.userId, r.key, now(), { fromMs: now().getTime() - 400 * DAY });
      const absRets = A.simpleReturns(inst.observations).map((x) => Math.abs(x.r));
      const volChange = A.recentVsBaseline(absRets, 30, 90);
      if (volChange && (volChange.ratio >= 1.75 || volChange.ratio <= 0.5)) findings.push({ kind: 'volatility_change', key: r.key, label: r.label, what: `Mean absolute daily move over the last 30 days is ${volChange.ratio.toFixed(2)}× its level over the previous 90 days.`, baseline: 'the 90 days before the last 30', period: `30 days to ${inst.last?.slice(0, 10)}`, sources: inst.source, robustness: 'Descriptive: a ratio, not a statistical test.', limitations: 'One venue series; a few extreme days can drive the ratio.', value: volChange.ratio });
      const vol = A.recentVsBaseline(inst.volumes, 7, 90);
      if (vol && vol.ratio >= 2.5) findings.push({ kind: 'volume_anomaly', key: r.key, label: r.label, what: `Average daily volume over the last 7 days is ${vol.ratio.toFixed(1)}× its average over the previous 90 days.`, baseline: 'mean of the 90 days before the last 7', period: `7 days to ${inst.last?.slice(0, 10)}`, sources: inst.source, robustness: 'Descriptive.', limitations: 'Venue volume only; other venues and wash trading are not accounted for.', value: vol.ratio });
      if (btc && !r.key.startsWith('crypto:bitcoin@') && r.return_30d !== null) {
        const btc30 = A.periodReturn(btc.observations, 30);
        if (btc30.ok && Math.abs(r.return_30d - btc30.value) >= 0.25) findings.push({ kind: 'benchmark_divergence', key: r.key, label: r.label, what: `30-day return ${(r.return_30d * 100).toFixed(1)}% vs bitcoin ${(btc30.value * 100).toFixed(1)}%: a gap of ${((r.return_30d - btc30.value) * 100).toFixed(1)} percentage points.`, baseline: 'bitcoin over the same 30 days', period: `30 days to ${inst.last?.slice(0, 10)}`, sources: `${inst.source}; ${btc.source}`, robustness: 'Descriptive.', limitations: 'Different venues or quote currencies can add small differences.', value: r.return_30d - btc30.value });
        const al = A.alignSeries([inst.observations, btc.observations]);
        const ra = A.alignedReturns(al.dates, al.values[0]!, 1);
        const rb = A.alignedReturns(al.dates, al.values[1]!, 1);
        const corr = (from: number, to: number) => { const p = ra.slice(from, to).map((x, i) => [x, rb.slice(from, to)[i]] as const).filter((q): q is readonly [number, number] => q[0] !== null && q[1] !== null); return p.length >= 25 ? A.pearson(p.map((q) => q[0]), p.map((q) => q[1])) : null; };
        const n = ra.length;
        const recent = corr(n - 30, n);
        const before = corr(n - 120, n - 30);
        if (recent !== null && before !== null && Math.abs(recent - before) >= 0.4) findings.push({ kind: 'correlation_shift', key: r.key, label: r.label, what: `Correlation of daily returns with bitcoin is ${recent.toFixed(2)} over the last 30 days vs ${before.toFixed(2)} over the 90 days before.`, baseline: 'the 90 days before the last 30', period: `30 days to ${inst.last?.slice(0, 10)}`, sources: `${inst.source}; ${btc.source}`, robustness: 'Descriptive; 30-day correlations are noisy.', limitations: 'Correlation does not establish causation.', value: recent - before });
      }
    }
    const dq = await db.query<{ source_id: string; dataset: string; n: number }>(`SELECT source_id, dataset, count(*)::int AS n FROM crypto.quarantine WHERE created_at > $1 GROUP BY source_id, dataset`, [new Date(now().getTime() - 7 * DAY).toISOString()]);
    for (const d of dq) findings.push({ kind: 'data_quality', key: null, label: `${d.source_id} ${d.dataset}`, what: `${d.n} record(s) quarantined in the last 7 days.`, baseline: 'zero quarantined records is the expected state', period: 'last 7 days', sources: d.source_id, robustness: 'A count of validation failures.', limitations: 'See Sources & health for the reasons.', value: d.n });
    return {
      generated_at: now().toISOString(), scanned: Math.min(60, rows.length), findings,
      rules: ['Volatility change: last-30-day mean absolute daily move ÷ previous 90 days ≥ 1.75 or ≤ 0.5.', 'Volume anomaly: last-7-day mean volume ÷ previous 90 days ≥ 2.5.', 'Benchmark divergence: |30-day return − bitcoin’s| ≥ 25 percentage points.', 'Correlation shift: |30-day correlation with bitcoin − previous 90 days| ≥ 0.4.', 'Data quality: any quarantined records in the last 7 days.'],
      note: 'Findings are research questions from transparent rules on stored data, not signals or recommendations.',
    };
  });
}
