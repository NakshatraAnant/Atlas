import { addDays, istInstant, quarterEnd, quarterStart } from '../../lib/dates.js';
import { between, hashSeed, mulberry32, normal, round } from './rng.js';
import type { CompanySpec } from './universe.js';

// Synthetic statements that obey accounting identities so the pipeline's quality checks
// (quarters sum to the year, assets = equity + liabilities) pass on clean data.

export interface VendorPeriod {
  isin: string;
  basis: 'consolidated' | 'standalone';
  period_type: 'Q' | 'FY';
  fiscal_year: number;
  fiscal_quarter: number | null;
  period_start: string;
  period_end: string;
  filed_at: string;
  audited: boolean;
  version: number;
  values: Record<string, number>;
  missing: Record<string, 'not_reported' | 'not_available'>;
}

export interface CompanyFundamentals {
  periods: VendorPeriod[];
  /** Annual profit and dividend by filing instant (primary basis), used to anchor prices and dividends. */
  epsTimeline: { availableAt: string; profitCr: number; dps: number; sharesAtFiling: number }[];
  shares: number; // shares outstanding at the start, before any split or bonus
}

const RESTATED_FY = 2025;

const fyOf = (iso: string): number => (Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) + 1 : Number(iso.slice(0, 4)));

function filingDate(c: CompanySpec, fy: number, q: number, rngLag: number): string {
  const end = quarterEnd(fy, q);
  const lag = q === 4 ? Math.round(35 + rngLag * 23) : Math.round(18 + rngLag * 27);
  return addDays(end, lag);
}

interface QuarterPL {
  values: Record<string, number>;
}

