// ATLAS Academy source curriculum (version-controlled authoring format).
// `syncCurriculum` loads this into the acad.* tables; the API and web read only the database, so
// course copy is never hard-coded in the UI. All content here was drafted with AI assistance and
// is stored as `in_review`: it is NOT published until a named reviewer completes the seven-point
// review (factual, calculation, pedagogy, accessibility, rights, alignment, technical).
// Examples use hypothetical companies and round numbers; nothing describes a real security.

import type { Correct, QType, ReadinessRules } from './engine.js';
import { ED_MODULE_1, ED_MODULE_2, ED_MODULE_3, ED_MODULE_4 } from './content/equity-detective.js';
import { ED_MODULE_5, ED_MODULE_5_OBJECTIVES } from './content/equity-detective-context.js';
import { MA_MODULE_1, MA_MODULE_2, MA_MODULE_3 } from './content/market-architect.js';
import { MD_MODULE_2, MD_MODULE_3, MD_MODULE_4 } from './content/market-decoder.js';
import { MD_MODULE_5, MD_MODULE_5_OBJECTIVES } from './content/market-decoder-plumbing.js';
import { SE_MODULE_1, SE_MODULE_2, SE_MODULE_3 } from './content/signal-engineer.js';

export interface SourceQuestion {
  id: string;
  skill: string;
  prerequisite?: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  qtype: QType;
  stem: string;
  options?: string[];
  correct: Correct;
  explanation: string;
  misconception: string;
  weight?: number;
  critical?: boolean;
  objective?: string;
}

export const WIDGETS = ['order_book', 'percent_path', 'ownership_split', 'diversification', 'compound_growth', 'real_return', 'index_weighting', 'statement_flow', 'dupont', 'ev_bridge', 'drawdown', 'overfit', 'cost_drag', 'dcf', 'dcf_surface_3d', 'portfolio_risk', 'multiple_testing', 'statements_3d', 'tx_journey_3d', 'tokenomics_3d', 'consensus_3d', 'signing', 'amm_pool_3d', 'quant_3d', 'depth_3d'] as const;
export type Widget = (typeof WIDGETS)[number];

export type Block =
  | { stage: 'discover'; kind: 'text'; title: string; body: string[] }
  | { stage: 'observe'; kind: 'interactive'; title: string; widget: Widget; intro: string; alt_text: string }
  /** A guided exercise inside the ATLAS product itself (practical use of real screens on permitted data). */
  | { stage: 'observe'; kind: 'atlas_task'; title: string; href: string; steps: string[]; alt_text: string }
  | { stage: 'predict'; kind: 'prediction'; prompt: string; options: string[]; answer: number; reveal: string }
  | { stage: 'investigate'; kind: 'worked_example'; title: string; steps: string[] }
  | { stage: 'decide'; kind: 'guided_practice'; prompt: string; hint: string; answer_text: string }
  | { stage: 'explain'; kind: 'reflection'; prompt: string; model_answer: string }
  | { stage: 'review'; kind: 'summary'; points: string[] };

export interface SourceLesson {
  id: string;
  title: string;
  minutes: number;
  objectives: string[];
  prerequisites?: string[];
  blocks: Block[];
  quiz: SourceQuestion[];
  references: { title: string; url?: string; note: string }[];
  mastery_rule: string;
}

export interface SourceCourse {
  id: string;
  position: number;
  title: string;
  tagline: string;
  description: string;
  audience: string;
  prerequisites: string;
  preceding?: string;
  completion_statement: string;
  rules: ReadinessRules;
  objectives: { id: string; statement: string; skill: string }[];
  modules: { id: string; title: string; summary: string; lessons: SourceLesson[] }[];
  diagnostic: SourceQuestion[];
}

const RULES: ReadinessRules = { high_min: 0.8, low_max: 0.4, critical_miss_low: 2, questions: 5, max_attempts_per_week: 3 };
const COMPLETION = 'This record shows which learning objectives you practised and the assessments you completed in the ATLAS Academy. It is not a professional qualification, licence or certification, and it says nothing about future investment results.';
const SEBI_INVESTOR_EDU = { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'General investor education from the Indian securities regulator.' };

