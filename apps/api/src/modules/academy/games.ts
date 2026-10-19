import { dcf } from '@atlas/shared';

// ATLAS Academy games. Each targets one learning objective, uses deterministic rules and is graded
// on the server. Scoring is accuracy only: no streaks, leaderboards, chance mechanics or rewards
// for speculative outcomes. Content status: in_review (AI-assisted draft).

export const GAMES_VERSION = 1;

interface ClassifyItem { prompt: string; data?: [string, string][]; correct: number; why: string }
interface ClassifyGame { id: string; version: number; title: string; course_id: string; objective_id: string; mechanic: 'classify'; intro: string; options: string[]; items: ClassifyItem[] }
interface TuneParam { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string }
interface TuneRound { prompt: string; fixed: Record<string, number>; params: TuneParam[] }
interface TuneGame { id: string; version: number; title: string; course_id: string; objective_id: string; mechanic: 'tune'; intro: string; rounds: TuneRound[] }
export type Game = ClassifyGame | TuneGame;

export interface TuneOutcome { ok: boolean; metrics: Record<string, number | null>; message: string }

const STATEMENTS = ['Profit and loss statement', 'Balance sheet', 'Cash flow: operating', 'Cash flow: investing', 'Cash flow: financing'];
const BIASES = ['Look-ahead bias', 'Survivorship bias', 'Overfitting or data snooping', 'Benchmark mismatch', 'No obvious bias'];
const LAYERS = ['Observed fact (with a source)', 'Calculated result', 'Interpretation', 'Unsupported claim'];

