// ATLAS Academy engine: deterministic, side-effect free, unit-tested (test/academy.test.ts).
// Everything a learner is told ("why this recommendation") is derived here from explicit rules,
// so it can be explained and audited. Five questions give a rough readiness estimate only.

export const ACADEMY_ENGINE_VERSION = 'acad-engine-1';

export type QType = 'single_choice' | 'numeric' | 'multi_select';
export type Correct = { index: number } | { indexes: number[] } | { value: number; abs_tol: number; unit?: string };
export type Response = { index: number } | { indexes: number[] } | { value: number } | null;

export interface BankQuestion {
  question_id: string;
  version: number;
  skill: string;
  prerequisite: string | null;
  difficulty: number;
  qtype: QType;
  stem: string;
  options: string[];
  correct: Correct;
  explanation: string;
  misconception: string;
  weight: number;
  critical: boolean;
  objective_id: string | null;
}

export interface ReadinessRules {
  /** Weighted score at or above which readiness is high (if no critical miss). */
  high_min: number;
  /** Weighted score below which readiness is low. */
  low_max: number;
  /** This many critical misses make readiness low regardless of score. */
  critical_miss_low: number;
  /** Number of questions per attempt. */
  questions: number;
  /** Attempts allowed in a rolling 7 days. */
  max_attempts_per_week: number;
}

export const DEFAULT_RULES: ReadinessRules = { high_min: 0.8, low_max: 0.4, critical_miss_low: 2, questions: 5, max_attempts_per_week: 3 };

/** Small deterministic PRNG (mulberry32) so a selection can be reproduced from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Picks `n` diagnostic questions: one per distinct skill first (so five questions cover five
 * prerequisites where the bank allows), preferring questions the learner has not seen in recent
 * attempts. Falls back to seen questions only when the unseen pool cannot fill the set.
 */
