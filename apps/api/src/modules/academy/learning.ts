// Learning engine: XP, levels, streaks, missions, achievements and the next recommended action.
// Everything is deterministic and rule-based (no AI). XP is derived on the server from authoritative
// learner records, so an action earns points at most once and nothing can be "clicked" into XP.
// Activity points (XP) are kept separate from demonstrated mastery (acad.objective_mastery).

import type { Db } from '../../db/db.js';

export const LEARNING_ENGINE_VERSION = 'learn-engine-1';

/** Visible XP rules. One award per (kind, ref). */
export const XP_RULES = {
  lesson_completed: { xp: 20, label: 'Complete a lesson (worked through it and attempted its quiz)', once: 'per lesson' },
  quiz_perfect: { xp: 10, label: 'Answer every question in a lesson quiz correctly', once: 'per lesson' },
  error_recovered: { xp: 10, label: 'Get a lesson quiz fully right after an earlier attempt with mistakes', once: 'per lesson' },
  objective_mastered: { xp: 30, label: 'Master a learning objective (3+ answers, recent estimate ≥ 80%)', once: 'per objective' },
  review_recalled: { xp: 5, label: 'Recall a concept correctly in a due spaced review', once: 'per review' },
  diagnostic_completed: { xp: 10, label: 'Finish a course readiness check', once: 'per course' },
  game_solved: { xp: 15, label: 'Solve a practice game with every answer correct', once: 'per game' },
  capstone_submitted: { xp: 100, label: 'Submit a course capstone', once: 'per course' },
  course_completed: { xp: 200, label: 'Earn a course completion record', once: 'per course' },
  daily_mission: { xp: 10, label: 'Complete the daily mission', once: 'per day' },
  weekly_mission: { xp: 25, label: 'Meet your weekly goal of learning days', once: 'per week' },
  // Research activity (written server-side to research.activity only after the work was done and checked).
  research_note: { xp: 10, label: 'Write a substantive research note (80+ characters)', once: 'per note; at most 3 a day' },
  hypothesis_recorded: { xp: 15, label: 'Record a hypothesis with evidence for and against, before the outcome', once: 'per hypothesis; at most 3 a day' },
  hypothesis_reviewed: { xp: 25, label: 'Review a hypothesis against what happened (credit for the review, not for being right)', once: 'per hypothesis' },
  journal_reflection: { xp: 15, label: 'Write a journal reflection: what you expected, what the evidence showed, what you missed', once: 'per entry; at most 3 a day' },
  benchmark_comparison: { xp: 10, label: 'Compare instruments against a benchmark in the workbench', once: 'per set of instruments; at most 3 a day' },
  correlation_study: { xp: 10, label: 'Study a rolling correlation', once: 'per pair and window; at most 3 a day' },
  walkforward_backtest: { xp: 20, label: 'Run a walk-forward (out-of-sample) backtest', once: 'per instrument and window; at most 3 a day' },
  report_created: { xp: 30, label: 'Build a research report with limitations and parameters', once: 'per report; at most 3 a day' },
  portfolio_risk_review: { xp: 10, label: 'Review a research portfolio risk analysis', once: 'per portfolio and range; at most 3 a day' },
  data_issue_investigated: { xp: 20, label: 'Document a data-quality issue that the integrity check confirms', once: 'per issue; at most 3 a day' },
  scenario_tested: { xp: 10, label: 'Stress-test a research portfolio', once: 'per scenario; at most 3 a day' },
} as const;
/** research.activity kind → learning-event kind (alert_configured earns nothing: setting an alert is not research). */
export const RESEARCH_KINDS: Record<string, keyof typeof XP_RULES> = {
  note_written: 'research_note', hypothesis_recorded: 'hypothesis_recorded', hypothesis_reviewed: 'hypothesis_reviewed', journal_reflection: 'journal_reflection',
  benchmark_comparison: 'benchmark_comparison', correlation_study: 'correlation_study', walkforward_backtest: 'walkforward_backtest', report_created: 'report_created',
  portfolio_risk_review: 'portfolio_risk_review', data_issue_investigated: 'data_issue_investigated', scenario_tested: 'scenario_tested',
};
/** Research awards per kind per local day: repeating an action more often earns nothing more. */
export const RESEARCH_DAILY_CAP = 3;
export type EventKind = keyof typeof XP_RULES;
/** Mission bonuses reward learning that already happened; they do not count as learning activity themselves. */
const BONUS_KINDS = new Set<EventKind>(['daily_mission', 'weekly_mission']);

export interface LearningEvent { kind: EventKind; ref: string; xp: number; occurred_at: string }

// ───────────── Levels ─────────────
/** Total XP needed to reach level n: 50·n·(n−1). Level 1 at 0, 2 at 100, 3 at 300, 4 at 600, 5 at 1000. */
export const xpForLevel = (n: number) => 50 * n * (n - 1);
export function levelFor(xp: number): { level: number; xp: number; level_start: number; next_level_at: number } {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n++;
  return { level: n, xp, level_start: xpForLevel(n), next_level_at: xpForLevel(n + 1) };
}

/**
 * Named ranks. A rank needs BOTH the XP level and demonstrated competence (mastered objectives and
 * specific research practices), so activity alone cannot buy a senior title.
 */
