// Three-statement model for the "Three statements in motion" scene (EQUITY DETECTIVE). A deliberately
// simple, fully deterministic model of a FICTIONAL company: one year, ₹ crore, Ind AS-style
// presentation simplified for teaching. Not a model of any real company.
// Invariant (tested): closing assets = closing liabilities + equity, whatever the inputs.

export interface StatementInputs {
  /** Revenue for the year, ₹ crore (> 0). */
  revenue: number;
  /** EBITDA as a percentage of revenue (−50 to 60). */
  ebitdaMarginPct: number;
  /** Capital expenditure as a percentage of revenue (0 to 40). */
  capexPct: number;
  /** Increase in working capital as a percentage of revenue (−20 to 30; negative releases cash). */
  workingCapitalIncreasePct: number;
  /** Share of positive profit paid as dividends (0 to 100). */
  payoutPct: number;
  /** New borrowing during the year, ₹ crore (−debt to +500; negative repays). */
  newBorrowing: number;
}

export const OPENING = { cash: 120, fixedAssets: 600, workingCapital: 180, debt: 300, equity: 600 } as const;
export const MODEL_RULES = { depreciationPctOfOpeningFixedAssets: 10, interestPctOfOpeningDebt: 9, taxRatePct: 25 } as const;

export const DEFAULT_STATEMENT_INPUTS: StatementInputs = { revenue: 1000, ebitdaMarginPct: 18, capexPct: 8, workingCapitalIncreasePct: 3, payoutPct: 30, newBorrowing: 0 };

export interface ThreeStatements {
  income: { revenue: number; operatingCosts: number; ebitda: number; depreciation: number; ebit: number; interest: number; pbt: number; tax: number; pat: number };
  cashFlow: { pat: number; depreciation: number; workingCapitalIncrease: number; operating: number; capex: number; investing: number; dividends: number; borrowing: number; financing: number; netChange: number };
  balanceSheet: {
    opening: { cash: number; fixedAssets: number; workingCapital: number; assets: number; debt: number; equity: number; liabilitiesAndEquity: number };
    closing: { cash: number; fixedAssets: number; workingCapital: number; assets: number; debt: number; equity: number; liabilitiesAndEquity: number };
  };
  links: { retainedProfit: number; cashConversionPct: number | null; freeCashFlow: number };
  warnings: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function validateStatementInputs(i: StatementInputs): string[] {
  const e: string[] = [];
  if (!(i.revenue > 0 && i.revenue <= 100000)) e.push('Revenue must be between 0 and 1,00,000 crore.');
  if (!(i.ebitdaMarginPct >= -50 && i.ebitdaMarginPct <= 60)) e.push('EBITDA margin must be between −50% and 60%.');
  if (!(i.capexPct >= 0 && i.capexPct <= 40)) e.push('Capex must be between 0% and 40% of revenue.');
  if (!(i.workingCapitalIncreasePct >= -20 && i.workingCapitalIncreasePct <= 30)) e.push('Working-capital change must be between −20% and 30% of revenue.');
  if (!(i.payoutPct >= 0 && i.payoutPct <= 100)) e.push('Payout must be between 0% and 100%.');
  if (!(i.newBorrowing >= -OPENING.debt && i.newBorrowing <= 500)) e.push(`New borrowing must be between −${OPENING.debt} (repay all debt) and 500 crore.`);
  return e;
}

export function threeStatements(i: StatementInputs): ThreeStatements {
  const errors = validateStatementInputs(i);
  if (errors.length) throw new Error(errors.join(' '));
  const ebitda = (i.revenue * i.ebitdaMarginPct) / 100;
  const depreciation = (OPENING.fixedAssets * MODEL_RULES.depreciationPctOfOpeningFixedAssets) / 100;
  const ebit = ebitda - depreciation;
  const interest = (OPENING.debt * MODEL_RULES.interestPctOfOpeningDebt) / 100;
  const pbt = ebit - interest;
  // Tax only on a profit; a loss gives no tax credit in this simple model.
  const tax = pbt > 0 ? (pbt * MODEL_RULES.taxRatePct) / 100 : 0;
  const pat = pbt - tax;
  const wcIncrease = (i.revenue * i.workingCapitalIncreasePct) / 100;
  const operating = pat + depreciation - wcIncrease;
  const capex = (i.revenue * i.capexPct) / 100;
  const dividends = pat > 0 ? (pat * i.payoutPct) / 100 : 0;
  const financing = i.newBorrowing - dividends;
  const netChange = operating - capex + financing;
  const open = { ...OPENING, assets: OPENING.cash + OPENING.fixedAssets + OPENING.workingCapital, liabilitiesAndEquity: OPENING.debt + OPENING.equity };
  const close = {
    cash: OPENING.cash + netChange,
    fixedAssets: OPENING.fixedAssets + capex - depreciation,
    workingCapital: OPENING.workingCapital + wcIncrease,
    debt: OPENING.debt + i.newBorrowing,
    equity: OPENING.equity + pat - dividends,
    assets: 0,
    liabilitiesAndEquity: 0,
  };
  close.assets = close.cash + close.fixedAssets + close.workingCapital;
  close.liabilitiesAndEquity = close.debt + close.equity;
  const warnings: string[] = [];
  if (close.cash < 0) warnings.push('Closing cash is negative: in reality the company would need more financing or would have to cut spending.');
  if (close.equity < 0) warnings.push('Equity is negative: losses and payouts exceed what shareholders put in and retained.');
  if (pat < 0) warnings.push('The company made a loss, so no dividend is paid and no tax is charged in this model.');
  const round = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)])) as T;
  return {
    income: round({ revenue: i.revenue, operatingCosts: i.revenue - ebitda, ebitda, depreciation, ebit, interest, pbt, tax, pat }),
    cashFlow: round({ pat, depreciation, workingCapitalIncrease: wcIncrease, operating, capex, investing: -capex, dividends, borrowing: i.newBorrowing, financing, netChange }),
    balanceSheet: { opening: round(open), closing: round(close) },
    links: { retainedProfit: r2(pat - dividends), cashConversionPct: pat > 0 ? r2((operating / pat) * 100) : null, freeCashFlow: r2(operating - capex) },
    warnings,
  };
}
