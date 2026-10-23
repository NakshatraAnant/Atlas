// Commodity sources and the curated series catalogue (docs/commodity/COMMODITY_DATA.md, checked 23 Oct 2026).
//
// Three categories, never blended:
//   global_benchmark      published benchmark prices (EIA daily spot assessments; IMF monthly averages);
//   indian_futures        MCX/NCDEX contracts: no permitted free source, so none are configured;
//   physical_fundamental  inventories and futures by contract position from EIA (needs your free EIA key).
//
// FRED's CSV download (fred.stlouisfed.org/graph/fredgraph.csv?id=…) needs no key; every series below was
// fetched from this machine on 23 Oct 2026. FRED gives a blank value for a day without an assessment
// (e.g. US holidays); a blank is a missing observation, never a zero.

export interface SeriesDef {
  series_id: string;
  category: 'global_benchmark' | 'indian_futures' | 'physical_fundamental';
  commodity: string;
  name: string;
  price_type: 'spot' | 'futures_settlement' | 'average_price' | 'index' | 'inventory';
  unit: string;
  currency: string | null;
  frequency: 'daily' | 'weekly' | 'monthly';
  source_id: 'fred' | 'eia';
  source_series: string;
  upstream: string;
  contract_position?: number;
  licence_note: string;
}

const EIA_VIA_FRED = 'U.S. Energy Information Administration data (U.S. government work), retrieved via FRED®, Federal Reserve Bank of St. Louis. Kept locally for your research.';
const IMF_VIA_FRED = 'IMF Primary Commodity Prices, retrieved via FRED®. Subject to the IMF’s terms of use (attribution); kept locally for personal research, not redistributed.';
const EIA_API = 'U.S. Energy Information Administration open data (U.S. government work), via the EIA API with your own key.';

const fredDaily = (id: string, commodity: string, name: string, unit: string): SeriesDef => ({ series_id: `fred:${id}`, category: 'global_benchmark', commodity, name, price_type: 'spot', unit, currency: 'USD', frequency: 'daily', source_id: 'fred', source_series: id, upstream: 'EIA spot price', licence_note: EIA_VIA_FRED });
const imf = (id: string, commodity: string, name: string, unit: string, priceType: 'average_price' | 'index' = 'average_price'): SeriesDef => ({ series_id: `fred:${id}`, category: 'global_benchmark', commodity, name, price_type: priceType, unit, currency: priceType === 'index' ? null : 'USD', frequency: 'monthly', source_id: 'fred', source_series: id, upstream: 'IMF Primary Commodity Prices (monthly average)', licence_note: IMF_VIA_FRED });