export const RANKS: { rank: number; title: string; min_level: number; mastered: number; needs: (keyof typeof XP_RULES)[] }[] = [
  { rank: 1, title: 'Explorer', min_level: 1, mastered: 0, needs: [] },
  { rank: 2, title: 'Market Student', min_level: 2, mastered: 1, needs: [] },
  { rank: 3, title: 'Research Apprentice', min_level: 3, mastered: 3, needs: ['research_note'] },
  { rank: 4, title: 'Data Analyst', min_level: 4, mastered: 6, needs: ['benchmark_comparison', 'data_issue_investigated'] },
  { rank: 5, title: 'Quantitative Researcher', min_level: 5, mastered: 10, needs: ['walkforward_backtest', 'correlation_study'] },
  { rank: 6, title: 'Senior Analyst', min_level: 6, mastered: 16, needs: ['hypothesis_reviewed', 'portfolio_risk_review'] },
  { rank: 7, title: 'Research Architect', min_level: 7, mastered: 24, needs: ['report_created', 'scenario_tested'] },
];
export function rankFor(level: number, mastered: number, practices: Set<string>) {
  let current = RANKS[0]!;
  for (const r of RANKS) if (level >= r.min_level && mastered >= r.mastered && r.needs.every((n) => practices.has(n))) current = r;
  const next = RANKS.find((r) => r.rank === current.rank + 1) ?? null;
  return {
    rank: current.rank, title: current.title,
    next: next ? { title: next.title, needs_level: next.min_level, level_ok: level >= next.min_level, needs_mastered: next.mastered, mastered_ok: mastered >= next.mastered, needs_practices: next.needs.map((n) => ({ kind: n, label: XP_RULES[n].label, done: practices.has(n) })) } : null,
  };
}

// ───────────── Dates in the learner's timezone ─────────────
export function localDate(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** Monday of the ISO week containing d (YYYY-MM-DD). */
export const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

// ───────────── Streaks ─────────────
/**
 * Daily streak over local dates with learning activity. Fair rules:
 * - Today does not break the streak before it ends: if today has no activity yet, counting starts yesterday.
 * - Rest day: one missed day is bridged (not counted, not breaking) if there was no other rest day in the
 *   previous six days of the streak. Two missed days in a row end the streak.
 */
export function streak(activeDates: Iterable<string>, today: string): { current: number; longest: number; today_active: boolean; rest_days_in_current: number } {
  const days = new Set(activeDates);
  const run = (from: string) => {
    let count = 0;
    let rests = 0;
    let lastRest: string | null = null;
    let d = from;
    for (;;) {
      if (days.has(d)) {
        count++;
        d = addDays(d, -1);
        continue;
      }
      const prev = addDays(d, -1);
      // A rest day sits between two active days; at the start of the count it is the missed yesterday
      // that today's activity can still bridge.
      const restAllowed = days.has(prev) && (count > 0 || d === from) && (lastRest === null || daysBetween(prev, lastRest) > 6);
      if (!restAllowed) break;
      rests++;
      lastRest = d;
      d = prev;
    }
    return { count, rests };
  };
  const todayActive = days.has(today);
  const cur = run(todayActive ? today : addDays(today, -1));
  let longest = cur.count;
  for (const d of days) if (!days.has(addDays(d, 1)) && !days.has(addDays(d, 2))) longest = Math.max(longest, run(d).count);
  return { current: cur.count, longest, today_active: todayActive, rest_days_in_current: cur.rests };
}
const daysBetween = (a: string, b: string) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Consecutive weeks (ending with the current week if met, else the previous one) with at least `goal` active days. */
export function weeklyStreak(activeDates: Iterable<string>, today: string, goal: number): { current: number; this_week_days: number; goal: number } {
  const perWeek = new Map<string, number>();
  for (const d of activeDates) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) ?? 0) + 1);
  const thisWeek = weekStart(today);
  const met = (w: string) => (perWeek.get(w) ?? 0) >= goal;
  let w = met(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let n = 0;
  while (met(w)) {
    n++;
    w = addDays(w, -7);
  }
  return { current: n, this_week_days: perWeek.get(thisWeek) ?? 0, goal };
}

