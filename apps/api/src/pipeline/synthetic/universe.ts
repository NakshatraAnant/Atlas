import { between, hashSeed, mulberry32, pick, type Rng } from './rng.js';

// Fictional company universe for development and tests. Names are invented, ISINs use the
// non-existent country prefix "XXS" so a synthetic security can never be confused with a
// real listing, and every company is flagged is_synthetic.

export type Template = 'standard' | 'bank' | 'nbfc' | 'insurance';

export interface SectorSpec {
  sector: string;
  industries: string[];
  template: Template;
  suffixes: string[];
  margin: number; // operating margin (standard template)
  growth: number; // long-run revenue growth
  peRange: [number, number];
  inventoryDays: number | null; // null = not reported
  seasonality: [number, number, number, number];
  beta: number;
}

export const SECTORS: SectorSpec[] = [
  { sector: 'IT', industries: ['IT Services', 'Software Products'], template: 'standard', suffixes: ['Software', 'Infotech', 'Digital', 'Systems'], margin: 0.22, growth: 0.11, peRange: [20, 38], inventoryDays: null, seasonality: [0.24, 0.25, 0.255, 0.255], beta: 0.85 },
  { sector: 'FMCG', industries: ['Packaged Foods', 'Personal Care'], template: 'standard', suffixes: ['Foods', 'Consumer', 'Beverages', 'Home Care'], margin: 0.17, growth: 0.09, peRange: [35, 60], inventoryDays: 45, seasonality: [0.245, 0.25, 0.255, 0.25], beta: 0.65 },
  { sector: 'Auto', industries: ['Passenger Vehicles', 'Auto Components', 'Two Wheelers'], template: 'standard', suffixes: ['Motors', 'Auto', 'Autoparts', 'Wheels'], margin: 0.13, growth: 0.1, peRange: [18, 32], inventoryDays: 30, seasonality: [0.22, 0.25, 0.28, 0.25], beta: 1.1 },
  { sector: 'Pharma', industries: ['Pharmaceuticals', 'Diagnostics'], template: 'standard', suffixes: ['Pharma Labs', 'Lifesciences', 'Healthcare', 'Remedies'], margin: 0.2, growth: 0.1, peRange: [22, 40], inventoryDays: 90, seasonality: [0.245, 0.255, 0.25, 0.25], beta: 0.75 },
  { sector: 'Metals', industries: ['Steel', 'Non-ferrous Metals'], template: 'standard', suffixes: ['Steel', 'Metals', 'Alloys'], margin: 0.15, growth: 0.07, peRange: [7, 14], inventoryDays: 70, seasonality: [0.24, 0.24, 0.26, 0.26], beta: 1.35 },
  { sector: 'Utilities', industries: ['Power Generation', 'Gas Distribution'], template: 'standard', suffixes: ['Power', 'Energy', 'Gas'], margin: 0.3, growth: 0.07, peRange: [9, 18], inventoryDays: 20, seasonality: [0.26, 0.25, 0.24, 0.25], beta: 0.8 },
  { sector: 'Materials', industries: ['Cement', 'Building Materials'], template: 'standard', suffixes: ['Cement', 'Buildmat', 'Infra Materials'], margin: 0.18, growth: 0.08, peRange: [18, 35], inventoryDays: 40, seasonality: [0.25, 0.22, 0.25, 0.28], beta: 1.05 },
  { sector: 'Retail', industries: ['Department Stores', 'Specialty Retail'], template: 'standard', suffixes: ['Retail', 'Lifestyle', 'Mart'], margin: 0.09, growth: 0.14, peRange: [40, 80], inventoryDays: 75, seasonality: [0.23, 0.24, 0.29, 0.24], beta: 1.0 },
  { sector: 'Telecom', industries: ['Telecom Services'], template: 'standard', suffixes: ['Telecom', 'Networks'], margin: 0.38, growth: 0.06, peRange: [25, 60], inventoryDays: null, seasonality: [0.25, 0.25, 0.25, 0.25], beta: 0.9 },
  { sector: 'Chemicals', industries: ['Specialty Chemicals', 'Agrochemicals'], template: 'standard', suffixes: ['Chemicals', 'Agro Chem', 'Polymers'], margin: 0.19, growth: 0.11, peRange: [25, 45], inventoryDays: 80, seasonality: [0.26, 0.24, 0.24, 0.26], beta: 1.05 },
  { sector: 'Capital Goods', industries: ['Industrial Machinery', 'Electrical Equipment'], template: 'standard', suffixes: ['Engineering', 'Electricals', 'Industries'], margin: 0.12, growth: 0.12, peRange: [30, 55], inventoryDays: 60, seasonality: [0.2, 0.23, 0.25, 0.32], beta: 1.15 },
  { sector: 'Banks', industries: ['Private Banks', 'Public Sector Banks'], template: 'bank', suffixes: ['Bank'], margin: 0, growth: 0.14, peRange: [10, 22], inventoryDays: null, seasonality: [0.24, 0.25, 0.25, 0.26], beta: 1.1 },
  { sector: 'NBFC', industries: ['Consumer Finance', 'Housing Finance'], template: 'nbfc', suffixes: ['Finserv', 'Capital', 'Housing Finance'], margin: 0, growth: 0.17, peRange: [15, 35], inventoryDays: null, seasonality: [0.24, 0.25, 0.25, 0.26], beta: 1.25 },
  { sector: 'Insurance', industries: ['Life Insurance', 'General Insurance'], template: 'insurance', suffixes: ['Insurance', 'Life Insurance'], margin: 0, growth: 0.13, peRange: [40, 80], inventoryDays: null, seasonality: [0.2, 0.24, 0.26, 0.3], beta: 0.85 },
];

