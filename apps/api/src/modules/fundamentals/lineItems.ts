import type { Db } from '../../db/db.js';
import { bulkInsert } from '../../lib/bulk.js';

// Statement line items (fund.line_item_definitions). Units: INR_cr = ₹ crore, INR = rupees, shares, percent.
export interface LineItem {
  code: string;
  name: string;
  statement: 'pl' | 'bs' | 'cf' | 'bank' | 'per_share' | 'other';
  unit: 'INR_cr' | 'INR' | 'shares' | 'percent';
  flow: boolean;
  templates: string[];
}

const ALL = ['standard', 'bank', 'nbfc', 'insurance'];
const STD = ['standard'];
const FIN = ['bank', 'nbfc'];

export const LINE_ITEMS: LineItem[] = [
  { code: 'revenue_from_operations', name: 'Revenue from operations', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'interest_earned', name: 'Interest earned', statement: 'bank', unit: 'INR_cr', flow: true, templates: FIN },
  { code: 'interest_expended', name: 'Interest expended', statement: 'bank', unit: 'INR_cr', flow: true, templates: FIN },
  { code: 'net_interest_income', name: 'Net interest income', statement: 'bank', unit: 'INR_cr', flow: true, templates: FIN },
  { code: 'net_premium_earned', name: 'Net premium earned', statement: 'pl', unit: 'INR_cr', flow: true, templates: ['insurance'] },
  { code: 'investment_income', name: 'Investment income', statement: 'pl', unit: 'INR_cr', flow: true, templates: ['insurance'] },
  { code: 'claims_incurred', name: 'Claims incurred', statement: 'pl', unit: 'INR_cr', flow: true, templates: ['insurance'] },
  { code: 'other_income', name: 'Other income', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'operating_expenses', name: 'Operating expenses', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'operating_profit', name: 'Operating profit', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'provisions', name: 'Provisions and contingencies', statement: 'bank', unit: 'INR_cr', flow: true, templates: FIN },
  { code: 'depreciation', name: 'Depreciation and amortisation', statement: 'pl', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'finance_costs', name: 'Finance costs', statement: 'pl', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'exceptional_items', name: 'Exceptional items', statement: 'pl', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'profit_before_tax', name: 'Profit before tax', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'tax_expense', name: 'Tax expense', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'net_profit', name: 'Net profit', statement: 'pl', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'eps_diluted', name: 'Diluted EPS', statement: 'per_share', unit: 'INR', flow: true, templates: ALL },
  { code: 'total_assets', name: 'Total assets', statement: 'bs', unit: 'INR_cr', flow: false, templates: ALL },
  { code: 'total_equity', name: 'Total equity', statement: 'bs', unit: 'INR_cr', flow: false, templates: ALL },
  { code: 'total_liabilities', name: 'Total liabilities', statement: 'bs', unit: 'INR_cr', flow: false, templates: ALL },
  { code: 'borrowings', name: 'Borrowings', statement: 'bs', unit: 'INR_cr', flow: false, templates: ALL },
  { code: 'advances', name: 'Advances (loans)', statement: 'bank', unit: 'INR_cr', flow: false, templates: FIN },
  { code: 'deposits', name: 'Deposits', statement: 'bank', unit: 'INR_cr', flow: false, templates: ['bank'] },
  { code: 'cash_and_equivalents', name: 'Cash and cash equivalents', statement: 'bs', unit: 'INR_cr', flow: false, templates: STD },
  { code: 'trade_receivables', name: 'Trade receivables', statement: 'bs', unit: 'INR_cr', flow: false, templates: STD },
  { code: 'inventories', name: 'Inventories', statement: 'bs', unit: 'INR_cr', flow: false, templates: STD },
  { code: 'trade_payables', name: 'Trade payables', statement: 'bs', unit: 'INR_cr', flow: false, templates: STD },
  { code: 'net_fixed_assets', name: 'Net fixed assets', statement: 'bs', unit: 'INR_cr', flow: false, templates: STD },
  { code: 'other_assets', name: 'Other assets', statement: 'bs', unit: 'INR_cr', flow: false, templates: STD },
  { code: 'gnpa_pct', name: 'Gross NPA', statement: 'bank', unit: 'percent', flow: false, templates: FIN },
  { code: 'nnpa_pct', name: 'Net NPA', statement: 'bank', unit: 'percent', flow: false, templates: FIN },
  { code: 'capital_adequacy_ratio', name: 'Capital adequacy ratio', statement: 'bank', unit: 'percent', flow: false, templates: FIN },
  { code: 'solvency_ratio', name: 'Solvency ratio', statement: 'other', unit: 'percent', flow: false, templates: ['insurance'] },
  { code: 'cash_from_operations', name: 'Cash flow from operating activities', statement: 'cf', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'capex', name: 'Capital expenditure', statement: 'cf', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'cash_from_investing', name: 'Cash flow from investing activities', statement: 'cf', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'cash_from_financing', name: 'Cash flow from financing activities', statement: 'cf', unit: 'INR_cr', flow: true, templates: STD },
  { code: 'dividends_paid', name: 'Dividends paid', statement: 'cf', unit: 'INR_cr', flow: true, templates: ALL },
  { code: 'dividend_per_share', name: 'Dividend per share', statement: 'per_share', unit: 'INR', flow: true, templates: ALL },
  { code: 'shares_outstanding', name: 'Shares outstanding (period end)', statement: 'other', unit: 'shares', flow: false, templates: ALL },
];

export const FLOW_ITEMS = new Set(LINE_ITEMS.filter((l) => l.flow && l.unit === 'INR_cr').map((l) => l.code));
export const LINE_ITEM_BY_CODE = new Map(LINE_ITEMS.map((l) => [l.code, l]));

export async function seedLineItems(db: Db): Promise<void> {
  await bulkInsert(
    db,
    'fund.line_item_definitions',
    LINE_ITEMS.map((l, i) => ({ code: l.code, name: l.name, statement: l.statement, unit: l.unit, flow: l.flow, templates: `{${l.templates.join(',')}}`, display_order: i })),
    { onConflict: 'ON CONFLICT (code) DO NOTHING' },
  );
}