// ───────────── Achievements ─────────────
export interface Snapshot {
  lessonsCompleted: { lesson_id: string; course_id: string; at: string }[];
  lessonsAvailable: { lesson_id: string; course_id: string }[];
  mastered: { objective_id: string; at: string }[];
  gamesSolved: { game_id: string; at: string }[];
  capstones: { course_id: string; at: string }[];
  completions: { course_id: string; at: string }[];
  reviewsRecalled: number;
  errorsRecovered: number;
  longestStreak: number;
  research: { kind: string; at: string }[];
}
interface AchievementDef { id: string; title: string; description: string; glyph: string; check: (s: Snapshot) => { met: boolean; progress: [number, number]; evidence: string; at?: string } }
const masteredAt = (s: Snapshot, id: string) => s.mastered.find((m) => m.objective_id === id)?.at;
const solvedAt = (s: Snapshot, id: string) => s.gamesSolved.find((g) => g.game_id === id)?.at;
const either = (s: Snapshot, objective: string, game: string, what: string) => {
  const at = masteredAt(s, objective) ?? solvedAt(s, game);
  return { met: !!at, progress: [at ? 1 : 0, 1] as [number, number], evidence: `${what}: objective ${objective} mastered or the ${game} game solved`, at };
};
const courseLessons = (s: Snapshot, course: string) => {
  const all = s.lessonsAvailable.filter((l) => l.course_id === course);
  const done = s.lessonsCompleted.filter((l) => l.course_id === course && all.some((a) => a.lesson_id === l.lesson_id));
  const last = done.map((d) => d.at).sort().pop();
  return { all: all.length, done: done.length, at: last };
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-lesson', title: 'First Lesson', description: 'Complete your first Academy lesson.', glyph: '1', check: (s) => ({ met: s.lessonsCompleted.length > 0, progress: [Math.min(1, s.lessonsCompleted.length), 1], evidence: 'A completed lesson', at: s.lessonsCompleted.map((l) => l.at).sort()[0] }) },
  { id: 'first-mastery', title: 'First Concept Mastered', description: 'Master one learning objective through repeated correct answers.', glyph: '★', check: (s) => ({ met: s.mastered.length > 0, progress: [Math.min(1, s.mastered.length), 1], evidence: 'One objective in the mastered state', at: s.mastered.map((m) => m.at).sort()[0] }) },
  { id: 'market-foundations', title: 'Market Foundations', description: 'Complete every available MARKET DECODER lesson.', glyph: 'M', check: (s) => { const c = courseLessons(s, 'market-decoder'); return { met: c.all > 0 && c.done === c.all, progress: [c.done, c.all], evidence: 'All MARKET DECODER lessons completed', at: c.at }; } },
  { id: 'statement-reader', title: 'Financial Statement Reader', description: 'Show you can connect the three financial statements.', glyph: 'S', check: (s) => either(s, 'ed-o1', 'statement-surgeon', 'Statements') },
  { id: 'cash-flow-investigator', title: 'Cash Flow Investigator', description: 'Master the difference between reported profit and operating cash flow.', glyph: '₹', check: (s) => ({ met: !!masteredAt(s, 'ed-o2'), progress: [masteredAt(s, 'ed-o2') ? 1 : 0, 1], evidence: 'Objective ed-o2 mastered', at: masteredAt(s, 'ed-o2') }) },
  { id: 'valuation-explorer', title: 'Valuation Explorer', description: 'Show you can use valuation multiples or a reverse DCF.', glyph: 'V', check: (s) => either(s, 'ed-o5', 'valuation-lab', 'Valuation') },
  { id: 'bias-detector', title: 'Bias Detector', description: 'Recognise look-ahead, survivorship and data-snooping bias.', glyph: 'B', check: (s) => either(s, 'se-o2', 'bias-trap', 'Bias') },
  { id: 'quantitative-researcher', title: 'Quantitative Researcher', description: 'Master every SIGNAL ENGINEER objective.', glyph: 'Q', check: (s) => { const ids = ['se-o1', 'se-o2', 'se-o3', 'se-o4']; const n = ids.filter((i) => masteredAt(s, i)).length; return { met: n === ids.length, progress: [n, ids.length], evidence: 'Objectives se-o1 to se-o4 mastered', at: n === ids.length ? ids.map((i) => masteredAt(s, i)!).sort().pop() : undefined }; } },
  { id: 'evidence-first', title: 'Evidence-First Analyst', description: 'Separate facts, calculations and interpretations.', glyph: 'E', check: (s) => either(s, 'ma-o4', 'evidence-challenge', 'Evidence') },
  { id: 'learned-from-mistake', title: 'Learned from a Mistake', description: 'Get a lesson quiz fully right after an attempt with errors.', glyph: '↺', check: (s) => ({ met: s.errorsRecovered > 0, progress: [Math.min(1, s.errorsRecovered), 1], evidence: 'A perfect quiz after an imperfect one on the same lesson' }) },
  { id: 'recall-habit', title: 'Recall Habit', description: 'Recall ten concepts correctly in spaced reviews.', glyph: 'R', check: (s) => ({ met: s.reviewsRecalled >= 10, progress: [Math.min(10, s.reviewsRecalled), 10], evidence: 'Ten correct spaced-review answers' }) },
  { id: 'consistency-builder', title: 'Consistency Builder', description: 'Learn on seven days in a row (one rest day allowed).', glyph: '7', check: (s) => ({ met: s.longestStreak >= 7, progress: [Math.min(7, s.longestStreak), 7], evidence: 'A daily learning streak of seven' }) },
  { id: 'capstone-defender', title: 'Capstone Defender', description: 'Submit a course capstone.', glyph: 'C', check: (s) => ({ met: s.capstones.length > 0, progress: [Math.min(1, s.capstones.length), 1], evidence: 'A submitted capstone', at: s.capstones.map((c) => c.at).sort()[0] }) },
  { id: 'research-dossier', title: 'Research Dossier Completed', description: 'Submit the MARKET ARCHITECT research dossier capstone.', glyph: 'D', check: (s) => { const at = s.capstones.find((c) => c.course_id === 'market-architect')?.at; return { met: !!at, progress: [at ? 1 : 0, 1], evidence: 'MARKET ARCHITECT capstone submitted', at }; } },
  { id: 'first-research-note', title: 'First Research Note', description: 'Write a substantive research note.', glyph: 'N', check: (s) => researchCount(s, 'note_written', 1, 'A substantive research note') },
  { id: 'data-detective', title: 'Data Detective', description: 'Document a data-quality issue that the integrity check confirms.', glyph: 'D', check: (s) => researchCount(s, 'data_issue_investigated', 1, 'A confirmed data-quality finding') },
  { id: 'source-verification-expert', title: 'Source Verification Expert', description: 'Document three confirmed data-quality issues.', glyph: '✓', check: (s) => researchCount(s, 'data_issue_investigated', 3, 'Three confirmed data-quality findings') },
  { id: 'benchmark-builder', title: 'Benchmark Builder', description: 'Compare instruments against a benchmark.', glyph: 'B', check: (s) => researchCount(s, 'benchmark_comparison', 1, 'A benchmark comparison in the workbench') },
  { id: 'correlation-explorer', title: 'Correlation Explorer', description: 'Study three rolling correlations.', glyph: 'ρ', check: (s) => researchCount(s, 'correlation_study', 3, 'Three rolling-correlation studies') },
  { id: 'backtest-auditor', title: 'Backtest Auditor', description: 'Run a walk-forward backtest and compare in-sample with out-of-sample results.', glyph: 'W', check: (s) => researchCount(s, 'walkforward_backtest', 1, 'A walk-forward backtest') },
  { id: 'risk-analyst', title: 'Risk Analyst', description: 'Review a portfolio risk analysis and stress-test it.', glyph: 'R', check: (s) => { const a = s.research.find((r) => r.kind === 'portfolio_risk_review'); const b = s.research.find((r) => r.kind === 'scenario_tested'); return { met: !!(a && b), progress: [(a ? 1 : 0) + (b ? 1 : 0), 2] as [number, number], evidence: 'A portfolio risk review and a stress scenario', at: a && b ? [a.at, b.at].sort().pop() : undefined }; } },
  { id: 'thesis-reviewer', title: 'Thesis Reviewer', description: 'Review a recorded hypothesis against what happened.', glyph: 'T', check: (s) => researchCount(s, 'hypothesis_reviewed', 1, 'A reviewed hypothesis') },
  { id: 'first-report', title: 'First Completed Research Report', description: 'Build a research report with limitations and parameters.', glyph: '§', check: (s) => researchCount(s, 'report_created', 1, 'A research report') },
  { id: 'on-chain-explorer', title: 'On-Chain Explorer', description: 'Master reading chain data and network metrics.', glyph: '⛓', check: (s) => { const ids = ['oe-o1', 'oe-o2']; const n = ids.filter((i) => masteredAt(s, i)).length; return { met: n === 2, progress: [n, 2] as [number, number], evidence: 'Objectives oe-o1 and oe-o2 mastered', at: n === 2 ? ids.map((i) => masteredAt(s, i)!).sort().pop() : undefined }; } },
  { id: 'fundamentals-investigator', title: 'Fundamentals Investigator', description: 'Master reading cash flow and returns on capital.', glyph: 'F', check: (s) => { const ids = ['ed-o2', 'ed-o3']; const n = ids.filter((i) => masteredAt(s, i)).length; return { met: n === 2, progress: [n, 2] as [number, number], evidence: 'Objectives ed-o2 and ed-o3 mastered', at: n === 2 ? ids.map((i) => masteredAt(s, i)!).sort().pop() : undefined }; } },
  { id: 'course-mastery', title: 'Course Mastery', description: 'Earn a course completion record (all lessons, 80% of objectives mastered, capstone).', glyph: '◆', check: (s) => ({ met: s.completions.length > 0, progress: [Math.min(1, s.completions.length), 1], evidence: 'A course completion record', at: s.completions.map((c) => c.at).sort()[0] }) },
];