const NAME_ROOTS = [
  'Kaveri', 'Zenith', 'Meridian', 'Orchid', 'Tarang', 'Alpine', 'Sundial', 'Banyan', 'Lotus', 'Garuda', 'Nimbus', 'Palmyra', 'Saffron', 'Indus', 'Vindhya',
  'Narmada', 'Konark', 'Ajanta', 'Deccan', 'Malabar', 'Coromandel', 'Aravali', 'Sahyadri', 'Chola', 'Pallava', 'Godavari', 'Tapti', 'Nilgiri', 'Kanchan', 'Mahanadi',
  'Shivalik', 'Hampi', 'Sarayu', 'Yamuna', 'Kosi', 'Chambal', 'Brahma', 'Ashoka', 'Vijaya', 'Kalinga', 'Magadh', 'Avanti', 'Kamrup', 'Lohit', 'Sutlej',
  'Beas', 'Ravi', 'Chenab', 'Jhelum', 'Teesta', 'Sabari', 'Pamba', 'Periyar', 'Krishna', 'Bhima', 'Tunga', 'Netravati', 'Mandovi', 'Zuari', 'Sharavati',
  'Amber', 'Coral', 'Jade', 'Onyx', 'Opal', 'Pearl', 'Ruby', 'Topaz', 'Garnet', 'Beryl', 'Quartz', 'Cobalt', 'Indigo', 'Crimson', 'Emerald',
  'Falcon', 'Heron', 'Ibis', 'Kestrel', 'Lark', 'Osprey', 'Peacock', 'Sarus', 'Swift', 'Tern', 'Bulbul', 'Mynah', 'Koel', 'Hornbill', 'Kingfisher',
  'Neem', 'Peepal', 'Sal', 'Teak', 'Deodar', 'Ashwa', 'Gulmohar', 'Kadamba', 'Arjuna', 'Bakul', 'Champa', 'Jasmine', 'Mogra', 'Tulsi', 'Chandan',
  'Prithvi', 'Agni', 'Vayu', 'Jal', 'Akash', 'Surya', 'Chandra', 'Tara', 'Dhruv', 'Mira', 'Arka', 'Ravi Kiran', 'Usha', 'Sandhya', 'Nisha',
  'Everest', 'Kanchenjunga', 'Nanda', 'Trishul', 'Kamet', 'Saltoro', 'Siachen', 'Doda', 'Pir Panjal', 'Zanskar', 'Ladakh', 'Spiti', 'Kinnaur', 'Lahaul', 'Kullu',
  'Bodhi', 'Dharma', 'Karma', 'Moksha', 'Shanti', 'Prana', 'Ojas', 'Tejas', 'Veda', 'Yuga', 'Kalpa', 'Mantra', 'Yantra', 'Sutra', 'Tantra',
  'Bharat', 'Hind', 'Aryan', 'Navya', 'Nova', 'Orion', 'Pegasus', 'Lyra', 'Vega', 'Rigel', 'Sirius', 'Altair', 'Deneb', 'Polaris', 'Canopus',
  'Kesari', 'Haldi', 'Elaichi', 'Kesar', 'Jeera', 'Methi', 'Ajwain', 'Saunf', 'Dalchini', 'Laung', 'Kalonji', 'Hing', 'Imli', 'Kokum', 'Amla',
  'Pinnacle', 'Summit', 'Crest', 'Apex', 'Vertex', 'Horizon', 'Frontier', 'Harbour', 'Delta', 'Estuary', 'Lagoon', 'Prairie', 'Meadow', 'Grove', 'Orchard',
  'Monsoon', 'Basant', 'Sharad', 'Hemant', 'Shishir', 'Grishma', 'Varsha', 'Megh', 'Barkha', 'Sawan', 'Phagun', 'Chaitra', 'Kartik', 'Magh', 'Pausha',
];

