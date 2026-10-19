import type { SourceLesson } from '../curriculum.js';

// MARKET DECODER, modules 2–4. Original text; numbers match packages/shared learning-sims tests.
// Status: in_review (AI-assisted draft) until a named reviewer completes the seven-point review.

const SEBI = { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'General investor education from the Indian securities regulator.' };
const RBI = { title: 'Reserve Bank of India: monetary policy and inflation publications', url: 'https://www.rbi.org.in/', note: 'Primary source for India\'s inflation framework and policy statements; check the current framework.' };
const NIFTY = { title: 'NSE Indices: index methodology documents', url: 'https://www.niftyindices.com/', note: 'How Indian indices are constructed and weighted; read the methodology for the specific index.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

export const MD_MODULE_2: SourceLesson[] = [
  {
    id: 'md-l4', title: 'Volatility: how much prices move', minutes: 13, objectives: ['md-o4'], prerequisites: ['md-l3'], mastery_rule: RULE('md-o4'), references: [SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Two shares, same average, different journeys', body: [
        'Volatility describes how widely returns swing around their average. Two shares can both average about 1% a month while one moves ±2% and the other ±10%.',
        'High volatility is not the same as a bad investment, and low volatility is not the same as a safe one. It measures how bumpy the path has been, not where it ends.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Same average, different paths', widget: 'percent_path', intro: 'Enter +10 and −10, then +30 and −30. Both pairs average 0%, but watch where ₹100 ends up.', alt_text: 'A step chart follows ₹100 through each percentage move and a sentence states the ending value and total change.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A share rises 20% and then falls 20%. Where does ₹100 end?', options: ['₹100', '₹96', '₹104'], answer: 1, reveal: '100 × 1.20 × 0.80 = 96. Larger swings cost more on the way back: this is sometimes called volatility drag.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Why big swings hurt compounding', steps: [
        '+10% then −10%: 1.10 × 0.90 = 0.99, a 1% loss.',
        '+30% then −30%: 1.30 × 0.70 = 0.91, a 9% loss.',
        'Both pairs have an average move of 0%, yet the wider swings lost nine times as much.',
        'This is why a series of returns cannot be judged by its average alone.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A share moves +15% then −15%. What is the total change?', hint: 'Multiply the growth factors 1.15 and 0.85.', answer_text: '1.15 × 0.85 = 0.9775, a fall of 2.25%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why does a share that has been calm for three years still carry risk?', model_answer: 'Past volatility describes the past only; news, results or market stress can produce moves far larger than anything seen recently.' },
      { stage: 'review', kind: 'summary', points: ['Volatility measures how widely returns swing.', 'Equal-sized gains and losses do not cancel: wider swings cost more.', 'Low past volatility does not cap future losses.'] },
    ],
    quiz: [
      { id: 'md-q4-1', objective: 'md-o4', skill: 'risk_vs_certainty', difficulty: 1, qtype: 'single_choice', stem: 'Share A swings about ±2% a month and share B about ±10%; both average 1%. Which is more volatile?', options: ['A', 'B', 'They are equally volatile', 'It cannot be said'], correct: { index: 1 }, explanation: 'Volatility is about the size of swings around the average; B swings five times as widely.', misconception: 'Judging risk by the average return.' },
      { id: 'md-q4-2', objective: 'md-o4', skill: 'risk_vs_certainty', difficulty: 2, qtype: 'numeric', stem: 'A share rises 20% and then falls 20%. What is the total return, in percent?', correct: { value: -4, abs_tol: 0.05, unit: '%' }, explanation: '1.20 × 0.80 = 0.96, so the total return is −4%.', misconception: 'Assuming +20% and −20% cancel out.' },
      { id: 'md-q4-3', objective: 'md-o4', skill: 'risk_vs_certainty', difficulty: 2, qtype: 'single_choice', stem: 'A share has had very low volatility for three years. Which statement is correct?', options: ['It cannot fall sharply', 'It can still fall sharply; past volatility does not limit future moves', 'Its future returns are guaranteed to be low', 'It is risk-free'], correct: { index: 1 }, explanation: 'Volatility is measured on the past; future moves can be much larger.', misconception: 'Treating historical calm as protection.' },
    ],
  },
  {
    id: 'md-l5', title: 'Diversification: what it removes and what it cannot', minutes: 15, objectives: ['md-o5'], prerequisites: ['md-l4'], mastery_rule: RULE('md-o5'), references: [SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Company risk and market risk', body: [
        'Some risk is specific to one company: a factory fire, a lost contract, a fraud. Some risk hits almost everything at once: a recession, a sharp rise in interest rates, a global sell-off.',
        'Holding many companies in different industries dilutes company-specific risk. It cannot remove the shared, market-wide part, because those shocks move most shares together.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Add companies, watch the risk', widget: 'diversification', intro: 'Choose how volatile each share is and how closely shares move together (correlation). Then increase the number of shares held in equal amounts.', alt_text: 'A chart plots portfolio volatility against the number of shares held, falling quickly at first and levelling off at a floor set by correlation; the values are also listed in a table.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Each share has 30% volatility and shares have a correlation of 0.3. Roughly how volatile is an equal-weighted portfolio of 1,000 such shares?', options: ['About 0%', 'About 16%', 'About 30%'], answer: 1, reveal: 'Volatility falls towards 30% × √0.3 ≈ 16.4% and stops there: the shared market risk remains however many shares you hold.' },
      { stage: 'investigate', kind: 'worked_example', title: 'The diversification formula', steps: [
        'For n shares held equally, each with volatility σ and average correlation ρ: portfolio volatility = σ × √(ρ + (1 − ρ) ÷ n).',
        'With σ = 30% and ρ = 0.3: one share gives 30%.',
        'Ten shares: 30% × √(0.3 + 0.7 ÷ 10) = 30% × √0.37 ≈ 18.25%.',
        'Very many shares: 30% × √0.3 ≈ 16.43%. Most of the benefit arrives with the first 10 to 20 holdings.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'If shares were perfectly correlated (ρ = 1), how much would diversification reduce volatility?', hint: 'Put ρ = 1 into the formula.', answer_text: 'Not at all: √(1 + 0) = 1, so the portfolio is as volatile as one share.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why might a portfolio of 20 bank shares be less diversified than 20 shares across different industries?', model_answer: 'Shares in one industry tend to move together (higher correlation), so the company-specific risk they dilute is smaller and they share sector-wide shocks.' },
      { stage: 'review', kind: 'summary', points: ['Diversification dilutes company-specific risk.', 'Market-wide risk remains; correlation sets the floor.', 'Spreading across industries matters as much as the number of holdings.'] },
    ],
    quiz: [
      { id: 'md-q5-1', objective: 'md-o5', skill: 'diversification', difficulty: 3, qtype: 'numeric', stem: 'Using volatility = σ × √(ρ + (1 − ρ) ÷ n), with σ = 30%, ρ = 0.3 and n = 10, what is the portfolio volatility in percent?', correct: { value: 18.25, abs_tol: 0.05, unit: '%' }, explanation: '30 × √(0.3 + 0.07) = 30 × 0.6083 ≈ 18.25%.', misconception: 'Dividing volatility by the number of holdings.' },
      { id: 'md-q5-2', objective: 'md-o5', skill: 'diversification', difficulty: 2, qtype: 'single_choice', stem: 'As the number of equally weighted holdings grows very large, portfolio volatility:', options: ['Falls to zero', 'Approaches a floor set by how closely shares move together', 'Rises', 'Stays the same as one share'], correct: { index: 1 }, explanation: 'The shared, market-wide component cannot be diversified away.', misconception: 'Believing enough holdings remove all risk.' },
      { id: 'md-q5-3', objective: 'md-o5', skill: 'diversification', difficulty: 2, qtype: 'multi_select', stem: 'Which actions reduce company-specific (concentration) risk? Select all that apply.', options: ['Holding companies from several different industries', 'Holding more companies in moderate amounts', 'Using a broad index fund', 'Putting more money into the share that rose most last year'], correct: { indexes: [0, 1, 2] }, explanation: 'Adding to last year\'s winner increases concentration rather than reducing it.', misconception: 'Confusing recent performance with diversification.' },
    ],
  },
];

export const MD_MODULE_3: SourceLesson[] = [
  {
    id: 'md-l6', title: 'Compounding: growth on growth', minutes: 12, objectives: ['md-o7'], prerequisites: ['md-l3'], mastery_rule: RULE('md-o7'), references: [SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Returns that earn returns', body: [
        'With compounding, each year\'s return is earned on the original amount plus everything earned so far.',
        'Over short periods the difference from simple interest is small. Over decades it dominates the outcome.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Watch ₹10,000 compound', widget: 'compound_growth', intro: 'Change the yearly rate and the number of years. Compare compound growth with simple growth on the same chart.', alt_text: 'Two lines show the value of ₹10,000 under compound and simple growth over the chosen years; the final values are stated in text.' },
      { stage: 'predict', kind: 'prediction', prompt: '₹10,000 grows at 10% a year for 20 years. Roughly what is it worth?', options: ['₹30,000', '₹67,000', '₹2,00,000'], answer: 1, reveal: '10,000 × 1.10²⁰ ≈ ₹67,275. Simple interest would give only ₹30,000.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Year by year', steps: [
        'Year 1: 10,000 × 1.10 = 11,000.',
        'Year 2: 11,000 × 1.10 = 12,100 (the extra ₹100 is interest on last year\'s interest).',
        'After n years: value = principal × (1 + r)ⁿ.',
        'Rule of 72: at r% a year, money doubles in roughly 72 ÷ r years. At 8%: about 9 years (exactly 9.01).',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Roughly how long does money take to double at 12% a year?', hint: 'Use the rule of 72.', answer_text: '72 ÷ 12 = 6 years (the exact figure is about 6.1 years).' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why does starting to invest a few years earlier make such a difference?', model_answer: 'Each extra year adds a compounding period at the end, when the balance is largest, so early years have an outsized effect on the final value.' },
      { stage: 'review', kind: 'summary', points: ['Compound value = principal × (1 + r)ⁿ.', 'Rule of 72: doubling time ≈ 72 ÷ rate.', 'Time is the most powerful input; returns are never guaranteed.'] },
    ],
    quiz: [
      { id: 'md-q6-1', objective: 'md-o7', skill: 'compounding', difficulty: 2, qtype: 'numeric', stem: '₹50,000 earns 8% a year, compounded annually, for 3 years. What is it worth, in rupees?', correct: { value: 62985.6, abs_tol: 1, unit: '₹' }, explanation: '50,000 × 1.08³ = 50,000 × 1.259712 = ₹62,985.60.', misconception: 'Using simple interest (₹62,000).' },
      { id: 'md-q6-2', objective: 'md-o7', skill: 'compounding', difficulty: 1, qtype: 'numeric', stem: 'Using the rule of 72, roughly how many years does money take to double at 6% a year?', correct: { value: 12, abs_tol: 0.01 }, explanation: '72 ÷ 6 = 12 years (exactly about 11.9).', misconception: 'Dividing 100 by the rate.' },
      { id: 'md-q6-3', objective: 'md-o7', skill: 'compounding', difficulty: 2, qtype: 'single_choice', stem: 'Why does compounding favour long holding periods?', options: ['Returns are higher in later years', 'Each period\'s return is earned on a growing base that includes past returns', 'Taxes disappear over time', 'Risk falls to zero over time'], correct: { index: 1 }, explanation: 'Growth on growth makes the curve steepen over time.', misconception: 'Thinking compounding changes the rate rather than the base.' },
    ],
  },
  {
    id: 'md-l7', title: 'Inflation and real returns', minutes: 12, objectives: ['md-o6'], prerequisites: ['md-l6'], mastery_rule: RULE('md-o6'), references: [RBI, SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'More rupees, less shopping', body: [
        'Inflation is the rise in the general price level. If your savings grow by 6% while prices rise 7%, you can buy less than before even though you have more rupees.',
        'The real return measures growth in purchasing power: real = (1 + nominal) ÷ (1 + inflation) − 1.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Nominal versus real', widget: 'real_return', intro: 'Set a nominal return and an inflation rate. See the real return and what ₹1,00,000 can buy after ten years.', alt_text: 'The widget shows the real return and two values after ten years, one in today\'s rupees and one in future rupees, as text and bars.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A deposit pays 7% and inflation is 5%. What is the real return?', options: ['Exactly 2%', 'Slightly less than 2%', 'Slightly more than 2%'], answer: 1, reveal: '1.07 ÷ 1.05 − 1 = 1.905%. Subtracting is a close approximation only when rates are low.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Ten years at 7% with 5% inflation', steps: [
        'Nominal: ₹1,00,000 × 1.07¹⁰ ≈ ₹1,96,715.',
        'Prices: 1.05¹⁰ ≈ 1.6289, so the same goods cost about 63% more.',
        'In today\'s rupees: 1,96,715 ÷ 1.6289 ≈ ₹1,20,766, a real gain of about 21% over ten years.',
        'Same answer from the real rate: 1,00,000 × 1.01905¹⁰ ≈ ₹1,20,766.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Savings earn 4% while inflation is 6%. What is the real return?', hint: '(1.04 ÷ 1.06) − 1.', answer_text: '−1.89%: purchasing power falls by almost 2% a year.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why should long-term goals be planned in real rather than nominal terms?', model_answer: 'Goals are about what money can buy; nominal growth that does not beat inflation leaves you worse off in real terms.' },
      { stage: 'review', kind: 'summary', points: ['Real return = (1 + nominal) ÷ (1 + inflation) − 1.', 'Positive nominal returns can be negative in real terms.', 'Compare investments on real, after-cost terms.'] },
    ],
    quiz: [
      { id: 'md-q7-1', objective: 'md-o6', skill: 'inflation', difficulty: 2, qtype: 'numeric', stem: 'An investment earns 9% while inflation is 6%. What is the real return, in percent (two decimals)?', correct: { value: 2.83, abs_tol: 0.01, unit: '%' }, explanation: '1.09 ÷ 1.06 − 1 = 2.830%.', misconception: 'Subtracting to get exactly 3%.' },
      { id: 'md-q7-2', objective: 'md-o6', skill: 'inflation', difficulty: 1, qtype: 'single_choice', stem: 'A fixed deposit pays 6.5% while consumer prices rise 7%. After a year, your purchasing power has:', options: ['Risen', 'Fallen', 'Stayed exactly the same', 'Doubled'], correct: { index: 1 }, explanation: 'The deposit grew less than prices, so it buys slightly less.', misconception: 'Looking only at the rupee balance.' },
      { id: 'md-q7-3', objective: 'md-o6', skill: 'inflation', difficulty: 1, qtype: 'single_choice', stem: 'Which best describes a real return?', options: ['The return before costs', 'The return after adjusting for inflation', 'The return guaranteed by a bank', 'The return in a foreign currency'], correct: { index: 1 }, explanation: 'Real returns measure growth in purchasing power.', misconception: 'Equating "real" with "actual".' },
    ],
  },
];

export const MD_MODULE_4: SourceLesson[] = [
  {
    id: 'md-l8', title: 'Indices and how they are weighted', minutes: 14, objectives: ['md-o8'], prerequisites: ['md-l1'], mastery_rule: RULE('md-o8'), references: [NIFTY, SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'One number for many shares', body: [
        'An index summarises the price movement of a defined group of shares. Major Indian benchmark indices are weighted by free-float market capitalisation: large companies, counting only shares available for trading, carry the most weight.',
        'Weighting decides whose moves matter. An equal-weighted index gives every member the same say.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Cap-weighted versus equal-weighted', widget: 'index_weighting', intro: 'Change the prices of a large and a small company and compare the two index returns.', alt_text: 'A table lists each company\'s weight and price change, with the cap-weighted and equal-weighted index returns stated below.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A large company worth 90% of an index rises 10% while the small one (10%) falls 10%. The cap-weighted index:', options: ['Is flat', 'Rises about 8%', 'Falls about 8%'], answer: 1, reveal: '0.9 × 10% + 0.1 × (−10%) = 8%. An equal-weighted index of the two would be flat.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Computing both returns', steps: [
        'Big: 90 shares at ₹100 → ₹110. Small: 10 shares at ₹100 → ₹90.',
        'Market value before: 9,000 + 1,000 = 10,000. After: 9,900 + 900 = 10,800. Cap-weighted return: 8%.',
        'Equal-weighted: average of +10% and −10% = 0%.',
        'Same day, two very different headlines: always check how an index is built.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'An index has A (market value ₹800 crore) and B (₹200 crore). A rises 10% and B falls 10%. What is the cap-weighted return?', hint: 'Weights 80% and 20%.', answer_text: '0.8 × 10% + 0.2 × (−10%) = 6%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why might the main index rise on a day when most shares fell?', model_answer: 'A few heavily weighted large companies rose enough to outweigh many smaller decliners.' },
      { stage: 'review', kind: 'summary', points: ['Weighting determines whose moves drive an index.', 'Cap weighting gives large companies more influence.', 'Read the index methodology before comparing returns.'] },
    ],
    quiz: [
      { id: 'md-q8-1', objective: 'md-o8', skill: 'index', difficulty: 2, qtype: 'numeric', stem: 'Company A (market value ₹800 crore) rises 10%; company B (₹200 crore) falls 10%. What is the cap-weighted index return, in percent?', correct: { value: 6, abs_tol: 0.05, unit: '%' }, explanation: '(880 + 180) ÷ 1,000 − 1 = 6%.', misconception: 'Averaging the two returns (0%).' },
      { id: 'md-q8-2', objective: 'md-o8', skill: 'index', difficulty: 1, qtype: 'single_choice', stem: 'In a free-float market-cap weighted index, the largest weights go to:', options: ['Companies with the highest share price', 'Companies whose freely traded shares have the highest total market value', 'The oldest companies', 'Companies chosen by the exchange each day'], correct: { index: 1 }, explanation: 'Weight depends on free-float market value, not the price per share.', misconception: 'Confusing a high share price with a large company.' },
      { id: 'md-q8-3', objective: 'md-o8', skill: 'index', difficulty: 2, qtype: 'numeric', stem: 'In the same two-company example, what would an equal-weighted index return, in percent?', correct: { value: 0, abs_tol: 0.05, unit: '%' }, explanation: 'The average of +10% and −10% is 0%.', misconception: 'Applying market-value weights to an equal-weighted index.' },
    ],
  },
  {
    id: 'md-l9', title: 'Reading breadth and the daily briefing', minutes: 15, objectives: ['md-o9'], prerequisites: ['md-l8'], mastery_rule: RULE('md-o9'), references: [SEBI, NIFTY],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Beyond the headline number', body: [
        'Breadth asks how many shares rose versus fell. An index can rise while most shares fall, if a few heavyweights carry it.',
        'The ATLAS daily briefing combines index moves, breadth, sector returns and volatility, and links every number to its source and calculation. It describes what happened; it does not forecast or recommend.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Read today\'s market in ATLAS', href: '/app/market', steps: [
        'Open Market and note the index change and the advance/decline counts.',
        'Is breadth broad (most shares up) or narrow (a few heavyweights)?',
        'Open the latest briefing and click any number to see its evidence: source, date and calculation.',
        'Note whether the data is synthetic (development data is labelled) and when it was last updated.',
      ], alt_text: 'A guided exercise in the ATLAS Market page and daily briefing; all steps are described in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'The index rose 0.8% but 1,300 shares fell and 700 rose. What is the most likely explanation?', options: ['Data error', 'A few large, heavily weighted companies rose', 'Most companies rose'], answer: 1, reveal: 'Narrow breadth with a rising index usually means gains concentrated in large-weight companies.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Advance–decline ratio', steps: [
        'Advance–decline ratio = advances ÷ declines.',
        '1,200 advances and 800 declines: ratio 1.5 (broad strength).',
        '700 advances and 1,300 declines: ratio 0.54 (broad weakness), even if the index rose.',
        'Read breadth alongside the index rather than instead of it.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'On a day with 950 advances, 1,050 declines and an index up 0.1%, how would you describe the market?', hint: 'Compare breadth with the index move.', answer_text: 'Nearly flat and mixed: slightly more decliners than advancers, with a marginal index gain.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why does ATLAS link every figure in the briefing to its evidence?', model_answer: 'So readers can check the source, date and calculation behind each number instead of trusting a headline.' },
      { stage: 'review', kind: 'summary', points: ['Breadth shows how widely a move is shared.', 'Index and breadth can disagree.', 'ATLAS briefings describe the past session with evidence; they are not forecasts or advice.'] },
    ],
    quiz: [
      { id: 'md-q9-1', objective: 'md-o9', skill: 'market_reading', difficulty: 1, qtype: 'numeric', stem: 'On a session with 1,200 advances and 800 declines, what is the advance–decline ratio?', correct: { value: 1.5, abs_tol: 0.005 }, explanation: '1,200 ÷ 800 = 1.5.', misconception: 'Dividing declines by advances.' },
      { id: 'md-q9-2', objective: 'md-o9', skill: 'market_reading', difficulty: 2, qtype: 'single_choice', stem: 'The index rose but most shares fell. This most likely means:', options: ['Gains were concentrated in a few heavily weighted companies', 'The index is calculated wrongly', 'Most investors made money', 'Small companies drove the rise'], correct: { index: 0 }, explanation: 'In a cap-weighted index, large companies can outweigh many small decliners.', misconception: 'Assuming the index reflects the typical share.' },
      { id: 'md-q9-3', objective: 'md-o9', skill: 'market_reading', difficulty: 1, qtype: 'single_choice', stem: 'Which statement describes the ATLAS daily briefing?', options: ['A forecast of tomorrow\'s market', 'A list of recommended shares', 'A description of the past session with each figure linked to its source and calculation', 'Live intraday prices'], correct: { index: 2 }, explanation: 'Briefings are end-of-day, evidence-linked descriptions, not forecasts or recommendations.', misconception: 'Treating a market summary as advice.' },
    ],
  },
];
