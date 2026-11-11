import type { SourceLesson } from '../curriculum.js';

// SIGNAL ENGINEER, modules 1–3. Original text; numbers match packages/shared learning-sims tests.
// Status: in_review (AI-assisted draft) until a named reviewer completes the seven-point review.

const BTM = { title: 'ATLAS methodology: backtests', url: '/methodology/backtests', note: 'Engine timing, cost table, liquidity rules, bias controls and known limitations.' };
const SEBI = { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'General investor education from the Indian securities regulator.' };
const LIT = { title: 'Further reading: research on backtest overfitting and multiple testing', note: 'Academic literature on data snooping (for example, work on the probability of backtest overfitting) explains why selected strategies disappoint out of sample. Summarised here in original words; consult the papers directly.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

export const SE_MODULE_1: SourceLesson[] = [
  {
    id: 'se-l1', title: 'Returns, volatility and drawdown', minutes: 16, objectives: ['se-o1'], mastery_rule: RULE('se-o1'), references: [BTM, SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Three ways to describe a return series', body: [
        'Return: how much value changed. Volatility: how widely periodic returns swing (annualised by multiplying daily volatility by √252). Drawdown: the fall from a previous peak.',
        'Maximum drawdown captures the worst experience an investor would have lived through, which averages hide.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Find the worst fall', widget: 'drawdown', intro: 'Edit a series of portfolio values and see the running peak, the drawdown at each point and the maximum drawdown.', alt_text: 'A chart shows portfolio value with its running peak; the maximum drawdown, its peak and trough are listed as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A portfolio goes 200 → 260 → 182 → 240. What is the maximum drawdown?', options: ['9%', '30%', '20%'], answer: 1, reveal: 'Peak 260, trough 182: (260 − 182) ÷ 260 = 30%. The start value is irrelevant.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Recovering from a drawdown', steps: [
        'After a 30% fall, ₹100 becomes ₹70.',
        'To return to ₹100 needs 100 ÷ 70 − 1 = 42.86%.',
        'After 50%: 100%. After 75%: 300%. Deep drawdowns take disproportionate gains to repair.',
        'ATLAS backtest reports show maximum drawdown and its dates next to returns for this reason.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Daily volatility is 1.2%. Roughly what is the annualised volatility?', hint: 'Multiply by √252 ≈ 15.87.', answer_text: '1.2% × 15.87 ≈ 19.0% a year.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why might two strategies with the same annual return feel completely different to hold?', model_answer: 'One may have had much deeper or longer drawdowns, testing the investor\'s patience and capital along the way.' },
      { stage: 'review', kind: 'summary', points: ['Report return, volatility and drawdown together.', 'Maximum drawdown is measured from the previous peak.', 'Recovery needs grow faster than losses.'] },
    ],
    quiz: [
      { id: 'se-q1-1', objective: 'se-o1', skill: 'returns', difficulty: 2, qtype: 'numeric', stem: 'A portfolio goes 200 → 260 → 182 → 240. What is the maximum drawdown, in percent?', correct: { value: 30, abs_tol: 0.05, unit: '%' }, explanation: '(260 − 182) ÷ 260 = 30%.', misconception: 'Measuring from the starting value.' },
      { id: 'se-q1-2', objective: 'se-o1', skill: 'returns', difficulty: 2, qtype: 'numeric', stem: 'After a 30% loss, what gain is needed to recover, in percent (two decimals)?', correct: { value: 42.86, abs_tol: 0.05, unit: '%' }, explanation: '1 ÷ 0.7 − 1 = 42.86%.', misconception: 'Assuming a 30% gain recovers a 30% loss.' },
      { id: 'se-q1-3', objective: 'se-o1', skill: 'volatility', difficulty: 3, qtype: 'single_choice', stem: 'Daily returns are independent with volatility σ. Roughly how does volatility scale to a year of 252 trading days?', options: ['σ × 252', 'σ × √252', 'σ ÷ 252', 'It does not change'], correct: { index: 1 }, explanation: 'Variances add for independent returns, so standard deviation scales with the square root of time.', misconception: 'Scaling volatility linearly with time.' },
    ],
  },
  {
    id: 'se-l2', title: 'Probability and expected value', minutes: 14, objectives: ['se-o4'], prerequisites: ['se-l1'], mastery_rule: RULE('se-o4'), references: [SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Averages over many outcomes', body: [
        'Expected value (EV) = Σ probability × outcome. A positive EV means a rule would gain on average over many independent repetitions; it says nothing certain about any single outcome.',
        'Market outcomes are not coin flips with known odds; probabilities estimated from history are themselves uncertain.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Volatility drag on repeated bets', widget: 'percent_path', intro: 'Try +50% then −40% repeated twice. The average move is +5%, yet watch what happens to ₹100.', alt_text: 'A step chart follows ₹100 through the chosen moves; the final value and total change are stated in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A bet wins ₹200 with probability 0.3 and loses ₹50 with probability 0.7. Is the expected value positive?', options: ['Yes, +₹25', 'No, −₹25', 'Zero'], answer: 0, reveal: '0.3 × 200 − 0.7 × 50 = 60 − 35 = +₹25 on average, while 70% of single tries still lose.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Average return versus compounded growth', steps: [
        'A share gains 50% or loses 40% with equal chance each year: the average yearly return is +5%.',
        'Over two years with one of each: 1.5 × 0.6 = 0.90, a 10% loss.',
        'The typical compounded path loses money even though the arithmetic average is positive.',
        'What matters for wealth is the growth of the multiplied path, not the simple average.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Two independent events each have probability 0.5. What is the probability both happen?', hint: 'Multiply independent probabilities.', answer_text: '0.5 × 0.5 = 0.25, or 25%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can a strategy with positive expected value still ruin an investor?', model_answer: 'Large losses or too much size per bet can wipe out capital before the average works out; compounding punishes big losses.' },
      { stage: 'review', kind: 'summary', points: ['EV = Σ probability × outcome.', 'Positive EV does not guarantee any single result.', 'Compounded growth can be negative even when average returns are positive.'] },
    ],
    quiz: [
      { id: 'se-q2-1', objective: 'se-o4', skill: 'probability', difficulty: 2, qtype: 'numeric', stem: 'A bet wins ₹200 with probability 0.3 and loses ₹50 with probability 0.7. What is its expected value, in rupees?', correct: { value: 25, abs_tol: 0.01, unit: '₹' }, explanation: '0.3 × 200 − 0.7 × 50 = ₹25.', misconception: 'Ignoring the probabilities.' },
      { id: 'se-q2-2', objective: 'se-o4', skill: 'probability', difficulty: 2, qtype: 'single_choice', stem: 'A rule has positive expected value. Which is true?', options: ['It will make money next time', 'It gains on average over many independent repetitions, but any single try can lose', 'It cannot lose money', 'It is guaranteed to beat the market'], correct: { index: 1 }, explanation: 'Expected value describes a long-run average, not a single outcome.', misconception: 'Treating expectation as certainty.' },
      { id: 'se-q2-3', objective: 'se-o4', skill: 'probability', difficulty: 3, qtype: 'numeric', stem: 'A share gains 50% one year and loses 40% the next. What is the total two-year return, in percent?', correct: { value: -10, abs_tol: 0.05, unit: '%' }, explanation: '1.5 × 0.6 = 0.9, a 10% loss, despite a +5% average yearly return.', misconception: 'Adding the yearly returns.' },
    ],
  },
];

export const SE_MODULE_2: SourceLesson[] = [
  {
    id: 'se-l3', title: 'Look-ahead and survivorship bias', minutes: 15, objectives: ['se-o2'], prerequisites: ['se-l1'], mastery_rule: RULE('se-o2'), references: [BTM],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Testing with information you did not have', body: [
        'Look-ahead bias uses information that was not yet available: annual results filed in May used to trade in January, or a closing price used to trade at that same close.',
        'Survivorship bias tests only on companies that still exist today, silently dropping those that failed or delisted, which flatters results.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'See the bias controls in the ATLAS Quant Lab', href: '/methodology/backtests', steps: [
        'Read how ATLAS times signals (at the close) and fills (at the next session\'s open).',
        'Find how fundamentals become usable only from their filing timestamp.',
        'Find how delisted companies stay in historical universes (point-in-time membership).',
        'Open a company that delisted in the synthetic data and note that its history is kept, not deleted.',
      ], alt_text: 'A guided reading of the ATLAS backtest methodology; all steps are described in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A backtest buys companies with strong FY results on 2 April, but those results were filed on 20 May. What is wrong?', options: ['Nothing', 'Look-ahead bias: the results were not known on 2 April', 'Survivorship bias'], answer: 1, reveal: 'Indian companies typically file annual results weeks after the year ends; a test must use them only after the filing date.' },
      { stage: 'investigate', kind: 'worked_example', title: 'How survivorship inflates returns', steps: [
        'Start of period: 10 companies. Two fail and delist, losing 100%. Eight survive with +40% on average.',
        'True equal-weighted return: (8 × 40% + 2 × (−100%)) ÷ 10 = 12%.',
        'Survivors-only test: 40%. The bias added 28 percentage points.',
        'Point-in-time universes keep the failures in the test.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A rule computes its signal from the day\'s close. When should the test assume the trade happens?', hint: 'When could you actually act on that information?', answer_text: 'At the next session\'s open (or later), not at the same close.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is keeping the originally reported (not restated) figures important for backtests?', model_answer: 'Investors at the time saw the original numbers; using restated ones uses information that only appeared later.' },
      { stage: 'review', kind: 'summary', points: ['Use data only from when it became available.', 'Keep failed and delisted companies in historical universes.', 'Signals at the close imply execution at the next open.'] },
    ],
    quiz: [
      { id: 'se-q3-1', objective: 'se-o2', skill: 'bias', difficulty: 2, qtype: 'single_choice', stem: 'A test uses FY results (filed 20 May) to trade on 2 April. This is:', options: ['Survivorship bias', 'Look-ahead bias', 'Correct practice', 'Benchmark mismatch'], correct: { index: 1 }, explanation: 'The information did not exist on the trade date.', misconception: 'Assuming results are known on the period-end date.' },
      { id: 'se-q3-2', objective: 'se-o2', skill: 'bias', difficulty: 3, qtype: 'numeric', stem: 'Ten companies: eight return +40% and two delist with −100%. What is the true equal-weighted return, in percent?', correct: { value: 12, abs_tol: 0.05, unit: '%' }, explanation: '(8 × 40 − 2 × 100) ÷ 10 = 12%.', misconception: 'Averaging only the survivors (40%).' },
      { id: 'se-q3-3', objective: 'se-o2', skill: 'bias', difficulty: 1, qtype: 'single_choice', stem: 'How do point-in-time universes reduce survivorship bias?', options: ['They remove failed companies', 'They include each company only for the dates it was actually in the universe, including later failures', 'They use today\'s index members for all dates', 'They ignore delistings'], correct: { index: 1 }, explanation: 'Membership is tied to dates, so failures stay in the history.', misconception: 'Using today\'s constituents for the past.' },
    ],
  },
  {
    id: 'se-l4', title: 'Overfitting and data snooping', minutes: 16, objectives: ['se-o2'], prerequisites: ['se-l3'], mastery_rule: RULE('se-o2'), references: [BTM, LIT],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'When the best result is mostly luck', body: [
        'Try enough variations on the same data and some will look excellent purely by chance. Choosing the best one selects luck as much as skill.',
        'The cure is discipline: decide the hypothesis and test plan first, hold back data the search never sees, count every variant tried and expect performance to fall out of sample.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'The best of many coin flips', widget: 'overfit', intro: 'Generate many strategies with no edge at all (each gains or loses 1% at random). Pick the best on the first half and see how it does on the second half.', alt_text: 'The widget reports the best in-sample result, the same strategy\'s out-of-sample result and the average in-sample result, as text and bars.' },
      { stage: 'predict', kind: 'prediction', prompt: 'The best of 200 no-edge strategies made +16% in-sample. What should you expect from it out of sample?', options: ['About +16%', 'About 0%', 'About +32%'], answer: 1, reveal: 'With no real edge, the winner\'s future is a coin flip: around zero on average.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Counting false discoveries', steps: [
        'Test 40 rules that truly have no edge at the 5% significance level.',
        'Expected false positives: 40 × 0.05 = 2 "significant" rules by chance.',
        'ATLAS warns when many variants are tested in one session and asks you to record your hypothesis before running.',
        'Prefer fewer, pre-specified tests with an untouched hold-out period.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'You tried 25 parameter combinations and kept the best. What should you report alongside its result?', hint: 'Think about what a reader needs to judge luck.', answer_text: 'That 25 variants were tested, how the winner was chosen, and its performance on data not used for selection.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why does adding more rules and conditions increase the risk of overfitting?', model_answer: 'Each extra condition gives the search more freedom to fit noise in the sample, which will not repeat.' },
      { stage: 'review', kind: 'summary', points: ['Searching many variants manufactures impressive results by chance.', 'Expected false positives = tests × significance level.', 'Pre-register, hold out data, count variants, expect decay.'] },
    ],
    quiz: [
      { id: 'se-q4-1', objective: 'se-o2', skill: 'bias', difficulty: 2, qtype: 'single_choice', stem: 'You pick the best of 200 strategies that have no real edge. Its expected out-of-sample result is roughly:', options: ['The same as in-sample', 'Zero (no edge)', 'Double the in-sample result', 'Always negative'], correct: { index: 1 }, explanation: 'Selection picked luck; luck does not persist.', misconception: 'Believing the in-sample winner will keep winning.' },
      { id: 'se-q4-2', objective: 'se-o2', skill: 'bias', difficulty: 2, qtype: 'numeric', stem: 'You test 40 rules with no real edge at a 5% significance level. How many false positives do you expect?', correct: { value: 2, abs_tol: 0.01 }, explanation: '40 × 0.05 = 2.', misconception: 'Ignoring multiple testing.' },
      { id: 'se-q4-3', objective: 'se-o2', skill: 'bias', difficulty: 3, qtype: 'single_choice', stem: 'Which practice best protects against data snooping?', options: ['Testing until a variant works', 'Keeping a hold-out period that the search never touches and reporting every variant tried', 'Choosing the period where the rule worked best', 'Removing transaction costs to see the signal clearly'], correct: { index: 1 }, explanation: 'Untouched data and full disclosure of the search make luck visible.', misconception: 'Treating more searching as more evidence.' },
    ],
  },
];