export const GAMES: Game[] = [
  {
    id: 'statement-surgeon', version: GAMES_VERSION, title: 'Statement Surgeon', course_id: 'equity-detective', objective_id: 'ed-o1', mechanic: 'classify', options: STATEMENTS,
    intro: 'Place each line item where it belongs. Cash-flow items go to the activity that produced them (Ind AS 7 classification for a typical non-financial company).',
    items: [
      { prompt: 'Revenue from operations', correct: 0, why: 'Revenue for the period is reported in the profit and loss statement.' },
      { prompt: 'Trade receivables at 31 March', correct: 1, why: 'Amounts owed by customers at a date are a balance-sheet asset.' },
      { prompt: 'Purchase of property, plant and equipment', correct: 3, why: 'Spending on long-term assets is an investing cash flow.' },
      { prompt: 'Dividends paid to shareholders', correct: 4, why: 'Payments to shareholders are financing cash flows.' },
      { prompt: 'Depreciation and amortisation expense', correct: 0, why: 'Depreciation is a non-cash expense in the P&L (added back in operating cash flow).' },
      { prompt: 'Inventories at 31 March', correct: 1, why: 'Stock held at a date is a balance-sheet asset.' },
      { prompt: 'Proceeds from long-term borrowings', correct: 4, why: 'Raising debt is a financing cash flow.' },
      { prompt: 'Cash received from customers', correct: 2, why: 'Collections from the core business are operating cash flows.' },
      { prompt: 'Finance costs for the year', correct: 0, why: 'Interest expense for the period is reported in the P&L.' },
      { prompt: 'Equity share capital', correct: 1, why: 'Share capital is part of equity on the balance sheet.' },
    ],
  },
  {
    id: 'bias-trap', version: GAMES_VERSION, title: 'Bias Trap', course_id: 'signal-engineer', objective_id: 'se-o2', mechanic: 'classify', options: BIASES,
    intro: 'Each card describes a backtest. Name the main problem, if any.',
    items: [
      { prompt: 'Buys on 1 April using full-year results that companies filed in May.', correct: 0, why: 'The results did not exist on the trade date.' },
      { prompt: 'Tests a rule on today\'s 50 largest companies, going back fifteen years.', correct: 1, why: 'Today\'s large companies are the survivors; failures are missing.' },
      { prompt: 'Tried 300 moving-average pairs and reports only the best one.', correct: 2, why: 'The winner of a large search is partly luck.' },
      { prompt: 'Compares a small-company strategy with a large-company index.', correct: 3, why: 'The difference may reflect size exposure, not skill.' },
      { prompt: 'Signals on the close, fills at the next open, costs included, point-in-time universe, plan written before the run.', correct: 4, why: 'These are the main controls; limitations may remain but no obvious bias is described.' },
      { prompt: 'Uses restated revenue figures for every past year.', correct: 0, why: 'Investors at the time saw the originally reported figures.' },
      { prompt: 'Drops companies that delisted from the dataset "to clean it".', correct: 1, why: 'Removing failures inflates historical returns.' },
      { prompt: 'Chose the start year after seeing which one made the rule look best.', correct: 2, why: 'Cherry-picking the period is a form of data snooping.' },
    ],
  },
  {
    id: 'evidence-challenge', version: GAMES_VERSION, title: 'Evidence Challenge', course_id: 'market-architect', objective_id: 'ma-o4', mechanic: 'classify', options: LAYERS,
    intro: 'Classify each sentence from a research note. Defensible research labels which layer each claim belongs to.',
    items: [
      { prompt: '"FY26 revenue was ₹1,240 crore (annual report filed 22 May 2026, linked)."', correct: 0, why: 'A reported figure with its source.' },
      { prompt: '"Cash conversion was 72% (operating cash flow ÷ net profit, ATLAS methodology v1)."', correct: 1, why: 'A result computed from stated inputs and a formula.' },
      { prompt: '"The inventory build may reflect preparation for a product launch."', correct: 2, why: 'A possible explanation that needs verification.' },
      { prompt: '"Management is the best in the industry."', correct: 3, why: 'No evidence or measure is given.' },
      { prompt: '"Promoter pledge rose from 10% to 45% of holdings (shareholding filing, linked)."', correct: 0, why: 'Sourced disclosure data.' },
      { prompt: '"The share will double within a year."', correct: 3, why: 'An unsupported forecast; research should not assert future prices.' },
      { prompt: '"EV/EBITDA is 8.0× (EV ₹1,800 crore ÷ EBITDA ₹225 crore)."', correct: 1, why: 'Calculated from stated inputs.' },
      { prompt: '"Margins fell possibly because raw-material costs rose; checking the cost notes."', correct: 2, why: 'A labelled hypothesis with a planned check.' },
    ],
  },
  {
    id: 'market-replay', version: GAMES_VERSION, title: 'Market Replay', course_id: 'market-decoder', objective_id: 'md-o9', mechanic: 'classify', options: ['Supported by the data', 'Not supported by the data'],
    intro: 'Replay end-of-day sessions from a synthetic market. For each headline, decide whether the session data supports it. Synthetic data: illustrative only.',
    items: [
      { prompt: '"Broad rally: most shares rose."', data: [['Index change', '+1.2%'], ['Advances', '1,450'], ['Declines', '520']], correct: 0, why: 'Advances far exceed declines.' },
      { prompt: '"Broad rally: most shares rose."', data: [['Index change', '+0.9%'], ['Advances', '640'], ['Declines', '1,330']], correct: 1, why: 'The index rose but most shares fell: a narrow move.' },
      { prompt: '"Banks led the market higher."', data: [['Index change', '+0.6%'], ['Best sector', 'IT +2.1%'], ['Banks', '−0.4%']], correct: 1, why: 'Banks fell; IT led.' },
      { prompt: '"A quiet, mixed session."', data: [['Index change', '+0.05%'], ['Advances', '980'], ['Declines', '1,010']], correct: 0, why: 'A tiny index move with balanced breadth.' },
      { prompt: '"The market fell because of interest-rate fears."', data: [['Index change', '−1.1%'], ['Advances', '500'], ['Declines', '1,480'], ['Macro events', 'None scheduled']], correct: 1, why: 'The data shows a broad fall but says nothing about its cause.' },
      { prompt: '"Volatility was unusually high."', data: [['20-day realised volatility', '28%'], ['1-year percentile', '94th']], correct: 0, why: 'The 94th percentile of the past year is unusually high.' },
      { prompt: '"New highs outnumbered new lows."', data: [['52-week highs', '35'], ['52-week lows', '112']], correct: 1, why: 'New lows outnumbered highs.' },
      { prompt: '"The index fell while breadth was weak."', data: [['Index change', '−0.7%'], ['Advances', '610'], ['Declines', '1,360']], correct: 0, why: 'Both the index and breadth were negative.' },
    ],
  },
  {
    id: 'valuation-lab', version: GAMES_VERSION, title: 'Valuation Lab', course_id: 'market-architect', objective_id: 'ma-o1', mechanic: 'tune',
    intro: 'Reverse DCF: find the terminal growth rate that makes the DCF value equal today\'s enterprise value (within 2%). It shows what the price already assumes, not what the company is worth.',
    rounds: [
      { prompt: 'FCF ₹100, 110, 121 crore; discount rate 12%; enterprise value ₹1,383 crore.', fixed: { fcf1: 100, fcf2: 110, fcf3: 121, discount: 12, ev: 1383 }, params: [{ key: 'growth', label: 'Terminal growth', min: 0, max: 10, step: 0.1, default: 2, unit: '%' }] },
      { prompt: 'FCF ₹80, 84, 88 crore; discount rate 11%; enterprise value ₹1,500 crore.', fixed: { fcf1: 80, fcf2: 84, fcf3: 88, discount: 11, ev: 1500 }, params: [{ key: 'growth', label: 'Terminal growth', min: 0, max: 10, step: 0.1, default: 2, unit: '%' }] },
      { prompt: 'FCF ₹50, 60, 70 crore; discount rate 13%; enterprise value ₹700 crore.', fixed: { fcf1: 50, fcf2: 60, fcf3: 70, discount: 13, ev: 700 }, params: [{ key: 'growth', label: 'Terminal growth', min: 0, max: 10, step: 0.1, default: 2, unit: '%' }] },
    ],
  },
  {
    id: 'portfolio-under-pressure', version: GAMES_VERSION, title: 'Portfolio Under Pressure', course_id: 'market-architect', objective_id: 'ma-o2', mechanic: 'tune',
    intro: 'Set weights for equities, bonds and gold so the portfolio meets the expected-return target AND survives the stress scenario within the loss limit. Assumptions are illustrative, not forecasts.',
    rounds: [
      { prompt: 'Expected returns: equities 11%, bonds 7%, gold 6%. Stress: equities −40%, bonds +3%, gold +10%. Need return ≥ 8% and stress loss no worse than −20%.', fixed: { r_eq: 11, r_bd: 7, r_au: 6, s_eq: -40, s_bd: 3, s_au: 10, min_return: 8, max_loss: -20 }, params: [{ key: 'w_eq', label: 'Equities', min: 0, max: 100, step: 5, default: 60, unit: '%' }, { key: 'w_bd', label: 'Bonds', min: 0, max: 100, step: 5, default: 30, unit: '%' }, { key: 'w_au', label: 'Gold', min: 0, max: 100, step: 5, default: 10, unit: '%' }] },
      { prompt: 'Same assets. Stress: equities −50%, bonds −5% (rates spike), gold +15%. Need return ≥ 8% and stress loss no worse than −20%.', fixed: { r_eq: 11, r_bd: 7, r_au: 6, s_eq: -50, s_bd: -5, s_au: 15, min_return: 8, max_loss: -20 }, params: [{ key: 'w_eq', label: 'Equities', min: 0, max: 100, step: 5, default: 60, unit: '%' }, { key: 'w_bd', label: 'Bonds', min: 0, max: 100, step: 5, default: 30, unit: '%' }, { key: 'w_au', label: 'Gold', min: 0, max: 100, step: 5, default: 10, unit: '%' }] },
    ],
  },
  {
    id: 'build-the-business', version: GAMES_VERSION, title: 'Build the Business', course_id: 'equity-detective', objective_id: 'ed-o3', mechanic: 'tune',
    intro: 'Run a small manufacturer. Demand falls as price rises (units = 10,000 − 50 × price). Choose a price and a cost-saving investment to reach the targets.',
    rounds: [
      { prompt: 'Variable cost ₹70 per unit; fixed costs ₹2,00,000; capital employed ₹4,00,000 plus any investment. Each ₹1,000 invested cuts the variable cost by ₹0.20 (maximum ₹1,00,000). Targets: EBIT margin ≥ 10% and ROCE ≥ 15%.', fixed: { a: 10000, b: 50, vc: 70, fixed: 200000, capital: 400000, saving_per_1000: 0.2, min_margin: 10, min_roce: 15 }, params: [{ key: 'price', label: 'Price per unit', min: 60, max: 200, step: 1, default: 100, unit: '₹' }, { key: 'invest', label: 'Cost-saving investment', min: 0, max: 100000, step: 5000, default: 0, unit: '₹' }] },
    ],
  },
];