// ───────────────────────────── 1. MARKET DECODER ─────────────────────────────
const marketDecoder: SourceCourse = {
  id: 'market-decoder',
  position: 1,
  title: 'ATLAS: MARKET DECODER',
  tagline: 'How markets work, what a share is, and how to think about risk.',
  description: 'Start here if you are new to investing. You will learn what you own when you buy a share, how exchanges match buyers and sellers, how to calculate returns correctly, and why risk and uncertainty never disappear.',
  audience: 'Beginners with basic arithmetic and no prior market experience.',
  prerequisites: 'Comfort with percentages and simple arithmetic, and a willingness to treat every investment outcome as uncertain.',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'md-o1', statement: 'Explain what a share represents and the ways a shareholder can gain or lose.', skill: 'share_ownership' },
    { id: 'md-o2', statement: 'Describe how buy and sell orders on an exchange produce a trade price.', skill: 'price_setting' },
    { id: 'md-o3', statement: 'Calculate percentage changes and multi-period returns correctly.', skill: 'returns_math' },
    { id: 'md-o4', statement: 'Distinguish risk from certainty and explain why past returns do not guarantee future returns.', skill: 'risk_vs_certainty' },
    { id: 'md-o5', statement: 'Explain how diversification reduces the impact of a single company failing.', skill: 'diversification' },
    { id: 'md-o6', statement: 'Compare nominal and real (inflation-adjusted) returns.', skill: 'inflation' },
    { id: 'md-o7', statement: 'Calculate compound growth and estimate doubling times.', skill: 'compounding' },
    { id: 'md-o8', statement: 'Explain how index weighting determines index returns.', skill: 'index' },
    { id: 'md-o9', statement: 'Read market breadth and an evidence-linked daily briefing.', skill: 'market_reading' },
    ...MD_MODULE_5_OBJECTIVES,
  ],
  modules: [
    {
      id: 'md-m1',
      title: 'What a market is',
      summary: 'Ownership, order matching and the arithmetic of returns.',
      lessons: [
        {
          id: 'md-l1',
          title: 'Shares: owning a slice of a business',
          minutes: 12,
          objectives: ['md-o1'],
          mastery_rule: 'Objective md-o1 is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.',
          references: [SEBI_INVESTOR_EDU],
          blocks: [
            { stage: 'discover', kind: 'text', title: 'A business split into pieces', body: [
              'A company that needs money to grow can sell small pieces of ownership called shares. If a company has 1,00,00,000 shares and you own 1,000 of them, you own 0.01% of the company.',
              'Owning a share does not make the company owe you anything fixed. You share in what the business earns and in what it is worth, for better or worse.',
            ] },
            { stage: 'observe', kind: 'interactive', title: 'Slice the company', widget: 'ownership_split', intro: 'Change the number of shares the company has issued and the number you hold, and watch your ownership percentage change.', alt_text: 'An interactive bar shows your holding as a fraction of all shares issued, with the percentage written next to it.' },
            { stage: 'predict', kind: 'prediction', prompt: 'A company issues new shares to raise money and you do not buy any. What happens to your percentage ownership?', options: ['It rises', 'It falls', 'It stays the same'], answer: 1, reveal: 'Your number of shares is unchanged but the total grew, so your slice is smaller. This is called dilution.' },
            { stage: 'investigate', kind: 'worked_example', title: 'Two ways a shareholder can gain', steps: [
              'Suppose you buy 10 shares of a hypothetical company at ₹200 each: you pay ₹2,000.',
              'Over a year the company pays a dividend of ₹4 per share: you receive ₹40.',
              'At the end of the year the share trades at ₹220. Your shares are worth ₹2,200, a ₹200 gain on paper.',
              'Total gain = ₹200 + ₹40 = ₹240, which is 12% of the ₹2,000 you paid. If the price had fallen to ₹170, the same dividend would leave you with a loss of ₹260.',
            ] },
            { stage: 'decide', kind: 'guided_practice', prompt: 'You hold 500 shares of a company that has 50,000 shares in total. What percentage do you own?', hint: 'Divide your shares by the total, then multiply by 100.', answer_text: '500 ÷ 50,000 = 0.01, which is 1%.' },
            { stage: 'explain', kind: 'reflection', prompt: 'In one or two sentences, explain why a shareholder is not guaranteed a dividend.', model_answer: 'Dividends are paid only if the company decides to pay them out of its profits or reserves; a shareholder owns part of the business, not a fixed claim like a lender.' },
            { stage: 'review', kind: 'summary', points: ['A share is part-ownership of a company, not a loan.', 'Shareholders can gain through dividends and price changes, and can lose money.', 'Issuing new shares dilutes existing holders who do not buy more.'] },
          ],
          quiz: [
            { id: 'md-q1-1', objective: 'md-o1', skill: 'share_ownership', difficulty: 1, qtype: 'single_choice', stem: 'Which best describes owning a share in a listed company?', options: ['Lending money to the company at a fixed rate', 'Owning a part of the company', 'Holding a deposit the company must repay', 'A guarantee of yearly dividends'], correct: { index: 1 }, explanation: 'A share is part-ownership. Lenders (bondholders, banks) have fixed claims; shareholders do not.', misconception: 'Treating a share like a fixed deposit or loan.' },
            { id: 'md-q1-2', objective: 'md-o1', skill: 'share_ownership', difficulty: 2, qtype: 'numeric', stem: 'You buy 20 shares at ₹150. You receive a dividend of ₹3 per share and sell at ₹162. What is your total gain in rupees?', correct: { value: 300, abs_tol: 0.5, unit: '₹' }, explanation: 'Price gain = 20 × (162 − 150) = ₹240. Dividends = 20 × 3 = ₹60. Total = ₹300 (before costs and taxes).', misconception: 'Forgetting to include the dividend, or counting it per share instead of per holding.' },
            { id: 'md-q1-3', objective: 'md-o1', skill: 'share_ownership', difficulty: 2, qtype: 'single_choice', stem: 'A company with 10,00,000 shares issues 2,50,000 new shares. You held 10,000 shares and bought none. What is your new ownership?', options: ['1%', '0.8%', '1.25%', '0.75%'], correct: { index: 1 }, explanation: 'Before: 10,000 ÷ 10,00,000 = 1%. After: 10,000 ÷ 12,50,000 = 0.8%.', misconception: 'Ignoring dilution when the share count rises.' },
          ],
        },
        {
          id: 'md-l2',
          title: 'How prices are set: orders meet',
          minutes: 15,
          objectives: ['md-o2'],
          prerequisites: ['md-l1'],
          mastery_rule: 'Objective md-o2 is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.',
          references: [SEBI_INVESTOR_EDU, { title: 'NSE: market timings and order types', url: 'https://www.nseindia.com/', note: 'Exchange documentation on order types; check the current rules before relying on them.' }],
          blocks: [
            { stage: 'discover', kind: 'text', title: 'Nobody sets the price', body: [
              'On an exchange, buyers place orders saying the highest price they will pay (a bid) and sellers place orders saying the lowest price they will accept (an ask).',
              'A trade happens when a bid meets an ask. The list of waiting orders is the order book. Neither the company nor the regulator sets the trading price.',
            ] },
            { stage: 'observe', kind: 'interactive', title: 'Match the order book', widget: 'order_book', intro: 'Add buy and sell limit orders and watch which ones trade. Orders at better prices trade first; at the same price, earlier orders trade first.', alt_text: 'Two columns list buy orders (highest price first) and sell orders (lowest price first). Matched quantities move to a trades list below, with the trade price and quantity written out.' },
            { stage: 'predict', kind: 'prediction', prompt: 'The best bid is ₹99 and the best ask is ₹101. A new sell order arrives willing to sell at ₹99. What happens?', options: ['Nothing trades', 'It trades at ₹99 against the best bid', 'It trades at ₹101'], answer: 1, reveal: 'The seller accepts ₹99, which meets the waiting buyer\'s bid, so a trade happens at ₹99, the price of the order already in the book.' },
            { stage: 'investigate', kind: 'worked_example', title: 'Walking the book', steps: [
              'Sell orders waiting: 100 shares at ₹101, 200 at ₹102.',
              'A buyer sends a market order for 250 shares (buy at the best available prices).',
              'First 100 shares trade at ₹101, then 150 at ₹102.',
              'Average price = (100 × 101 + 150 × 102) ÷ 250 = ₹101.60. Large orders can move the price they pay; this is why liquidity matters.',
            ] },
            { stage: 'decide', kind: 'guided_practice', prompt: 'Best bid ₹249 for 50 shares, best ask ₹251 for 80 shares. What is the bid-ask spread in rupees and as a percentage of the mid-price?', hint: 'Spread = ask − bid. Mid-price = (ask + bid) ÷ 2.', answer_text: 'Spread = ₹2. Mid = ₹250. 2 ÷ 250 = 0.8%.' },
            { stage: 'explain', kind: 'reflection', prompt: 'Why might the price you pay for a large order differ from the last traded price?', model_answer: 'The order may use up the best-priced sell orders and then trade against worse prices further up the book, so the average price rises (market impact).' },
            { stage: 'review', kind: 'summary', points: ['Prices come from matching bids and asks in the order book.', 'Better-priced orders trade first; ties go to the earliest order.', 'Thin order books mean wider spreads and more price impact for large orders.'] },
          ],
          quiz: [
            { id: 'md-q2-1', objective: 'md-o2', skill: 'price_setting', difficulty: 1, qtype: 'single_choice', stem: 'Who sets the price at which a share trades on an exchange?', options: ['The company, each morning', 'The regulator', 'The matching of buy and sell orders', 'The stockbroker'], correct: { index: 2 }, explanation: 'Trades happen where a buyer\'s bid meets a seller\'s ask in the exchange\'s order book.', misconception: 'Believing a company or regulator fixes the market price.' },
            { id: 'md-q2-2', objective: 'md-o2', skill: 'price_setting', difficulty: 3, qtype: 'numeric', stem: 'Sell orders waiting: 300 shares at ₹50 and 200 shares at ₹51. You place a market order to buy 400 shares. What is your average price per share, in rupees?', correct: { value: 50.25, abs_tol: 0.005, unit: '₹' }, explanation: '300 × 50 + 100 × 51 = 20,100. 20,100 ÷ 400 = ₹50.25.', misconception: 'Assuming the whole order fills at the best price.' },
            { id: 'md-q2-3', objective: 'md-o2', skill: 'price_setting', difficulty: 2, qtype: 'single_choice', stem: 'Two buy orders are waiting at ₹100: one placed at 10:01, one at 10:05. A seller sells at ₹100 for fewer shares than both want. Which is filled first?', options: ['The 10:01 order', 'The 10:05 order', 'They are split equally', 'The larger order'], correct: { index: 0 }, explanation: 'At the same price, exchanges generally use time priority: the earlier order is filled first.', misconception: 'Thinking size or recency decides priority at the same price.' },
          ],
        },
        {
          id: 'md-l3',
          title: 'Percentages, returns and why −50% needs +100%',
          minutes: 14,
          objectives: ['md-o3'],
          prerequisites: ['md-l1'],
          mastery_rule: 'Objective md-o3 is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.',
          references: [SEBI_INVESTOR_EDU],
          blocks: [
            { stage: 'discover', kind: 'text', title: 'Always divide by where you started', body: [
              'A percentage change compares the change with the starting value: (end − start) ÷ start × 100.',
              'Returns over several periods multiply, they do not add: a 10% gain followed by a 10% loss leaves you below where you started.',
            ] },
            { stage: 'observe', kind: 'interactive', title: 'Follow ₹100 through gains and losses', widget: 'percent_path', intro: 'Choose a sequence of percentage moves and watch ₹100 change step by step. Compare the simple sum of the percentages with the actual result.', alt_text: 'A step chart starts at ₹100 and shows the value after each percentage move, with a table listing each step and the cumulative result.' },
            { stage: 'predict', kind: 'prediction', prompt: 'A share falls 50%. What gain does it need to get back to its original price?', options: ['50%', '75%', '100%'], answer: 2, reveal: '₹100 falling 50% becomes ₹50. Getting back to ₹100 means gaining ₹50 on ₹50, which is 100%.' },
            { stage: 'investigate', kind: 'worked_example', title: 'Three years of returns', steps: [
              'Year 1: +20%. Year 2: −10%. Year 3: +5%.',
              'Growth factors: 1.20 × 0.90 × 1.05 = 1.134.',
              'Total return = 13.4%, not 20 − 10 + 5 = 15%.',
              'Average annual (compound) return = 1.134^(1/3) − 1 ≈ 4.28% a year.',
            ] },
            { stage: 'decide', kind: 'guided_practice', prompt: 'A share goes from ₹400 to ₹300. What is the percentage change?', hint: 'Change ÷ starting value.', answer_text: '(300 − 400) ÷ 400 = −25%.' },
            { stage: 'explain', kind: 'reflection', prompt: 'Explain to a friend why +10% then −10% does not return you to the start.', model_answer: 'The 10% loss is taken from a larger amount (110), so it removes 11, leaving 99. Percentage moves compound on the current value.' },
            { stage: 'review', kind: 'summary', points: ['Percentage change = (end − start) ÷ start.', 'Multi-period returns multiply: (1 + r1)(1 + r2)… − 1.', 'Losses need larger gains to recover: −50% needs +100%.'] },
          ],
          quiz: [
            { id: 'md-q3-1', objective: 'md-o3', skill: 'returns_math', difficulty: 1, qtype: 'numeric', stem: 'A share rises from ₹80 to ₹92. What is the percentage increase?', correct: { value: 15, abs_tol: 0.05, unit: '%' }, explanation: '(92 − 80) ÷ 80 = 0.15 = 15%.', misconception: 'Dividing by the end value (12 ÷ 92 ≈ 13%).' },
            { id: 'md-q3-2', objective: 'md-o3', skill: 'returns_math', difficulty: 2, qtype: 'numeric', stem: 'An investment returns +25% in year one and −20% in year two. What is the total two-year return, in percent?', correct: { value: 0, abs_tol: 0.05, unit: '%' }, explanation: '1.25 × 0.80 = 1.00, so the total return is 0%, even though +25 − 20 = +5.', misconception: 'Adding percentage returns instead of multiplying growth factors.' },
            { id: 'md-q3-3', objective: 'md-o3', skill: 'returns_math', difficulty: 3, qtype: 'numeric', stem: 'After a 20% fall, what percentage gain is needed to get back to the starting value?', correct: { value: 25, abs_tol: 0.05, unit: '%' }, explanation: '₹100 → ₹80. Recovering ₹20 on ₹80 needs 20 ÷ 80 = 25%.', misconception: 'Assuming the recovery needs the same percentage as the fall.' },
          ],
        },
      ],
    },
    { id: 'md-m2', title: 'Risk and return', summary: 'Volatility, diversification, and why higher potential return comes with more uncertainty.', lessons: MD_MODULE_2 },
    { id: 'md-m3', title: 'Money over time', summary: 'Compounding, inflation and real returns.', lessons: MD_MODULE_3 },
    { id: 'md-m4', title: 'Reading the market', summary: 'Indices, sectors, breadth and the daily briefing.', lessons: MD_MODULE_4 },
    { id: 'md-m5', title: 'How trading and market data work', summary: 'Exchanges and identifiers, settlement, primary and secondary markets, OHLC data, and how to spot stale or misleading data.', lessons: MD_MODULE_5 },
  ],
  diagnostic: [
    { id: 'md-d01', skill: 'percentages', difficulty: 1, qtype: 'numeric', critical: true, stem: 'A share price rises from ₹200 to ₹250. What is the percentage increase?', correct: { value: 25, abs_tol: 0.05, unit: '%' }, explanation: '(250 − 200) ÷ 200 = 25%.', misconception: 'Dividing by the new price (50 ÷ 250 = 20%).' },
    { id: 'md-d02', skill: 'percentages', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'A share falls 50% and then rises 50%. Compared with where it started, it is now:', options: ['Back where it started', '25% below the start', '25% above the start', '50% below the start'], correct: { index: 1 }, explanation: '100 → 50 → 75: 25% below the start.', misconception: 'Equal percentage gains and losses cancel out.' },
    { id: 'md-d03', skill: 'compounding', difficulty: 2, qtype: 'numeric', stem: '₹10,000 earns 10% a year, compounded annually. How much is it worth after 2 years, in rupees?', correct: { value: 12100, abs_tol: 1, unit: '₹' }, explanation: '10,000 × 1.1 × 1.1 = ₹12,100.', misconception: 'Using simple interest (₹12,000).' },
    { id: 'md-d04', skill: 'risk_vs_certainty', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'A fund shows it returned 18% a year over the last five years. What can you conclude?', options: ['It will return about 18% next year', 'Past returns do not guarantee future returns', 'It is risk-free', 'It will beat a fixed deposit every year'], correct: { index: 1 }, explanation: 'Historical returns describe the past only; future returns are uncertain.', misconception: 'Extrapolating past returns as a promise.' },
    { id: 'md-d05', skill: 'share_ownership', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'Buying a share of a listed company means:', options: ['Lending money to the company', 'Owning a part of the company', 'Making a fixed-interest deposit', 'Being promised a dividend'], correct: { index: 1 }, explanation: 'A share is part-ownership with no fixed claim.', misconception: 'Confusing shares with loans or deposits.' },
    { id: 'md-d06', skill: 'diversification', difficulty: 2, qtype: 'single_choice', stem: 'Which approach most reduces the damage if one company fails?', options: ['Put all money in one well-known company', 'Spread money across many companies in different industries', 'Buy more of a company whenever it falls', 'Only buy companies in the news'], correct: { index: 1 }, explanation: 'Diversification limits the share of your money exposed to any single failure.', misconception: 'Believing familiarity or fame reduces risk.' },
    { id: 'md-d07', skill: 'inflation', difficulty: 2, qtype: 'single_choice', stem: 'Your savings earn 4% a year while prices rise 6% a year. After a year, what you can buy with your savings has:', options: ['Increased', 'Decreased', 'Stayed the same', 'Cannot be judged'], correct: { index: 1 }, explanation: 'Your money grew less than prices, so its purchasing power fell (about 2% in real terms).', misconception: 'Looking only at the nominal rupee amount.' },
    { id: 'md-d08', skill: 'index', difficulty: 1, qtype: 'single_choice', stem: 'A market index such as a "top 50 companies" index is:', options: ['The share of a single company', 'A measure that tracks a basket of shares', 'A government bond', 'A product with a guaranteed return'], correct: { index: 1 }, explanation: 'An index summarises the price movement of a defined group of shares.', misconception: 'Treating an index as a single security or a guaranteed product.' },
    { id: 'md-d09', skill: 'price_setting', difficulty: 2, qtype: 'single_choice', stem: 'On a stock exchange, the price of a trade is set by:', options: ['The company each morning', 'The regulator', 'Buy and sell orders meeting', 'The broker'], correct: { index: 2 }, explanation: 'Trades occur where bids and asks meet in the order book.', misconception: 'Believing an authority fixes market prices.' },
    { id: 'md-d10', skill: 'risk_vs_certainty', difficulty: 2, qtype: 'single_choice', stem: 'Which statement about risk and return is most accurate?', options: ['Higher potential returns usually come with more uncertainty', 'Popular investments with high returns are safe', 'Holding long enough removes all risk', 'Low-risk investments always lose money'], correct: { index: 0 }, explanation: 'Investors usually demand higher expected return for bearing more uncertainty; nothing removes risk entirely.', misconception: 'Thinking time or popularity eliminates risk.' },
    { id: 'md-d11', skill: 'percentages', difficulty: 2, qtype: 'numeric', stem: 'A ₹500 share pays a yearly dividend of ₹10. What is the dividend yield, in percent?', correct: { value: 2, abs_tol: 0.01, unit: '%' }, explanation: '10 ÷ 500 = 2%.', misconception: 'Dividing price by dividend, or forgetting to convert to a percentage.' },
    { id: 'md-d12', skill: 'risk_vs_certainty', difficulty: 3, qtype: 'multi_select', stem: 'Which are real risks for a shareholder? Select all that apply.', options: ['The share price may fall', 'The company may cut its dividend', 'The company may fail', 'The exchange guarantees investors against losses'], correct: { indexes: [0, 1, 2] }, explanation: 'Prices, dividends and the company itself are all uncertain. No exchange guarantees investors against investment losses.', misconception: 'Assuming some authority protects investors from market losses.' },
  ],
};

