import { addDays, dayOfWeek, istInstant } from '../../lib/dates.js';
import type { CompanyFundamentals } from './fundamentals.js';
import { between, hashSeed, mulberry32, normal, round } from './rng.js';
import type { CompanySpec } from './universe.js';

// Synthetic end-of-day market data: trading calendar, raw (as-traded) prices that jump on
// corporate-action ex-dates, corporate actions, index levels and constituents.

export interface VendorPrice {
  isin: string;
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prev_close: number | null;
  volume: number;
  trades: number;
  delivery_qty: number;
  traded_value: number;
}

export interface VendorCorporateAction {
  isin: string;
  action_type: 'split' | 'bonus' | 'rights' | 'dividend' | 'merger' | 'delisting' | 'symbol_change';
  announced_at: string;
  ex_date: string;
  record_date: string | null;
  ratio_num: number | null;
  ratio_den: number | null;
  cash_amount: number | null;
  subscription_price: number | null;
  notes: string | null;
}

// Synthetic exchange holidays (fixed dates). Real NSE calendars must come from the licensed master-data feed.
const FIXED_HOLIDAYS = ['01-26', '03-14', '04-14', '05-01', '08-15', '10-02', '11-01', '12-25'];

export function tradingCalendar(start: string, end: string): { date: string; isTradingDay: boolean; note: string | null }[] {
  const out: { date: string; isTradingDay: boolean; note: string | null }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const holiday = FIXED_HOLIDAYS.includes(d.slice(5));
    const weekend = dow === 0 || dow === 6;
    out.push({ date: d, isTradingDay: !weekend && !holiday, note: weekend ? 'Weekend' : holiday ? 'Exchange holiday (synthetic calendar)' : null });
  }
  return out;
}

export interface PricePlan {
  prices: VendorPrice[];
  actions: VendorCorporateAction[];
  /** Final-share-basis shares outstanding, for market capitalisation. */
  finalShares: number;
  /** Shares outstanding (raw basis) by date for market cap: shares_t = finalShares × Π later factors. */
  sharesOn: (date: string) => number;
}

interface MarketFactor {
  dates: string[];
  ret: Map<string, number>;
  sector: Map<string, Map<string, number>>;
}

export function marketFactors(seed: number, days: string[], sectors: string[]): MarketFactor {
  const r = mulberry32(hashSeed('market', seed));
  const ret = new Map<string, number>();
  let state = 1;
  const vols = [0.0065, 0.0105, 0.02];
  for (const d of days) {
    const u = r();
    if (state === 0 && u < 0.01) state = 1;
    else if (state === 1 && u < 0.008) state = u < 0.004 ? 0 : 2;
    else if (state === 2 && u < 0.04) state = 1;
    let mu = 0.00045;
    let sigma = vols[state]!;
    if (d >= '2020-02-20' && d <= '2020-03-23') {
      mu = -0.011;
      sigma = 0.032;
    } else if (d > '2020-03-23' && d <= '2020-06-30') {
      mu = 0.0035;
      sigma = 0.02;
    }
    ret.set(d, mu + sigma * normal(r));
  }
  const sector = new Map<string, Map<string, number>>();
  for (const s of sectors) {
    const rs = mulberry32(hashSeed('sector', seed, s));
    const m = new Map<string, number>();
    let drift = 0;
    for (const d of days) {
      drift = drift * 0.995 + normal(rs) * 0.00003;
      m.set(d, drift + 0.0055 * normal(rs));
    }
    sector.set(s, m);
  }
  return { dates: days, ret, sector };
}

