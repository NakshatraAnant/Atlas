// ATLAS Academy video scripts. Each scene's narration is spoken by a local, offline voice and also
// becomes its captions and transcript; its visual is drawn by scripts/video/engine.js. Every number is
// a definition or a clearly labelled hypothetical / fictional example, checked against
// packages/shared (three-statements.ts, learning-sims-courses.ts). Status: in review, like all
// Academy content.

export type Visual =
  | { type: 'title'; course: string; title: string; subtitle: string }
  | { type: 'bullets'; heading: string; items: string[]; note?: string }
  | { type: 'flow'; heading: string; nodes: string[]; note?: string }
  | { type: 'compare'; heading: string; left: { title: string; points: string[] }; right: { title: string; points: string[] }; note?: string }
  | { type: 'bars'; heading: string; items: { label: string; value: number }[]; unit: string; decimals?: number; note?: string }
  | { type: 'waterfall'; heading: string; steps: { label: string; value: number; total?: boolean }[]; unit: string; note?: string }
  | { type: 'line'; heading: string; points: { label: string; value: number }[]; unit: string; note?: string }
  | { type: 'end'; heading: string; takeaway: string; note: string };

export interface Scene { narration: string; visual: Visual }
export interface VideoScript { id: string; course_id: string; lesson_id: string; title: string; objective: string; accent: string; scenes: Scene[] }

const EDU = 'Education, not investment advice.';