// ───────────────────────────── 2. EQUITY DETECTIVE ─────────────────────────────
const equityDetective: SourceCourse = {
  id: 'equity-detective',
  position: 2,
  title: 'ATLAS: EQUITY DETECTIVE',
  tagline: 'Read financial statements and find the story behind the numbers.',
  description: 'Learn to read the profit and loss statement, balance sheet and cash-flow statement together, tell profit from cash, use ratios with care, and build valuation judgements on evidence.',
  audience: 'Learners who understand what shares are and want to analyse individual companies.',
  prerequisites: 'Understanding of the three financial statements at a basic level, percentages, and simple ratios.',
  preceding: 'market-decoder',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'ed-o1', statement: 'Connect the profit and loss statement, balance sheet and cash-flow statement.', skill: 'statements' },
    { id: 'ed-o2', statement: 'Explain differences between reported profit and operating cash flow.', skill: 'profit_vs_cash' },
    { id: 'ed-o3', statement: 'Calculate and interpret margins, ROE and ROCE.', skill: 'ratios' },
    { id: 'ed-o4', statement: 'Assess leverage and its effect on risk.', skill: 'leverage' },
    { id: 'ed-o5', statement: 'Use P/E and EV/EBITDA with their limitations.', skill: 'valuation' },
    { id: 'ed-o6', statement: 'Interpret financial quality flags as questions to investigate.', skill: 'quality' },
    ...ED_MODULE_5_OBJECTIVES,
  ],
  modules: [
    { id: 'ed-m1', title: 'Three statements, one business', summary: 'How the statements link and what each one hides.', lessons: ED_MODULE_1 },
    { id: 'ed-m2', title: 'Profit is an opinion, cash is a fact', summary: 'Working capital, accruals and cash conversion.', lessons: ED_MODULE_2 },
    { id: 'ed-m3', title: 'Returns on capital', summary: 'Margins, ROE, ROCE and what drives them.', lessons: ED_MODULE_3 },
    { id: 'ed-m4', title: 'What is it worth?', summary: 'Relative valuation, enterprise value and its traps.', lessons: ED_MODULE_4 },
    { id: 'ed-m5', title: 'The business behind the numbers', summary: 'Business models and industry structure, annual reports, standalone and consolidated statements, revenue quality, free cash flow, peer comparison and corporate actions.', lessons: ED_MODULE_5 },
  ],
  diagnostic: [
    { id: 'ed-d01', skill: 'statements', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'Which statement shows a company\'s assets, liabilities and equity at a point in time?', options: ['Profit and loss statement', 'Balance sheet', 'Cash-flow statement', 'Directors\' report'], correct: { index: 1 }, explanation: 'The balance sheet is a snapshot at a date; the P&L and cash-flow statements cover a period.', misconception: 'Mixing up period statements with the point-in-time balance sheet.' },
    { id: 'ed-d02', skill: 'profit_vs_cash', difficulty: 3, qtype: 'single_choice', critical: true, stem: 'A company reports rising profits but negative operating cash flow for two years. What should you check first?', options: ['Whether receivables and inventory are growing faster than sales', 'Nothing: profit is what matters', 'Whether the share price has risen', 'Whether depreciation is too high'], correct: { index: 0 }, explanation: 'Profit can be booked before cash arrives. Fast-growing receivables or inventory absorb cash and deserve scrutiny.', misconception: 'Assuming profit and cash are the same thing.' },
    { id: 'ed-d03', skill: 'ratios', difficulty: 2, qtype: 'numeric', stem: 'Revenue is ₹800 crore and operating profit (EBIT) is ₹120 crore. What is the operating margin, in percent?', correct: { value: 15, abs_tol: 0.05, unit: '%' }, explanation: '120 ÷ 800 = 15%.', misconception: 'Dividing revenue by profit.' },
    { id: 'ed-d04', skill: 'ratios', difficulty: 2, qtype: 'numeric', critical: true, stem: 'Net profit is ₹50 crore and average shareholders\' equity is ₹400 crore. What is the ROE, in percent?', correct: { value: 12.5, abs_tol: 0.05, unit: '%' }, explanation: '50 ÷ 400 = 12.5%.', misconception: 'Using total assets or market value instead of book equity.' },
    { id: 'ed-d05', skill: 'leverage', difficulty: 3, qtype: 'single_choice', critical: true, stem: 'Two companies have the same ROE. Company A has no debt; Company B has a lot of debt. Which is true?', options: ['B\'s ROE is more sensitive to a fall in profits', 'A must be overvalued', 'B is safer because it uses cheaper money', 'Their risk is identical because ROE is equal'], correct: { index: 0 }, explanation: 'Debt magnifies the effect of profit changes on equity holders and adds fixed obligations.', misconception: 'Equal returns imply equal risk.' },
    { id: 'ed-d06', skill: 'valuation', difficulty: 1, qtype: 'numeric', stem: 'A share trades at ₹300 and earnings per share are ₹20. What is the P/E ratio?', correct: { value: 15, abs_tol: 0.01 }, explanation: '300 ÷ 20 = 15.', misconception: 'Inverting the ratio (EPS ÷ price is the earnings yield).' },
    { id: 'ed-d07', skill: 'valuation', difficulty: 2, qtype: 'single_choice', stem: 'On its own, a low P/E ratio most likely means:', options: ['The share is definitely undervalued', 'The market may expect low growth or see higher risk; context is needed', 'The company is loss-making', 'Nothing, because P/E does not depend on price'], correct: { index: 1 }, explanation: 'Valuation multiples reflect expectations and risk; a low multiple can be justified.', misconception: 'Low multiple = bargain.' },
    { id: 'ed-d08', skill: 'business_economics', difficulty: 3, qtype: 'single_choice', stem: 'Which is the strongest sign of a durable competitive advantage?', options: ['Consistently higher returns on capital than peers over many years', 'One quarter of very high sales growth', 'A high share price', 'A large advertising budget'], correct: { index: 0 }, explanation: 'Sustained high returns on capital suggest competitors cannot easily copy the business.', misconception: 'Treating short-term growth or popularity as a moat.' },
    { id: 'ed-d09', skill: 'statements', difficulty: 2, qtype: 'single_choice', stem: 'Which item belongs in cash flow from investing activities?', options: ['Purchase of machinery', 'Payments to suppliers', 'Dividends paid to shareholders', 'Repayment of a bank loan'], correct: { index: 0 }, explanation: 'Capital expenditure is investing. Supplier payments are operating; dividends and loan repayments are financing.', misconception: 'Classifying all large payments as investing.' },
    { id: 'ed-d10', skill: 'valuation', difficulty: 3, qtype: 'numeric', stem: 'Market capitalisation is ₹1,000 crore, total debt ₹300 crore and cash ₹100 crore. Using EV = market cap + debt − cash, what is the enterprise value in crore?', correct: { value: 1200, abs_tol: 0.5, unit: '₹ crore' }, explanation: '1,000 + 300 − 100 = ₹1,200 crore.', misconception: 'Adding cash instead of subtracting it.' },
    { id: 'ed-d11', skill: 'statements', difficulty: 2, qtype: 'single_choice', stem: 'Depreciation is best described as:', options: ['A cash payment made each year', 'Spreading the cost of an asset over its useful life', 'A tax on assets', 'Repayment of a loan used to buy assets'], correct: { index: 1 }, explanation: 'Depreciation is a non-cash expense that allocates an asset\'s cost over time.', misconception: 'Treating depreciation as a cash outflow.' },
    { id: 'ed-d12', skill: 'statements', difficulty: 3, qtype: 'single_choice', stem: 'Why should consolidated and standalone figures not be mixed in one ratio?', options: ['Consolidated figures include subsidiaries, so the ratio would mix different scopes', 'They are always identical', 'Only standalone figures are audited', 'Regulators forbid looking at both'], correct: { index: 0 }, explanation: 'Each basis covers a different set of entities; combining them produces a meaningless ratio.', misconception: 'Assuming the two bases are interchangeable.' },
  ],
};