export const SE_MODULE_3: SourceLesson[] = [
  {
    id: 'se-l5', title: 'Designing a fair backtest in the Quant Lab', minutes: 18, objectives: ['se-o3'], prerequisites: ['se-l4'], mastery_rule: RULE('se-o3'), references: [BTM],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'A test plan before a test', body: [
        'A fair backtest states the hypothesis, universe and membership rules, signal timing, execution and costs, benchmark, evaluation period and the number of variants you will try, before looking at results.',
        'ATLAS records every run with its data snapshot, engine version and cost table so it can be reproduced exactly.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Run and read a backtest', widget: 'param_surface_3d', intro: "A fair backtest chooses its rules before it sees the test data. This surface is 25 versions of one rule on real Brent prices. Switch between in-sample and out-of-sample and watch where the best-looking peak lands.", href: '/app/lab', steps: [
        'Write your hypothesis in a note first (for example: "a 50/200-day crossover reduced drawdowns on this company without destroying returns").',
        'Run the moving-average template on one company with costs included.',
        'Read every warning (few trades, single security, benchmark mismatch) and open its explanation.',
        'Re-run the saved test and confirm the results hash is identical; compare with the benchmark.',
      ], alt_text: 'A guided exercise in the ATLAS Quant Lab; all steps are described in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A test produced 14 trades over six years. What should you conclude about its win rate?', options: ['It is reliable', 'It is weak evidence: too few trades to separate skill from luck', 'It proves the rule works'], answer: 1, reveal: 'ATLAS warns below 30 trades because a handful of outcomes can swing the statistics.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Reading a result honestly', steps: [
        'Total return 48% versus a benchmark 61% over the same period, with maximum drawdown 18% versus 32%.',
        'Lower return, lower drawdown: a different risk profile, not "better" or "worse" on one number.',
        'Doubling costs cut the return to 39%: results are cost-sensitive.',
        'Conclusion written as a hypothesis with limitations, never as a recommendation.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Name three things you must decide before running a test.', hint: 'Think: what, when, compared with what.', answer_text: 'Hypothesis and rules; universe and period (with hold-out); costs, execution timing and benchmark.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why does ATLAS never show "today\'s signal" from a strategy?', model_answer: 'The Lab is for studying the past; showing live signals would turn research into trading recommendations.' },
      { stage: 'review', kind: 'summary', points: ['Write the plan before seeing results.', 'Read warnings, costs, benchmark and drawdown together.', 'Reproducible runs make results checkable.'] },
    ],
    quiz: [
      { id: 'se-q5-1', objective: 'se-o3', skill: 'experiment_design', difficulty: 1, qtype: 'single_choice', stem: 'In the ATLAS engine, a signal computed on a session\'s close is executed:', options: ['At the same close', 'At the next session\'s open', 'At the previous close', 'At the day\'s high'], correct: { index: 1 }, explanation: 'Execution follows the information, avoiding look-ahead.', misconception: 'Trading on information at the instant it appears.' },
      { id: 'se-q5-2', objective: 'se-o3', skill: 'experiment_design', difficulty: 2, qtype: 'multi_select', stem: 'Which belong in a fair backtest plan? Select all that apply.', options: ['Transaction costs and slippage', 'A suitable benchmark', 'A hold-out period', 'Choosing the period after seeing where the rule worked best'], correct: { indexes: [0, 1, 2] }, explanation: 'Choosing the period after the fact is cherry-picking.', misconception: 'Treating period selection as a free choice.' },
      { id: 'se-q5-3', objective: 'se-o3', skill: 'experiment_design', difficulty: 2, qtype: 'single_choice', stem: 'A backtest has only 14 trades. The best interpretation is:', options: ['The result is statistically strong', 'Weak evidence: too few trades to distinguish skill from luck', 'The strategy is safe', 'Costs do not matter'], correct: { index: 1 }, explanation: 'Small samples make statistics unstable.', misconception: 'Trusting a high win rate from few trades.' },
    ],
  },
  {
    id: 'se-l6', title: 'Costs, turnover and benchmarks', minutes: 14, objectives: ['se-o3'], prerequisites: ['se-l5'], mastery_rule: RULE('se-o3'), references: [BTM],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Small costs, repeated often', body: [
        'Every trade pays costs: brokerage, securities transaction tax, exchange and regulatory charges, stamp duty, GST and slippage. Annual cost drag ≈ turnover × cost per unit traded.',
        'A benchmark must match the strategy\'s universe and risk; beating the wrong benchmark proves little.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Cost drag calculator', widget: 'cost_drag', intro: 'Set gross return, turnover and cost per unit traded; see the net return.', alt_text: 'The widget shows cost drag and net return as text and bars.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A strategy trades 6× its portfolio value a year at 0.25% per unit traded. What is the annual cost drag?', options: ['0.25%', '1.5%', '6%'], answer: 1, reveal: '6 × 0.25% = 1.5% of the portfolio every year.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Gross to net', steps: [
        'Gross return 14%, turnover 6×, cost 0.25% → drag 1.5% → net 12.5%.',
        'At turnover 20× the drag is 5%, wiping out much of a 14% edge.',
        'A small-company strategy should be compared with a small-company index, not a large-company benchmark.',
        'ATLAS uses a versioned cost table and flags benchmark mismatches.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Gross 10%, turnover 4×, cost 0.3%. What is the net return?', hint: 'Drag = 4 × 0.3%.', answer_text: 'Drag 1.2%, net 8.8%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can a high-turnover rule look great before costs and poor after?', model_answer: 'Its edge per trade may be smaller than the cost per trade; repeated many times, costs consume the edge.' },
      { stage: 'review', kind: 'summary', points: ['Cost drag ≈ turnover × cost per unit traded.', 'Always report results after costs.', 'Use a benchmark with a matching universe and risk.'] },
    ],
    quiz: [
      { id: 'se-q6-1', objective: 'se-o3', skill: 'experiment_design', difficulty: 2, qtype: 'numeric', stem: 'Turnover is 6× a year and costs are 0.25% of value traded. What is the annual cost drag, in percent?', correct: { value: 1.5, abs_tol: 0.005, unit: '%' }, explanation: '6 × 0.25% = 1.5%.', misconception: 'Counting cost once per year instead of per unit traded.' },
      { id: 'se-q6-2', objective: 'se-o3', skill: 'experiment_design', difficulty: 2, qtype: 'numeric', stem: 'Gross return 14%, turnover 6×, cost 0.25% per unit traded. What is the net return, in percent?', correct: { value: 12.5, abs_tol: 0.005, unit: '%' }, explanation: '14 − 1.5 = 12.5%.', misconception: 'Ignoring turnover.' },
      { id: 'se-q6-3', objective: 'se-o3', skill: 'experiment_design', difficulty: 1, qtype: 'single_choice', stem: 'A small-company strategy should be compared with:', options: ['A large-company index', 'A small-company index with a similar universe', 'A fixed deposit rate only', 'No benchmark'], correct: { index: 1 }, explanation: 'A matching benchmark separates strategy skill from size exposure.', misconception: 'Using whichever benchmark makes results look best.' },
    ],
  },
];
