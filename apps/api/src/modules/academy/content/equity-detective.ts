import type { SourceLesson } from '../curriculum.js';

// EQUITY DETECTIVE, modules 1–4. Original text; numbers match packages/shared learning-sims tests.
// Status: in_review (AI-assisted draft) until a named reviewer completes the seven-point review.

const SEBI = { title: 'SEBI (Listing Obligations and Disclosure Requirements) Regulations', url: 'https://www.sebi.gov.in/', note: 'Sets when and how listed companies publish results in India; check the current regulation text.' };
const INDAS = { title: 'Indian Accounting Standards (Ind AS), Ministry of Corporate Affairs', url: 'https://www.mca.gov.in/', note: 'Primary source for the accounting standards behind Indian financial statements.' };
const METH = { title: 'ATLAS methodology: metric definitions', url: '/methodology', note: 'Exact formulas, inputs and edge rules ATLAS uses for every ratio.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

export const ED_MODULE_1: SourceLesson[] = [
  {
    id: 'ed-l1', title: 'Reading the profit and loss statement', minutes: 15, objectives: ['ed-o1'], mastery_rule: RULE('ed-o1'), references: [INDAS, SEBI, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'From revenue to profit', body: [
        'The profit and loss statement (P&L) covers a period, such as a quarter or a financial year ending 31 March. It starts with revenue and subtracts costs in layers.',
        'Each layer answers a different question: EBITDA (is the core business earning?), EBIT (after the wear of assets), profit before tax (after financing costs) and net profit (what belongs to shareholders after tax).',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Find the layers in a real ATLAS profile', href: '/app/companies', steps: [
        'Open any covered company and go to Financials.',
        'Switch between Quarterly and Annual, and between Consolidated and Standalone; note the basis label on every figure.',
        'Find revenue, operating profit (EBITDA), depreciation, finance costs, profit before tax and net profit.',
        'Click a value to see where it came from and when it was filed. Development data is synthetic and labelled.',
      ], alt_text: 'A guided exercise in the ATLAS company Financials tab; all steps are described in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Revenue is ₹1,000 crore and operating expenses excluding depreciation are ₹750 crore. What is EBITDA?', options: ['₹1,750 crore', '₹250 crore', '₹750 crore'], answer: 1, reveal: 'EBITDA = 1,000 − 750 = ₹250 crore, before depreciation, interest and tax.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Walking down the P&L (₹ crore)', steps: [
        'Revenue 1,000 − operating expenses 750 = EBITDA 250.',
        'EBITDA 250 − depreciation and amortisation 50 = EBIT 200.',
        'EBIT 200 − finance costs 20 = profit before tax 180.',
        'Tax at 25% = 45, so net profit = 135.',
        'Margins: EBITDA 25%, EBIT 20%, net 13.5%.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Revenue ₹600 crore, operating expenses ₹480 crore, depreciation ₹30 crore. What is EBIT and the EBIT margin?', hint: 'EBIT = revenue − operating expenses − depreciation.', answer_text: 'EBIT = 600 − 480 − 30 = ₹90 crore; margin = 90 ÷ 600 = 15%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why compare EBIT margins rather than net margins across companies with very different debt levels?', model_answer: 'EBIT is before interest, so it compares operating performance without the effect of how each company is financed.' },
      { stage: 'review', kind: 'summary', points: ['The P&L covers a period and steps from revenue to net profit.', 'Each layer isolates a different effect: operations, asset wear, financing, tax.', 'Never mix consolidated and standalone figures, or quarterly and annual periods.'] },
    ],
    quiz: [
      { id: 'ed-q1-1', objective: 'ed-o1', skill: 'statements', difficulty: 2, qtype: 'numeric', stem: 'Revenue ₹1,000 crore, operating expenses (excluding depreciation) ₹750 crore, depreciation ₹50 crore. What is EBIT, in ₹ crore?', correct: { value: 200, abs_tol: 0.5, unit: '₹ crore' }, explanation: '1,000 − 750 − 50 = ₹200 crore.', misconception: 'Forgetting to subtract depreciation.' },
      { id: 'ed-q1-2', objective: 'ed-o1', skill: 'statements', difficulty: 2, qtype: 'numeric', stem: 'EBIT is ₹200 crore, finance costs ₹20 crore and the tax rate 25%. What is net profit, in ₹ crore?', correct: { value: 135, abs_tol: 0.5, unit: '₹ crore' }, explanation: 'PBT = 180; tax = 45; net profit = ₹135 crore.', misconception: 'Applying tax before deducting interest.' },
      { id: 'ed-q1-3', objective: 'ed-o1', skill: 'statements', difficulty: 1, qtype: 'single_choice', stem: 'Which line reflects how a company is financed rather than how its operations perform?', options: ['Revenue', 'Depreciation', 'Finance costs (interest)', 'Raw material costs'], correct: { index: 2 }, explanation: 'Interest depends on borrowing, a financing choice.', misconception: 'Treating interest as an operating cost.' },
    ],
  },
  {
    id: 'ed-l2', title: 'The balance sheet and how the statements connect', minutes: 15, objectives: ['ed-o1'], prerequisites: ['ed-l1'], mastery_rule: RULE('ed-o1'), references: [INDAS, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'A snapshot that must balance', body: [
        'The balance sheet is a snapshot at one date: what the company owns (assets) and how they are funded (liabilities and equity). Assets = liabilities + equity, always.',
        'The statements connect: net profit not paid out as dividends adds to retained earnings in equity, and the cash-flow statement explains how cash moved from the opening to the closing balance sheet.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Three statements in motion', widget: 'statements_3d', intro: 'Change revenue, margin, capex, working capital, dividends and borrowing for a fictional company. Watch profit flow into operating cash, cash flow into the closing cash balance, and retained profit into equity, while assets keep equalling liabilities plus equity. Pick a link to highlight it.', alt_text: 'A 3D scene with three panels of bars (profit and loss, cash flow and closing balance sheet) for a fictional company; exact figures are in three tables below the scene.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Opening equity is ₹500 crore, net profit ₹135 crore and dividends ₹35 crore, with no other changes. What is closing equity?', options: ['₹635 crore', '₹600 crore', '₹535 crore'], answer: 1, reveal: '500 + 135 − 35 = ₹600 crore: retained profit links the P&L to the balance sheet.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Three statements, one story', steps: [
        'P&L: net profit ₹135 crore.',
        'Balance sheet: equity rises by 135 − dividends 35 = ₹100 crore.',
        'Cash flow: operating cash flow starts from profit, adds back non-cash depreciation and adjusts for working capital; investing covers capital expenditure; financing covers dividends, borrowing and repayments.',
        'Opening cash + net change in cash = closing cash on the balance sheet.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Total assets are ₹2,000 crore and liabilities ₹1,200 crore. What is equity?', hint: 'Rearrange assets = liabilities + equity.', answer_text: 'Equity = 2,000 − 1,200 = ₹800 crore.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can a profitable company still run out of cash?', model_answer: 'Profit is recorded when earned, but cash may be tied up in unpaid customer bills, inventory or capital spending, or used for debt repayment.' },
      { stage: 'review', kind: 'summary', points: ['Assets = liabilities + equity at every balance-sheet date.', 'Retained profit links the P&L to equity.', 'The cash-flow statement reconciles opening and closing cash.'] },
    ],
    quiz: [
      { id: 'ed-q2-1', objective: 'ed-o1', skill: 'statements', difficulty: 2, qtype: 'numeric', stem: 'Opening equity ₹500 crore, net profit ₹135 crore, dividends paid ₹35 crore, no other changes. What is closing equity, in ₹ crore?', correct: { value: 600, abs_tol: 0.5, unit: '₹ crore' }, explanation: '500 + 135 − 35 = ₹600 crore.', misconception: 'Adding dividends instead of subtracting them.' },
      { id: 'ed-q2-2', objective: 'ed-o1', skill: 'statements', difficulty: 1, qtype: 'single_choice', stem: 'Which identity always holds on a balance sheet?', options: ['Revenue = expenses + profit', 'Assets = liabilities + equity', 'Cash = profit', 'Equity = market capitalisation'], correct: { index: 1 }, explanation: 'Everything a company owns is funded by liabilities or equity.', misconception: 'Confusing book equity with market value.' },
      { id: 'ed-q2-3', objective: 'ed-o1', skill: 'statements', difficulty: 2, qtype: 'single_choice', stem: 'Which statement explains how cash moved between two balance-sheet dates?', options: ['The profit and loss statement', 'The cash-flow statement', 'The directors\' report', 'The shareholding pattern'], correct: { index: 1 }, explanation: 'It splits the change in cash into operating, investing and financing flows.', misconception: 'Assuming profit equals the change in cash.' },
    ],
  },
];

export const ED_MODULE_2: SourceLesson[] = [
  {
    id: 'ed-l3', title: 'Working capital and cash conversion', minutes: 16, objectives: ['ed-o2'], prerequisites: ['ed-l2'], mastery_rule: RULE('ed-o2'), references: [INDAS, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Where profit goes before it becomes cash', body: [
        'Working capital is money tied up in running the business: customers who have not paid yet (receivables) and stock on shelves (inventory), partly funded by suppliers not yet paid (payables).',
        'When receivables and inventory grow faster than payables, cash is absorbed: operating cash flow falls below profit. Cash conversion = operating cash flow ÷ net profit.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'The profit-to-cash bridge', widget: 'statement_flow', intro: 'Start with profit 100 and depreciation 20, then increase receivables by 60, inventory by 30 and payables by 10.', alt_text: 'A bridge chart from net profit to operating cash flow, with each working-capital change as a step; values are listed in a table.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Profit 100, depreciation 20, receivables +60, inventory +30, payables +10. Is operating cash flow above or below profit?', options: ['Above', 'Below', 'Equal'], answer: 1, reveal: 'Working capital absorbed 60 + 30 − 10 = 80, so OCF = 100 + 20 − 80 = 40: cash conversion of 40%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'One year of a fast-growing distributor (₹ crore)', steps: [
        'Net profit 100; add back depreciation 20 (a non-cash cost).',
        'Receivables rose 60 and inventory 30: cash not yet collected or sitting in stock.',
        'Payables rose 10: suppliers funded part of the growth.',
        'OCF = 100 + 20 − (60 + 30 − 10) = 40. Cash conversion = 40 ÷ 100 = 40%.',
        'One year like this can be normal for a growing business; several years in a row deserves investigation.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Profit 200, depreciation 30, receivables +50, inventory +20, payables +15. What are OCF and cash conversion?', hint: 'Working-capital increase = 50 + 20 − 15.', answer_text: 'OCF = 200 + 30 − 55 = 175; conversion = 175 ÷ 200 = 87.5%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'What would you check if receivable days kept rising for three years while revenue grew steadily?', model_answer: 'Whether customers are paying more slowly, credit terms were loosened to drive sales, or revenue recognition is aggressive; read notes and announcements and compare with peers.' },
      { stage: 'review', kind: 'summary', points: ['Working capital = receivables + inventory − payables (simplified).', 'Growing working capital absorbs cash: OCF < profit.', 'Persistent low cash conversion is a question to investigate, not a verdict.'] },
    ],
    quiz: [
      { id: 'ed-q3-1', objective: 'ed-o2', skill: 'profit_vs_cash', difficulty: 3, qtype: 'numeric', stem: 'Net profit ₹200 crore, depreciation ₹30 crore, receivables up ₹50 crore, inventory up ₹20 crore, payables up ₹15 crore. What is operating cash flow, in ₹ crore?', correct: { value: 175, abs_tol: 0.5, unit: '₹ crore' }, explanation: '200 + 30 − (50 + 20 − 15) = ₹175 crore.', misconception: 'Adding the increase in receivables instead of subtracting it.' },
      { id: 'ed-q3-2', objective: 'ed-o2', skill: 'profit_vs_cash', difficulty: 2, qtype: 'numeric', stem: 'Operating cash flow is ₹175 crore and net profit ₹200 crore. What is cash conversion, in percent?', correct: { value: 87.5, abs_tol: 0.05, unit: '%' }, explanation: '175 ÷ 200 = 87.5%.', misconception: 'Dividing profit by cash flow.' },
      { id: 'ed-q3-3', objective: 'ed-o2', skill: 'profit_vs_cash', difficulty: 2, qtype: 'single_choice', stem: 'Receivables grow much faster than revenue for several years. What is the most appropriate first step?', options: ['Conclude the company is committing fraud', 'Investigate collection periods, credit terms and revenue recognition', 'Ignore it because profit is rising', 'Assume the auditor has checked it, so nothing more is needed'], correct: { index: 1 }, explanation: 'It is a reason to investigate, not proof of wrongdoing.', misconception: 'Jumping from a warning sign to a conclusion.' },
    ],
  },
  {
    id: 'ed-l4', title: 'Financial quality flags', minutes: 14, objectives: ['ed-o6'], prerequisites: ['ed-l3'], mastery_rule: RULE('ed-o6'), references: [SEBI, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Signals that deserve a closer look', body: [
        'Some patterns are worth investigating: profit without matching cash for several years, frequent auditor changes, qualified audit opinions, rising pledges of promoter shares, or large restatements of past results.',
        'A flag is a question, not a verdict. ATLAS shows each flag with the rule that triggered it and the filings behind it.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Open the quality flags for a company', href: '/app/companies', steps: [
        'Open a covered company and find its financial quality flags.',
        'For any flag, read the rule (for example, "any disclosure in the last 3 years") and open the evidence.',
        'Check whether a restated period shows both the original and the restated value.',
        'Write one question you would ask management about the flag.',
      ], alt_text: 'A guided exercise in the ATLAS company quality-flags section; all steps are described in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A company changed auditors twice in three years. What does this tell you on its own?', options: ['The accounts are wrong', 'Something worth investigating; there may be a benign reason', 'Nothing at all'], answer: 1, reveal: 'Auditor changes have many causes (mandatory rotation, fees, group restructuring). Read the disclosed reasons before drawing conclusions.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Reading a flag properly', steps: [
        'Flag: cash conversion below 50% for three consecutive years.',
        'Evidence: OCF and net profit for each year, with filing dates.',
        'Context: is the company growing fast (working capital builds up) or is collection slowing?',
        'Next step: compare receivable days with peers, and read the notes on revenue recognition.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A promoter has pledged 45% of their holding, up from 10% two years ago. Why might that matter to minority shareholders?', hint: 'Think about what lenders can do if the share price falls.', answer_text: 'If the price falls, lenders may sell pledged shares, which can push the price lower and change control. It is a risk to understand, not a prediction.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why should a quality flag never be presented as proof of wrongdoing?', model_answer: 'Flags are rule-based patterns with possible benign explanations; conclusions need evidence, context and often information that is not public.' },
      { stage: 'review', kind: 'summary', points: ['Flags point to questions, with the rule and evidence shown.', 'Common flags: weak cash conversion, auditor changes, qualifications, pledges, restatements.', 'Investigate context before drawing conclusions.'] },
    ],
    quiz: [
      { id: 'ed-q4-1', objective: 'ed-o6', skill: 'quality', difficulty: 2, qtype: 'multi_select', stem: 'Which are reasonable financial quality flags? Select all that apply.', options: ['Operating cash flow far below profit for several years', 'A rising share of promoter shares pledged', 'Frequent auditor changes', 'Paying a regular dividend'], correct: { indexes: [0, 1, 2] }, explanation: 'Paying dividends is not, by itself, a warning sign.', misconception: 'Treating any distribution as a red flag.' },
      { id: 'ed-q4-2', objective: 'ed-o6', skill: 'quality', difficulty: 1, qtype: 'single_choice', stem: 'A quality flag appears on a company. The best interpretation is:', options: ['Proof of fraud', 'A rule-based prompt to investigate further', 'A sell recommendation', 'Irrelevant if the share price is rising'], correct: { index: 1 }, explanation: 'Flags identify patterns worth examining; they are not verdicts or advice.', misconception: 'Equating a flag with a conclusion.' },
      { id: 'ed-q4-3', objective: 'ed-o6', skill: 'quality', difficulty: 2, qtype: 'single_choice', stem: 'A past year\'s results were restated. Why does ATLAS keep the originally reported figures?', options: ['To hide the correction', 'So analysis and backtests can use what investors actually knew at the time', 'Because restatements are always wrong', 'To save storage'], correct: { index: 1 }, explanation: 'Point-in-time data avoids using information that did not exist yet (look-ahead bias).', misconception: 'Assuming the latest figures are always the right ones to use historically.' },
    ],
  },
];

export const ED_MODULE_3: SourceLesson[] = [
  {
    id: 'ed-l5', title: 'Margins and DuPont ROE', minutes: 16, objectives: ['ed-o3'], prerequisites: ['ed-l1'], mastery_rule: RULE('ed-o3'), references: [METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Three levers behind return on equity', body: [
        'Return on equity (ROE) = net profit ÷ shareholders\' equity. The DuPont identity splits it into three levers: net margin (profit per rupee of sales) × asset turnover (sales per rupee of assets) × equity multiplier (assets per rupee of equity).',
        'Two companies with the same ROE can be very different businesses: one with high margins, another with fast turnover, a third with heavy borrowing.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Pull the DuPont levers', widget: 'dupont', intro: 'Change revenue, profit, assets and equity. The three levers multiply to the same ROE as profit ÷ equity.', alt_text: 'Three bars show net margin, asset turnover and equity multiplier, with their product and the directly computed ROE written below.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Net margin 10%, asset turnover 1.5 and equity multiplier 2. What is ROE?', options: ['13.5%', '30%', '3%'], answer: 1, reveal: '10% × 1.5 × 2 = 30%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Two businesses, same ROE (₹ crore)', steps: [
        'Retailer: revenue 2,000, profit 60, assets 1,000, equity 400 → margin 3% × turnover 2.0 × multiplier 2.5 = 15%.',
        'Software firm: revenue 500, profit 75, assets 600, equity 500 → margin 15% × turnover 0.83 × multiplier 1.2 = 15%.',
        'Same ROE, different risks: the retailer relies on volume and borrowing; the software firm on margin.',
        'Always check that numerator and denominator use the same period and the same basis.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Revenue 2,000, net profit 160, assets 1,600, equity 800. Compute the three levers and ROE.', hint: 'Margin = 160 ÷ 2,000; turnover = 2,000 ÷ 1,600; multiplier = 1,600 ÷ 800.', answer_text: '8% × 1.25 × 2 = 20%, matching 160 ÷ 800.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is an ROE driven mainly by the equity multiplier riskier than one driven by margin?', model_answer: 'A high multiplier means more borrowing; debt adds fixed obligations that magnify losses when profits fall.' },
      { stage: 'review', kind: 'summary', points: ['ROE = margin × turnover × equity multiplier.', 'Same ROE can hide very different business models and risks.', 'Use matching periods and bases for every input.'] },
    ],
    quiz: [
      { id: 'ed-q5-1', objective: 'ed-o3', skill: 'ratios', difficulty: 3, qtype: 'numeric', stem: 'Revenue ₹2,000 crore, net profit ₹160 crore, assets ₹1,600 crore, equity ₹800 crore. What is ROE, in percent?', correct: { value: 20, abs_tol: 0.05, unit: '%' }, explanation: '8% × 1.25 × 2 = 20% (= 160 ÷ 800).', misconception: 'Dividing profit by assets (that is return on assets).' },
      { id: 'ed-q5-2', objective: 'ed-o3', skill: 'ratios', difficulty: 2, qtype: 'single_choice', stem: 'Which DuPont lever adds the most financial risk when it is high?', options: ['Net margin', 'Asset turnover', 'Equity multiplier (leverage)', 'None of them'], correct: { index: 2 }, explanation: 'A high equity multiplier means more debt funding the assets.', misconception: 'Assuming all routes to ROE carry the same risk.' },
      { id: 'ed-q5-3', objective: 'ed-o3', skill: 'ratios', difficulty: 1, qtype: 'numeric', stem: 'EBIT is ₹300 crore on revenue of ₹2,400 crore. What is the operating (EBIT) margin, in percent?', correct: { value: 12.5, abs_tol: 0.05, unit: '%' }, explanation: '300 ÷ 2,400 = 12.5%.', misconception: 'Inverting the ratio.' },
    ],
  },
  {
    id: 'ed-l6', title: 'ROCE and leverage', minutes: 15, objectives: ['ed-o4'], prerequisites: ['ed-l5'], mastery_rule: RULE('ed-o4'), references: [METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Return on all the capital', body: [
        'Return on capital employed (ROCE) = EBIT ÷ (equity + debt). It measures how well the business uses all the money invested in it, regardless of who provided it.',
        'If a company earns a ROCE above its cost of borrowing, debt lifts ROE; if ROCE falls below the cost of debt, leverage hurts shareholders.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Leverage magnifies both ways', widget: 'dupont', intro: 'Hold EBIT steady and replace equity with debt. Watch ROE rise while ROCE stays the same; then cut EBIT and watch ROE fall faster.', alt_text: 'Values for ROCE, ROE and debt-to-equity update as inputs change; all values are shown as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'EBIT ₹180 crore, equity ₹800 crore, debt ₹400 crore. What is ROCE?', options: ['22.5%', '15%', '45%'], answer: 1, reveal: '180 ÷ (800 + 400) = 15%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Same business, two capital structures (₹ crore)', steps: [
        'Capital employed 1,200, EBIT 180 → ROCE 15% in both cases.',
        'All equity (1,200): no interest; tax 25% → profit 135; ROE = 135 ÷ 1,200 = 11.25%.',
        'Equity 800 + debt 400 at 9%: interest 36; PBT 144; tax 36; profit 108; ROE = 108 ÷ 800 = 13.5%.',
        'If EBIT halves to 90: all-equity ROE 5.6%; leveraged ROE = (90 − 36) × 0.75 ÷ 800 = 5.1%. Leverage cut deeper.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Debt ₹400 crore and equity ₹800 crore. What is the debt-to-equity ratio?', hint: 'Debt ÷ equity.', answer_text: '400 ÷ 800 = 0.5.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can a rising ROE be a warning sign rather than good news?', model_answer: 'It may come from more borrowing or shrinking equity (e.g. losses or buybacks), not better operations; check ROCE and leverage.' },
      { stage: 'review', kind: 'summary', points: ['ROCE = EBIT ÷ (equity + debt).', 'Debt lifts ROE only while ROCE exceeds the cost of debt.', 'Leverage magnifies falls as well as rises.'] },
    ],
    quiz: [
      { id: 'ed-q6-1', objective: 'ed-o4', skill: 'leverage', difficulty: 2, qtype: 'numeric', stem: 'EBIT ₹180 crore, equity ₹800 crore and debt ₹400 crore. What is ROCE, in percent?', correct: { value: 15, abs_tol: 0.05, unit: '%' }, explanation: '180 ÷ 1,200 = 15%.', misconception: 'Dividing by equity only.' },
      { id: 'ed-q6-2', objective: 'ed-o4', skill: 'leverage', difficulty: 3, qtype: 'single_choice', stem: 'When does adding debt raise ROE?', options: ['Always', 'When the return on capital exceeds the after-tax cost of the debt', 'Only when interest rates are zero', 'Never'], correct: { index: 1 }, explanation: 'Borrowed money must earn more than it costs to help shareholders.', misconception: 'Believing debt always improves returns.' },
      { id: 'ed-q6-3', objective: 'ed-o4', skill: 'leverage', difficulty: 1, qtype: 'numeric', stem: 'Debt is ₹400 crore and equity ₹800 crore. What is the debt-to-equity ratio?', correct: { value: 0.5, abs_tol: 0.005 }, explanation: '400 ÷ 800 = 0.5.', misconception: 'Dividing equity by debt.' },
    ],
  },
];

export const ED_MODULE_4: SourceLesson[] = [
  {
    id: 'ed-l7', title: 'P/E and earnings yield', minutes: 13, objectives: ['ed-o5'], prerequisites: ['ed-l1'], mastery_rule: RULE('ed-o5'), references: [METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Price per rupee of earnings', body: [
        'The price-to-earnings ratio (P/E) = market capitalisation ÷ net profit (or price ÷ earnings per share). Its inverse, the earnings yield, is profit as a percentage of market value.',
        'A P/E is not cheap or expensive on its own. It reflects expected growth, risk and the quality of earnings, and it is meaningless for loss-making companies.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Multiples from the same numbers', widget: 'ev_bridge', intro: 'Change market value, debt, cash, EBITDA and profit. See P/E and EV/EBITDA side by side.', alt_text: 'The widget lists enterprise value, P/E and EV/EBITDA computed from the inputs, with "not meaningful" shown when a denominator is not positive.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Market capitalisation ₹2,400 crore and net profit ₹160 crore. What is the P/E?', options: ['6.7', '15', '38.4'], answer: 1, reveal: '2,400 ÷ 160 = 15; earnings yield = 1 ÷ 15 ≈ 6.67%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Why two P/Es differ', steps: [
        'Company A: P/E 12, profit growing 5% a year, steady.',
        'Company B: P/E 30, profit growing 25% a year, but with more uncertainty.',
        'Neither ratio says which is the better investment; it says what the market currently expects.',
        'ATLAS shows each company\'s P/E against its own history and peer medians, with the inputs as evidence.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A share trades at ₹450 and earnings per share are ₹30. What are the P/E and earnings yield?', hint: 'P/E = price ÷ EPS.', answer_text: 'P/E = 15; earnings yield = 30 ÷ 450 ≈ 6.67%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is a very low P/E sometimes a warning rather than a bargain?', model_answer: 'The market may expect profits to fall, or the profit may include one-off gains; a low multiple can be justified by risk or decline.' },
      { stage: 'review', kind: 'summary', points: ['P/E = market cap ÷ net profit; earnings yield is its inverse.', 'Multiples encode expectations of growth and risk.', 'P/E is not meaningful for loss-makers.'] },
    ],
    quiz: [
      { id: 'ed-q7-1', objective: 'ed-o5', skill: 'valuation', difficulty: 1, qtype: 'numeric', stem: 'Market capitalisation ₹2,400 crore and net profit ₹160 crore. What is the P/E?', correct: { value: 15, abs_tol: 0.01 }, explanation: '2,400 ÷ 160 = 15.', misconception: 'Dividing profit by market capitalisation.' },
      { id: 'ed-q7-2', objective: 'ed-o5', skill: 'valuation', difficulty: 2, qtype: 'numeric', stem: 'If a company\'s P/E is 15, what is its earnings yield, in percent (two decimals)?', correct: { value: 6.67, abs_tol: 0.01, unit: '%' }, explanation: '1 ÷ 15 = 6.67%.', misconception: 'Confusing earnings yield with dividend yield.' },
      { id: 'ed-q7-3', objective: 'ed-o5', skill: 'valuation', difficulty: 1, qtype: 'single_choice', stem: 'A company reported a net loss. Its P/E ratio is:', options: ['Very low, so the share is cheap', 'Not meaningful', 'Zero', 'Infinite and very expensive'], correct: { index: 1 }, explanation: 'With negative earnings the ratio has no useful interpretation.', misconception: 'Reading a negative P/E as cheap.' },
    ],
  },
  {
    id: 'ed-l8', title: 'Enterprise value and EV/EBITDA', minutes: 15, objectives: ['ed-o5'], prerequisites: ['ed-l7'], mastery_rule: RULE('ed-o5'), references: [METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Valuing the whole business', body: [
        'Enterprise value (EV) approximates the value of the whole business to all capital providers: market capitalisation + debt − cash.',
        'EV/EBITDA compares that value with operating earnings before interest, so it is less distorted by different debt levels than P/E.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Build the EV bridge', widget: 'ev_bridge', intro: 'Start with a market value of ₹1,500 crore, debt ₹500 crore, cash ₹200 crore and EBITDA ₹225 crore.', alt_text: 'A bridge from market capitalisation to enterprise value adds debt and subtracts cash; EV/EBITDA and P/E are shown as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Market cap ₹1,500 crore, debt ₹500 crore, cash ₹200 crore. What is EV?', options: ['₹2,200 crore', '₹1,800 crore', '₹1,200 crore'], answer: 1, reveal: '1,500 + 500 − 200 = ₹1,800 crore.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Two companies, different debt (₹ crore)', steps: [
        'A: market cap 1,000, no debt, cash 0, EBITDA 150, profit 100 → EV 1,000; EV/EBITDA 6.7; P/E 10.',
        'B: market cap 600, debt 400, cash 0, EBITDA 150, profit 70 → EV 1,000; EV/EBITDA 6.7; P/E 8.6.',
        'Same operating business, same EV/EBITDA; P/E differs because B pays interest.',
        'EV/EBITDA is not meaningful for banks, whose debt is their raw material; ATLAS hides it for financial-sector templates.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'With EV ₹1,800 crore and EBITDA ₹225 crore, what is EV/EBITDA?', hint: 'Divide EV by EBITDA.', answer_text: '1,800 ÷ 225 = 8×.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why subtract cash when computing enterprise value?', model_answer: 'A buyer of the whole business would receive the cash, which offsets part of the price; EV values the operating business.' },
      { stage: 'review', kind: 'summary', points: ['EV = market cap + debt − cash.', 'EV/EBITDA is less affected by capital structure than P/E.', 'Use sector-appropriate measures; EV/EBITDA does not suit banks.'] },
    ],
    quiz: [
      { id: 'ed-q8-1', objective: 'ed-o5', skill: 'valuation', difficulty: 2, qtype: 'numeric', stem: 'Market cap ₹1,500 crore, debt ₹500 crore, cash ₹200 crore. What is the enterprise value, in ₹ crore?', correct: { value: 1800, abs_tol: 0.5, unit: '₹ crore' }, explanation: '1,500 + 500 − 200 = ₹1,800 crore.', misconception: 'Adding cash instead of subtracting it.' },
      { id: 'ed-q8-2', objective: 'ed-o5', skill: 'valuation', difficulty: 2, qtype: 'numeric', stem: 'Enterprise value is ₹1,800 crore and EBITDA ₹225 crore. What is EV/EBITDA?', correct: { value: 8, abs_tol: 0.005 }, explanation: '1,800 ÷ 225 = 8.', misconception: 'Using net profit instead of EBITDA.' },
      { id: 'ed-q8-3', objective: 'ed-o5', skill: 'valuation', difficulty: 3, qtype: 'single_choice', stem: 'For which kind of company is EV/EBITDA generally NOT meaningful?', options: ['A manufacturer', 'A software company', 'A bank', 'A retailer'], correct: { index: 2 }, explanation: 'For banks, borrowing is part of operations, so EV and EBITDA do not separate operations from financing.', misconception: 'Applying one multiple to every sector.' },
    ],
  },
];