export const SERIES: SeriesDef[] = [
  fredDaily('DCOILWTICO', 'crude_oil', 'WTI crude oil, Cushing OK (spot)', 'USD per barrel'),
  fredDaily('DCOILBRENTEU', 'crude_oil', 'Brent crude oil, Europe (spot)', 'USD per barrel'),
  fredDaily('DHHNGSP', 'natural_gas', 'Henry Hub natural gas (spot)', 'USD per million Btu'),
  fredDaily('DHOILNYH', 'heating_oil', 'No. 2 heating oil, New York Harbor (spot)', 'USD per gallon'),
  fredDaily('DDFUELUSGULF', 'diesel', 'Ultra-low-sulfur No. 2 diesel, US Gulf Coast (spot)', 'USD per gallon'),
  fredDaily('DJFUELUSGULF', 'jet_fuel', 'Kerosene-type jet fuel, US Gulf Coast (spot)', 'USD per gallon'),
  fredDaily('DPROPANEMBTX', 'propane', 'Propane, Mont Belvieu TX (spot)', 'USD per gallon'),
  { series_id: 'fred:GASREGW', category: 'global_benchmark', commodity: 'gasoline', name: 'US regular gasoline, retail (weekly average)', price_type: 'average_price', unit: 'USD per gallon', currency: 'USD', frequency: 'weekly', source_id: 'fred', source_series: 'GASREGW', upstream: 'EIA retail price survey', licence_note: EIA_VIA_FRED },
  imf('PCOPPUSDM', 'copper', 'Copper (global price)', 'USD per metric ton'),
  imf('PALUMUSDM', 'aluminium', 'Aluminium (global price)', 'USD per metric ton'),
  imf('PNICKUSDM', 'nickel', 'Nickel (global price)', 'USD per metric ton'),
  imf('PZINCUSDM', 'zinc', 'Zinc (global price)', 'USD per metric ton'),
  imf('PWHEAMTUSDM', 'wheat', 'Wheat (global price)', 'USD per metric ton'),
  imf('PMAIZMTUSDM', 'maize', 'Maize/corn (global price)', 'USD per metric ton'),
  imf('PSOYBUSDM', 'soybeans', 'Soybeans (global price)', 'USD per metric ton'),
  imf('PRICENPQUSDM', 'rice', 'Rice (global price)', 'USD per metric ton'),
  imf('PPOILUSDM', 'palm_oil', 'Palm oil (global price)', 'USD per metric ton'),
  imf('PSUGAISAUSDM', 'sugar', 'Sugar, International Sugar Agreement (global price)', 'US cents per pound'),
  imf('PCOTTINDUSDM', 'cotton', 'Cotton (global price)', 'US cents per pound'),
  imf('PCOFFOTMUSDM', 'coffee', 'Coffee, other mild arabica (global price)', 'US cents per pound'),
  imf('PNGASEUUSDM', 'natural_gas', 'Natural gas, EU (global price)', 'USD per million Btu'),
  imf('PNGASJPUSDM', 'lng', 'LNG, Asia (global price)', 'USD per million Btu'),
  imf('PCOALAUUSDM', 'coal', 'Coal, Australian thermal (global price)', 'USD per metric ton'),
  imf('PURANUSDM', 'uranium', 'Uranium (global price)', 'USD per pound'),
  imf('PALLFNFINDEXM', 'all_commodities', 'All-commodities price index (IMF)', 'Index, 2016 = 100', 'index'),
  // Physical and fundamental statistics, and futures by contract position: EIA open data (your own key).
  { series_id: 'eia:WCESTUS1', category: 'physical_fundamental', commodity: 'crude_oil', name: 'US crude oil ending stocks excluding SPR (weekly)', price_type: 'inventory', unit: 'thousand barrels', currency: null, frequency: 'weekly', source_id: 'eia', source_series: 'WCESTUS1', upstream: 'EIA Weekly Petroleum Status Report', licence_note: EIA_API },
  ...[1, 2, 3, 4].map((n): SeriesDef => ({ series_id: `eia:RCLC${n}`, category: 'physical_fundamental', commodity: 'crude_oil', name: `NYMEX WTI crude futures, contract ${n} (Cushing)`, price_type: 'futures_settlement', unit: 'USD per barrel', currency: 'USD', frequency: 'daily', source_id: 'eia', source_series: `RCLC${n}`, upstream: 'EIA (NYMEX futures prices by contract position)', contract_position: n, licence_note: EIA_API })),
];

export const CATEGORY_NOTES = {
  global_benchmark: 'Published benchmark prices: EIA daily spot assessments (US locations) and IMF monthly average world prices. Spot and monthly averages are different things and are labelled; neither is a futures price or an Indian price.',
  indian_futures: 'MCX and NCDEX contracts (Indian exchange-traded futures). Not available: historical exchange data is licensed and no permitted free source was found (MCX/NCDEX data products are paid; EODHD’s free plan returned no Indian derivatives). Nothing is shown in its place.',
  physical_fundamental: 'Inventories and futures prices by contract position from the EIA open-data API. Needs your own free EIA key (EIA_API_KEY in .env.local); without it these series stay empty.',
} as const;

export const UNAVAILABLE = [
  { what: 'Gold and silver benchmark prices', why: 'The LBMA series were withdrawn from FRED (HTTP 404 on 23 Oct 2026) and no other free, permitted daily source was found.' },
  { what: 'Indian commodity futures (MCX, NCDEX)', why: 'Licensed exchange data; no permitted free source.' },
  { what: 'Indian physical spot prices (mandi arrivals and prices)', why: 'Agmarknet data via data.gov.in needs a separate API key and was not evaluated in this release.' },
  { what: 'Futures curves beyond WTI contract positions 1–4', why: 'Multi-expiry exchange data is licensed; EIA publishes only these four positions for WTI.' },
] as const;

// ───────────── Parsing ─────────────

export type CommodityErrorCategory = 'network' | 'timeout' | 'auth' | 'not_found' | 'rate_limited' | 'malformed' | 'provider_error' | 'not_configured';
export class CommodityError extends Error {
  constructor(readonly category: CommodityErrorCategory, message: string) {
    super(message);
  }
}