export const RESEARCH_EVENT_KINDS = new Set<string>(Object.values(RESEARCH_KINDS));

/** Rotating daily research missions: each uses only features and data available without paid APIs. */
export const RESEARCH_MISSIONS: { kind: keyof typeof XP_RULES; title: string; why: string; condition: string; effort: string; href: string }[] = [
  { kind: 'benchmark_comparison', title: 'Compare an asset with a relevant benchmark', why: 'A return means little until you know what the alternative did.', condition: 'In the workbench, compare at least one instrument with a benchmark.', effort: '10 minutes', href: '/app/research-hub?tab=workbench' },
  { kind: 'hypothesis_recorded', title: 'Write down a thesis before you know the outcome', why: 'Recording expectations in advance is the only honest way to check your judgement later.', condition: 'Record a hypothesis with evidence for, evidence against and a review date.', effort: '15 minutes', href: '/app/research-hub?tab=notebook' },
  { kind: 'data_issue_investigated', title: 'Find and document a data-quality issue', why: 'Every analysis is only as good as its inputs.', condition: 'Use the integrity check to find a gap, deviation or revision and document it.', effort: '10–20 minutes', href: '/app/research-hub?tab=integrity' },
  { kind: 'walkforward_backtest', title: 'Test a rule out of sample', why: 'In-sample results are optimistic by construction.', condition: 'Run a walk-forward backtest and compare in-sample with out-of-sample results.', effort: '10 minutes', href: '/app/research-hub?tab=backtest' },
  { kind: 'journal_reflection', title: 'Reflect on a past analysis', why: 'Naming what you missed is how judgement improves.', condition: 'Write a journal entry: what you expected, what the evidence showed, what you missed.', effort: '10 minutes', href: '/app/research-hub?tab=notebook' },
  { kind: 'report_created', title: 'Turn an analysis into a report', why: 'Writing it down exposes gaps in the reasoning.', condition: 'Build a report with a research question, instruments and a benchmark.', effort: '15 minutes', href: '/app/research-hub?tab=reports' },
];

/** Skill areas for the map: objectives (by id or course) plus the applied practices that evidence them. */
export const SKILL_AREAS: { id: string; title: string; match: (objectiveId: string, courseId: string) => boolean; practices: (keyof typeof XP_RULES)[] }[] = [
  { id: 'foundations', title: 'Financial foundations', match: (_o, c) => c === 'market-decoder', practices: [] },
  { id: 'statements', title: 'Accounting and statements', match: (o) => ['ed-o1', 'ed-o2', 'ed-o3'].includes(o), practices: [] },
  { id: 'equity', title: 'Equity analysis', match: (o, c) => c === 'equity-detective' && !['ed-o1', 'ed-o2', 'ed-o3'].includes(o), practices: ['benchmark_comparison'] },
  { id: 'crypto', title: 'Crypto fundamentals', match: (_o, c) => c === 'crypto-decoder' || c === 'tokenomics-detective', practices: [] },
  { id: 'microstructure', title: 'Market microstructure', match: (o) => ['md-o2', 'cd-o3', 'aa-o3'].includes(o), practices: [] },
  { id: 'quant', title: 'Quantitative methods', match: (o, c) => c === 'signal-engineer' || (c === 'onchain-engineer' && o !== 'oe-o3'), practices: ['correlation_study', 'walkforward_backtest'] },
  { id: 'risk', title: 'Portfolio risk', match: (o, c) => (c === 'market-architect' && o !== 'ma-o4') || o === 'aa-o4', practices: ['portfolio_risk_review', 'scenario_tested'] },
  { id: 'data', title: 'Data literacy', match: (o) => o === 'oe-o3', practices: ['data_issue_investigated'] },
  { id: 'commodities', title: 'Commodity markets', match: (_o, c) => c === 'commodity-decoder', practices: [] },
  { id: 'communication', title: 'Research communication', match: (o) => ['ma-o4', 'aa-o1', 'aa-o5'].includes(o), practices: ['report_created', 'hypothesis_reviewed', 'journal_reflection'] },
];

function researchCount(s: Snapshot, kind: string, n: number, what: string) {
  const xs = s.research.filter((r) => r.kind === kind).map((r) => r.at).sort();
  return { met: xs.length >= n, progress: [Math.min(n, xs.length), n] as [number, number], evidence: what, at: xs.length >= n ? xs[n - 1] : undefined };
}

