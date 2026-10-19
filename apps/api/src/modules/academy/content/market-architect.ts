import type { SourceLesson } from '../curriculum.js';

// MARKET ARCHITECT, modules 1–3. Original text; numbers match packages/shared learning-sims tests.
// Status: in_review (AI-assisted draft) until a named reviewer completes the seven-point review.

const METH = { title: 'ATLAS methodology', url: '/methodology', note: 'Metric definitions, backtest engine and AI evidence rules used throughout ATLAS.' };
const LIT = { title: 'Further reading: valuation and portfolio theory texts', note: 'Standard corporate-finance and portfolio-theory textbooks cover discounted cash flow, the cost of capital and diversification in depth. This lesson is an original summary; consult the texts directly.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

export const MA_MODULE_1: SourceLesson[] = [
  {
    id: 'ma-l1', title: 'Discounted cash flow', minutes: 18, objectives: ['ma-o1'], mastery_rule: RULE('ma-o1'), references: [LIT, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'A rupee later is worth less than a rupee now', body: [
        'A discounted cash flow (DCF) values a business as the present value of the free cash flows it is expected to generate, discounted at a rate reflecting risk and the cost of capital.',
        'Typical structure: a few explicitly forecast years, then a terminal value assuming steady growth for ever: TV = FCF(n+1) ÷ (r − g). The result is only as good as the assumptions.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Build a three-year DCF', widget: 'dcf', intro: 'Enter three years of free cash flow, a discount rate and terminal growth. See the present values and how much of the value comes from the terminal value.', alt_text: 'A table lists each year\'s cash flow and present value, the terminal value and its present value, the total and the terminal share, all as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'With FCF of 100, 110 and 121 at 12% and 4% terminal growth, roughly what share of the value comes from the terminal value?', options: ['About 20%', 'About 50%', 'About 80%'], answer: 2, reveal: 'About 81%: most of a typical DCF\'s value sits in the assumption about the distant future.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Step by step (₹ crore)', steps: [
        'PV of explicit years: 100 ÷ 1.12 + 110 ÷ 1.12² + 121 ÷ 1.12³ = 89.29 + 87.69 + 86.13 = 263.10.',
        'Terminal value at year 3: 121 × 1.04 ÷ (0.12 − 0.04) = 1,573.',
        'PV of terminal value: 1,573 ÷ 1.12³ = 1,573 ÷ 1.404928 = 1,119.63.',
        'Enterprise value ≈ 263.10 + 1,119.63 = 1,382.73; terminal share ≈ 81%.',
        'Equity value = enterprise value − debt + cash; per-share value divides by shares outstanding.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Next year\'s FCF is ₹50 crore, growing 5% for ever; the discount rate is 11%. What is the value?', hint: 'Growing perpetuity: FCF ÷ (r − g).', answer_text: '50 ÷ (0.11 − 0.05) = ₹833.33 crore.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is a DCF better thought of as a way to examine assumptions than as a precise value?', model_answer: 'Small changes in growth or discount rate move the value a lot, especially the terminal value; the model shows what you must believe for a given price.' },
      { stage: 'review', kind: 'summary', points: ['Value = PV of explicit cash flows + PV of terminal value.', 'TV = FCF(n+1) ÷ (r − g), requires r > g.', 'Terminal value often dominates: test the assumptions.'] },
    ],
    quiz: [
      { id: 'ma-q1-1', objective: 'ma-o1', skill: 'dcf', difficulty: 2, qtype: 'numeric', stem: 'What is the present value of ₹121 crore received in year 3 at a 12% discount rate, in ₹ crore (two decimals)?', correct: { value: 86.13, abs_tol: 0.01, unit: '₹ crore' }, explanation: '121 ÷ 1.12³ = 121 ÷ 1.404928 = 86.13.', misconception: 'Discounting once instead of compounding over three years.' },
      { id: 'ma-q1-2', objective: 'ma-o1', skill: 'dcf', difficulty: 2, qtype: 'numeric', stem: 'Next year\'s FCF is ₹50 crore, growing 5% for ever, discounted at 11%. What is the value, in ₹ crore (two decimals)?', correct: { value: 833.33, abs_tol: 0.01, unit: '₹ crore' }, explanation: '50 ÷ 0.06 = 833.33.', misconception: 'Adding growth to the discount rate.' },
      { id: 'ma-q1-3', objective: 'ma-o1', skill: 'dcf', difficulty: 3, qtype: 'single_choice', stem: 'In a DCF, the terminal value is 80% of the total. What follows?', options: ['The valuation is precise', 'The result is highly sensitive to the terminal growth and discount rate assumptions', 'The explicit years can be ignored', 'The company must be undervalued'], correct: { index: 1 }, explanation: 'When most value sits in the terminal assumption, small changes there move the answer most.', misconception: 'Treating the DCF output as a fact.' },
    ],
  },
  {
    id: 'ma-l2', title: 'Scenarios and sensitivity', minutes: 16, objectives: ['ma-o1'], prerequisites: ['ma-l1'], mastery_rule: RULE('ma-o1'), references: [LIT, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'From one number to a range', body: [
        'Sensitivity analysis changes one or two inputs at a time to show how the value responds. Scenario analysis changes a coherent set of inputs together (bear, base, bull) to tell different stories about the business.',
        'A reverse DCF asks the opposite question: what growth does today\'s price imply?',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'The sensitivity surface', widget: 'dcf_surface_3d', intro: 'Explore value across discount rates and terminal growth rates as a 3D surface (or a table, if 3D is unavailable or you prefer reduced motion).', alt_text: 'A grid of DCF values for each combination of discount rate (rows) and terminal growth (columns); the same values appear in an accessible table.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Next year\'s FCF is 100 and the discount rate 12%. Terminal growth goes from 4% to 5%. The perpetuity value rises by roughly:', options: ['1%', '14%', '50%'], answer: 1, reveal: '100 ÷ 0.08 = 1,250 → 100 ÷ 0.07 = 1,428.6: about +14.3% from a one-point change.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Three scenarios (₹ crore)', steps: [
        'Bear: FCF flat at 100 for three years, 13% discount, 3% growth.',
        'Base: 100, 110, 121; 12% discount; 4% growth → about 1,383.',
        'Bull: 100, 115, 132; 11% discount; 5% growth.',
        'Present the range and the assumptions behind each scenario, never only the base case.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A company\'s value per share is ₹500 in the base case, ₹320 in the bear case and ₹740 in the bull case. How should you describe this?', hint: 'Report the range and what drives it.', answer_text: 'Value is highly uncertain (₹320–₹740), driven by growth and the discount rate; state the assumptions rather than a single target.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is a reverse DCF useful when a share trades at a high multiple?', model_answer: 'It shows the growth the price already assumes, which you can judge against the business\'s history and industry.' },
      { stage: 'review', kind: 'summary', points: ['Sensitivity moves inputs one or two at a time.', 'Scenarios move coherent sets of assumptions together.', 'Reverse DCF finds the growth implied by the price.'] },
    ],
    quiz: [
      { id: 'ma-q2-1', objective: 'ma-o1', skill: 'dcf', difficulty: 3, qtype: 'numeric', stem: 'Next year\'s FCF 100, discount rate 12%. By how much does the perpetuity value rise, in percent (two decimals), if growth goes from 4% to 5%?', correct: { value: 14.29, abs_tol: 0.05, unit: '%' }, explanation: '1,428.57 ÷ 1,250 − 1 = 14.29%.', misconception: 'Expecting a one-point change in growth to change value by about one percent.' },
      { id: 'ma-q2-2', objective: 'ma-o1', skill: 'dcf', difficulty: 2, qtype: 'single_choice', stem: 'What distinguishes scenario analysis from sensitivity analysis?', options: ['Nothing', 'Scenarios change a coherent set of assumptions together; sensitivity varies one or two inputs', 'Scenarios use no numbers', 'Sensitivity analysis always uses three cases'], correct: { index: 1 }, explanation: 'Scenarios tell consistent stories; sensitivities isolate the effect of single inputs.', misconception: 'Using the terms interchangeably.' },
      { id: 'ma-q2-3', objective: 'ma-o1', skill: 'dcf', difficulty: 2, qtype: 'single_choice', stem: 'A reverse DCF answers which question?', options: ['What is the fair price?', 'What growth does the current price imply?', 'What will the share do next year?', 'What dividend will be paid?'], correct: { index: 1 }, explanation: 'It solves for the assumptions embedded in today\'s price.', misconception: 'Treating any DCF as a forecast.' },
    ],
  },
];

export const MA_MODULE_2: SourceLesson[] = [
  {
    id: 'ma-l3', title: 'Correlation and portfolio volatility', minutes: 16, objectives: ['ma-o2'], mastery_rule: RULE('ma-o2'), references: [LIT],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Risk does not add up linearly', body: [
        'For two assets, portfolio variance = w₁²σ₁² + w₂²σ₂² + 2w₁w₂ρσ₁σ₂. Portfolio volatility is its square root.',
        'Only with perfect correlation (ρ = 1) is portfolio volatility the weighted average; lower correlation lowers risk below the average.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Two-asset risk explorer', widget: 'portfolio_risk', intro: 'Set the two volatilities, the weight and the correlation. Move correlation from 1 to −1.', alt_text: 'A chart plots portfolio volatility against weight for the chosen correlation, with the current value stated as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Two assets, each 20% volatile, equal weights, correlation 0. Portfolio volatility is about:', options: ['20%', '14%', '10%'], answer: 1, reveal: '√(0.25 × 0.04 × 2) = √0.02 ≈ 14.14%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'A 60/40 mix', steps: [
        'Asset A 25% volatility, asset B 15%, weights 60/40, correlation 0.2.',
        'Variance = 0.36 × 0.0625 + 0.16 × 0.0225 + 2 × 0.6 × 0.4 × 0.2 × 0.25 × 0.15 = 0.0225 + 0.0036 + 0.0036 = 0.0297.',
        'Volatility = √0.0297 ≈ 17.23%, below the 21% weighted average.',
        'In crises, correlations often rise, so the benefit can shrink when it is most needed.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'What is the volatility of a 50/50 mix of two 20%-volatile assets with correlation 1?', hint: 'Perfect correlation: no diversification.', answer_text: '20%, the weighted average.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can a portfolio built on historical correlations disappoint in a crisis?', model_answer: 'Correlations are estimated from calmer periods and tend to rise when markets fall together, reducing diversification just when it matters.' },
      { stage: 'review', kind: 'summary', points: ['Portfolio variance includes a correlation term.', 'Lower correlation lowers risk below the weighted average.', 'Correlations are unstable, especially in stress.'] },
    ],
    quiz: [
      { id: 'ma-q3-1', objective: 'ma-o2', skill: 'portfolio_risk', difficulty: 4, qtype: 'numeric', stem: 'Weights 60/40, volatilities 25% and 15%, correlation 0.2. What is portfolio volatility, in percent (two decimals)?', correct: { value: 17.23, abs_tol: 0.05, unit: '%' }, explanation: '√0.0297 = 17.23%.', misconception: 'Taking the weighted average of volatilities (21%).' },
      { id: 'ma-q3-2', objective: 'ma-o2', skill: 'portfolio_risk', difficulty: 2, qtype: 'single_choice', stem: 'When is two-asset portfolio volatility exactly the weighted average of the two volatilities?', options: ['When correlation is 0', 'When correlation is 1', 'When correlation is −1', 'Always'], correct: { index: 1 }, explanation: 'Only perfect positive correlation gives no diversification benefit.', misconception: 'Assuming volatility always averages.' },
      { id: 'ma-q3-3', objective: 'ma-o2', skill: 'portfolio_risk', difficulty: 2, qtype: 'single_choice', stem: 'What tends to happen to correlations between shares in market crises?', options: ['They usually fall to zero', 'They often rise, reducing diversification', 'They become negative', 'They are unaffected'], correct: { index: 1 }, explanation: 'Common shocks move most assets together.', misconception: 'Relying on calm-period correlations in stress.' },
    ],
  },
  {
    id: 'ma-l4', title: 'Drawdowns and stress tests', minutes: 15, objectives: ['ma-o2'], prerequisites: ['ma-l3'], mastery_rule: RULE('ma-o2'), references: [LIT, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'What if the bad day comes?', body: [
        'A stress test applies a specified shock (for example, equities −40%, bonds +5%) to see the portfolio loss and how long recovery might take.',
        'Unlike Value-at-Risk, which estimates a loss threshold from a model, a stress test asks about a named scenario, including ones larger than recent history.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'Drawdown and recovery', widget: 'drawdown', intro: 'Build a path that falls and recovers and read the maximum drawdown and the gain needed to recover.', alt_text: 'A chart shows the path with its running peak; maximum drawdown and required recovery gain are listed as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A portfolio is 70% equity and 30% bonds. Equities fall 40% and bonds rise 5%. The portfolio loses about:', options: ['40%', '26.5%', '13%'], answer: 1, reveal: '0.7 × (−40%) + 0.3 × 5% = −28% + 1.5% = −26.5%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'From shock to recovery', steps: [
        'Loss 26.5%: ₹100 becomes ₹73.50.',
        'Recovery needs 100 ÷ 73.5 − 1 ≈ 36.05%.',
        'At 8% a year, that takes about 4 years (1.08⁴ ≈ 1.36).',
        'A stress test turns abstract risk into a concrete question: could the investor hold through this?',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Equities 50%, bonds 50%. Equities −30%, bonds +4%. What is the portfolio loss?', hint: 'Weight each asset\'s change.', answer_text: '0.5 × (−30%) + 0.5 × 4% = −13%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why combine stress tests with volatility-based measures?', model_answer: 'Volatility describes typical variation; stress tests examine specific severe scenarios that statistics from calm periods understate.' },
      { stage: 'review', kind: 'summary', points: ['Stress tests apply named shocks.', 'Recovery needs grow faster than losses.', 'Use stress tests alongside volatility and VaR.'] },
    ],
    quiz: [
      { id: 'ma-q4-1', objective: 'ma-o2', skill: 'portfolio_risk', difficulty: 2, qtype: 'numeric', stem: 'A portfolio is 70% equities and 30% bonds. Equities fall 40% and bonds rise 5%. What is the portfolio return, in percent?', correct: { value: -26.5, abs_tol: 0.05, unit: '%' }, explanation: '−28% + 1.5% = −26.5%.', misconception: 'Ignoring the bond weight.' },
      { id: 'ma-q4-2', objective: 'ma-o2', skill: 'portfolio_risk', difficulty: 3, qtype: 'numeric', stem: 'After a 26.5% loss, what gain is needed to recover, in percent (two decimals)?', correct: { value: 36.05, abs_tol: 0.05, unit: '%' }, explanation: '1 ÷ 0.735 − 1 = 36.05%.', misconception: 'Assuming a 26.5% gain is enough.' },
      { id: 'ma-q4-3', objective: 'ma-o2', skill: 'portfolio_risk', difficulty: 2, qtype: 'single_choice', stem: 'How does a stress test differ from Value-at-Risk?', options: ['They are identical', 'A stress test applies a named scenario; VaR estimates a loss threshold from a statistical model', 'VaR gives the maximum possible loss', 'Stress tests only use history'], correct: { index: 1 }, explanation: 'Stress tests can examine scenarios beyond the data a model was fitted to.', misconception: 'Reading VaR as a worst case.' },
    ],
  },
];

export const MA_MODULE_3: SourceLesson[] = [
  {
    id: 'ma-l5', title: 'Validation and multiple testing', minutes: 17, objectives: ['ma-o3'], mastery_rule: RULE('ma-o3'), references: [LIT, METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'How many tests stand behind a result?', body: [
        'With many independent tests at significance α, the chance of at least one false positive is 1 − (1 − α)ⁿ, and the expected number is n × α.',
        'Defences: pre-registration, hold-out and walk-forward validation, corrections such as Bonferroni (α ÷ n), and reporting every variant tried.',
      ] },
      { stage: 'observe', kind: 'interactive', title: 'False discoveries calculator', widget: 'multiple_testing', intro: 'Set the number of tests and the significance level. See expected false positives, the chance of at least one, and the Bonferroni threshold.', alt_text: 'The widget lists expected false positives, the probability of at least one false positive and the Bonferroni-corrected threshold as text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'You run 20 independent tests at 5%, none with a real effect. The chance of at least one "significant" result is about:', options: ['5%', '36%', '64%'], answer: 2, reveal: '1 − 0.95²⁰ ≈ 64%.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Walk-forward validation', steps: [
        'Fit rules on 2014–2017, test on 2018; refit on 2014–2018, test on 2019; and so on.',
        'Each test year is untouched by the fitting that preceded it.',
        'Report the stitched out-of-sample record, not the best in-sample fit.',
        'Expect decay: an in-sample Sharpe of 2 with an out-of-sample 0.3 signals overfitting.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'With 20 tests at an overall 5% level, what per-test threshold does Bonferroni require?', hint: 'Divide α by the number of tests.', answer_text: '0.05 ÷ 20 = 0.0025 (0.25%) per test.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why should a research report state how many variants were tried?', model_answer: 'Readers can only judge whether a result is luck if they know how large the search was.' },
      { stage: 'review', kind: 'summary', points: ['P(at least one false positive) = 1 − (1 − α)ⁿ.', 'Bonferroni: test each at α ÷ n.', 'Use hold-out or walk-forward data and report the search.'] },
    ],
    quiz: [
      { id: 'ma-q5-1', objective: 'ma-o3', skill: 'model_validation', difficulty: 2, qtype: 'numeric', stem: 'With 20 tests and an overall significance level of 5%, what is the Bonferroni per-test threshold, in percent?', correct: { value: 0.25, abs_tol: 0.001, unit: '%' }, explanation: '5% ÷ 20 = 0.25%.', misconception: 'Keeping 5% for every test.' },
      { id: 'ma-q5-2', objective: 'ma-o3', skill: 'model_validation', difficulty: 3, qtype: 'numeric', stem: 'You run 20 independent tests at 5% with no real effects. What is the probability of at least one false positive, in percent (two decimals)?', correct: { value: 64.15, abs_tol: 0.05, unit: '%' }, explanation: '1 − 0.95²⁰ = 64.15%.', misconception: 'Thinking the chance stays at 5%.' },
      { id: 'ma-q5-3', objective: 'ma-o3', skill: 'model_validation', difficulty: 2, qtype: 'single_choice', stem: 'What is walk-forward validation?', options: ['Testing on the same data used for fitting', 'Repeatedly fitting on past data and testing on the following, untouched period', 'Choosing the best year', 'Removing outliers'], correct: { index: 1 }, explanation: 'Each evaluation uses only data that came after the fit.', misconception: 'Equating any re-test with validation.' },
    ],
  },
  {
    id: 'ma-l6', title: 'Research you can defend', minutes: 16, objectives: ['ma-o4'], prerequisites: ['ma-l5'], mastery_rule: RULE('ma-o4'), references: [METH],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Facts, calculations, interpretations', body: [
        'Defensible research separates three layers: observed facts (with sources), calculated results (with formulas and inputs) and interpretations (clearly labelled as judgement).',
        'A good thesis is falsifiable: it says what evidence would prove it wrong and when you will review it. It records counter-evidence, not just support.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Write a defensible note in ATLAS', href: '/app/research', steps: [
        'Open a company and save three figures to a note, each with its evidence link.',
        'Ask the assistant one question and read how its answer separates observed, calculated and interpretation.',
        'Record a hypothesis with a review date in the hypothesis tracker, with one piece of counter-evidence.',
        'Check that every number in your note can be traced to a source or calculation.',
      ], alt_text: 'A guided exercise in ATLAS notes, assistant and hypothesis tracker; all steps are described in text.' },
      { stage: 'predict', kind: 'prediction', prompt: 'Which of these is a falsifiable thesis?', options: ['"This company is great."', '"Cash conversion will stay above 80% over the next four quarters; I will review in August."', '"The share will go up."'], answer: 1, reveal: 'It states a measurable claim, a time frame and when it will be checked.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Anatomy of a research note', steps: [
        'Fact: "FY26 revenue ₹1,240 crore (annual report, filed 22 May 2026)" with an evidence link.',
        'Calculation: "Cash conversion 72% (OCF ÷ net profit, ATLAS methodology v1)".',
        'Interpretation: "Possible explanation: inventory build ahead of a product launch (to verify)".',
        'Counter-evidence and review date: "Receivable days rose for three years; review after Q2 results."',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Rewrite "this stock will double" as defensible research language.', hint: 'Replace a prediction with a testable hypothesis and evidence.', answer_text: 'For example: "If margins recover to the five-year median, earnings could rise materially; I will test this against the next four quarterly results."' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why record counter-evidence in your own notes?', model_answer: 'It guards against confirmation bias and makes it easier to change your mind when the evidence turns.' },
      { stage: 'review', kind: 'summary', points: ['Separate facts, calculations and interpretations.', 'Make theses falsifiable, with review dates.', 'Record counter-evidence and sources.'] },
    ],
    quiz: [
      { id: 'ma-q6-1', objective: 'ma-o4', skill: 'research_communication', difficulty: 1, qtype: 'single_choice', stem: 'Which statement is an interpretation rather than an observed fact or calculation?', options: ['Revenue was ₹1,240 crore in FY26', 'Cash conversion was 72%', 'The inventory build may reflect an upcoming launch', 'The annual report was filed on 22 May'], correct: { index: 2 }, explanation: 'It is a possible explanation that needs verification.', misconception: 'Presenting explanations as facts.' },
      { id: 'ma-q6-2', objective: 'ma-o4', skill: 'research_communication', difficulty: 2, qtype: 'single_choice', stem: 'Which thesis is falsifiable?', options: ['"Management is excellent."', '"Debt-to-equity will fall below 0.5 by March 2027; review after Q4 results."', '"The market will rise."', '"This is a quality company."'], correct: { index: 1 }, explanation: 'It names a measurable outcome and a review point.', misconception: 'Mistaking opinions for testable claims.' },
      { id: 'ma-q6-3', objective: 'ma-o4', skill: 'research_communication', difficulty: 2, qtype: 'multi_select', stem: 'What belongs in a defensible research note? Select all that apply.', options: ['Sources for each fact', 'Stated assumptions and formulas', 'Counter-evidence and a review date', 'A guaranteed price target'], correct: { indexes: [0, 1, 2] }, explanation: 'No research can guarantee a price; claims must be evidenced and reviewable.', misconception: 'Equating confidence with certainty.' },
    ],
  },
];