export function generateFundamentals(c: CompanySpec, seed: number, endDate: string): CompanyFundamentals {
  const r = mulberry32(hashSeed('fund', seed, c.idx));
  const firstFy = Math.max(2015, fyOf(c.listedOn) - 2);
  const lastFy = fyOf(endDate);
  const stopFy = c.delistedOn ? fyOf(c.delistedOn) : lastFy;
  const lagProfile = r();
  const taxRate = 0.25;
  const periods: VendorPeriod[] = [];
  const epsTimeline: CompanyFundamentals['epsTimeline'] = [];

  // Shares outstanding: chosen so the starting price matches the target P/E on starting earnings.
  let margin = c.template === 'standard' ? c.sector.margin * between(r, 0.75, 1.25) : 0;
  if (c.traits.has('loss_maker')) margin = 0.02;
  const baseNetMargin = c.template === 'standard' ? Math.max(0.01, margin * 0.55) : 0.16;
  const startProfitCr = c.baseRevenueCr * baseNetMargin;
  const startMcapCr = Math.max(200, startProfitCr * c.pe0);
  const shares = Math.round((startMcapCr * 1e7) / c.price0);

  let revenue = c.baseRevenueCr;
  let equity = c.template === 'standard' ? c.baseRevenueCr * between(r, 0.45, 0.9) : c.baseRevenueCr * 0.9;
  let deRatio = c.template === 'standard' ? between(r, 0.05, 0.7) : 0;
  let recDays = between(r, 25, 70);
  const payDays = between(r, 30, 75);
  const invDays = c.sector.inventoryDays === null ? null : c.sector.inventoryDays * between(r, 0.7, 1.3);
  const assetTurnover = between(r, 0.7, 1.6);
  const oiRatio = c.traits.has('other_income_heavy') ? between(r, 0.06, 0.09) : between(r, 0.004, 0.02);
  const depRatio = between(r, 0.02, 0.05);
  const alpha = between(r, -0.04, 0.05);
  const payout = between(r, 0.1, 0.45);
  // Bank / NBFC / insurer state
  let advances = c.baseRevenueCr / 0.085;
  let gnpa = between(r, 1.2, 5.5);
  const cdRatio = between(r, 0.72, 0.9);
  const costToIncome = between(r, 0.38, 0.55);
  const nimTarget = c.template === 'nbfc' ? between(r, 0.05, 0.08) : between(r, 0.028, 0.042);
  const solvency = between(r, 1.7, 2.6);
  let car = between(r, 14, 19);
  let cumShares = shares;

  for (let fy = firstFy; fy <= Math.min(stopFy, lastFy); fy++) {
    const growth = c.sector.growth + alpha + normal(r) * 0.06 + (fy === 2021 ? -0.12 : 0) + (fy === 2022 ? 0.08 : 0);
    revenue = revenue * (1 + growth);
    if (c.template === 'standard') {
      margin = Math.min(0.5, Math.max(c.traits.has('loss_maker') ? -0.05 : 0.03, margin + normal(r) * 0.012));
      if (c.traits.has('rising_receivables') && fy >= lastFy - 3) recDays += between(r, 4, 8);
      else recDays = Math.max(15, recDays + normal(r) * 3);
      if (c.traits.has('rising_leverage') && fy >= lastFy - 4) deRatio += between(r, 0.18, 0.35);
      else deRatio = Math.max(0, deRatio + normal(r) * 0.05);
    } else {
      advances = advances * (1 + growth);
      gnpa = Math.max(0.6, gnpa + normal(r) * 0.4);
      car = Math.max(11.5, Math.min(21, car + normal(r) * 0.6));
    }
    const quarters: QuarterPL[] = [];
    const seasonal = c.sector.seasonality.map((w) => w * (1 + normal(r) * 0.02));
    const wSum = seasonal.reduce((a, b) => a + b, 0);
    for (let q = 1; q <= 4; q++) {
      const qRev = round((revenue * seasonal[q - 1]!) / wSum, 2);
      const v: Record<string, number> = {};
      if (c.template === 'standard') {
        const qMargin = margin + normal(r) * 0.01;
        const opProfit = round(qRev * qMargin, 2);
        const otherIncome = round(qRev * oiRatio * (1 + normal(r) * 0.1), 2);
        const dep = round(qRev * depRatio, 2);
        const fin = round(((equity * deRatio) * 0.09) / 4, 2);
        const exceptional = c.idx === 0 && fy === lastFy - 1 && q === 4 ? round(qRev * 0.03, 2) : 0;
        const pbt = round(opProfit + otherIncome - dep - fin + exceptional, 2);
        const tax = round(Math.max(0, pbt) * taxRate, 2);
        v.revenue_from_operations = qRev;
        v.other_income = otherIncome;
        v.operating_expenses = round(qRev - opProfit, 2);
        v.operating_profit = opProfit;
        v.depreciation = dep;
        v.finance_costs = fin;
        v.exceptional_items = exceptional;
        v.profit_before_tax = pbt;
        v.tax_expense = tax;
        v.net_profit = round(pbt - tax, 2);
      } else if (c.template === 'bank' || c.template === 'nbfc') {
        const avgAdv = advances * (0.94 + 0.02 * q);
        const earned = round((avgAdv * between(r, 0.085, 0.1)) / 4 / (c.template === 'nbfc' ? 0.85 : 1), 2);
        const nii = round((avgAdv * nimTarget * (1 + normal(r) * 0.03)) / 4, 2);
        const expended = round(earned - nii, 2);
        const oi = round(nii * between(r, 0.18, 0.3), 2);
        const opex = round((nii + oi) * costToIncome * (1 + normal(r) * 0.03), 2);
        const provisions = round((avgAdv * (gnpa / 100) * between(r, 0.12, 0.22)) / 4, 2);
        const pbt = round(nii + oi - opex - provisions, 2);
        const tax = round(Math.max(0, pbt) * taxRate, 2);
        v.revenue_from_operations = earned;
        v.interest_earned = earned;
        v.interest_expended = expended;
        v.net_interest_income = nii;
        v.other_income = oi;
        v.operating_expenses = opex;
        v.operating_profit = round(nii + oi - opex, 2);
        v.provisions = provisions;
        v.profit_before_tax = pbt;
        v.tax_expense = tax;
        v.net_profit = round(pbt - tax, 2);
      } else {
        const npe = round(qRev * 0.86, 2);
        const inv = round(qRev - npe, 2);
        const claims = round(npe * between(r, 0.62, 0.78), 2);
        const opex = round(npe * between(r, 0.12, 0.18), 2);
        const pbt = round(npe + inv - claims - opex, 2);
        const tax = round(Math.max(0, pbt) * taxRate, 2);
        v.revenue_from_operations = qRev;
        v.net_premium_earned = npe;
        v.investment_income = inv;
        v.claims_incurred = claims;
        v.operating_expenses = opex;
        v.operating_profit = round(npe + inv - claims - opex, 2);
        v.other_income = 0;
        v.profit_before_tax = pbt;
        v.tax_expense = tax;
        v.net_profit = round(pbt - tax, 2);
      }
      v.eps_diluted = round((v.net_profit! * 1e7) / cumShares, 2);
      quarters.push({ values: v });
    }

    // Annual figures: flow items are the exact sum of the four quarters.
    const annual: Record<string, number> = {};
    for (const key of Object.keys(quarters[0]!.values)) {
      if (key === 'eps_diluted') continue;
      annual[key] = round(quarters.reduce((s, q) => s + (q.values[key] ?? 0), 0), 2);
    }
    annual.eps_diluted = round((annual.net_profit! * 1e7) / cumShares, 2);
    const np = annual.net_profit!;
    const dividends = round(Math.max(0, np) * payout, 2);
    const dps = round((dividends * 1e7) / cumShares, 2);
    equity = round(equity + np - dividends, 2);
    const missing: Record<string, 'not_reported' | 'not_available'> = {};

    if (c.template === 'standard') {
      const borrowings = round(equity * deRatio, 2);
      const receivables = round((annual.revenue_from_operations! * recDays) / 365, 2);
      const inventories = invDays === null ? null : round((annual.operating_expenses! * invDays) / 365, 2);
      const payables = round((annual.operating_expenses! * payDays) / 365, 2);
      const otherLiab = round(annual.revenue_from_operations! * 0.08, 2);
      const totalLiabilities = round(borrowings + payables + otherLiab, 2);
      const totalAssets = round(equity + totalLiabilities, 2);
      const fixedAssets = round(Math.min(totalAssets * 0.55, annual.revenue_from_operations! / assetTurnover * 0.6), 2);
      const cash = round(Math.max(totalAssets * 0.03, totalAssets * between(r, 0.04, 0.12)), 2);
      const otherAssets = round(totalAssets - fixedAssets - receivables - (inventories ?? 0) - cash, 2);
      const cfoBase = np + annual.depreciation! - receivables * 0.08;
      const cfo = round(c.traits.has('weak_cash') && fy >= lastFy - 4 ? annual.operating_profit! * between(r, 0.15, 0.4) : Math.max(cfoBase, annual.operating_profit! * between(r, 0.6, 0.95)), 2);
      const capex = round(annual.depreciation! * between(r, 1.0, 1.8), 2);
      Object.assign(annual, {
        total_assets: totalAssets,
        total_equity: equity,
        total_liabilities: totalLiabilities,
        borrowings,
        cash_and_equivalents: cash,
        trade_receivables: receivables,
        trade_payables: payables,
        net_fixed_assets: fixedAssets,
        other_assets: otherAssets,
        cash_from_operations: cfo,
        capex,
        cash_from_investing: round(-capex + annual.other_income! * 0.5, 2),
        cash_from_financing: round(-dividends + borrowings * normal(r) * 0.05, 2),
        dividends_paid: dividends,
        dividend_per_share: dps,
        shares_outstanding: cumShares,
      });
      if (inventories === null) missing.inventories = 'not_reported';
      else annual.inventories = inventories;
    } else if (c.template === 'bank' || c.template === 'nbfc') {
      const deposits = c.template === 'bank' ? round(advances / cdRatio, 2) : null;
      const borrowings = c.template === 'nbfc' ? round(advances * 0.82, 2) : round(advances * 0.08, 2);
      const totalAssets = round((deposits ?? 0) + borrowings + equity + advances * 0.05, 2);
      Object.assign(annual, {
        advances: round(advances, 2),
        borrowings,
        total_assets: totalAssets,
        total_equity: equity,
        total_liabilities: round(totalAssets - equity, 2),
        gnpa_pct: round(gnpa, 2),
        nnpa_pct: round(gnpa * between(r, 0.22, 0.38), 2),
        capital_adequacy_ratio: round(car, 2),
        dividends_paid: dividends,
        dividend_per_share: dps,
        shares_outstanding: cumShares,
      });
      if (deposits !== null) annual.deposits = deposits;
      else missing.deposits = 'not_reported';
    } else {
      const totalAssets = round(annual.revenue_from_operations! * between(r, 3.5, 5), 2);
      Object.assign(annual, {
        total_assets: totalAssets,
        total_equity: equity,
        total_liabilities: round(totalAssets - equity, 2),
        solvency_ratio: round(solvency + normal(r) * 0.05, 2),
        dividends_paid: dividends,
        dividend_per_share: dps,
        shares_outstanding: cumShares,
      });
    }

    const bases: ('consolidated' | 'standalone')[] = c.hasConsolidated ? ['consolidated', 'standalone'] : ['standalone'];
    for (const basis of bases) {
      const scale = basis === 'standalone' && c.hasConsolidated ? 0.88 : 1;
      const scaleValues = (v: Record<string, number>): Record<string, number> => {
        if (scale === 1) return { ...v };
        const o: Record<string, number> = {};
        for (const [k, val] of Object.entries(v)) {
          o[k] = ['gnpa_pct', 'nnpa_pct', 'capital_adequacy_ratio', 'solvency_ratio', 'shares_outstanding', 'dividend_per_share'].includes(k) ? val : round(val * scale, 2);
        }
        if (o.net_profit !== undefined) o.eps_diluted = round((o.net_profit * 1e7) / cumShares, 2);
        return o;
      };
      // Quarter values are scaled the same way and then the year is rebuilt as their sum.
      const qVals = quarters.map((q) => scaleValues(q.values));
      for (let q = 1; q <= 4; q++) {
        const filed = filingDate(c, fy, q, lagProfile);
        if (filed > endDate) continue;
        if (c.delistedOn && filed > c.delistedOn) continue;
        periods.push({
          isin: c.isin, basis, period_type: 'Q', fiscal_year: fy, fiscal_quarter: q,
          period_start: quarterStart(fy, q), period_end: quarterEnd(fy, q),
          filed_at: istInstant(filed, q === 4 ? '17:45' : '16:30'), audited: q === 4, version: 1,
          values: qVals[q - 1]!, missing: {},
        });
      }
      const fyFiled = filingDate(c, fy, 4, lagProfile);
      if (fyFiled <= endDate && !(c.delistedOn && fyFiled > c.delistedOn)) {
        const av = scaleValues(annual);
        for (const key of Object.keys(qVals[0]!)) {
          if (key === 'eps_diluted') continue;
          av[key] = round(qVals.reduce((s, q) => s + (q[key] ?? 0), 0), 2);
        }
        av.eps_diluted = round((av.net_profit! * 1e7) / cumShares, 2);
        if (av.total_assets !== undefined && av.total_equity !== undefined) av.total_liabilities = round(av.total_assets - av.total_equity, 2);
        if (av.other_assets !== undefined) {
          av.other_assets = round(av.total_assets! - av.net_fixed_assets! - av.trade_receivables! - (av.inventories ?? 0) - av.cash_and_equivalents!, 2);
        }
        periods.push({
          isin: c.isin, basis, period_type: 'FY', fiscal_year: fy, fiscal_quarter: null,
          period_start: `${fy - 1}-04-01`, period_end: `${fy}-03-31`,
          filed_at: istInstant(fyFiled, '17:45'), audited: true, version: 1,
          values: av, missing: { ...missing },
        });
        if (basis === bases[0]) {
          epsTimeline.push({ availableAt: istInstant(fyFiled, '17:45'), profitCr: av.net_profit!, dps: av.dividend_per_share ?? 0, sharesAtFiling: cumShares });
        }
      }
    }
    // Bonus or split changes the share count from the next year (handled with prices).
    if (c.traits.has('bonus') && fy === lastFy - 2) cumShares *= 2;
    if (c.traits.has('split') && fy === lastFy - 4) cumShares *= 5;
  }

  // Restatement: FY25 is reissued (version 2) together with the FY26 annual filing, on every basis.
  if (c.traits.has('restated')) {
    for (const target of periods.filter((p) => p.period_type === 'FY' && p.fiscal_year === RESTATED_FY && p.version === 1)) {
      const latest = periods.find((p) => p.period_type === 'FY' && p.fiscal_year === RESTATED_FY + 1 && p.basis === target.basis);
      if (!latest) continue;
      const v2 = structuredClone(target);
      v2.version = 2;
      v2.filed_at = latest.filed_at;
      v2.values.net_profit = round(v2.values.net_profit! * 0.97, 2);
      v2.values.tax_expense = round(v2.values.profit_before_tax! - v2.values.net_profit, 2);
      v2.values.eps_diluted = round(v2.values.eps_diluted! * 0.97, 2);
      periods.push(v2);
    }
  }
  return { periods, epsTimeline, shares };
}