// ───────────── Missions ─────────────
export interface Mission { id: string; kind: 'daily' | 'weekly' | 'revision' | 'course' | 'project'; title: string; why: string; condition: string; effort: string; reward: string; done: boolean; href?: string; progress?: [number, number] }

// ───────────── Database sync ─────────────
interface Settings { timezone: string; weekly_goal_days: number }
export async function learnerSettings(db: Db, userId: string): Promise<Settings> {
  return (await db.maybeOne<Settings>(`SELECT timezone, weekly_goal_days FROM acad.learner_settings WHERE user_id=$1`, [userId])) ?? { timezone: 'Asia/Kolkata', weekly_goal_days: 3 };
}

/**
 * Derives XP events from authoritative learner records and inserts any that are missing. Idempotent:
 * re-running never changes an existing award. Event times are the times of the underlying records.
 */
export async function syncLearningEvents(db: Db, userId: string): Promise<void> {
  const events: LearningEvent[] = [];
  const add = (kind: EventKind, ref: string, at: string | Date) => events.push({ kind, ref, xp: XP_RULES[kind].xp, occurred_at: new Date(at).toISOString() });
  for (const r of await db.query<{ lesson_id: string; completed_at: string }>(`SELECT lesson_id, completed_at FROM acad.lesson_progress WHERE user_id=$1 AND completed_at IS NOT NULL`, [userId])) add('lesson_completed', r.lesson_id, r.completed_at);
  const quizzes = await db.query<{ lesson_id: string; score: number; submitted_at: string }>(`SELECT lesson_id, score::float8 AS score, submitted_at FROM acad.quiz_attempts WHERE user_id=$1 AND kind='lesson_quiz' ORDER BY submitted_at, score`, [userId]);
  // Attempts with the same timestamp (possible with a fixed clock) are ordered imperfect-first.
  const seenImperfect = new Set<string>();
  for (const q of quizzes) {
    if (q.score >= 1) {
      add('quiz_perfect', q.lesson_id, q.submitted_at);
      if (seenImperfect.has(q.lesson_id)) add('error_recovered', q.lesson_id, q.submitted_at);
    } else seenImperfect.add(q.lesson_id);
  }
  for (const r of await db.query<{ attempt_id: string; submitted_at: string }>(`SELECT attempt_id, submitted_at FROM acad.quiz_attempts WHERE user_id=$1 AND kind='review' AND score >= 1`, [userId])) add('review_recalled', r.attempt_id, r.submitted_at);
  for (const r of await db.query<{ objective_id: string; updated_at: string }>(`SELECT objective_id, updated_at FROM acad.objective_mastery WHERE user_id=$1 AND state='mastered'`, [userId])) add('objective_mastered', r.objective_id, r.updated_at);
  for (const r of await db.query<{ course_id: string; at: string }>(`SELECT course_id, min(submitted_at) AS at FROM acad.diagnostic_attempts WHERE user_id=$1 AND submitted_at IS NOT NULL GROUP BY course_id`, [userId])) add('diagnostic_completed', r.course_id, r.at);
  for (const r of await db.query<{ game_id: string; at: string }>(`SELECT game_id, min(played_at) AS at FROM acad.game_scores WHERE user_id=$1 AND correct = total GROUP BY game_id`, [userId])) add('game_solved', r.game_id, r.at);
  for (const r of await db.query<{ course_id: string; at: string }>(`SELECT course_id, min(submitted_at) AS at FROM acad.capstone_submissions WHERE user_id=$1 GROUP BY course_id`, [userId])) add('capstone_submitted', r.course_id, r.at);
  for (const r of await db.query<{ course_id: string; issued_at: string }>(`SELECT course_id, issued_at FROM acad.completion_records WHERE user_id=$1`, [userId])) add('course_completed', r.course_id, r.issued_at);
  // Research: at most RESEARCH_DAILY_CAP awards per kind per local day (later ones that day earn nothing).
  const tz = (await learnerSettings(db, userId)).timezone;
  const research = await db.query<{ kind: string; ref: string; occurred_at: string }>(`SELECT kind, ref, occurred_at FROM research.activity WHERE user_id=$1 ORDER BY occurred_at, ref`, [userId]);
  const perDay = new Map<string, number>();
  for (const r of research) {
    const kind = RESEARCH_KINDS[r.kind];
    if (!kind) continue;
    const k = `${kind}|${localDate(r.occurred_at, tz)}`;
    const n = perDay.get(k) ?? 0;
    perDay.set(k, n + 1);
    if (n < RESEARCH_DAILY_CAP) add(kind, `${r.kind}:${r.ref}`.slice(0, 120), r.occurred_at);
  }
  await insertEvents(db, userId, events);
  // Mission bonuses, judged on the learning events above (bonuses themselves never count as activity).
  const settings = await learnerSettings(db, userId);
  const all = await loadEvents(db, userId);
  const bonuses: LearningEvent[] = [];
  const byDay = new Map<string, LearningEvent[]>();
  for (const e of all.filter((x) => !BONUS_KINDS.has(x.kind))) {
    const d = localDate(e.occurred_at, settings.timezone);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  for (const [d, evs] of byDay) if (dailyMissionMet(evs)) bonuses.push({ kind: 'daily_mission', ref: d, xp: XP_RULES.daily_mission.xp, occurred_at: evs.map((e) => e.occurred_at).sort()[0]! });
  const perWeek = new Map<string, string[]>();
  for (const d of byDay.keys()) perWeek.set(weekStart(d), [...(perWeek.get(weekStart(d)) ?? []), d]);
  for (const [w, ds] of perWeek) {
    if (ds.length >= settings.weekly_goal_days) {
      const firstMet = [...ds].sort()[settings.weekly_goal_days - 1]!;
      bonuses.push({ kind: 'weekly_mission', ref: w, xp: XP_RULES.weekly_mission.xp, occurred_at: byDay.get(firstMet)!.map((e) => e.occurred_at).sort()[0]! });
    }
  }
  await insertEvents(db, userId, bonuses);
}
/** Daily mission: one completed lesson, a solved game, or three correct reviews in a day. */
/** Research that counts as a day of genuine practice (alone, quick look-ups such as one portfolio view do not). */
export const QUALIFYING_RESEARCH = new Set<EventKind>(['hypothesis_recorded', 'hypothesis_reviewed', 'journal_reflection', 'benchmark_comparison', 'walkforward_backtest', 'report_created', 'data_issue_investigated']);
export const dailyMissionMet = (evs: { kind: EventKind }[]) =>
  evs.some((e) => e.kind === 'lesson_completed' || e.kind === 'game_solved' || QUALIFYING_RESEARCH.has(e.kind)) || evs.filter((e) => e.kind === 'review_recalled').length >= 3;

async function insertEvents(db: Db, userId: string, events: LearningEvent[]) {
  if (!events.length) return;
  await db.query(
    `INSERT INTO acad.learning_events (user_id, kind, ref, xp, occurred_at)
     SELECT $1, e.kind, e.ref, e.xp, e.occurred_at FROM json_to_recordset($2::json) AS e(kind text, ref text, xp int, occurred_at timestamptz)
     ON CONFLICT (user_id, kind, ref) DO NOTHING`,
    [userId, JSON.stringify(events)],
  );
}
async function loadEvents(db: Db, userId: string): Promise<LearningEvent[]> {
  return db.query<LearningEvent>(`SELECT kind, ref, xp, occurred_at FROM acad.learning_events WHERE user_id=$1 ORDER BY occurred_at`, [userId]);
}

/** Loads the snapshot used by achievements, unlocks newly met ones (recording when ATLAS first observed them). */
export async function evaluateAchievements(db: Db, userId: string, now: Date, statuses: string[], longestStreak: number) {
  const snapshot: Snapshot = {
    lessonsCompleted: await db.query(`SELECT p.lesson_id, m.course_id, p.completed_at AS at FROM acad.lesson_progress p JOIN acad.lessons l ON l.lesson_id=p.lesson_id AND l.version=p.lesson_version JOIN acad.modules m ON m.module_id=l.module_id WHERE p.user_id=$1 AND p.completed_at IS NOT NULL`, [userId]),
    lessonsAvailable: await db.query(`SELECT DISTINCT l.lesson_id, m.course_id FROM acad.lessons l JOIN acad.modules m USING (module_id) WHERE l.status = ANY($1)`, [statuses]),
    mastered: await db.query(`SELECT objective_id, updated_at AS at FROM acad.objective_mastery WHERE user_id=$1 AND state='mastered'`, [userId]),
    gamesSolved: await db.query(`SELECT game_id, min(played_at) AS at FROM acad.game_scores WHERE user_id=$1 AND correct=total GROUP BY game_id`, [userId]),
    capstones: await db.query(`SELECT course_id, min(submitted_at) AS at FROM acad.capstone_submissions WHERE user_id=$1 GROUP BY course_id`, [userId]),
    completions: await db.query(`SELECT course_id, issued_at AS at FROM acad.completion_records WHERE user_id=$1`, [userId]),
    reviewsRecalled: (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.learning_events WHERE user_id=$1 AND kind='review_recalled'`, [userId])).n,
    errorsRecovered: (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.learning_events WHERE user_id=$1 AND kind='error_recovered'`, [userId])).n,
    longestStreak,
    research: await db.query(`SELECT kind, occurred_at AS at FROM research.activity WHERE user_id=$1`, [userId]),
  };
  const results = ACHIEVEMENTS.map((a) => ({ a, r: a.check(snapshot) }));
  const newly = results.filter((x) => x.r.met);
  if (newly.length) {
    await db.query(
      `INSERT INTO acad.achievement_unlocks (user_id, achievement_id, unlocked_at, evidence)
       SELECT $1, x.id, x.at, x.evidence FROM json_to_recordset($2::json) AS x(id text, at timestamptz, evidence jsonb)
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, JSON.stringify(newly.map((x) => ({ id: x.a.id, at: new Date(x.r.at ?? now).toISOString(), evidence: { rule: x.r.evidence, engine: LEARNING_ENGINE_VERSION } })))],
    );
  }
  const unlocked = await db.query<{ achievement_id: string; unlocked_at: string }>(`SELECT achievement_id, unlocked_at FROM acad.achievement_unlocks WHERE user_id=$1`, [userId]);
  return results.map(({ a, r }) => ({
    id: a.id, title: a.title, description: a.description, glyph: a.glyph, requirement: r.evidence, progress: r.progress,
    unlocked_at: unlocked.find((u) => u.achievement_id === a.id)?.unlocked_at ?? null,
  }));
}

/** Everything the learner dashboard needs, computed from the ledger. */
export async function learnerSummary(db: Db, userId: string, now: Date, statuses: string[]) {
  await syncLearningEvents(db, userId);
  const settings = await learnerSettings(db, userId);
  const events = await loadEvents(db, userId);
  const today = localDate(now, settings.timezone);
  const learning = events.filter((e) => !BONUS_KINDS.has(e.kind));
  const activeDates = new Set(learning.map((e) => localDate(e.occurred_at, settings.timezone)));
  const daily = streak(activeDates, today);
  const weekly = weeklyStreak(activeDates, today, settings.weekly_goal_days);
  const xp = events.reduce((s, e) => s + e.xp, 0);
  const achievements = await evaluateAchievements(db, userId, now, statuses, daily.longest);
  // Calendar: the last five weeks, oldest first.
  const start = weekStart(addDays(today, -28));
  const calendar = Array.from({ length: 35 }, (_, i) => addDays(start, i)).map((d) => ({
    date: d, active: activeDates.has(d), future: d > today,
    xp: events.filter((e) => localDate(e.occurred_at, settings.timezone) === d).reduce((s, e) => s + e.xp, 0),
  }));
  const todays = learning.filter((e) => localDate(e.occurred_at, settings.timezone) === today);
  const reviewsDue = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM acad.review_schedule WHERE user_id=$1 AND due_at <= $2`, [userId, now.toISOString()])).n;
  const recommendation = await recommend(db, userId, statuses, reviewsDue);
  const missions: Mission[] = [
    { id: 'daily', kind: 'daily', title: 'Learn something today', why: 'Short, regular practice is remembered better than long, rare sessions.', condition: 'Complete one lesson, solve one practice game, or recall three concepts in review.', effort: '10–15 minutes', reward: `${XP_RULES.daily_mission.xp} XP`, done: dailyMissionMet(todays), progress: [Math.min(3, todays.filter((e) => e.kind === 'review_recalled').length), 3] },
    { id: 'weekly', kind: 'weekly', title: `Learn on ${settings.weekly_goal_days} days this week`, why: 'Spreading study over several days strengthens recall.', condition: `Do qualifying learning on ${settings.weekly_goal_days} different days (Monday to Sunday, ${settings.timezone}).`, effort: `${settings.weekly_goal_days} short sessions`, reward: `${XP_RULES.weekly_mission.xp} XP`, done: weekly.this_week_days >= settings.weekly_goal_days, progress: [Math.min(weekly.this_week_days, settings.weekly_goal_days), settings.weekly_goal_days] },
  ];
  if (reviewsDue > 0) missions.push({ id: 'revision', kind: 'revision', title: `Review ${reviewsDue} due concept${reviewsDue === 1 ? '' : 's'}`, why: 'These concepts are scheduled now because recall fades without practice.', condition: 'Answer each due review question.', effort: `about ${Math.max(2, reviewsDue)} minutes`, reward: `${XP_RULES.review_recalled.xp} XP per correct recall`, done: false, href: '/app/academy/review' });
  if (recommendation.href && recommendation.kind !== 'review') missions.push({ id: 'course', kind: recommendation.kind === 'capstone' ? 'project' : 'course', title: recommendation.title, why: recommendation.reason, condition: recommendation.condition, effort: recommendation.effort, reward: recommendation.reward, done: false, href: recommendation.href });
  // Research mission of the day: deterministic rotation by local date, so it is auditable and the same all day.
  const dayIndex = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  const rm = RESEARCH_MISSIONS[dayIndex % RESEARCH_MISSIONS.length]!;
  missions.push({ id: `research-${rm.kind}`, kind: 'daily', title: rm.title, why: rm.why, condition: rm.condition, effort: rm.effort, reward: `${XP_RULES[rm.kind].xp} XP`, done: todays.some((e) => e.kind === rm.kind), href: rm.href });
  const researchThisWeek = learning.filter((e) => RESEARCH_EVENT_KINDS.has(e.kind) && weekStart(localDate(e.occurred_at, settings.timezone)) === weekStart(today)).length;
  missions.push({ id: 'weekly-research', kind: 'weekly', title: 'Do two pieces of documented research this week', why: 'Applying a concept to real data is where it sticks.', condition: 'Any two research activities from the XP rules (notes, hypotheses, comparisons, backtests, reports, data findings).', effort: '2 sessions', reward: 'Counts toward your rank requirements', done: researchThisWeek >= 2, progress: [Math.min(2, researchThisWeek), 2], href: '/app/research-hub' });
  // Rank: XP level AND competence.
  const masteredRows = await db.query<{ objective_id: string; state: string; estimate: number; evidence_count: number }>(`SELECT objective_id, state, estimate::float8 AS estimate, evidence_count FROM acad.objective_mastery WHERE user_id=$1`, [userId]);
  const masteredIds = new Set(masteredRows.filter((m) => m.state === 'mastered').map((m) => m.objective_id));
  const practices = new Set(events.map((e) => e.kind as string));
  const level = levelFor(xp);
  const rank = rankFor(level.level, masteredIds.size, practices);
  // Skill map: mastery of the objectives in each area plus the applied practices that evidence it.
  const objectives = await db.query<{ objective_id: string; course_id: string; statement: string }>(`SELECT objective_id, course_id, statement FROM acad.objectives ORDER BY course_id, position`);
  const skill_map = SKILL_AREAS.map((a) => {
    const ids = objectives.filter((o) => a.match(o.objective_id, o.course_id)).map((o) => o.objective_id);
    const weak = masteredRows.filter((m) => ids.includes(m.objective_id) && m.state === 'learning' && m.evidence_count >= 2 && m.estimate < 0.6).map((m) => ({ objective_id: m.objective_id, statement: objectives.find((o) => o.objective_id === m.objective_id)?.statement ?? '' }));
    return { id: a.id, title: a.title, objectives: ids.length, mastered: ids.filter((i) => masteredIds.has(i)).length, practices: a.practices.map((p) => ({ kind: p, label: XP_RULES[p].label, done: practices.has(p) })), needs_practice: weak };
  });
  const hypothesesDue = await db.query<{ entry_id: string; title: string; review_date: string }>(`SELECT entry_id, title, review_date FROM research.notebook_entries WHERE user_id=$1 AND kind='hypothesis' AND reviewed_at IS NULL AND deleted_at IS NULL ORDER BY review_date LIMIT 10`, [userId]);
  return {
    engine_version: LEARNING_ENGINE_VERSION,
    settings,
    xp: level,
    rank,
    skill_map,
    research: { this_week: researchThisWeek, hypotheses_open: hypothesesDue.map((h) => ({ ...h, due: h.review_date <= today })) },
    xp_rules: Object.entries(XP_RULES).map(([kind, r]) => ({ kind, ...r })),
    streak: { daily, weekly },
    calendar,
    recent: events.slice(-12).reverse().map((e) => ({ ...e, label: XP_RULES[e.kind].label })),
    achievements,
    missions,
    recommendation,
    reviews_due: reviewsDue,
    notes: [
      'XP records learning activity; mastery is shown separately and can go down as well as up.',
      'Recommendations are rule-based, not AI-generated. Each one states the rule that produced it.',
      'Leaderboards are not offered: there is no opt-in community yet, and ATLAS does not invent participants.',
    ],
  };
}