// ───────────────────────────── 3. SIGNAL ENGINEER ─────────────────────────────
const signalEngineer: SourceCourse = {
  id: 'signal-engineer',
  position: 3,
  title: 'ATLAS: SIGNAL ENGINEER',
  tagline: 'Test ideas with data, and learn why most patterns are noise.',
  description: 'Probability, returns, volatility and drawdown; how to design a fair experiment, avoid look-ahead and survivorship bias, and read a backtest critically.',
  audience: 'Learners comfortable with company analysis who want to test rules with data.',
  prerequisites: 'Basic probability, return calculations, reading price charts, and the idea of testing a claim with evidence.',
  preceding: 'equity-detective',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'se-o1', statement: 'Compute returns, volatility and drawdown from a price series.', skill: 'returns_stats' },
    { id: 'se-o2', statement: 'Recognise look-ahead, survivorship and data-snooping biases.', skill: 'bias' },
    { id: 'se-o3', statement: 'Design an out-of-sample test with costs and a fair benchmark.', skill: 'experiment_design' },
    { id: 'se-o4', statement: 'Reason with probability and expected value without confusing averages with certainty.', skill: 'probability' },
  ],
  modules: [
    { id: 'se-m1', title: 'Returns and randomness', summary: 'Probability, compounding, volatility and drawdown.', lessons: SE_MODULE_1 },
    { id: 'se-m2', title: 'How backtests lie', summary: 'Look-ahead, survivorship and over-fitting.', lessons: SE_MODULE_2 },
    { id: 'se-m3', title: 'Running a fair experiment', summary: 'Hypotheses, out-of-sample tests, costs and benchmarks in the Quant Lab.', lessons: SE_MODULE_3 },
  ],
  diagnostic: [
    { id: 'se-d01', skill: 'probability', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'A fair coin has landed heads five times in a row. What is the probability the next toss is heads?', options: ['Less than 1/2, tails is due', 'Exactly 1/2', 'More than 1/2, heads is on a streak', 'It cannot be known'], correct: { index: 1 }, explanation: 'Independent tosses have no memory: the probability stays 1/2.', misconception: 'The gambler\'s fallacy.' },
    { id: 'se-d02', skill: 'returns', difficulty: 2, qtype: 'numeric', stem: 'A price goes from 100 to 110 and then to 99. What is the total return over the two days, in percent?', correct: { value: -1, abs_tol: 0.05, unit: '%' }, explanation: '99 ÷ 100 − 1 = −1%.', misconception: 'Adding daily returns (+10% − 10% = 0%).' },
    { id: 'se-d03', skill: 'returns', difficulty: 3, qtype: 'single_choice', stem: 'Daily returns alternate +10% and −10% for two days. The average daily return is 0%. What happens to wealth?', options: ['It is unchanged', 'It ends 1% lower', 'It ends 1% higher', 'It depends on the starting amount'], correct: { index: 1 }, explanation: '1.1 × 0.9 = 0.99. Volatility drags compound growth below the arithmetic average.', misconception: 'Treating the arithmetic mean as the growth rate.' },
    { id: 'se-d04', skill: 'statistics', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'Two series have a correlation of 0.9. This means:', options: ['One causes the other', 'They moved together strongly in a linear way, which does not prove causation', '90% of one series\' moves are caused by the other', 'They will keep moving together'], correct: { index: 1 }, explanation: 'Correlation measures past linear co-movement only.', misconception: 'Correlation implies causation or persistence.' },
    { id: 'se-d05', skill: 'volatility', difficulty: 1, qtype: 'single_choice', stem: 'Series A has daily returns +1%, −1%, +1%, −1%. Series B has +3%, −3%, +3%, −3%. Which is more volatile?', options: ['A', 'B', 'Equal', 'Cannot tell'], correct: { index: 1 }, explanation: 'B\'s returns spread further from their mean, so its standard deviation is three times A\'s.', misconception: 'Confusing average return with volatility.' },
    { id: 'se-d06', skill: 'experimental_thinking', difficulty: 3, qtype: 'single_choice', critical: true, stem: 'You test 200 variations of a rule on the same data and choose the best result. What is the main danger?', options: ['The best result is likely partly luck (over-fitting)', 'Too few trades to pay costs', 'None, more tests mean more confidence', 'The data are too recent'], correct: { index: 0 }, explanation: 'With many tries, some look good by chance. The winner\'s performance is biased upwards.', misconception: 'More searching produces more reliable results.' },
    { id: 'se-d07', skill: 'experimental_thinking', difficulty: 3, qtype: 'single_choice', stem: 'A rule uses today\'s closing price to decide and assumes it trades at that same close. What is wrong?', options: ['Look-ahead bias: you could not act on the close at the close; trade at the next open or later', 'Nothing', 'It ignores dividends', 'Closing prices are not real prices'], correct: { index: 0 }, explanation: 'A decision needs the information to exist before the trade. Using the next session\'s price fixes the timing.', misconception: 'Ignoring when information becomes available.' },
    { id: 'se-d08', skill: 'chart_reading', difficulty: 2, qtype: 'single_choice', stem: 'A 50-day moving average crosses above the 200-day moving average. This tells you:', options: ['The price will rise', 'Recent average prices are above the longer-term average: a description of the past', 'Volume has increased', 'Earnings have grown'], correct: { index: 1 }, explanation: 'Moving averages summarise past prices; they predict nothing on their own.', misconception: 'Treating indicators as forecasts.' },
    { id: 'se-d09', skill: 'experimental_thinking', difficulty: 2, qtype: 'single_choice', stem: 'What is the best way to check whether a trading rule works?', options: ['Test it on data not used to design it', 'Re-run it on the same data until it works', 'Choose the period where it worked best', 'Leave out trading costs to see the pure signal'], correct: { index: 0 }, explanation: 'Out-of-sample testing guards against fitting noise.', misconception: 'In-sample success is evidence.' },
    { id: 'se-d10', skill: 'returns', difficulty: 3, qtype: 'numeric', stem: 'A portfolio goes 100 → 150 → 90 → 120. What is the maximum drawdown, in percent?', correct: { value: 40, abs_tol: 0.05, unit: '%' }, explanation: 'The worst peak-to-trough fall is 150 → 90: 60 ÷ 150 = 40%.', misconception: 'Measuring from the start instead of the previous peak.' },
    { id: 'se-d11', skill: 'statistics', difficulty: 3, qtype: 'single_choice', stem: 'A backtest uses only companies that are listed today. Which bias does this introduce?', options: ['Survivorship bias', 'Look-ahead bias in prices', 'No bias', 'Confirmation bias in the data'], correct: { index: 0 }, explanation: 'Companies that failed or delisted are missing, so results look better than an investor could have achieved.', misconception: 'Today\'s universe represents the past.' },
    { id: 'se-d12', skill: 'probability', difficulty: 2, qtype: 'numeric', stem: 'A bet wins ₹100 with probability 0.4 and loses ₹50 with probability 0.6. What is its expected value in rupees?', correct: { value: 10, abs_tol: 0.01, unit: '₹' }, explanation: '0.4 × 100 − 0.6 × 50 = 40 − 30 = ₹10.', misconception: 'Ignoring probabilities or the size of the loss.' },
  ],
};