export function generatePrices(c: CompanySpec, f: CompanyFundamentals, seed: number, tradingDays: string[], factors: MarketFactor, lastFy: number): PricePlan {
  const r = mulberry32(hashSeed('price', seed, c.idx));
  const actions: VendorCorporateAction[] = [];
  const days = tradingDays.filter((d) => d >= c.listedOn && (!c.delistedOn || d <= c.delistedOn));
  const end = days[days.length - 1] ?? c.listedOn;
  const firstTradingOnOrAfter = (iso: string): string | undefined => days.find((d) => d >= iso);

  const factorEvents: { exDate: string; factor: number }[] = [];
  if (c.traits.has('split')) {
    const ex = firstTradingOnOrAfter(`${lastFy - 4}-04-20`);
    if (ex) {
      factorEvents.push({ exDate: ex, factor: 0.2 });
      actions.push({ isin: c.isin, action_type: 'split', announced_at: istInstant(addDays(ex, -30), '15:10'), ex_date: ex, record_date: ex, ratio_num: 5, ratio_den: 1, cash_amount: null, subscription_price: null, notes: 'Sub-division of face value ₹10 into ₹2 (5 new for 1 old)' });
    }
  }
  if (c.traits.has('bonus')) {
    const ex = firstTradingOnOrAfter(`${lastFy - 2}-04-20`);
    if (ex) {
      factorEvents.push({ exDate: ex, factor: 0.5 });
      actions.push({ isin: c.isin, action_type: 'bonus', announced_at: istInstant(addDays(ex, -35), '15:20'), ex_date: ex, record_date: ex, ratio_num: 1, ratio_den: 1, cash_amount: null, subscription_price: null, notes: 'Bonus 1:1 (one new share for every share held)' });
    }
  }
  const rightsEx = c.traits.has('rights') ? firstTradingOnOrAfter(`${lastFy - 3}-09-10`) : undefined;
  let rightsSubscription = 0;

  // Final-basis shares: the share count after every split, bonus and rights issue.
  const finalShares = f.shares * factorEvents.reduce((acc, e) => acc / e.factor, 1) * (rightsEx ? 1.2 : 1);
  // Rights 1-for-5 at 70% of the cum-rights close: TERP / cum = (5 + 0.7) / 6 = 0.95 regardless of price.
  const RIGHTS_FACTOR = 0.95;
  const splitBonusLater = (date: string): number => factorEvents.reduce((acc, e) => (e.exDate > date ? acc * e.factor : acc), 1);
  const laterFactor = (date: string): number => splitBonusLater(date) * (rightsEx && rightsEx > date ? RIGHTS_FACTOR : 1);

  // Dividend schedule: ex-date about six weeks after the annual filing, on the per-share amount filed then.
  const dividends = new Map<string, number>();
  for (const e of f.epsTimeline) {
    if (e.dps <= 0) continue;
    const ex = firstTradingOnOrAfter(addDays(e.availableAt.slice(0, 10), 45));
    if (ex) dividends.set(ex, e.dps);
  }

  const fairMcap = (date: string): number | null => {
    let latest: CompanyFundamentals['epsTimeline'][number] | undefined;
    for (const e of f.epsTimeline) if (e.availableAt.slice(0, 10) <= date) latest = e;
    if (!latest || latest.profitCr <= 0) return null;
    return latest.profitCr * c.pe0;
  };

  const prices: VendorPrice[] = [];
  // Economic price on the final share basis.
  let econ = (c.price0 * f.shares) / finalShares;
  let prevRaw: number | null = null;
  const sectorRet = factors.sector.get(c.sector.sector)!;
  const turnover = c.sizeBucket === 'large' ? 0.0012 : c.sizeBucket === 'mid' ? 0.002 : 0.003;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    const m = factors.ret.get(d) ?? 0;
    const fm = fairMcap(d);
    const mcapNow = (econ * finalShares) / 1e7;
    const anchor = fm ? 0.0018 * Math.log(fm / mcapNow) : 0;
    let ret = c.beta * m + (sectorRet.get(d) ?? 0) + c.idioVol * normal(r) + anchor;
    // Rare idiosyncratic jumps (news days)
    if (r() < 0.003) ret += normal(r) * 0.06;
    ret = Math.max(-0.19, Math.min(0.19, ret));
    if (i > 0) econ *= Math.exp(ret);
    const div = dividends.get(d);
    if (div) {
      // dps is per share at filing time; convert to the final basis.
      const lf = laterFactor(d);
      econ = Math.max(econ * 0.5, econ - div * lf);
    }
    if (rightsEx && d === rightsEx) {
      const cumRaw = prevRaw ?? econ;
      rightsSubscription = round(cumRaw * 0.7, 2);
      actions.push({ isin: c.isin, action_type: 'rights', announced_at: istInstant(addDays(d, -40), '16:05'), ex_date: d, record_date: d, ratio_num: 1, ratio_den: 5, cash_amount: null, subscription_price: rightsSubscription, notes: 'Rights issue: 1 new share for every 5 held at the subscription price' });
    }
    const raw = econ / laterFactor(d);
    const gap = 1 + normal(r) * 0.004;
    const open = round((prevRaw ?? raw) * gap, 2);
    const close = round(raw, 2);
    const hi = round(Math.max(open, close) * (1 + Math.abs(normal(r)) * 0.006), 2);
    const lo = round(Math.min(open, close) * (1 - Math.abs(normal(r)) * 0.006), 2);
    const adjVol = finalShares * turnover * Math.exp(normal(r) * 0.35) * (1 + Math.min(4, Math.abs(ret) / 0.012));
    const volume = Math.max(100, Math.round(adjVol * laterFactor(d)));
    const vwap = (hi + lo + close) / 3;
    prices.push({
      isin: c.isin,
      symbol: c.symbolHistory.find((s) => s.validFrom <= d && (!s.validTo || d < s.validTo))?.symbol ?? c.symbol,
      date: d,
      open, high: hi, low: lo, close,
      prev_close: prevRaw === null ? null : round(prevRaw, 2),
      volume,
      trades: Math.max(10, Math.round(volume / between(r, 40, 120))),
      delivery_qty: Math.round(volume * between(r, 0.3, 0.65)),
      traded_value: round(volume * vwap, 2),
    });
    prevRaw = close;
  }
  for (const [ex, dps] of dividends) {
    actions.push({ isin: c.isin, action_type: 'dividend', announced_at: istInstant(addDays(ex, -40), '17:50'), ex_date: ex, record_date: ex, ratio_num: null, ratio_den: null, cash_amount: dps, subscription_price: null, notes: 'Final dividend' });
  }
  if (c.delistedOn) {
    actions.push({ isin: c.isin, action_type: c.delistReason === 'merger' ? 'merger' : 'delisting', announced_at: istInstant(addDays(end, -60), '18:00'), ex_date: end, record_date: null, ratio_num: null, ratio_den: null, cash_amount: null, subscription_price: null, notes: c.delistReason === 'merger' ? 'Amalgamated into another company; last traded price recorded' : 'Voluntary delisting; last traded price recorded' });
  }
  for (const s of c.symbolHistory.slice(1)) {
    actions.push({ isin: c.isin, action_type: 'symbol_change', announced_at: istInstant(addDays(s.validFrom, -14), '12:00'), ex_date: s.validFrom, record_date: null, ratio_num: null, ratio_den: null, cash_amount: null, subscription_price: null, notes: `Symbol changed to ${s.symbol}` });
  }
  return { prices, actions, finalShares, sharesOn: (date) => finalShares * splitBonusLater(date) / (rightsEx && rightsEx > date ? 1.2 : 1) };
}