export interface ObsRow { date: string; value: number }
export interface Parsed { rows: ObsRow[]; missing: number; invalid: { line: number; raw: string; reason: string }[] }

/** FRED graph CSV: header "observation_date,<ID>" (older files "DATE,<ID>"); blank or "." = no observation that day. */
export function parseFredCsv(status: number, body: string, seriesId: string): Parsed {
  if (status === 404) throw new CommodityError('not_found', `FRED has no series ${seriesId} (HTTP 404).`);
  if (status === 429) throw new CommodityError('rate_limited', 'FRED asked ATLAS to slow down (HTTP 429).');
  if (status >= 400) throw new CommodityError('provider_error', `FRED returned HTTP ${status}.`);
  const lines = body.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = (lines[0] ?? '').split(',');
  if (head.length !== 2 || !/^(observation_date|DATE)$/i.test(head[0]!.trim()) || head[1]!.trim() !== seriesId) throw new CommodityError('malformed', `FRED response for ${seriesId} does not have the expected header.`);
  const out: Parsed = { rows: [], missing: 0, invalid: [] };
  lines.slice(1).forEach((l, i) => {
    const [d = '', v = ''] = l.split(',').map((x) => x.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { out.invalid.push({ line: i + 2, raw: l.slice(0, 80), reason: 'invalid_date' }); return; }
    if (v === '' || v === '.') { out.missing++; return; }
    const n = Number(v);
    if (!Number.isFinite(n)) { out.invalid.push({ line: i + 2, raw: l.slice(0, 80), reason: 'not_a_number' }); return; }
    out.rows.push({ date: d, value: n });
  });
  return out;
}

/**
 * EIA API v2 data response: { response: { data: [{ period, series, value, units }] } }. Shape from EIA's
 * API documentation; not yet exercised with a real key in this installation, so anything else is rejected.
 */
export function parseEiaV2(status: number, body: string, seriesId: string): Parsed {
  if (status === 401 || status === 403) throw new CommodityError('auth', `EIA rejected the API key (HTTP ${status}). Check EIA_API_KEY in .env.local.`);
  if (status === 429) throw new CommodityError('rate_limited', 'EIA rate limit reached (HTTP 429).');
  if (status >= 400) throw new CommodityError('provider_error', `EIA returned HTTP ${status}.`);
  let raw: any;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new CommodityError('malformed', 'EIA returned a response that is not JSON.');
  }
  if (raw?.error) throw new CommodityError(/api_key/i.test(String(raw.error)) ? 'auth' : 'provider_error', `EIA: ${String(raw.error).slice(0, 200)}`);
  const data = raw?.response?.data;
  if (!Array.isArray(data)) throw new CommodityError('malformed', 'EIA response has no response.data array.');
  const out: Parsed = { rows: [], missing: 0, invalid: [] };
  data.forEach((r: any, i: number) => {
    if (r?.series !== undefined && r.series !== seriesId) return;
    const d = String(r?.period ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { out.invalid.push({ line: i, raw: JSON.stringify(r).slice(0, 80), reason: 'invalid_date' }); return; }
    if (r.value === null || r.value === undefined || r.value === '') { out.missing++; return; }
    const n = Number(r.value);
    if (!Number.isFinite(n)) { out.invalid.push({ line: i, raw: JSON.stringify(r).slice(0, 80), reason: 'not_a_number' }); return; }
    out.rows.push({ date: d, value: n });
  });
  out.rows.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function fredUrl(id: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
}

export function eiaUrl(def: SeriesDef, key: string, start?: string): string {
  const route = def.price_type === 'inventory' ? 'petroleum/stoc/wstk' : 'petroleum/pri/fut';
  const freq = def.frequency === 'weekly' ? 'weekly' : 'daily';
  return `https://api.eia.gov/v2/${route}/data/?api_key=${encodeURIComponent(key)}&frequency=${freq}&data[0]=value&facets[series][]=${encodeURIComponent(def.source_series)}${start ? `&start=${start}` : ''}&sort[0][column]=period&sort[0][direction]=desc&length=5000`;
}

export const redactUrl = (u: string) => u.replace(/(api_key|api_token|apikey)=[^&]+/g, '$1=REDACTED');
