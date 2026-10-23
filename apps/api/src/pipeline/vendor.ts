import { addDays } from '../lib/dates.js';
import { buildWorld, type WorldOptions } from './synthetic/generator.js';
import { hashSeed } from './synthetic/rng.js';

// Vendor adapters deliver raw files exactly as a licensed provider would (SFTP drop or API pull).
// The pipeline never trusts them: every file is stored unchanged, checksummed and validated.

export type DatasetName =
  | 'master' | 'calendar' | 'eod_prices' | 'corporate_actions' | 'index' | 'fundamentals' | 'xbrl_sample'
  | 'shareholding' | 'announcements' | 'insider_trades' | 'audit_events' | 'risk_free' | 'macro_calendar';

export const DATASET_SOURCES: Record<DatasetName, string> = {
  master: 'syn_master', calendar: 'syn_calendar', eod_prices: 'syn_eod', corporate_actions: 'syn_corp_actions', index: 'syn_index',
  fundamentals: 'syn_fundamentals', xbrl_sample: 'syn_xbrl', shareholding: 'syn_shareholding', announcements: 'syn_announcements',
  insider_trades: 'syn_insider', audit_events: 'syn_audit', risk_free: 'syn_rbi', macro_calendar: 'syn_macro',
};

export interface VendorFile {
  sourceId: string;
  dataset: DatasetName;
  dataDate: string;
  mode: 'history' | 'daily';
  fileName: string;
  body: string;
}

export interface FetchRequest {
  /** Release date: the vendor delivers what was published by the end of this IST date. */
  asOf: string;
  mode: 'history' | 'daily';
  /** For daily mode: records published after this date (exclusive). Defaults to the previous day. */
  since?: string;
}

export interface VendorAdapter {
  readonly name: string;
  readonly isSynthetic: boolean;
  fetch(dataset: DatasetName, req: FetchRequest): Promise<VendorFile | null>;
}

export interface SyntheticVendorOptions extends WorldOptions {
  /** Inject one corrupted price row on deterministic days (exercises quarantine). */
  injectFaults?: boolean;
  /** Simulate a vendor outage for these dates (exercises staleness and delay notices). */
  missingDates?: string[];
}

const endOfDay = (d: string) => `${d}T18:29:59.999Z`; // 23:59:59 IST

/**
 * No vendor: used when demo data is switched off (ALLOW_SYNTHETIC_DATA=false) and no licensed vendor is
 * configured. Every fetch answers "nothing delivered", so the daily pipeline records an honest gap instead
 * of generating anything.
 */
export class NoVendor implements VendorAdapter {
  readonly name = 'none';
  readonly isSynthetic = false;
  async fetch(): Promise<VendorFile | null> {
    return null;
  }
}

export class SyntheticVendor implements VendorAdapter {
  readonly name = 'synthetic';
  readonly isSynthetic = true;
  constructor(private readonly opts: SyntheticVendorOptions = {}) {}

  get world() {
    return buildWorld(this.opts);
  }

  async fetch(dataset: DatasetName, req: FetchRequest): Promise<VendorFile | null> {
    const w = this.world;
    const asOf = req.asOf;
    const since = req.since ?? addDays(asOf, -1);
    const inWindow = (instant: string) => (req.mode === 'history' ? instant <= endOfDay(asOf) : instant > endOfDay(since) && instant <= endOfDay(asOf));
    const dateInWindow = (d: string) => (req.mode === 'history' ? d <= asOf : d > since && d <= asOf);
    if (this.opts.missingDates?.includes(asOf) && ['eod_prices', 'index', 'corporate_actions'].includes(dataset)) return null;
    let records: unknown[];
    switch (dataset) {
      case 'master':
        records = w.master.filter((m) => m.listed_on <= asOf).map((m) => ({ ...m, status: m.delisted_on && m.delisted_on <= asOf ? 'delisted' : 'listed', delisted_on: m.delisted_on && m.delisted_on <= asOf ? m.delisted_on : null, symbols: m.symbols.filter((s) => s.valid_from <= asOf).map((s) => ({ ...s, valid_to: s.valid_to && s.valid_to <= asOf ? s.valid_to : null })) }));
        break;
      case 'calendar':
        records = w.calendar.filter((d) => d.date <= addDays(asOf, 120));
        break;
      case 'eod_prices': {
        const rows = w.prices.filter((p) => dateInWindow(p.date)).map((p) => ({ ...p }));
        if (this.opts.injectFaults && req.mode === 'daily' && rows.length && hashSeed('fault', asOf) % 3 === 0) {
          const victim = rows[hashSeed('victim', asOf) % rows.length]!;
          const h = victim.high;
          victim.high = victim.low;
          victim.low = h; // high < low: OHLC integrity failure
        }
        records = rows;
        break;
      }
      case 'corporate_actions':
        records = w.actions.filter((a) => inWindow(a.announced_at));
        break;
      case 'index':
        records = [
          { kind: 'definitions', rows: w.indices.definitions },
          { kind: 'constituents', rows: w.indices.constituents.filter((c) => c.effective_from <= asOf).map((c) => ({ ...c, effective_to: c.effective_to && c.effective_to <= addDays(asOf, 1) ? c.effective_to : null })) },
          { kind: 'levels', rows: w.indices.levels.filter((l) => dateInWindow(l.date)) },
        ];
        break;
      case 'fundamentals':
        records = w.periods.filter((p) => inWindow(p.filed_at));
        break;
      case 'xbrl_sample':
        records = w.xbrl.filter((p) => inWindow(p.filed_at));
        break;
      case 'shareholding':
        records = w.shareholding.filter((s) => inWindow(s.filed_at));
        break;
      case 'announcements':
        records = w.announcements.filter((a) => inWindow(a.published_at));
        break;
      case 'insider_trades':
        records = w.insider.filter((t) => inWindow(t.disclosed_at));
        break;
      case 'audit_events':
        records = w.audit.filter((a) => inWindow(a.filed_at));
        break;
      case 'risk_free':
        records = w.riskFree.filter((r) => dateInWindow(r.auction_date));
        break;
      case 'macro_calendar':
        records = w.macro
          .filter((e) => e.event_date >= addDays(asOf, -30) && e.event_date <= addDays(asOf, 75))
          .filter((e) => e.kind !== 'results' || addDays(e.event_date, -45) <= asOf)
          .map((e) => (e.kind === 'results' ? { ...e, status: addDays(e.event_date, -9) <= asOf ? 'confirmed' : 'scheduled' } : e));
        break;
    }
    const body = JSON.stringify({ meta: { vendor: 'atlas-synthetic', dataset, asOf, since: req.mode === 'daily' ? since : null, mode: req.mode, synthetic: true }, records });
    return { sourceId: DATASET_SOURCES[dataset], dataset, dataDate: asOf, mode: req.mode, fileName: `${dataset}_${req.mode}_${asOf}.json`, body };
  }
}