export interface CompanySpec {
  idx: number;
  isin: string;
  symbol: string;
  cin: string;
  legalName: string;
  shortName: string;
  formerNames: string[];
  symbolHistory: { symbol: string; validFrom: string; validTo: string | null }[];
  sector: SectorSpec;
  industry: string;
  template: Template;
  sizeBucket: 'large' | 'mid' | 'small';
  listedOn: string;
  delistedOn: string | null;
  delistReason: 'merger' | 'delisting' | null;
  hasConsolidated: boolean;
  segmentsReported: boolean;
  beta: number;
  idioVol: number;
  baseRevenueCr: number; // FY2015 revenue (₹ crore); for banks, interest earned
  pe0: number;
  price0: number;
  // Designed patterns that exercise quality flags and edge cases
  traits: Set<'weak_cash' | 'rising_receivables' | 'rising_leverage' | 'auditor_change' | 'qualified_opinion' | 'other_income_heavy' | 'loss_maker' | 'restated' | 'xbrl_conflict' | 'pledge' | 'promoter_change' | 'injection_doc' | 'split' | 'bonus' | 'rights'>;
  description: string;
}

export interface UniverseOptions {
  seed: number;
  companies: number;
  startDate: string;
  endDate: string;
}

function symbolFor(root: string, suffix: string, taken: Set<string>): string {
  const base = (root.replace(/[^A-Za-z]/g, '').slice(0, 6) + suffix.replace(/[^A-Za-z]/g, '').slice(0, 4)).toUpperCase();
  let s = base;
  let n = 2;
  while (taken.has(s)) s = `${base}${n++}`;
  taken.add(s);
  return s;
}

function isinFor(idx: number): string {
  // XXS + 'SYN' + 5 digits + check char 'X'. Never a valid ISIN country prefix.
  return `XXSSYN${String(idx).padStart(5, '0')}X`;
}