// ───────────────────────────── 4. MARKET ARCHITECT ─────────────────────────────
const marketArchitect: SourceCourse = {
  id: 'market-architect',
  position: 4,
  title: 'ATLAS: MARKET ARCHITECT',
  tagline: 'Valuation, portfolio risk and research you can defend.',
  description: 'Discounted cash-flow valuation and its sensitivities, portfolio construction and risk, model validation, and the limits of what research can claim.',
  audience: 'Experienced learners who can analyse companies and test strategies.',
  prerequisites: 'DCF basics, portfolio volatility, statistical testing, and awareness of research biases.',
  preceding: 'signal-engineer',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'ma-o1', statement: 'Build and stress-test a discounted cash-flow valuation.', skill: 'dcf' },
    { id: 'ma-o2', statement: 'Measure and manage portfolio risk, including correlation effects.', skill: 'portfolio_risk' },
    { id: 'ma-o3', statement: 'Validate models out of sample and control for multiple testing.', skill: 'model_validation' },
    { id: 'ma-o4', statement: 'Write falsifiable, evidence-linked research that separates facts, calculations and interpretations.', skill: 'research_communication' },
  ],
  modules: [
    { id: 'ma-m1', title: 'Valuation under uncertainty', summary: 'DCF, terminal value, scenarios and sensitivity.', lessons: MA_MODULE_1 },
    { id: 'ma-m2', title: 'Portfolios under pressure', summary: 'Correlation, concentration, drawdowns and stress tests.', lessons: MA_MODULE_2 },
    { id: 'ma-m3', title: 'Research you can defend', summary: 'Validation, multiple testing and honest limitations.', lessons: MA_MODULE_3 },
  ],
  diagnostic: [
    { id: 'ma-d01', skill: 'dcf', difficulty: 3, qtype: 'numeric', critical: true, stem: 'Free cash flow next year is ₹100 crore and grows 4% a year forever. The discount rate is 12%. Using the growing-perpetuity formula, what is the value in crore?', correct: { value: 1250, abs_tol: 0.5, unit: '₹ crore' }, explanation: '100 ÷ (0.12 − 0.04) = ₹1,250 crore.', misconception: 'Using this year\'s cash flow or adding growth to the discount rate.' },
    { id: 'ma-d02', skill: 'dcf', difficulty: 4, qtype: 'numeric', stem: 'With next year\'s cash flow ₹100 crore and a 12% discount rate, by what percentage does the perpetuity value rise if growth goes from 4% to 5%?', correct: { value: 14.29, abs_tol: 0.1, unit: '%' }, explanation: '100 ÷ 0.07 = 1,428.6 versus 1,250: an increase of about 14.3%. Small growth changes move terminal values a lot.', misconception: 'Expecting a 1-point change in growth to change value by about 1%.' },
    { id: 'ma-d03', skill: 'portfolio_risk', difficulty: 4, qtype: 'numeric', critical: true, stem: 'Two assets each have 20% annual volatility and zero correlation. In an equal-weight portfolio, what is the portfolio volatility, in percent?', correct: { value: 14.14, abs_tol: 0.05, unit: '%' }, explanation: 'σ = √(0.5² × 0.2² + 0.5² × 0.2²) = √0.02 ≈ 14.14%.', misconception: 'Averaging volatilities (20%) and ignoring correlation.' },
    { id: 'ma-d04', skill: 'model_validation', difficulty: 3, qtype: 'single_choice', critical: true, stem: 'A strategy has an in-sample Sharpe ratio of 2.1 and an out-of-sample Sharpe of 0.3. What is the most reasonable conclusion?', options: ['The in-sample result is probably over-fitted or regime-specific', 'Out-of-sample periods are usually unlucky; trust the 2.1', 'Average them to get 1.2', 'The strategy is proven'], correct: { index: 0 }, explanation: 'A large drop out of sample is the classic sign of over-fitting.', misconception: 'Trusting in-sample performance.' },
    { id: 'ma-d05', skill: 'model_validation', difficulty: 3, qtype: 'numeric', stem: 'You test 100 independent strategies that truly have no edge, each at a 5% significance level. How many would you expect to look "significant" by chance?', correct: { value: 5, abs_tol: 0.01 }, explanation: '100 × 0.05 = 5 false positives on average.', misconception: 'Ignoring multiple testing.' },
    { id: 'ma-d06', skill: 'dcf', difficulty: 3, qtype: 'numeric', stem: 'Cost of equity is 14%, after-tax cost of debt 7%, and the capital mix is 70% equity and 30% debt. What is the WACC, in percent?', correct: { value: 11.9, abs_tol: 0.05, unit: '%' }, explanation: '0.7 × 14 + 0.3 × 7 = 9.8 + 2.1 = 11.9%.', misconception: 'Using pre-tax cost of debt or a simple average.' },
    { id: 'ma-d07', skill: 'research_limits', difficulty: 3, qtype: 'single_choice', stem: 'A backtest uses financial statements as later restated rather than as first reported. The main risk is:', options: ['Look-ahead bias', 'Survivorship bias', 'Higher trading costs', 'No risk; restated numbers are more accurate'], correct: { index: 0 }, explanation: 'Investors at the time saw the original figures. Point-in-time data avoid using information that did not yet exist.', misconception: 'More accurate data are always better for testing.' },
    { id: 'ma-d08', skill: 'portfolio_risk', difficulty: 3, qtype: 'single_choice', stem: 'A one-day 95% Value-at-Risk of ₹10 lakh means, under the model:', options: ['On about 95% of days the loss should not exceed ₹10 lakh', 'The maximum possible loss is ₹10 lakh', 'You lose exactly ₹10 lakh on 5% of days', 'Losses above ₹10 lakh are impossible'], correct: { index: 0 }, explanation: 'VaR is a threshold, not a maximum; losses on the worst 5% of days can be much larger.', misconception: 'Reading VaR as the worst case.' },
    { id: 'ma-d09', skill: 'valuation', difficulty: 3, qtype: 'single_choice', stem: 'Why is EV/EBITDA often preferred to P/E when comparing companies with very different debt levels?', options: ['It values the whole firm before interest, so it is less affected by capital structure', 'It always gives a lower number', 'It ignores debt entirely', 'It uses cash flow after capital spending'], correct: { index: 0 }, explanation: 'EV includes debt holders\' claim and EBITDA is before interest, reducing distortion from leverage.', misconception: 'Believing EV/EBITDA ignores debt.' },
    { id: 'ma-d10', skill: 'research_limits', difficulty: 4, qtype: 'numeric', stem: 'A strategy earns 12% a year before costs. Each year you trade shares worth 4 times the portfolio value (buys plus sells), and costs are 0.3% of the value traded. What is the return after costs, in percent?', correct: { value: 10.8, abs_tol: 0.05, unit: '%' }, explanation: 'Costs = 4 × 0.3% = 1.2% of the portfolio. 12 − 1.2 = 10.8%.', misconception: 'Ignoring turnover when estimating costs.' },
    { id: 'ma-d11', skill: 'research_limits', difficulty: 2, qtype: 'single_choice', stem: 'A small-company strategy is compared with a large-company index. What is the problem?', options: ['Benchmark mismatch: compare with a small-company index', 'None; any index will do', 'Large-company indices always rise faster', 'Small companies cannot be benchmarked'], correct: { index: 0 }, explanation: 'A fair benchmark has similar risk and universe; otherwise outperformance may only reflect size exposure.', misconception: 'Any benchmark is fine.' },
    { id: 'ma-d12', skill: 'portfolio_risk', difficulty: 2, qtype: 'numeric', stem: 'After a 50% loss, what return is needed to recover to the previous peak, in percent?', correct: { value: 100, abs_tol: 0.05, unit: '%' }, explanation: 'Half the money must double: +100%.', misconception: 'Assuming +50% recovers a 50% loss.' },
  ],
};

