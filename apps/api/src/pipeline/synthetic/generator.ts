import { generateAnnouncements, generateInsiderTrades, generateMacroCalendar, generateRiskFree, generateShareholding, type VendorAnnouncement, type VendorAuditEvent, type VendorInsiderTrade, type VendorMacroEvent, type VendorRiskFree, type VendorShareholding } from './disclosures.js';
import { generateFundamentals, type VendorPeriod } from './fundamentals.js';
import { generateIndices, generatePrices, marketFactors, tradingCalendar, type IndexOutput, type VendorCorporateAction, type VendorPrice } from './market.js';
import { round } from './rng.js';
import { buildUniverse, SECTORS, type CompanySpec } from './universe.js';

// The synthetic "vendor": a deterministic world generated once up to a fixed horizon, from
// which the adapter releases only what would have been published by a given date. History
// therefore never changes when the release date advances.

export const SYNTHETIC_HORIZON = '2027-06-30';
export const SYNTHETIC_START = '2013-01-01';

export interface VendorMasterRecord {
  isin: string;
  company_name: string;
  short_name: string;
  former_names: string[];
  cin: string;
  sector: string;
  industry: string;
  template: string;
  listed_on: string;
  delisted_on: string | null;
  status: 'listed' | 'delisted';
  face_value: number;
  description: string;
  segments_reported: boolean;
  symbols: { symbol: string; valid_from: string; valid_to: string | null }[];
  coverage: 'full' | 'not_covered';
}

export interface SyntheticWorld {
  seed: number;
  companies: CompanySpec[];
  calendar: { date: string; isTradingDay: boolean; note: string | null }[];
  tradingDays: string[];
  master: VendorMasterRecord[];
  prices: VendorPrice[];
  actions: VendorCorporateAction[];
  indices: IndexOutput;
  periods: VendorPeriod[];
  xbrl: VendorPeriod[];
  shareholding: VendorShareholding[];
  announcements: VendorAnnouncement[];
  insider: VendorInsiderTrade[];
  audit: VendorAuditEvent[];
  riskFree: VendorRiskFree[];
  macro: VendorMacroEvent[];
}

export interface WorldOptions {
  seed?: number;
  companies?: number;
  start?: string;
  horizon?: string;
}

const cache = new Map<string, SyntheticWorld>();

export function buildWorld(opts: WorldOptions = {}): SyntheticWorld {
  const seed = opts.seed ?? 2026;
  const n = opts.companies ?? 120;
  const start = opts.start ?? SYNTHETIC_START;
  const horizon = opts.horizon ?? SYNTHETIC_HORIZON;
  const key = `${seed}|${n}|${start}|${horizon}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const companies = buildUniverse({ seed, companies: n, startDate: start, endDate: horizon });
  const calendar = tradingCalendar(start, horizon);
  const tradingDays = calendar.filter((d) => d.isTradingDay).map((d) => d.date);
  const factors = marketFactors(seed, tradingDays, SECTORS.map((s) => s.sector));
  const lastFy = Number(horizon.slice(5, 7)) >= 4 ? Number(horizon.slice(0, 4)) + 1 : Number(horizon.slice(0, 4));

  const periods: VendorPeriod[] = [];
  const xbrl: VendorPeriod[] = [];
  const prices: VendorPrice[] = [];
  const actions: VendorCorporateAction[] = [];
  const shareholding: VendorShareholding[] = [];
  const announcements: VendorAnnouncement[] = [];
  const insider: VendorInsiderTrade[] = [];
  const audit: VendorAuditEvent[] = [];
  const macro: VendorMacroEvent[] = [];
  const plans = new Map<string, ReturnType<typeof generatePrices>>();

  for (const c of companies) {
    const f = generateFundamentals(c, seed, horizon);
    periods.push(...f.periods);
    const plan = generatePrices(c, f, seed, tradingDays, factors, lastFy);
    plans.set(c.isin, plan);
    prices.push(...plan.prices);
    actions.push(...plan.actions);
    shareholding.push(...generateShareholding(c, seed, horizon));
    const ann = generateAnnouncements(c, seed, f.periods, horizon);
    announcements.push(...ann.announcements);
    audit.push(...ann.audit);
    macro.push(...ann.upcoming);
    insider.push(...generateInsiderTrades(c, seed, horizon));
    // XBRL verification sample: latest annual period of each company, identical except for the
    // designated conflict company where revenue differs by 1.2% (beyond the 0.5% tolerance).
    const fy = f.periods.filter((p) => p.period_type === 'FY' && p.version === 1);
    for (const p of fy.slice(-3)) {
      const copy = structuredClone(p);
      if (c.traits.has('xbrl_conflict') && p.fiscal_year === 2026) copy.values.revenue_from_operations = round(copy.values.revenue_from_operations! * 1.012, 2);
      xbrl.push(copy);
    }
  }
  const indices = generateIndices(companies, plans, tradingDays);
  macro.push(...generateMacroCalendar(horizon).map((e) => e));
  // Listed companies outside the coverage universe: searchable with a "not yet covered" state (CMP-01).
  const uncovered: VendorMasterRecord[] = Array.from({ length: Math.max(10, Math.round(n * 0.25)) }, (_, k) => {
    const sector = SECTORS[k % SECTORS.length]!;
    const name = `${['Sapphire', 'Vanguard', 'Kalpataru', 'Shikhar', 'Ambar', 'Nirmal', 'Pratham', 'Sanjivani', 'Utkarsh', 'Abhay'][k % 10]} ${sector.suffixes[k % sector.suffixes.length]}${k >= 10 ? ` ${Math.floor(k / 10) + 1}` : ''}`;
    return {
      isin: `XXSSYN9${String(k + 1).padStart(4, '0')}X`,
      company_name: `${name} Ltd`, short_name: name, former_names: [], cin: `X9${String(k).padStart(4, '0')}SYN2012PLC${200000 + k}`,
      sector: sector.sector, industry: sector.industries[0]!, template: sector.template, listed_on: '2015-06-01', delisted_on: null, status: 'listed' as const,
      face_value: 10, description: `${name} is a fictional listed company outside the ATLAS coverage universe (synthetic).`, segments_reported: false,
      symbols: [{ symbol: name.replace(/[^A-Za-z]/g, '').slice(0, 10).toUpperCase(), valid_from: '2015-06-01', valid_to: null }],
      coverage: 'not_covered' as const,
    };
  });
  const master: VendorMasterRecord[] = companies.map((c) => ({
    coverage: 'full' as const,
    isin: c.isin,
    company_name: c.legalName,
    short_name: c.shortName,
    former_names: c.formerNames,
    cin: c.cin,
    sector: c.sector.sector,
    industry: c.industry,
    template: c.template,
    listed_on: c.listedOn,
    delisted_on: c.delistedOn,
    status: c.delistedOn ? 'delisted' : 'listed',
    face_value: c.traits.has('split') ? 2 : 10,
    description: c.description,
    segments_reported: c.segmentsReported,
    symbols: c.symbolHistory.map((s) => ({ symbol: s.symbol, valid_from: s.validFrom, valid_to: s.validTo })),
  }));
  master.push(...uncovered);
  const world: SyntheticWorld = {
    seed, companies, calendar, tradingDays, master, prices, actions, indices, periods, xbrl, shareholding, announcements, insider, audit,
    riskFree: generateRiskFree(seed, start, horizon), macro,
  };
  cache.set(key, world);
  return world;
}