export function selectDiagnostic(bank: BankQuestion[], n: number, seen: Set<string>, seed: number): BankQuestion[] {
  const r = rng(seed);
  const shuffled = [...bank].map((q) => ({ q, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.q);
  const unseen = shuffled.filter((q) => !seen.has(q.question_id));
  const seenQs = shuffled.filter((q) => seen.has(q.question_id));
  const picked: BankQuestion[] = [];
  const skills = new Set<string>();
  // Priority: unseen questions on new skills → any unseen → seen on new skills → any seen.
  // Avoiding recently seen questions outranks skill spread (a retake must not repeat when the bank allows).
  const pass = (pool: BankQuestion[], distinct: boolean) => {
    for (const q of pool) {
      if (picked.length === n) return;
      if (picked.includes(q) || (distinct && skills.has(q.skill))) continue;
      picked.push(q);
      skills.add(q.skill);
    }
  };
  pass(unseen, true);
  pass(unseen, false);
  pass(seenQs, true);
  pass(seenQs, false);
  // Present easiest first: it lowers anxiety without changing what is measured.
  return picked.sort((a, b) => a.difficulty - b.difficulty || a.question_id.localeCompare(b.question_id));
}

export function isCorrect(q: Pick<BankQuestion, 'qtype' | 'correct' | 'options'>, response: Response): boolean {
  if (response == null) return false;
  if (q.qtype === 'single_choice') return 'index' in response && 'index' in q.correct && response.index === q.correct.index;
  if (q.qtype === 'multi_select') {
    if (!('indexes' in response) || !('indexes' in q.correct)) return false;
    const a = [...new Set(response.indexes)].sort((x, y) => x - y);
    const b = [...q.correct.indexes].sort((x, y) => x - y);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (!('value' in response) || !('value' in q.correct) || !Number.isFinite(response.value)) return false;
  return Math.abs(response.value - q.correct.value) <= q.correct.abs_tol + 1e-12;
}

export interface QuestionOutcome {
  question_id: string;
  version: number;
  skill: string;
  correct: boolean;
  critical: boolean;
  weight: number;
  explanation: string;
  misconception: string | null;
  correct_answer: Correct;
}

export interface DiagnosticResult {
  score: number;
  max: number;
  ratio: number;
  critical_misses: number;
  readiness: 'high' | 'borderline' | 'low';
  reasons: string[];
  recommendation: { action: 'enrol' | 'review_then_retest' | 'preceding_course'; text: string };
  skills_to_review: string[];
  outcomes: QuestionOutcome[];
  caveat: string;
}

export const DIAGNOSTIC_CAVEAT = 'Five questions give a rough readiness estimate, not a measure of competence. You can review the prerequisites, retake the check with different questions, or start the course anyway.';

export function scoreDiagnostic(questions: BankQuestion[], responses: Response[], rules: ReadinessRules, ctx: { precedingCourseTitle?: string | null } = {}): DiagnosticResult {
  if (responses.length !== questions.length) throw new Error('One response per question is required');
  const outcomes: QuestionOutcome[] = questions.map((q, i) => {
    const ok = isCorrect(q, responses[i] ?? null);
    return { question_id: q.question_id, version: q.version, skill: q.skill, correct: ok, critical: q.critical, weight: q.weight, explanation: q.explanation, misconception: ok ? null : q.misconception, correct_answer: q.correct };
  });
  const max = outcomes.reduce((s, o) => s + o.weight, 0);
  const score = outcomes.reduce((s, o) => s + (o.correct ? o.weight : 0), 0);
  const ratio = max > 0 ? score / max : 0;
  const criticalMisses = outcomes.filter((o) => o.critical && !o.correct).length;
  const missedSkills = [...new Set(outcomes.filter((o) => !o.correct).map((o) => o.skill))];
  const reasons: string[] = [`You scored ${round2(score)} of ${round2(max)} weighted points (${Math.round(ratio * 100)}%).`];
  let readiness: DiagnosticResult['readiness'];
  if (criticalMisses >= rules.critical_miss_low) {
    readiness = 'low';
    reasons.push(`${criticalMisses} of the missed questions test core prerequisites for this course.`);
  } else if (ratio < rules.low_max) {
    readiness = 'low';
    reasons.push(`Scores below ${Math.round(rules.low_max * 100)}% suggest several prerequisites are not yet in place.`);
  } else if (ratio >= rules.high_min && criticalMisses === 0) {
    readiness = 'high';
    reasons.push(`Scores of ${Math.round(rules.high_min * 100)}% or more with no core prerequisite missed indicate you are ready.`);
  } else {
    readiness = 'borderline';
    reasons.push(criticalMisses > 0 ? 'You missed one core prerequisite; a short review should be enough.' : 'Most prerequisites are in place; a short review of the missed skills should help.');
  }
  if (missedSkills.length) reasons.push(`Skills to review: ${missedSkills.join(', ')}.`);
  const recommendation: DiagnosticResult['recommendation'] =
    readiness === 'high'
      ? { action: 'enrol', text: 'Start the course.' }
      : readiness === 'borderline'
        ? { action: 'review_then_retest', text: 'Review the listed prerequisites, then retake the check or start the course.' }
        : { action: 'preceding_course', text: ctx.precedingCourseTitle ? `Consider starting with ${ctx.precedingCourseTitle} first, or review the prerequisites and retake the check.` : 'Review the prerequisite notes for this course, then retake the check.' };
  return { score: round2(score), max: round2(max), ratio: round4(ratio), critical_misses: criticalMisses, readiness, reasons, recommendation, skills_to_review: missedSkills, outcomes, caveat: DIAGNOSTIC_CAVEAT };
}

/** How many more attempts are allowed now, given previous attempt start times (rolling 7 days). */
export function attemptsRemaining(previousStarts: Date[], now: Date, rules: ReadinessRules): { remaining: number; next_allowed_at: string | null } {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const recent = previousStarts.filter((d) => d.getTime() > weekAgo).sort((a, b) => a.getTime() - b.getTime());
  const remaining = Math.max(0, rules.max_attempts_per_week - recent.length);
  const next = remaining > 0 ? null : new Date(recent[recent.length - rules.max_attempts_per_week]!.getTime() + 7 * 86_400_000).toISOString();
  return { remaining, next_allowed_at: next };
}

// ───────────── Mastery (demonstrated, per objective) ─────────────
// Transparent rule: an exponentially weighted estimate of recent correctness (α = 0.5, start 0).
// An objective is "mastered" when the estimate ≥ 0.8 with at least 3 pieces of evidence.
// A later wrong answer can drop it back to "learning". Lesson completion never sets mastery.
export const MASTERY = { alpha: 0.5, threshold: 0.8, min_evidence: 3 } as const;

export interface MasteryState {
  evidence_count: number;
  correct_count: number;
  estimate: number;
  state: 'learning' | 'mastered';
}

export function updateMastery(prev: MasteryState | null, correct: boolean): MasteryState {
  const p = prev ?? { evidence_count: 0, correct_count: 0, estimate: 0, state: 'learning' as const };
  const estimate = round4(p.estimate + MASTERY.alpha * ((correct ? 1 : 0) - p.estimate));
  const evidence = p.evidence_count + 1;
  return { evidence_count: evidence, correct_count: p.correct_count + (correct ? 1 : 0), estimate, state: estimate >= MASTERY.threshold && evidence >= MASTERY.min_evidence ? 'mastered' : 'learning' };
}

// ───────────── Spaced review (Leitner) ─────────────
// Correct → next box, wrong → box 1. Box intervals in days. Daily review is capped so the queue
// never becomes a compulsion loop; nothing here sends notifications.
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 16, 35] as const;
export const REVIEW_DAILY_CAP = 10;

export function nextReview(box: number | null, correct: boolean, now: Date): { box: number; due_at: string } {
  const b = correct ? Math.min(5, (box ?? 0) + 1) : 1;
  return { box: b, due_at: new Date(now.getTime() + REVIEW_INTERVALS_DAYS[b - 1]! * 86_400_000).toISOString() };
}

/** Strip everything that would reveal the answer before submission. */
export function publicQuestion(q: BankQuestion) {
  return { question_id: q.question_id, version: q.version, qtype: q.qtype, stem: q.stem, options: q.options, skill: q.skill, difficulty: q.difficulty, unit: 'value' in q.correct ? (q.correct.unit ?? null) : null };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