export const VIDEO_SCRIPTS: VideoScript[] = [
  {
    id: 'md-intro', course_id: 'market-decoder', lesson_id: 'md-l1', accent: '#7fb2ec',
    title: 'How the Indian share market works',
    objective: 'Explain what a share is, how a trade settles in India, and why a share price and the business behind it are different things.',
    scenes: [
      { narration: 'Welcome to Market Decoder. In the next two minutes you will see what a share is, how a trade happens in India, and why a share price and a business are not the same thing.', visual: { type: 'title', course: 'ATLAS: MARKET DECODER', title: 'How the Indian share market works', subtitle: 'What you own, how a trade settles, and why price is not the business' } },
      { narration: 'A share is a small piece of ownership in a company. If a company has one crore shares and you own one thousand, you own one hundredth of one percent of it. You share in what the business earns and what it is worth, for better or worse.', visual: { type: 'bullets', heading: 'A share is a slice of a business', items: ['1,000 shares of 1,00,00,000 = 0.01% ownership', 'You share in profits and in value', 'Nothing about the return is fixed or promised'], note: 'Hypothetical numbers' } },
      { narration: 'In India you place an order through a registered broker. The exchange, NSE or BSE, matches it with an opposite order. A clearing corporation guarantees that both sides settle, and the shares arrive in your demat account at a depository, NSDL or CDSL, one working day later. This is called T plus one settlement.', visual: { type: 'flow', heading: 'From order to demat account', nodes: ['Broker', 'Exchange (NSE or BSE)', 'Clearing corporation', 'Depository (NSDL or CDSL)'], note: 'Indian equities settle T+1: one working day after the trade' } },
      { narration: 'A share price is what buyers and sellers agree at a moment in time. The business underneath is described by its revenue, profit, cash flow and debt, which are reported every quarter. The two can move apart for long periods, which is why ATLAS shows both, with the date of every number.', visual: { type: 'compare', heading: 'Price is not the business', left: { title: 'Share price', points: ['Set by trading, every session', 'Reflects expectations and mood', 'Can move far in a day'] }, right: { title: 'The business', points: ['Revenue, profit, cash flow, debt', 'Reported quarterly and annually', 'Changes more slowly'] } } },
      { narration: 'Prices also move in ways that are easy to misread. If a share rises twenty percent and then falls twenty percent, you do not get back to where you started. One hundred rupees becomes one hundred and twenty, then ninety-six. Returns compound; they do not simply add up.', visual: { type: 'line', heading: '+20% then −20% is not zero', points: [{ label: 'Start', value: 100 }, { label: 'After +20%', value: 120 }, { label: 'After −20%', value: 96 }], unit: '₹', note: 'Hypothetical: 100 × 1.20 × 0.80 = 96' } },
      { narration: 'A structured research routine helps. Identify the security precisely, by its symbol and ISIN. Read the latest results. Check the date and source of every figure. And write down what evidence would change your mind.', visual: { type: 'bullets', heading: 'A research routine', items: ['Identify the security: symbol and ISIN', 'Read the latest results', 'Check the date and source of every figure', 'Write down what would change your mind'] } },
      { narration: 'Market Decoder takes you through each of these steps with exercises and quizzes. This course is education, not investment advice.', visual: { type: 'end', heading: 'Key takeaway', takeaway: 'Shares are ownership. Prices are agreements. Research is evidence.', note: EDU } },
    ],
  },
  {
    id: 'ed-intro', course_id: 'equity-detective', lesson_id: 'ed-l1', accent: '#5fd0d8',
    title: 'A company-analysis workflow',
    objective: 'Follow profit, cash and the balance sheet of a company as one consistent story, and turn ratios into questions.',
    scenes: [
      { narration: 'Equity Detective teaches a practical workflow for reading a company from its financial statements. Here is the workflow in brief, using a fictional company.', visual: { type: 'title', course: 'ATLAS: EQUITY DETECTIVE', title: 'A company-analysis workflow', subtitle: 'Profit, cash and the balance sheet as one story' } },
      { narration: 'Start with the profit and loss statement. Our fictional company has revenue of one thousand crore. After operating costs, EBITDA is one hundred and eighty crore. Subtract depreciation, interest and tax, and net profit is about seventy crore.', visual: { type: 'waterfall', heading: 'Profit and loss (₹ crore)', unit: '₹ cr', steps: [{ label: 'Revenue', value: 1000, total: true }, { label: 'Operating costs', value: -820 }, { label: 'EBITDA', value: 180, total: true }, { label: 'Depreciation', value: -60 }, { label: 'Interest', value: -27 }, { label: 'Tax', value: -23.25 }, { label: 'Net profit', value: 69.75, total: true }], note: 'Fictional company' } },
      { narration: 'Next, follow the cash. Operating cash flow adds back depreciation, which used no cash this year, and subtracts money tied up in working capital. That gives about one hundred crore. After eighty crore of capital expenditure, free cash flow is under twenty crore.', visual: { type: 'waterfall', heading: 'From profit to free cash flow (₹ crore)', unit: '₹ cr', steps: [{ label: 'Net profit', value: 69.75, total: true }, { label: '+ Depreciation', value: 60 }, { label: '− Working capital', value: -30 }, { label: 'Operating cash flow', value: 99.75, total: true }, { label: '− Capex', value: -80 }, { label: 'Free cash flow', value: 19.75, total: true }], note: 'Fictional company' } },
      { narration: 'Then the balance sheet. Assets always equal liabilities plus equity. Profit that is not paid out as dividends is added to equity, and the cash-flow statement explains every rupee of change in cash.', visual: { type: 'compare', heading: 'The balance sheet always balances', left: { title: 'Assets: ₹900 cr', points: ['Cash 120', 'Fixed assets 600', 'Working capital 180'] }, right: { title: 'Liabilities + equity: ₹900 cr', points: ['Debt 300', 'Equity 600', 'Retained profit adds to equity'] }, note: 'Fictional company, opening balance sheet' } },
      { narration: 'Ratios turn these numbers into questions. An EBITDA margin of eighteen percent, cash conversion of about one hundred and forty-three percent, and debt of half the equity. Each ratio is a prompt to investigate, not a verdict.', visual: { type: 'bars', heading: 'Ratios as questions', unit: '%', decimals: 0, items: [{ label: 'EBITDA margin', value: 18 }, { label: 'Cash conversion (OCF ÷ profit)', value: 143 }, { label: 'Debt ÷ equity', value: 50 }], note: 'Fictional company' } },
      { narration: 'Ask whether profit is turning into cash, what drives growth, how much debt there is and at what cost, and how the company compares with its peers.', visual: { type: 'bullets', heading: 'Questions to ask', items: ['Is profit turning into cash?', 'What drives revenue growth?', 'How much debt, and at what cost?', 'How does it compare with peers?'] } },
      { narration: 'In the course you will practise this with interactive labs, including a three-dimensional model of the three statements, and finish with an evidence-backed research report. This is education, not investment advice.', visual: { type: 'end', heading: 'Key takeaway', takeaway: 'Profit, cash and the balance sheet must tell one consistent story.', note: EDU } },
    ],
  },
  {
    id: 'se-intro', course_id: 'signal-engineer', lesson_id: 'se-l1', accent: '#c3a3ef',
    title: 'Testing ideas without fooling yourself',
    objective: 'Describe what a fair historical test needs, and recognise look-ahead bias, survivorship bias, overfitting and multiple testing.',
    scenes: [
      { narration: 'Signal Engineer is about testing ideas with historical data, and about the ways that testing can fool you.', visual: { type: 'title', course: 'ATLAS: SIGNAL ENGINEER', title: 'Testing ideas without fooling yourself', subtitle: 'Data, returns, bias and fair tests' } },
      { narration: 'Quantitative research starts with clean data: prices adjusted for splits and bonuses, correct dates, and a clear definition of every return. A daily return is today’s close divided by yesterday’s close, minus one.', visual: { type: 'line', heading: 'A daily return uses closing prices', points: [{ label: 'Day 1', value: 200 }, { label: 'Day 2', value: 206 }, { label: 'Day 3', value: 201.85 }], unit: '₹', note: 'Hypothetical: 206 ÷ 200 − 1 = 3.00%; 201.85 ÷ 206 − 1 = −2.01%' } },
      { narration: 'Three traps catch most first attempts. Look-ahead bias uses information that was not available on the date of the decision. Survivorship bias tests only companies that still exist today. And overfitting tunes the rules until history looks perfect.', visual: { type: 'bullets', heading: 'Three common traps', items: ['Look-ahead bias: using information not yet available', 'Survivorship bias: testing only today’s survivors', 'Overfitting: tuning rules until history looks perfect'] } },
      { narration: 'Test enough random ideas and some will look good by chance. At a five percent significance level, the chance that at least one of twenty unrelated tests looks significant is about sixty-four percent.', visual: { type: 'bars', heading: 'Chance of at least one false positive', unit: '%', decimals: 1, items: [{ label: '1 test', value: 5 }, { label: '5 tests', value: 22.6 }, { label: '10 tests', value: 40.1 }, { label: '20 tests', value: 64.2 }], note: '1 − 0.95ⁿ, for unrelated tests at the 5% level' } },
      { narration: 'So design the test before you look. Keep data that the rules never saw, include transaction costs, and compare with a fair benchmark.', visual: { type: 'compare', heading: 'A fair test', left: { title: 'In-sample', points: ['Where the rules are designed', 'Always looks better than reality'] }, right: { title: 'Out-of-sample', points: ['Data the rules never saw', 'With costs and a fair benchmark'] } } },
      { narration: 'In the course you will measure returns, volatility and drawdowns, design out-of-sample tests in the Quant Lab, and learn to report results honestly. A backtest describes the past under stated assumptions. It is not a forecast, and this course is not investment advice.', visual: { type: 'end', heading: 'Key takeaway', takeaway: 'A backtest describes the past under stated assumptions; it is not a forecast.', note: EDU } },
    ],
  },
  {
    id: 'ma-intro', course_id: 'market-architect', lesson_id: 'ma-l1', accent: '#e8b06a',
    title: 'Building a research view you can defend',
    objective: 'Combine evidence, a valuation range, risks and a monitoring plan into one research view, and state what would prove it wrong.',
    scenes: [
      { narration: 'Market Architect brings everything together: evidence, valuation, risk and clear communication, into a research view you can defend.', visual: { type: 'title', course: 'ATLAS: MARKET ARCHITECT', title: 'Building a research view you can defend', subtitle: 'Evidence, valuation ranges, risk and monitoring' } },
      { narration: 'Start with a precise question. Gather evidence. Turn it into a range of values, not a single number. Weigh the risks. And state your conclusion together with what you will monitor.', visual: { type: 'flow', heading: 'A research process', nodes: ['Question', 'Evidence', 'Valuation range', 'Risks', 'Conclusion and monitoring'] } },
      { narration: 'A valuation depends on its assumptions. For a fictional company with next year’s free cash flow of one hundred crore, growing at four percent a year forever, the value is about one thousand six hundred and sixty-seven crore at a ten percent discount rate, one thousand two hundred and fifty at twelve percent, and one thousand at fourteen.', visual: { type: 'bars', heading: 'Value depends on the discount rate (₹ crore)', unit: '₹ cr', decimals: 0, items: [{ label: '10% discount rate', value: 1666.67 }, { label: '12%', value: 1250 }, { label: '14%', value: 1000 }], note: 'Fictional: value = 100 ÷ (r − 4%)' } },
      { narration: 'Write the thesis, the strongest counter-thesis, and the specific evidence that would invalidate your view. Then decide in advance what you will monitor.', visual: { type: 'bullets', heading: 'Thesis and counter-thesis', items: ['Thesis: what you believe and why', 'Counter-thesis: the strongest case against it', 'Invalidation: evidence that would prove it wrong', 'Monitoring: what you will check, and when'] } },
      { narration: 'Risk also lives at the portfolio level. With thirty percent volatility per share and an average correlation of zero point three, spreading across twenty shares cuts volatility to about seventeen percent, but never below about sixteen. Correlation sets a floor.', visual: { type: 'bars', heading: 'Equal-weight portfolio volatility', unit: '%', decimals: 1, items: [{ label: '1 share', value: 30 }, { label: '5 shares', value: 19.9 }, { label: '20 shares', value: 17.4 }, { label: 'Many shares (limit)', value: 16.4 }], note: 'Hypothetical: σ = 30% each, average correlation 0.3' } },
      { narration: 'In the course you will build and stress-test a discounted cash-flow model, measure portfolio risk, validate models, and present an integrated research dossier. A defensible view states its assumptions, its range, and what would prove it wrong. This is education, not investment advice.', visual: { type: 'end', heading: 'Key takeaway', takeaway: 'A defensible view states its assumptions, its range and what would prove it wrong.', note: EDU } },
    ],
  },
];
