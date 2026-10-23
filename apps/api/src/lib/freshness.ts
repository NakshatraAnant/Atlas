// Freshness that respects each series' publication schedule (docs/ATLAS_DATA_QUALITY_AND_FRESHNESS.md).
// The age of the latest observation is compared with how old the latest observation normally is when a
// series of that frequency is up to date (the reporting period plus the usual publication lag). A
// monthly series is therefore not "stale" because it did not change today, and a daily price is not
// "fresh" when its newest observation is weeks old.
//   fresh        latest observation within the expected age
//   delayed      up to 1.5 × the expected age (publication may simply be late)
//   stale        older than that
//   unavailable  no observation stored
//   provider_error  the last attempt to update failed and the data is no longer fresh
//   discontinued    the source no longer publishes the series (history only)

export type FreshState = 'fresh' | 'delayed' | 'stale' | 'unavailable' | 'provider_error' | 'discontinued';
export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

/** Expected age (days) of the newest observation when the series is current. */
// Calibrated on real FRED release lags (23 Oct 2026): core PCE for August was 83 days old in late October,
// US GDP Q2 (dated 1 April) 205 days old just before the Q3 release.
export const EXPECTED_AGE_DAYS: Record<Cadence, number> = { daily: 5, weekly: 13, monthly: 95, quarterly: 215, annual: 915 };
// Annual: a value for year Y (dated 1 January Y) is typically published in the middle of Y+1 and replaced
// in the middle of Y+2 (World Bank GDP, for example), so up to about 2.5 years is normal.

export function cadenceOf(frequency: string | null | undefined): Cadence {
  const f = (frequency ?? '').toLowerCase();
  if (f.startsWith('d')) return 'daily';
  if (f.startsWith('w') || f.startsWith('bi')) return 'weekly';
  if (f.startsWith('q')) return 'quarterly';
  if (f.startsWith('a') || f.startsWith('y')) return 'annual';
  return 'monthly';
}

export interface Freshness { state: FreshState; age_days: number | null; expected_within_days: number; rule: string }

export interface FreshnessOptions {
  /** Series published with a longer lag than its frequency suggests (daily rates in a weekly release). */
  expectedAgeDays?: number;
  /** The source stopped publishing the series after this date. */
  discontinuedAfter?: string | null;
}

export function freshnessOf(lastObservation: string | null, frequency: string | null | undefined, now: Date, lastError?: string | null, opts: FreshnessOptions = {}): Freshness {
  const cadence = cadenceOf(frequency);
  const expected = opts.expectedAgeDays ?? EXPECTED_AGE_DAYS[cadence];
  if (opts.discontinuedAfter && lastObservation && lastObservation.slice(0, 10) >= opts.discontinuedAfter) {
    return { state: 'discontinued', age_days: Math.floor((now.getTime() - Date.parse(`${lastObservation.slice(0, 10)}T00:00:00Z`)) / 86_400_000), expected_within_days: expected, rule: `The source stopped publishing this series after ${opts.discontinuedAfter}; it is shown as history.` };
  }
  const rule = opts.expectedAgeDays ? `This series is published with a lag: fresh while the newest observation is at most ${expected} days old, delayed up to ${Math.round(expected * 1.5)} days, stale after that.` : `${cadence} series: fresh while the newest observation is at most ${expected} days old, delayed up to ${Math.round(expected * 1.5)} days, stale after that.`;
  if (!lastObservation) return { state: 'unavailable', age_days: null, expected_within_days: expected, rule };
  const age = Math.floor((now.getTime() - Date.parse(`${lastObservation.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  let state: FreshState = age <= expected ? 'fresh' : age <= expected * 1.5 ? 'delayed' : 'stale';
  if (state !== 'fresh' && lastError) state = 'provider_error';
  return { state, age_days: age, expected_within_days: expected, rule };
}