interface Recommendation { kind: 'review' | 'resume' | 'revisit' | 'next' | 'capstone' | 'start' | 'next_course' | 'none'; title: string; reason: string; condition: string; effort: string; reward: string; href?: string }
/** The single most useful next action, by explicit rules in priority order. */
async function recommend(db: Db, userId: string, statuses: string[], reviewsDue: number): Promise<Recommendation> {
  if (reviewsDue > 0) return { kind: 'review', title: `Review ${reviewsDue} due concept${reviewsDue === 1 ? '' : 's'}`, reason: 'Rule 1: due reviews come first, because recall fades if they wait.', condition: 'Answer the due review questions.', effort: 'a few minutes', reward: `${XP_RULES.review_recalled.xp} XP per correct recall`, href: '/app/academy/review' };
  const lessons = await db.query<{ lesson_id: string; title: string; minutes: number; course_id: string; course_pos: number; module_pos: number; pos: number; objective_ids: string[] }>(
    `SELECT DISTINCT ON (l.lesson_id) l.lesson_id, l.title, l.minutes, m.course_id, c.position AS course_pos, m.position AS module_pos, l.position AS pos, l.objective_ids
       FROM acad.lessons l JOIN acad.modules m USING (module_id) JOIN acad.courses c ON c.course_id=m.course_id
      WHERE l.status = ANY($1) ORDER BY l.lesson_id, l.version DESC`,
    [statuses],
  );
  lessons.sort((a, b) => a.course_pos - b.course_pos || a.module_pos - b.module_pos || a.pos - b.pos);
  const progress = await db.query<{ lesson_id: string; completed_at: string | null }>(`SELECT lesson_id, completed_at FROM acad.lesson_progress WHERE user_id=$1`, [userId]);
  // A course is active if the learner enrolled in it or has worked on any of its lessons (lessons can be
  // opened without enrolling).
  const enrolledRows = await db.query<{ course_id: string }>(`SELECT course_id FROM acad.enrolments WHERE user_id=$1`, [userId]);
  const activeIds = [...new Set([...enrolledRows.map((e) => e.course_id), ...lessons.filter((l) => progress.some((p) => p.lesson_id === l.lesson_id)).map((l) => l.course_id)])];
  const enrolled = lessons.map((l) => l.course_id).filter((c, i, a) => a.indexOf(c) === i && activeIds.includes(c)).map((course_id) => ({ course_id }));
  const done = (id: string) => progress.some((p) => p.lesson_id === id && p.completed_at);
  const started = lessons.find((l) => enrolled.some((e) => e.course_id === l.course_id) && !done(l.lesson_id) && progress.some((p) => p.lesson_id === l.lesson_id));
  if (started) return { kind: 'resume', title: `Resume: ${started.title}`, reason: 'Rule 2: you started this lesson and have not finished it.', condition: 'Work through the lesson and attempt its quiz.', effort: `${started.minutes} min`, reward: `${XP_RULES.lesson_completed.xp} XP`, href: `/app/academy/lesson/${started.lesson_id}` };
  const weak = await db.maybeOne<{ objective_id: string }>(`SELECT objective_id FROM acad.objective_mastery WHERE user_id=$1 AND state='learning' AND evidence_count >= 2 AND estimate < 0.5 ORDER BY estimate, objective_id LIMIT 1`, [userId]);
  if (weak) {
    const l = lessons.find((x) => x.objective_ids.includes(weak.objective_id));
    if (l) return { kind: 'revisit', title: `Revisit: ${l.title}`, reason: `Rule 3: your recent answers on objective ${weak.objective_id} were mostly incorrect, so revisiting the lesson that teaches it comes before new material.`, condition: 'Re-read the lesson and retake its quiz.', effort: `${l.minutes} min`, reward: `${XP_RULES.error_recovered.xp} XP if the quiz is fully right after earlier mistakes`, href: `/app/academy/lesson/${l.lesson_id}` };
  }
  for (const e of enrolled) {
    const next = lessons.find((l) => l.course_id === e.course_id && !done(l.lesson_id));
    if (next) return { kind: 'next', title: `Next lesson: ${next.title}`, reason: 'Rule 4: the next lesson in a course you have started.', condition: 'Work through the lesson and attempt its quiz.', effort: `${next.minutes} min`, reward: `${XP_RULES.lesson_completed.xp} XP`, href: `/app/academy/lesson/${next.lesson_id}` };
    const cap = await db.maybeOne(`SELECT 1 FROM acad.capstone_submissions WHERE user_id=$1 AND course_id=$2`, [userId, e.course_id]);
    if (!cap) return { kind: 'capstone', title: 'Build your capstone', reason: 'Rule 5: you have completed every lesson in this course; the capstone applies it to a real task.', condition: 'Submit the capstone with its self-assessment.', effort: '1–3 hours', reward: `${XP_RULES.capstone_submitted.xp} XP`, href: `/app/academy/${e.course_id}/capstone` };
  }
  const courses = [...new Set(lessons.map((l) => l.course_id))];
  const nextCourse = courses.find((c) => !enrolled.some((e) => e.course_id === c));
  if (nextCourse) return { kind: enrolled.length ? 'next_course' : 'start', title: enrolled.length ? 'Start the next course' : 'Take the MARKET DECODER readiness check', reason: enrolled.length ? 'Rule 6: your enrolled courses are complete.' : 'Rule 6: you have not started a course yet; the five-question check finds the right starting point.', condition: 'Take the five-question readiness check or start the course.', effort: '5–10 minutes', reward: `${XP_RULES.diagnostic_completed.xp} XP for finishing the check`, href: `/app/academy/${nextCourse}` };
  return { kind: 'none', title: 'Nothing scheduled', reason: 'Every available lesson and capstone is complete.', condition: '', effort: '', reward: '' };
}