export function buildUniverse(opts: UniverseOptions): CompanySpec[] {
  const rng = mulberry32(hashSeed('universe', opts.seed));
  const takenNames = new Set<string>();
  const takenSymbols = new Set<string>();
  const out: CompanySpec[] = [];
  // Sector weights roughly mirror a broad Indian large/mid-cap universe.
  const sectorWeights = [10, 8, 8, 8, 5, 5, 5, 4, 2, 7, 8, 12, 7, 3];
  const totalW = sectorWeights.reduce((a, b) => a + b, 0);
  const sectorFor = (r: Rng): SectorSpec => {
    let x = r() * totalW;
    for (let i = 0; i < SECTORS.length; i++) {
      x -= sectorWeights[i]!;
      if (x <= 0) return SECTORS[i]!;
    }
    return SECTORS[0]!;
  };

  for (let i = 0; i < opts.companies; i++) {
    const r = mulberry32(hashSeed('company', opts.seed, i));
    // The first company is always the prototype's Kaveri Foods so documentation and tests stay readable.
    const sector = i === 0 ? SECTORS[1]! : sectorFor(r);
    let root = i === 0 ? 'Kaveri' : pick(r, NAME_ROOTS);
    let suffix = i === 0 ? 'Foods' : pick(r, sector.suffixes);
    let guard = 0;
    while (takenNames.has(`${root} ${suffix}`) && guard++ < 50) {
      root = pick(r, NAME_ROOTS);
      suffix = pick(r, sector.suffixes);
    }
    if (takenNames.has(`${root} ${suffix}`)) root = `${root} ${i}`;
    takenNames.add(`${root} ${suffix}`);
    const shortName = `${root} ${suffix}`;
    const legalName = `${shortName} ${sector.template === 'bank' ? 'Limited' : 'Ltd'}`;
    const symbol = symbolFor(root, suffix, takenSymbols);
    const size = i < Math.max(5, Math.round(opts.companies * 0.2)) ? 'large' : i < Math.round(opts.companies * 0.6) ? 'mid' : 'small';
    const yearsSpan = (Date.parse(opts.endDate) - Date.parse(opts.startDate)) / (365.25 * 86_400_000);
    let listedOn = opts.startDate;
    let delistedOn: string | null = null;
    let delistReason: CompanySpec['delistReason'] = null;
    // About 8% list after the start (IPOs) and about 7% are delisted or merged before the end.
    if (i > 5 && r() < 0.08) listedOn = new Date(Date.parse(opts.startDate) + between(r, 1.5, yearsSpan - 2) * 365.25 * 86_400_000).toISOString().slice(0, 10);
    else if (i > 5 && r() < 0.075) {
      delistedOn = new Date(Date.parse(opts.startDate) + between(r, 2.5, yearsSpan - 0.75) * 365.25 * 86_400_000).toISOString().slice(0, 10);
      delistReason = r() < 0.5 ? 'merger' : 'delisting';
    }
    const traits = new Set<CompanySpec['traits'] extends Set<infer T> ? T : never>();
    const t = r();
    if (sector.template === 'standard') {
      if (t < 0.07) traits.add('weak_cash');
      else if (t < 0.14) traits.add('rising_receivables');
      else if (t < 0.2) traits.add('rising_leverage');
      else if (t < 0.24) traits.add('other_income_heavy');
      else if (t < 0.27) traits.add('loss_maker');
    }
    if (r() < 0.04) traits.add('auditor_change');
    if (r() < 0.025) traits.add('qualified_opinion');
    if (r() < 0.06) traits.add('pledge');
    if (r() < 0.06) traits.add('promoter_change');
    const ca = r();
    if (ca < 0.12) traits.add('split');
    else if (ca < 0.24) traits.add('bonus');
    if (i === 0) {
      traits.clear();
      traits.add('rising_receivables');
      traits.add('restated');
      traits.add('bonus');
    }
    // Deterministic placement of rare cases so every universe size exercises them.
    if (i === 1) traits.add('xbrl_conflict');
    if (i === 2) traits.add('injection_doc');
    if (i === 3) traits.add('rights');
    if (i === 4) traits.add('restated');
    if (i === 5) { traits.add('auditor_change'); traits.add('pledge'); traits.add('promoter_change'); }
    const baseRevenue = size === 'large' ? between(r, 8000, 60000) : size === 'mid' ? between(r, 1500, 9000) : between(r, 250, 1800);
    const formerNames: string[] = [];
    const symbolHistory: CompanySpec['symbolHistory'] = [{ symbol, validFrom: listedOn, validTo: null }];
    if (i % 23 === 7) {
      // A renamed company: former name and former symbol searchable (CMP-02).
      const oldRoot = pick(r, NAME_ROOTS);
      formerNames.push(`${oldRoot} ${suffix} Ltd`);
      const oldSymbol = symbolFor(oldRoot, 'OLD', takenSymbols);
      const changeDate = new Date(Date.parse(listedOn) + 0.4 * (Date.parse(opts.endDate) - Date.parse(listedOn))).toISOString().slice(0, 10);
      symbolHistory.length = 0;
      symbolHistory.push({ symbol: oldSymbol, validFrom: listedOn, validTo: changeDate }, { symbol, validFrom: changeDate, validTo: null });
    }
    const industry = pick(r, sector.industries);
    out.push({
      idx: i,
      isin: isinFor(i + 1),
      symbol,
      cin: `X${String(10000 + i).padStart(5, '0')}SYN2010PLC${String(100000 + i)}`,
      legalName,
      shortName,
      formerNames,
      symbolHistory,
      sector,
      industry,
      template: sector.template,
      sizeBucket: size,
      listedOn,
      delistedOn,
      delistReason,
      hasConsolidated: sector.template === 'standard' ? r() < 0.7 : r() < 0.4,
      segmentsReported: r() < 0.5,
      beta: sector.beta * between(r, 0.8, 1.2),
      idioVol: between(r, 0.011, 0.022),
      baseRevenueCr: baseRevenue,
      pe0: between(r, sector.peRange[0], sector.peRange[1]),
      price0: between(r, 80, 2500),
      traits,
      description: `${shortName} is a fictional ${industry.toLowerCase()} company generated for ATLAS development and testing. It does not exist and its figures are synthetic.`,
    });
  }
  return out;
}
