// Capstones: one practical assignment per course, completed inside ATLAS on permitted data and
// self-assessed against a published rubric (optional reviewer marking). Original wording.
// Status: in_review (AI-assisted draft) until a named reviewer completes the content review.

export type ArtefactKind = 'note' | 'backtest' | 'hypothesis' | 'watchlist';

export interface SourceCapstone {
  title: string;
  brief: string;
  deliverables: string[];
  rubric: { criterion: string; levels: [string, string, string, string] }[];
  artefact_kinds: ArtefactKind[];
}

const levels = (l0: string, l1: string, l2: string, l3: string): [string, string, string, string] => [`0 — ${l0}`, `1 — ${l1}`, `2 — ${l2}`, `3 — ${l3}`];

export const CAPSTONES: Record<string, SourceCapstone> = {
  'market-decoder': {
    title: 'Explain one market session',
    brief: 'Use the ATLAS Market page and the daily briefing for one session to write a short explanation for a friend who is new to markets: what the index did, how broad the move was, which sectors led or lagged, and what the numbers do and do not tell you. Describe; do not forecast or recommend.',
    deliverables: ['A note in ATLAS (300–600 words) with at least three evidence-linked figures from the briefing', 'One sentence on breadth (advances versus declines) and what it adds to the index change', 'One limitation of the data (for example: end-of-day only, synthetic in development)'],
    rubric: [
      { criterion: 'Accuracy of figures', levels: levels('Figures missing or wrong', 'Some figures correct', 'All figures correct', 'All figures correct and each linked to evidence') },
      { criterion: 'Index versus breadth', levels: levels('Not discussed', 'Mentioned without interpretation', 'Correctly interpreted', 'Correctly interpreted with the weighting explanation') },
      { criterion: 'Language', levels: levels('Forecasts or advice present', 'Some speculative wording', 'Descriptive throughout', 'Descriptive, with uncertainty and limits stated') },
      { criterion: 'Clarity for a beginner', levels: levels('Unclear', 'Partly clear', 'Clear', 'Clear, with terms defined') },
    ],
    artefact_kinds: ['note'],
  },
  'equity-detective': {
    title: 'Investigate one company\'s quality of earnings',
    brief: 'Choose one covered company. Using its ATLAS profile, assess whether reported profit is backed by cash over the last five years, how returns on capital have moved and what drives them, and whether any quality flags deserve follow-up. Record what you found, what you could not find and what you would ask management.',
    deliverables: ['A research note with cash conversion for five years, ROE and ROCE with a DuPont split for the latest year', 'Every number linked to evidence, with basis (consolidated or standalone) stated', 'At least two questions for management and one piece of counter-evidence to your own view'],
    rubric: [
      { criterion: 'Correct calculations', levels: levels('Missing or wrong', 'Partly correct', 'Correct', 'Correct, consistent periods and basis') },
      { criterion: 'Profit versus cash', levels: levels('Not analysed', 'Described', 'Explained with working capital', 'Explained, compared with peers, with follow-up questions') },
      { criterion: 'Evidence and provenance', levels: levels('No sources', 'Some sources', 'All numbers sourced', 'All sourced, with data limitations noted') },
      { criterion: 'Balance', levels: levels('One-sided', 'Mentions risks', 'Includes counter-evidence', 'Counter-evidence weighed explicitly') },
    ],
    artefact_kinds: ['note'],
  },
  'signal-engineer': {
    title: 'Run and critique a pre-registered backtest',
    brief: 'Write a hypothesis and test plan first (universe, period with hold-out, rules, costs, benchmark, number of variants). Then run it in the ATLAS Quant Lab and write a critique: what the result shows, every warning raised, sensitivity to costs, and why the result is or is not evidence for the hypothesis.',
    deliverables: ['A note containing the plan, written before the run', 'At least one backtest run in ATLAS with costs included (linked)', 'A critique covering bias controls, warnings, cost sensitivity and benchmark choice'],
    rubric: [
      { criterion: 'Pre-registered plan', levels: levels('No plan', 'Partial plan', 'Complete plan before the run', 'Complete plan with a stated number of variants and hold-out') },
      { criterion: 'Bias awareness', levels: levels('Not discussed', 'Named', 'Explained for this test', 'Explained with how ATLAS controls them and what remains') },
      { criterion: 'Costs and benchmark', levels: levels('Ignored', 'Mentioned', 'Analysed', 'Analysed with doubled-cost sensitivity and a justified benchmark') },
      { criterion: 'Honest conclusion', levels: levels('Claims a proven strategy', 'Overstated', 'Measured', 'Measured, with limitations and next test') },
    ],
    artefact_kinds: ['note', 'backtest'],
  },
  'market-architect': {
    title: 'Defend a valuation range',
    brief: 'For one covered company, build bear, base and bull DCF scenarios from stated assumptions, show a sensitivity grid, and compare the range with relative valuation. Record a falsifiable hypothesis with a review date in the ATLAS hypothesis tracker. Present a range with reasons, not a price target.',
    deliverables: ['A note with three scenarios, their assumptions and resulting values', 'A sensitivity table (discount rate × terminal growth) and the terminal-value share', 'A hypothesis in the tracker with evidence links and a review date; one paragraph on what would prove you wrong'],
    rubric: [
      { criterion: 'Model mechanics', levels: levels('Wrong or missing', 'Partly correct', 'Correct', 'Correct, with equity bridge and per-share value') },
      { criterion: 'Assumption quality', levels: levels('Unstated', 'Stated', 'Justified with evidence', 'Justified, cross-checked against history and peers') },
      { criterion: 'Uncertainty', levels: levels('Single number', 'Range without reasons', 'Range with sensitivity', 'Range, sensitivity and what would change it') },
      { criterion: 'Defensibility', levels: levels('Opinion only', 'Some evidence', 'Facts, calculations and interpretations separated', 'Separated, falsifiable, with counter-evidence') },
    ],
    artefact_kinds: ['note', 'hypothesis'],
  },
};
