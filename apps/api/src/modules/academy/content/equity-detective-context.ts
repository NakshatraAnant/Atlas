import type { SourceLesson } from '../curriculum.js';

// EQUITY DETECTIVE, module 5: the business behind the numbers (batch 2, 20 Oct 2026).
// Original text. Examples use ATLAS's synthetic companies or labelled hypothetical numbers; no real
// prices or records are presented. Status: in_review (AI-assisted draft) until the seven-point review.

const INDAS = { title: 'Indian Accounting Standards (Ind AS), Ministry of Corporate Affairs', url: 'https://www.mca.gov.in/', note: 'Primary source for Ind AS 7 (cash flows), Ind AS 27 and 110 (separate and consolidated statements), Ind AS 28 (associates), Ind AS 33 (earnings per share), Ind AS 108 (segments) and Ind AS 115 (revenue).' };
const COMPANIES_ACT = { title: 'Companies Act, 2013, Ministry of Corporate Affairs', url: 'https://www.mca.gov.in/', note: 'Section 129 and Schedule III cover financial statements (including consolidated statements); Section 134 covers the board\'s report.' };
const LODR = { title: 'SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015', url: 'https://www.sebi.gov.in/', note: 'Regulation 33 covers periodic financial results (standalone and consolidated); Regulation 34 covers the annual report. Check the current regulation text.' };
const ICDR = { title: 'SEBI (Issue of Capital and Disclosure Requirements) Regulations, 2018', url: 'https://www.sebi.gov.in/', note: 'Conditions for rights issues and bonus issues by listed companies. Check the current regulation text.' };
const ICAI_SA701 = { title: 'ICAI: SA 701, Communicating Key Audit Matters in the Independent Auditor\'s Report', url: 'https://www.icai.org/', note: 'Standard on auditing that requires auditors of listed entities to report key audit matters.' };
const PORTER = { title: 'Michael E. Porter, "The Five Competitive Forces That Shape Strategy", Harvard Business Review, January 2008', url: 'https://hbr.org/2008/01/the-five-competitive-forces-that-shape-strategy', note: 'A widely used framework for analysing industry structure.' };
const NSE = { title: 'National Stock Exchange of India', url: 'https://www.nseindia.com/', note: 'Corporate-action announcements and the exchange\'s industry classification of listed companies. Read on the site; its terms prohibit automated collection.' };
const METH = { title: 'ATLAS methodology: metric definitions', url: '/methodology', note: 'Exact formulas, inputs and edge rules ATLAS uses for every ratio, peer median and adjustment.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

export const ED_MODULE_5_OBJECTIVES = [
  { id: 'ed-o7', statement: 'Describe how a company earns money (revenue model, cost structure, capital intensity) and how industry structure shapes its margins.', skill: 'business_models' },
  { id: 'ed-o8', statement: 'Navigate an Indian annual report and say which question each part (board\'s report, MD&A, auditor\'s report, statements, notes) answers.', skill: 'annual_report' },
  { id: 'ed-o9', statement: 'Distinguish standalone from consolidated statements, explain intra-group eliminations and non-controlling interest, and keep every ratio on one basis.', skill: 'consolidation' },
  { id: 'ed-o10', statement: 'Break revenue growth into volume, price and acquisitions, and judge how repeatable it is.', skill: 'revenue_quality' },
  { id: 'ed-o11', statement: 'Calculate free cash flow from operating cash flow and capital expenditure, and interpret capex intensity.', skill: 'free_cash_flow' },
  { id: 'ed-o12', statement: 'Build a fair peer comparison: similar businesses, one basis, aligned periods, sector-appropriate metrics and medians.', skill: 'peer_comparison' },
  { id: 'ed-o13', statement: 'Adjust per-share figures for splits, bonus issues and buybacks so that years can be compared like for like.', skill: 'corporate_actions' },
];

export const ED_MODULE_5: SourceLesson[] = [
  {
    id: 'ed-l9', title: 'Business models and industry structure', minutes: 15, objectives: ['ed-o7'], prerequisites: ['ed-l1'], mastery_rule: RULE('ed-o7'), references: [PORTER, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Before the numbers: how does this business make money?', body: [
        'A business model answers three questions. What does the company sell, and to whom (the revenue model)? Which costs stay the same when sales change (fixed costs) and which move with sales (variable costs)? How much money must be tied up in plant, equipment and stock to produce each rupee of sales (capital intensity)?',
        'Industry structure shapes how much profit is available at all. Few competitors, customers who find it hard to switch and suppliers with little bargaining power tend to allow higher margins; many similar competitors selling an undifferentiated product tend to push margins down. Porter\'s "five forces" is one common way to organise these questions.',
        'This is why margins differ so much between sectors. In ATLAS\'s synthetic universe, software companies are modelled with operating margins around 22% and retailers around 9%: different business models, not necessarily better or worse management.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Compare two business models in ATLAS', href: '/app/companies', steps: [
        'Open Kaveri Foods (synthetic) and read the Overview: sector, industry, description and whether segments are reported.',
        'Open Ratios and note the operating margin and asset turnover for the last few years.',
        'Go back to Companies, open a synthetic company in a different sector (for example IT or Retail) and read the same two ratios.',
        'Write one sentence per company on how it earns money and why its margin might sit where it does. Development data is synthetic and labelled.',
      ], alt_text: 'A guided task on two synthetic company profiles: read the sector, description, operating margin and asset turnover of each and compare them.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Two companies each have revenue of ₹1,000 crore and EBIT of ₹100 crore. Company A\'s costs are mostly fixed; Company B\'s are mostly variable. Revenue rises 10% at both. Whose EBIT rises by a larger percentage?', options: ['Company A (mostly fixed costs)', 'Company B (mostly variable costs)', 'Both rise 10%'], answer: 0, reveal: 'Fixed costs do not grow with sales, so most of A\'s extra revenue reaches EBIT. This is operating leverage, and it works in reverse when sales fall.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Operating leverage in two cost structures (hypothetical, ₹ crore)', steps: [
        'Company A: fixed costs 600, variable costs 30% of revenue. At revenue 1,000: EBIT = 1,000 − 600 − 300 = 100.',
        'Company B: fixed costs 100, variable costs 80% of revenue. At revenue 1,000: EBIT = 1,000 − 100 − 800 = 100.',
        'Revenue +10% to 1,100: A\'s EBIT = 1,100 − 600 − 330 = 170 (+70%); B\'s EBIT = 1,100 − 100 − 880 = 120 (+20%).',
        'Revenue −10% to 900: A\'s EBIT = 900 − 600 − 270 = 30 (−70%); B\'s EBIT = 900 − 100 − 720 = 80 (−20%).',
        'Same profit today, very different sensitivity: the cost structure is part of the risk.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'An industry has four companies with market shares of 40%, 30%, 20% and 10%. Calculate the Herfindahl-Hirschman Index (HHI), the sum of squared market shares.', hint: 'Square each share in percentage points, then add.', answer_text: '40² + 30² + 20² + 10² = 1,600 + 900 + 400 + 100 = 3,000. A higher HHI means a more concentrated industry (the maximum, one company with 100%, is 10,000).' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is comparing the operating margin of a software company with that of a retailer not a fair test of which is better run?', model_answer: 'They have different business models: the retailer sells high volumes at thin margins with fast asset turnover, while software has high margins and different capital needs. Margins are best compared within an industry, together with turnover and returns on capital.' },
      { stage: 'review', kind: 'summary', points: ['A business model: what is sold to whom, the fixed and variable cost mix, and the capital needed per rupee of sales.', 'Industry structure (competitors, customers, suppliers, substitutes, entrants) limits the profit available.', 'High fixed costs magnify profit changes in both directions (operating leverage).'] },
    ],
    quiz: [
      { id: 'ed-q9-1', objective: 'ed-o7', skill: 'business_models', difficulty: 1, qtype: 'single_choice', stem: 'Which best describes a capital-intensive business?', options: ['It needs a large investment in plant, equipment or stock for each rupee of sales', 'It pays high salaries', 'It has a high share price', 'It has many shareholders'], correct: { index: 0 }, explanation: 'Capital intensity measures how much capital is tied up to produce sales; it shows up as low asset turnover.', misconception: 'Confusing capital intensity with high costs in general or with market value.' },
      { id: 'ed-q9-2', objective: 'ed-o7', skill: 'business_models', difficulty: 3, qtype: 'numeric', stem: 'A company has fixed costs of ₹400 crore and variable costs equal to 50% of revenue. Revenue rises from ₹1,000 crore to ₹1,200 crore. By what percentage does EBIT rise?', correct: { value: 100, abs_tol: 0.05, unit: '%' }, explanation: 'EBIT goes from 1,000 − 400 − 500 = 100 to 1,200 − 400 − 600 = 200: a 100% rise from a 20% rise in revenue.', misconception: 'Assuming profit grows at the same rate as revenue.' },
      { id: 'ed-q9-3', objective: 'ed-o7', skill: 'business_models', difficulty: 2, qtype: 'numeric', stem: 'Four companies share a market: 50%, 25%, 15% and 10%. What is the Herfindahl-Hirschman Index (sum of squared percentage shares)?', correct: { value: 3450, abs_tol: 0.5 }, explanation: '2,500 + 625 + 225 + 100 = 3,450.', misconception: 'Adding the shares (always 100) instead of squaring them.' },
    ],
  },
  {
    id: 'ed-l10', title: 'Reading an annual report', minutes: 16, objectives: ['ed-o8'], prerequisites: ['ed-l2'], mastery_rule: RULE('ed-o8'), references: [COMPANIES_ACT, LODR, ICAI_SA701, INDAS],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'A long document with a clear structure', body: [
        'An Indian listed company\'s annual report brings together several parts required by the Companies Act, 2013 and SEBI\'s listing regulations. Narrative sections come first: the board\'s report, management discussion and analysis (MD&A), the corporate governance report and, for the largest listed companies, the business responsibility and sustainability report (BRSR).',
        'Then come the independent auditor\'s report, which states the auditor\'s opinion (unmodified, qualified, adverse or a disclaimer) and, for listed companies, the key audit matters; and the financial statements, usually both standalone and consolidated.',
        'The notes to the accounts are where much of the detail lives: accounting policies (for example, when revenue is recognised), segment information, related-party transactions, borrowings and their terms, and contingent liabilities such as disputed tax claims.',
        'The narrative is written by management and describes their view. The statements and notes are the evidence to test it against.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Trace a figure back to its filing', href: '/app/companies', steps: [
        'Open Kaveri Foods (synthetic) and select Disclosures; filter the category to Financial Results.',
        'Open Financials, choose Annual, and click any value: the evidence drawer shows the filing it came from and when it was filed.',
        'Open Quality flags and look for any audit-related flag and the rule behind it.',
        'ATLAS shows structured figures, not the full annual report. For a real company you would read the report itself on the company\'s or the exchange\'s website.',
      ], alt_text: 'A guided task on a synthetic company profile: find results disclosures, trace a financial value to its filing in the evidence drawer and check audit-related quality flags.' },
      { stage: 'predict', kind: 'prediction', prompt: 'You want to know whether the auditor had any reservation about the accounts. Which part of the annual report do you open first?', options: ['Management discussion and analysis', 'The independent auditor\'s report', 'The chairman\'s letter', 'The corporate governance report'], answer: 1, reveal: 'The auditor\'s report states the opinion and its basis. A qualified opinion, adverse opinion or disclaimer, and the key audit matters, all appear there.' },
      { stage: 'investigate', kind: 'worked_example', title: 'A reading route for a hypothetical company', steps: [
        'Auditor\'s report: is the opinion unmodified? Which key audit matters are listed (for example, revenue recognition or valuation of inventory)?',
        'Accounting policies note: when is revenue recognised, and has any policy changed since last year?',
        'Related-party note: how large are sales to, purchases from or loans to group companies and promoters?',
        'Contingent liabilities note: are there disputed claims that are large compared with net worth?',
        'Only then read the MD&A, and check each claim (for example, "volumes grew 12%") against segment revenue and the statements.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'The MD&A of a hypothetical company says "strong demand in all regions". Where in the report would you look to test that claim?', hint: 'Which note splits revenue by business or geography?', answer_text: 'The segment information note (and the revenue note), comparing revenue by segment or geography with the previous year; then the receivables on the balance sheet, to see whether the sales were collected.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why read the auditor\'s report and the notes before the MD&A?', model_answer: 'The MD&A is management\'s own account. Reading the independent opinion and the detailed notes first gives you the evidence and the open questions, so you can judge the narrative instead of adopting it.' },
      { stage: 'review', kind: 'summary', points: ['Narrative (board\'s report, MD&A, governance, BRSR) states management\'s view.', 'The auditor\'s report gives an independent opinion and key audit matters.', 'The statements and notes are the evidence: policies, segments, related parties, contingent liabilities.'] },
    ],
    quiz: [
      { id: 'ed-q10-1', objective: 'ed-o8', skill: 'annual_report', difficulty: 1, qtype: 'single_choice', stem: 'Which part of an annual report states whether the accounts give a true and fair view?', options: ['The board\'s report', 'The independent auditor\'s report', 'Management discussion and analysis', 'The notice of the annual general meeting'], correct: { index: 1 }, explanation: 'The auditor\'s opinion on the financial statements appears in the independent auditor\'s report.', misconception: 'Assuming management\'s narrative sections carry the audit opinion.' },
      { id: 'ed-q10-2', objective: 'ed-o8', skill: 'annual_report', difficulty: 2, qtype: 'single_choice', stem: 'A company is disputing a large tax demand that it has not recorded as a liability. Where is this most likely disclosed?', options: ['In the share price history', 'In the contingent liabilities note to the financial statements', 'In revenue from operations', 'Nowhere: unrecorded items are never disclosed'], correct: { index: 1 }, explanation: 'Possible obligations that are not recognised as liabilities are disclosed as contingent liabilities in the notes.', misconception: 'Thinking only recorded amounts appear in the annual report.' },
      { id: 'ed-q10-3', objective: 'ed-o8', skill: 'annual_report', difficulty: 2, qtype: 'multi_select', stem: 'Which of these are normally found in the notes to the financial statements? Select all that apply.', options: ['Significant accounting policies', 'Related-party transactions', 'Segment information', 'The share price on the day of the annual general meeting'], correct: { indexes: [0, 1, 2] }, explanation: 'Policies, related parties and segments are standard notes; share prices are market data, not part of the accounts.', misconception: 'Treating the notes as optional detail rather than part of the statements.' },
    ],
  },
  {
    id: 'ed-l11', title: 'Standalone versus consolidated statements', minutes: 15, objectives: ['ed-o9'], prerequisites: ['ed-l2'], mastery_rule: RULE('ed-o9'), references: [INDAS, COMPANIES_ACT, LODR, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'One company, or the whole group?', body: [
        'Standalone (separate) statements show the parent company on its own. Its subsidiaries appear only as investments, and it records income from them only when, for example, they pay it dividends.',
        'Consolidated statements present the parent and the subsidiaries it controls as one economic entity (Ind AS 110). Their revenues, costs, assets and liabilities are added line by line, and transactions inside the group, such as the parent selling to its own subsidiary, are eliminated so they are not counted twice.',
        'If the parent owns less than 100% of a subsidiary, the outside owners\' share is shown as non-controlling interest (NCI), in both profit and equity. Associates and joint ventures are not added line by line; the group includes its share of their profit as one line (the equity method, Ind AS 28).',
        'Indian listed companies with subsidiaries publish both bases. Either basis can be informative, but every ratio must take its numerator and denominator from the same one.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Switch the basis in ATLAS', href: '/app/companies', steps: [
        'Open a synthetic company and read the Overview line "Reporting basis shown by default".',
        'Open Financials, choose Annual and the Profit and loss statement. If the Basis selector offers both, switch between Consolidated and Standalone.',
        'Compare revenue and net profit on each basis for the same year, and read the basis label printed above the table.',
        'Open Ratios and confirm that the caption names a single basis for every ratio.',
      ], alt_text: 'A guided task in the Financials tab of a synthetic company: switch between consolidated and standalone bases and compare revenue and profit for the same year.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A parent sells goods for ₹100 crore to its wholly owned subsidiary, which sells all of them to outside customers for ₹130 crore. How much revenue from these goods appears in the consolidated statements?', options: ['₹230 crore', '₹130 crore', '₹100 crore', '₹30 crore'], answer: 1, reveal: 'Only sales to outsiders count for the group: ₹130 crore. The ₹100 crore sale inside the group is eliminated on consolidation.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Building a consolidated view (hypothetical, ₹ crore)', steps: [
        'Parent standalone revenue: 800, of which 100 is sales to its subsidiary. Subsidiary revenue: 300, all to outside customers.',
        'Consolidated revenue = 800 + 300 − 100 (intra-group) = 1,000.',
        'The parent owns 80% of the subsidiary, which earns net profit of 50. Consolidated net profit is 150.',
        'Non-controlling interest = 20% × 50 = 10. Profit attributable to owners of the parent = 150 − 10 = 140.',
        'Consolidated EPS and ROE use the 140 that belongs to the parent\'s shareholders, with equity attributable to owners of the parent.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Parent revenue is ₹500 crore, including ₹60 crore of sales to its subsidiary. The subsidiary\'s revenue is ₹200 crore, all external. What is consolidated revenue?', hint: 'Add both, then remove the intra-group sales.', answer_text: '500 + 200 − 60 = ₹640 crore.' },
      { stage: 'explain', kind: 'reflection', prompt: 'A company\'s standalone debt is low, but its consolidated debt is much higher. What does that tell you?', model_answer: 'Much of the group\'s borrowing sits in subsidiaries. Shareholders of the parent are exposed to the whole group, so the consolidated figure better shows the group\'s leverage; the difference is a question to investigate (who borrowed, and with what guarantees).' },
      { stage: 'review', kind: 'summary', points: ['Standalone: the parent alone. Consolidated: parent plus controlled subsidiaries, line by line.', 'Intra-group transactions are eliminated; outside owners\' share is non-controlling interest.', 'Take every input of a ratio from the same basis and period.'] },
    ],
    quiz: [
      { id: 'ed-q11-1', objective: 'ed-o9', skill: 'consolidation', difficulty: 2, qtype: 'numeric', stem: 'Parent revenue is ₹900 crore, including ₹120 crore of sales to its subsidiary. The subsidiary\'s revenue is ₹400 crore, all to outside customers. What is consolidated revenue, in ₹ crore?', correct: { value: 1180, abs_tol: 0.5, unit: '₹ crore' }, explanation: '900 + 400 − 120 = ₹1,180 crore; sales inside the group are eliminated.', misconception: 'Adding the two companies\' revenue without eliminating intra-group sales.' },
      { id: 'ed-q11-2', objective: 'ed-o9', skill: 'consolidation', difficulty: 2, qtype: 'numeric', stem: 'A parent owns 75% of a subsidiary that earns net profit of ₹80 crore. How much of that profit is attributable to non-controlling interest, in ₹ crore?', correct: { value: 20, abs_tol: 0.05, unit: '₹ crore' }, explanation: 'Outside owners hold 25%: 0.25 × 80 = ₹20 crore.', misconception: 'Using the parent\'s 75% share instead of the outside owners\' 25%.' },
      { id: 'ed-q11-3', objective: 'ed-o9', skill: 'consolidation', difficulty: 3, qtype: 'single_choice', stem: 'Which ROE calculation is consistent?', options: ['Consolidated profit attributable to owners ÷ consolidated equity attributable to owners', 'Consolidated net profit ÷ standalone equity', 'Standalone net profit ÷ consolidated equity', 'Consolidated revenue ÷ standalone equity'], correct: { index: 0 }, explanation: 'Numerator and denominator must cover the same entities and the same owners.', misconception: 'Mixing bases because both numbers are labelled "profit" or "equity".' },
    ],
  },
  {
    id: 'ed-l12', title: 'Revenue quality and growth drivers', minutes: 15, objectives: ['ed-o10'], prerequisites: ['ed-l3'], mastery_rule: RULE('ed-o10'), references: [INDAS, COMPANIES_ACT, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Not every rupee of revenue is equal', body: [
        'Indian statements separate revenue from operations (the core business) from other income (interest, dividends, one-off gains). Growth in the second is not growth in the business.',
        'Revenue growth can be split into drivers: volume (how much was sold), realisation (average price and product mix) and acquisitions (revenue bought, not grown). Growth without acquisitions is called organic growth. Because the drivers multiply, revenue growth = (1 + volume growth) × (1 + price growth) − 1.',
        'Quality asks how repeatable and how well-backed the revenue is: recurring contracts versus one-off orders, many customers versus a few, sales to outsiders versus related parties, and whether cash is being collected. Ind AS 115 sets when revenue may be recognised, and the accounting policies note says how the company applies it.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Check revenue against receivables', href: '/app/companies', steps: [
        'Open a synthetic company, then Financials → Profit and loss → Annual. Find revenue from operations and other income for the last three years.',
        'Switch to the Balance sheet and note trade receivables for the same years.',
        'Compare the growth rates: are receivables growing much faster than revenue?',
        'Open Quality flags to see whether ATLAS has flagged rising receivables or heavy other income for this company.',
      ], alt_text: 'A guided task in a synthetic company\'s Financials and Quality flags: compare revenue, other income and receivables growth over three years.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Volume grows 5% and the average selling price rises 6%. Roughly how much does revenue grow?', options: ['1%', '11%', '11.3%', '30%'], answer: 2, reveal: '1.05 × 1.06 − 1 = 11.3%. Adding the two (11%) is close but slightly understates growth, because the drivers multiply.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Separating the drivers (hypothetical, ₹ crore)', steps: [
        'Revenue from operations rose from 1,000 to 1,180: reported growth 18%.',
        'A business acquired during the year contributed 100. Organic revenue = 1,080, so organic growth = 8%.',
        'Volumes grew 3%. Price and mix therefore contributed 1.08 ÷ 1.03 − 1 ≈ 4.9%.',
        'Trade receivables rose from 150 to 210 (+40%), much faster than revenue: a question about credit terms and collection, not a verdict.',
        'Summary: most of the headline growth was bought or priced, not volume; check whether the price increases can hold.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Revenue rose from ₹500 crore to ₹560 crore, and ₹35 crore of the new figure came from an acquired business. What are reported and organic growth?', hint: 'Organic revenue excludes the acquired ₹35 crore.', answer_text: 'Reported: 560 ÷ 500 − 1 = 12%. Organic: (560 − 35) ÷ 500 − 1 = 5%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can rapid revenue growth together with even faster growth in receivables be a concern?', model_answer: 'Sales are being booked but not collected as quickly, perhaps through looser credit terms or aggressive recognition. Revenue that does not turn into cash is weaker evidence of a growing business; read the policies note and compare receivable days with peers.' },
      { stage: 'review', kind: 'summary', points: ['Separate revenue from operations from other income.', 'Revenue growth = (1 + volume) × (1 + price/mix) − 1, plus or minus acquisitions; organic growth excludes acquisitions.', 'Repeatable, diversified, collected revenue is higher quality than one-off, concentrated or uncollected revenue.'] },
    ],
    quiz: [
      { id: 'ed-q12-1', objective: 'ed-o10', skill: 'revenue_quality', difficulty: 2, qtype: 'numeric', stem: 'Volume grows 8% and the average selling price falls 2%. What is revenue growth, in percent (two decimals)?', correct: { value: 5.84, abs_tol: 0.05, unit: '%' }, explanation: '1.08 × 0.98 − 1 = 5.84%.', misconception: 'Adding the drivers (8 − 2 = 6%) instead of multiplying them.' },
      { id: 'ed-q12-2', objective: 'ed-o10', skill: 'revenue_quality', difficulty: 2, qtype: 'numeric', stem: 'Revenue rose from ₹2,000 crore to ₹2,300 crore. An acquired business contributed ₹180 crore of the new figure. What is organic growth, in percent?', correct: { value: 6, abs_tol: 0.05, unit: '%' }, explanation: '(2,300 − 180) ÷ 2,000 − 1 = 6%, against reported growth of 15%.', misconception: 'Treating acquired revenue as growth of the existing business.' },
      { id: 'ed-q12-3', objective: 'ed-o10', skill: 'revenue_quality', difficulty: 1, qtype: 'single_choice', stem: 'Which source of revenue growth is least likely to repeat next year?', options: ['A one-time bulk order from a single customer', 'Renewals of multi-year service contracts', 'Volume growth spread across many customers', 'A price increase across a broad product range that customers have accepted'], correct: { index: 0 }, explanation: 'A one-off order from one customer says little about next year\'s revenue.', misconception: 'Treating all revenue growth as equally repeatable.' },
    ],
  },
  {
    id: 'ed-l13', title: 'Free cash flow and capital expenditure', minutes: 15, objectives: ['ed-o11'], prerequisites: ['ed-l3'], mastery_rule: RULE('ed-o11'), references: [INDAS, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Cash left after keeping the business going', body: [
        'Capital expenditure (capex) is money spent on property, plant, equipment and intangible assets. It appears under investing activities in the cash-flow statement (Ind AS 7), not in the profit and loss statement; the P&L sees it only gradually, through depreciation.',
        'A simple definition: free cash flow (FCF) = operating cash flow − capex. It is the cash available for debt repayment, dividends, buybacks or acquisitions. Definitions vary (some also deduct interest or lease payments), so always check which one a source uses.',
        'Capex intensity = capex ÷ revenue shows how much a business must keep reinvesting. Part of capex maintains existing capacity and part adds new capacity; companies rarely disclose the split, and depreciation is only a rough guide to the maintenance part.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Calculate FCF from the cash-flow statement', href: '/app/companies', steps: [
        'Open a synthetic company, then Financials → Cash flow → Annual.',
        'For the last three years, note "Cash flow from operating activities" and "Capital expenditure".',
        'Calculate FCF = operating cash flow − capex for each year, and compare it with net profit from the Profit and loss statement.',
        'Click a value to check its basis and filing date before you use it.',
      ], alt_text: 'A guided task in the cash-flow statement of a synthetic company: read operating cash flow and capex for three years and calculate free cash flow.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Operating cash flow is ₹300 crore and capex is ₹220 crore. What is free cash flow?', options: ['₹520 crore', '₹80 crore', '₹300 crore', '−₹80 crore'], answer: 1, reveal: '300 − 220 = ₹80 crore. A large share of operating cash is being reinvested.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Three years with a new plant (hypothetical, ₹ crore)', steps: [
        'Year 1: OCF 250, capex 100 → FCF 150.',
        'Year 2: OCF 280, capex 320 (a new plant) → FCF −40.',
        'Year 3: OCF 340, capex 120 → FCF 220.',
        'Over three years: OCF 870, capex 540, FCF 330. Depreciation is about 90 a year, so capex well above depreciation in Year 2 suggests spending on growth rather than upkeep.',
        'One negative year in a building phase is not alarming by itself; the question is whether the new capacity later earns a return.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'OCF ₹180 crore, capex ₹75 crore, net profit ₹140 crore. What are FCF and FCF as a percentage of net profit?', hint: 'FCF = OCF − capex; then divide by net profit.', answer_text: 'FCF = 180 − 75 = ₹105 crore; 105 ÷ 140 = 75% of net profit.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can two companies with the same net profit generate very different free cash flow?', model_answer: 'They can differ in working capital (cash tied up in receivables and inventory) and in capex needs. A capital-intensive business may have to reinvest most of its operating cash just to maintain capacity.' },
      { stage: 'review', kind: 'summary', points: ['Capex sits in investing cash flow; the P&L sees it only through depreciation.', 'FCF = operating cash flow − capex (check the definition used).', 'Read FCF over several years: building phases and maintenance needs differ.'] },
    ],
    quiz: [
      { id: 'ed-q13-1', objective: 'ed-o11', skill: 'free_cash_flow', difficulty: 1, qtype: 'numeric', stem: 'Operating cash flow is ₹420 crore and purchases of property, plant and equipment are ₹150 crore. What is free cash flow (OCF − capex), in ₹ crore?', correct: { value: 270, abs_tol: 0.5, unit: '₹ crore' }, explanation: '420 − 150 = ₹270 crore.', misconception: 'Starting from net profit instead of operating cash flow.' },
      { id: 'ed-q13-2', objective: 'ed-o11', skill: 'free_cash_flow', difficulty: 2, qtype: 'numeric', stem: 'Capex is ₹90 crore and revenue ₹1,200 crore. What is capex intensity (capex ÷ revenue), in percent?', correct: { value: 7.5, abs_tol: 0.05, unit: '%' }, explanation: '90 ÷ 1,200 = 7.5%.', misconception: 'Dividing by net profit instead of revenue.' },
      { id: 'ed-q13-3', objective: 'ed-o11', skill: 'free_cash_flow', difficulty: 3, qtype: 'single_choice', stem: 'A company\'s operating cash flow is positive and rising, but FCF is negative for one year while it builds a new plant. What is the most reasonable reading?', options: ['The company is failing', 'An investment phase: check how it is funded and whether the new capacity later earns a return', 'FCF does not matter when profit is positive', 'Capex should be ignored because it is not in the P&L'], correct: { index: 1 }, explanation: 'Negative FCF during a building phase is a question about funding and future returns, not a verdict.', misconception: 'Judging FCF from a single year without context.' },
    ],
  },
  {
    id: 'ed-l14', title: 'Peer comparison and sector context', minutes: 14, objectives: ['ed-o12'], prerequisites: ['ed-l7'], mastery_rule: RULE('ed-o12'), references: [NSE, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Compared with whom?', body: [
        'A ratio means little on its own. A 15% operating margin is low for a software company in ATLAS\'s synthetic universe and high for a retailer. Peer comparison asks how a company compares with businesses that face similar economics.',
        'A fair peer set uses: companies with similar business models (not just the same broad sector label), the same reporting basis (all consolidated or all standalone), aligned periods (a company whose financial year ends in December is not directly comparable with one ending in March without adjustment), and metrics that suit the sector (banks are judged on measures such as net interest margin and asset quality, not EV/EBITDA or inventory days).',
        'Summarise the peer group with the median, which a single extreme company cannot drag far, rather than the mean. Sector context also matters: in cyclical sectors, profits near a peak can make P/E ratios look low.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Read a peer table in ATLAS', href: '/app/companies', steps: [
        'Open Kaveri Foods (synthetic) and select Peers.',
        'Read the alignment note above the table and any warnings below it.',
        'Find the peer median row, and any peer marked with a financial year that does not end in March.',
        'Click a metric name to open its definition in Methodology.',
      ], alt_text: 'A guided task on the Peers tab of a synthetic company: read the alignment note, warnings, peer median and fiscal-year markers, and open a metric definition.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Five peers have P/E ratios of 12, 14, 15, 16 and 90. Which number best describes the typical peer?', options: ['The mean, 29.4', 'The median, 15', 'The highest, 90', 'The lowest, 12'], answer: 1, reveal: 'One outlier (90) pulls the mean to 29.4, a value no peer is near. The median, 15, describes the middle of the group.' },
      { stage: 'investigate', kind: 'worked_example', title: 'A peer set with an outlier (hypothetical)', steps: [
        'Five packaged-food companies have operating margins of 14%, 16%, 17%, 19% and 31%.',
        'Median = 17%; mean = 97 ÷ 5 = 19.4%.',
        'The 31% company earns mostly royalties from licensing its brands: a different business model that probably does not belong in this peer set.',
        'Without it, the median is (16 + 17) ÷ 2 = 16.5%. A subject company at 18% sits above both versions of the median, but by different amounts.',
        'Always write down which peers you used and why, so the comparison can be checked.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Four peers have ROCE of 8%, 11%, 9% and 13%. What is the median?', hint: 'Sort the values; with an even count, average the middle two.', answer_text: 'Sorted: 8, 9, 11, 13. Median = (9 + 11) ÷ 2 = 10%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is a low P/E compared with peers not enough to call a company undervalued?', model_answer: 'The peers may differ in growth, risk, accounting basis or position in the cycle, and the company may have specific problems. A peer gap is a question about why it exists, not an answer.' },
      { stage: 'review', kind: 'summary', points: ['Peers share a business model, not just a sector label.', 'Use one basis, aligned periods and sector-appropriate metrics.', 'Summarise with the median, and record why each peer was included.'] },
    ],
    quiz: [
      { id: 'ed-q14-1', objective: 'ed-o12', skill: 'peer_comparison', difficulty: 1, qtype: 'numeric', stem: 'Five peers have ROCE of 12%, 18%, 15%, 40% and 14%. What is the peer median, in percent?', correct: { value: 15, abs_tol: 0.05, unit: '%' }, explanation: 'Sorted: 12, 14, 15, 18, 40. The middle value is 15%.', misconception: 'Using the mean (19.8%), which the 40% outlier pulls up.' },
      { id: 'ed-q14-2', objective: 'ed-o12', skill: 'peer_comparison', difficulty: 2, qtype: 'multi_select', stem: 'Which steps make a peer comparison fairer? Select all that apply.', options: ['Using the same reporting basis for every company', 'Aligning periods when financial years end in different months', 'Choosing companies with similar business models', 'Adding any company with a similar market capitalisation, whatever its industry'], correct: { indexes: [0, 1, 2] }, explanation: 'Basis, period and business model all affect the numbers; size alone does not make a company a peer.', misconception: 'Choosing peers by size or popularity instead of economics.' },
      { id: 'ed-q14-3', objective: 'ed-o12', skill: 'peer_comparison', difficulty: 3, qtype: 'single_choice', stem: 'A metals company has the lowest P/E in its peer group in a year when metal prices, and its profits, are near a peak. What is the most careful interpretation?', options: ['It is clearly the cheapest share', 'Peak-cycle profits can make P/E look low; compare across the cycle', 'P/E is meaningless for every company', 'A low P/E proves strong management'], correct: { index: 1 }, explanation: 'In cyclical sectors, the denominator (profit) is temporarily high near a peak, so P/E is temporarily low.', misconception: 'Reading a single-year multiple without sector context.' },
    ],
  },
  {
    id: 'ed-l15', title: 'Corporate actions and like-for-like comparisons', minutes: 15, objectives: ['ed-o13'], prerequisites: ['ed-l7'], mastery_rule: RULE('ed-o13'), references: [INDAS, ICDR, NSE, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'When the number of shares changes', body: [
        'A share split (for example, face value ₹10 to ₹2, so each share becomes five) and a bonus issue (free new shares to existing holders) increase the number of shares without bringing in any money. Profit is shared among more shares, so per-share figures fall even though nothing about the business changed.',
        'To compare years, earlier per-share figures are restated using the same ratio. Ind AS 33 requires earnings per share (EPS) for earlier periods to be adjusted for bonus issues and splits.',
        'A rights issue does bring in new money, usually at a discount to the market price, so its adjustment is smaller and uses the theoretical ex-rights price. A buyback reduces the number of shares, which raises EPS even if profit does not grow.',
        'For dividends, compare the total paid and the payout ratio (dividends ÷ net profit) as well as the dividend per share.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Find corporate actions in ATLAS', href: '/app/companies', steps: [
        'Open a synthetic company and select Price & technicals.',
        'Read the list of corporate actions below the chart: type, ex-date and ratio.',
        'Toggle "Adjusted for corporate actions" off and on, and watch prices before the ex-date change.',
        'Open Disclosures and filter to Corporate Action to find the matching announcement.',
      ], alt_text: 'A guided task on the price chart of a synthetic company: read its corporate actions, toggle the adjusted series and find the matching disclosure.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Last year: net profit ₹300 crore, 10 crore shares, EPS ₹30. This year a 1:1 bonus (one new share for each held) doubles the shares to 20 crore, and net profit is ₹330 crore, so EPS is ₹16.50. What happened to earnings per share?', options: ['They fell 45%', 'On a like-for-like basis they rose 10%', 'They cannot be compared', 'They rose 120%'], answer: 1, reveal: 'Restated for the bonus, last year\'s EPS is 30 ÷ 2 = ₹15. This year\'s ₹16.50 is 10% higher, the same as the growth in profit.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Restating per-share figures (hypothetical)', steps: [
        'Bonus 1:1 between the two years: share count × 2.',
        'EPS: last year ₹30 restated to ₹15; this year ₹16.50 → +10%.',
        'Dividend per share: last year ₹10 (₹100 crore in total) restated to ₹5; this year ₹6 (₹120 crore in total) → +20%, and the total paid also rose 20%.',
        'Buyback example: profit flat at ₹200 crore, shares reduced from 10 crore to 9.5 crore. EPS rises from ₹20 to about ₹21.05 (+5.3%) with no growth in profit.',
        'ATLAS\'s adjusted price series applies the same idea to prices, so returns across a split or bonus are measured correctly.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A share splits from face value ₹10 to ₹2 (each share becomes five). EPS before the split was ₹50. What is the restated pre-split EPS?', hint: 'Divide by the number of new shares per old share.', answer_text: '50 ÷ 5 = ₹10 per share.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can rising EPS be a weaker sign of progress than rising net profit?', model_answer: 'EPS can rise because the share count fell (for example, a buyback) rather than because the business earned more. Checking net profit and the share count separately shows which one moved.' },
      { stage: 'review', kind: 'summary', points: ['Splits and bonuses add shares without new money: restate earlier per-share figures.', 'Rights issues bring in money; buybacks shrink the share count and lift EPS.', 'Compare totals and payout ratios, not only per-share numbers.'] },
    ],
    quiz: [
      { id: 'ed-q15-1', objective: 'ed-o13', skill: 'corporate_actions', difficulty: 2, qtype: 'numeric', stem: 'A company issues bonus shares of 1 new share for every 2 held, so the share count rises by half. EPS before the bonus was ₹24. What is the restated pre-bonus EPS, in rupees?', correct: { value: 16, abs_tol: 0.01, unit: '₹' }, explanation: 'The share count is multiplied by 1.5, so 24 ÷ 1.5 = ₹16.', misconception: 'Dividing by 2 because the ratio mentions 2.' },
      { id: 'ed-q15-2', objective: 'ed-o13', skill: 'corporate_actions', difficulty: 3, qtype: 'numeric', stem: 'Net profit stays at ₹500 crore while a buyback reduces shares from 50 crore to 45 crore. By what percentage does EPS rise (two decimals)?', correct: { value: 11.11, abs_tol: 0.05, unit: '%' }, explanation: 'EPS goes from ₹10 to 500 ÷ 45 = ₹11.11: an 11.11% rise with no profit growth.', misconception: 'Assuming EPS growth always reflects profit growth.' },
      { id: 'ed-q15-3', objective: 'ed-o13', skill: 'corporate_actions', difficulty: 1, qtype: 'single_choice', stem: 'Which corporate action brings new money into the company?', options: ['A share split', 'A bonus issue', 'A rights issue', 'A change of trading symbol'], correct: { index: 2 }, explanation: 'In a rights issue, existing shareholders pay for new shares. Splits and bonus issues only change the number of shares.', misconception: 'Treating every increase in share count as fund raising.' },
    ],
  },
];