export const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));

/** Public view: never includes correct answers or explanations. */
export function publicGame(g: Game) {
  if (g.mechanic === 'classify') return { ...g, items: g.items.map((i) => ({ prompt: i.prompt, data: i.data ?? null })) };
  return g;
}

export function gradeClassify(g: ClassifyGame, answers: number[]): { correct: number; total: number; outcomes: { correct: boolean; answer: number; expected: number; why: string }[] } {
  const outcomes = g.items.map((it, i) => ({ correct: answers[i] === it.correct, answer: answers[i] ?? -1, expected: it.correct, why: it.why }));
  return { correct: outcomes.filter((o) => o.correct).length, total: g.items.length, outcomes };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Deterministic evaluation of one tune round (shared with the client for live feedback). */
export function evaluateTune(gameId: string, fixed: Record<string, number>, p: Record<string, number>): TuneOutcome {
  if (gameId === 'valuation-lab') {
    const g = p.growth!;
    if (!(fixed.discount! > g)) return { ok: false, metrics: { value: null }, message: 'Growth must be below the discount rate.' };
    const v = dcf({ fcf: [fixed.fcf1!, fixed.fcf2!, fixed.fcf3!], discountPct: fixed.discount!, terminalGrowthPct: g }).value;
    const gap = v / fixed.ev! - 1;
    return { ok: Math.abs(gap) <= 0.02, metrics: { value: round2(v), gap_pct: round2(gap * 100) }, message: Math.abs(gap) <= 0.02 ? `At ${g}% growth the DCF value (₹${round2(v)} crore) matches the enterprise value within 2%: this is the growth the price implies.` : `DCF value ₹${round2(v)} crore is ${round2(gap * 100)}% ${gap > 0 ? 'above' : 'below'} the enterprise value.` };
  }
  if (gameId === 'portfolio-under-pressure') {
    const w = [p.w_eq!, p.w_bd!, p.w_au!];
    const sum = w.reduce((s, x) => s + x, 0);
    if (Math.abs(sum - 100) > 1e-9) return { ok: false, metrics: { weights_total: sum }, message: `Weights must add to 100% (now ${sum}%).` };
    const ret = (w[0]! * fixed.r_eq! + w[1]! * fixed.r_bd! + w[2]! * fixed.r_au!) / 100;
    const stress = (w[0]! * fixed.s_eq! + w[1]! * fixed.s_bd! + w[2]! * fixed.s_au!) / 100;
    const ok = ret >= fixed.min_return! - 1e-9 && stress >= fixed.max_loss! - 1e-9;
    return { ok, metrics: { expected_return_pct: round2(ret), stress_return_pct: round2(stress) }, message: ok ? 'Both constraints met.' : `${ret < fixed.min_return! ? `Expected return ${round2(ret)}% is below ${fixed.min_return}%. ` : ''}${stress < fixed.max_loss! ? `Stress result ${round2(stress)}% breaches the ${fixed.max_loss}% limit.` : ''}`.trim() };
  }
  if (gameId === 'build-the-business') {
    const units = Math.max(0, fixed.a! - fixed.b! * p.price!);
    const vc = fixed.vc! - (Math.min(p.invest!, 100000) / 1000) * fixed.saving_per_1000!;
    const revenue = p.price! * units;
    const ebit = revenue - vc * units - fixed.fixed!;
    const capital = fixed.capital! + p.invest!;
    const margin = revenue > 0 ? (ebit / revenue) * 100 : null;
    const r = capital > 0 ? (ebit / capital) * 100 : null;
    const ok = margin !== null && r !== null && margin >= fixed.min_margin! && r >= fixed.min_roce!;
    return { ok, metrics: { units, revenue: round2(revenue), ebit: round2(ebit), ebit_margin_pct: margin === null ? null : round2(margin), roce_pct: r === null ? null : round2(r) }, message: ok ? 'Both targets met.' : 'Targets not yet met: adjust price (volume falls as price rises) or invest to cut unit costs.' };
  }
  throw new Error('Unknown tune game');
}