export interface IndexDef {
  index_code: string;
  name: string;
  kind: 'price' | 'total_return';
  universe_size_class: 'large' | 'mid' | 'small' | 'broad';
  base_date: string;
  base_value: number;
}

export interface IndexOutput {
  definitions: IndexDef[];
  constituents: { index_code: string; isin: string; effective_from: string; effective_to: string | null }[];
  levels: { index_code: string; date: string; close: number }[];
}

/** Cap-weighted price and total-return indices computed from synthetic constituents. */
export function generateIndices(companies: CompanySpec[], plans: Map<string, PricePlan>, tradingDays: string[]): IndexOutput {
  const base = tradingDays[0]!;
  const lcSize = Math.max(5, Math.round(companies.length * 0.25));
  const definitions: IndexDef[] = [
    { index_code: 'DEMO500', name: 'Demo Broad Market Index', kind: 'price', universe_size_class: 'broad', base_date: base, base_value: 10000 },
    { index_code: 'DEMO500TR', name: 'Demo Broad Market Index (Total Return)', kind: 'total_return', universe_size_class: 'broad', base_date: base, base_value: 10000 },
    { index_code: 'DEMOLC', name: `Demo Largecap ${lcSize}`, kind: 'price', universe_size_class: 'large', base_date: base, base_value: 10000 },
    { index_code: 'DEMOLCTR', name: `Demo Largecap ${lcSize} (Total Return)`, kind: 'total_return', universe_size_class: 'large', base_date: base, base_value: 10000 },
    { index_code: 'DEMOSC', name: 'Demo Smallcap', kind: 'price', universe_size_class: 'small', base_date: base, base_value: 10000 },
  ];
  // Per-security close/dividend lookups
  const byIsin = new Map<string, Map<string, VendorPrice>>();
  const divs = new Map<string, Map<string, number>>();
  const factorDates = new Map<string, Map<string, number>>();
  for (const c of companies) {
    const p = plans.get(c.isin)!;
    byIsin.set(c.isin, new Map(p.prices.map((x) => [x.date, x])));
    divs.set(c.isin, new Map(p.actions.filter((a) => a.action_type === 'dividend').map((a) => [a.ex_date, a.cash_amount!])));
    const fd = new Map<string, number>();
    for (const a of p.actions) {
      if (a.action_type === 'split') fd.set(a.ex_date, a.ratio_den! / a.ratio_num!);
      if (a.action_type === 'bonus') fd.set(a.ex_date, a.ratio_den! / (a.ratio_num! + a.ratio_den!));
      if (a.action_type === 'rights') fd.set(a.ex_date, 0.95);
    }
    factorDates.set(c.isin, fd);
  }
  const constituents: IndexOutput['constituents'] = [];
  // Broad index: every listed company while listed.
  for (const c of companies) {
    const prices = plans.get(c.isin)!.prices;
    if (!prices.length) continue;
    constituents.push({ index_code: 'DEMO500', isin: c.isin, effective_from: prices[0]!.date, effective_to: c.delistedOn ? addDays(prices[prices.length - 1]!.date, 1) : null });
  }
  // Large- and small-cap: reconstituted semi-annually (end of March and September) by market cap.
  const rebalances = tradingDays.filter((d, i) => {
    const next = tradingDays[i + 1];
    return i === 0 || (next !== undefined && ['03', '09'].includes(d.slice(5, 7)) && next.slice(5, 7) !== d.slice(5, 7));
  });
  const members: Record<'DEMOLC' | 'DEMOSC', Map<string, string>> = { DEMOLC: new Map(), DEMOSC: new Map() };
  for (const rb of rebalances) {
    const eff = tradingDays[tradingDays.indexOf(rb) + 1] ?? rb;
    const ranked = companies
      .filter((c) => byIsin.get(c.isin)!.has(rb))
      .map((c) => ({ isin: c.isin, mcap: byIsin.get(c.isin)!.get(rb)!.close * plans.get(c.isin)!.sharesOn(rb) }))
      .sort((a, b) => b.mcap - a.mcap);
    const sets = { DEMOLC: new Set(ranked.slice(0, lcSize).map((x) => x.isin)), DEMOSC: new Set(ranked.slice(Math.floor(ranked.length / 2)).map((x) => x.isin)) };
    for (const code of ['DEMOLC', 'DEMOSC'] as const) {
      const cur = members[code];
      for (const [isin, from] of [...cur]) {
        if (!sets[code].has(isin)) {
          constituents.push({ index_code: code, isin, effective_from: from, effective_to: eff });
          cur.delete(isin);
        }
      }
      for (const isin of sets[code]) if (!cur.has(isin)) cur.set(isin, rb === tradingDays[0] ? rb : eff);
    }
  }
  for (const code of ['DEMOLC', 'DEMOSC'] as const) {
    for (const [isin, from] of members[code]) {
      const c = companies.find((x) => x.isin === isin)!;
      const prices = plans.get(isin)!.prices;
      constituents.push({ index_code: code, isin, effective_from: from, effective_to: c.delistedOn ? addDays(prices[prices.length - 1]!.date, 1) : null });
    }
  }
  const intervals = new Map<string, { from: string; to: string | null }[]>();
  for (const k of constituents) {
    const key = `${k.index_code}|${k.isin}`;
    const list = intervals.get(key) ?? [];
    list.push({ from: k.effective_from, to: k.effective_to });
    intervals.set(key, list);
  }
  const memberOn = (code: string, isin: string, d: string) =>
    (intervals.get(`${code}|${isin}`) ?? []).some((k) => k.from <= d && (k.to === null || d < k.to));

  const levels: IndexOutput['levels'] = [];
  const level: Record<string, number> = { DEMO500: 10000, DEMO500TR: 10000, DEMOLC: 10000, DEMOLCTR: 10000, DEMOSC: 10000 };
  for (let i = 0; i < tradingDays.length; i++) {
    const d = tradingDays[i]!;
    if (i > 0) {
      const prev = tradingDays[i - 1]!;
      for (const code of ['DEMO500', 'DEMOLC', 'DEMOSC'] as const) {
        const isins = companies.map((c) => c.isin).filter((isin) => memberOn(code, isin, prev));
        let wSum = 0;
        let pr = 0;
        let tr = 0;
        for (const isin of isins) {
          const p0 = byIsin.get(isin)!.get(prev);
          const p1 = byIsin.get(isin)!.get(d);
          if (!p0 || !p1) continue;
          const w = p0.close * plans.get(isin)!.sharesOn(prev);
          const f = factorDates.get(isin)!.get(d) ?? 1;
          const priceRet = (p1.close / f) / p0.close - 1;
          const dv = divs.get(isin)!.get(d) ?? 0;
          wSum += w;
          pr += w * priceRet;
          tr += w * (priceRet + dv / p0.close);
        }
        if (wSum > 0) {
          level[code] = level[code]! * (1 + pr / wSum);
          if (code !== 'DEMOSC') level[`${code}TR`] = level[`${code}TR`]! * (1 + tr / wSum);
        }
      }
    }
    for (const code of Object.keys(level)) levels.push({ index_code: code, date: d, close: round(level[code]!, 2) });
  }
  return { definitions, constituents, levels };
}