// Digital-assets track (ATLAS Digital Assets). Imported at the end: the content modules import types from here.
import { CRYPTO_DECODER } from './content/crypto-decoder.js';
import { ASSET_ARCHITECT, ONCHAIN_ENGINEER, TOKENOMICS_DETECTIVE } from './content/crypto-advanced.js';

export const CURRICULUM: SourceCourse[] = [marketDecoder, equityDetective, signalEngineer, marketArchitect, CRYPTO_DECODER, TOKENOMICS_DETECTIVE, ONCHAIN_ENGINEER, ASSET_ARCHITECT];

/** Learning tracks: the four equity courses and the four digital-asset courses. Level is the position within the track. */
export const DIGITAL_ASSET_COURSES = new Set(['crypto-decoder', 'tokenomics-detective', 'onchain-engineer', 'asset-architect']);
export function courseTrack(courseId: string): { track: 'equities' | 'digital_assets'; level: number } {
  const ids = CURRICULUM.filter((c) => DIGITAL_ASSET_COURSES.has(c.id) === DIGITAL_ASSET_COURSES.has(courseId)).map((c) => c.id);
  return { track: DIGITAL_ASSET_COURSES.has(courseId) ? 'digital_assets' : 'equities', level: ids.indexOf(courseId) + 1 };
}
