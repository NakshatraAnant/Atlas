import { describe, expect, it } from 'vitest';
import { attemptsRemaining, DEFAULT_RULES, isCorrect, nextReview, publicQuestion, scoreDiagnostic, selectDiagnostic, updateMastery, type BankQuestion, type Response } from '../src/modules/academy/engine.js';

const q = (id: string, skill: string, over: Partial<BankQuestion> = {}): BankQuestion => ({
  question_id: id, version: 1, skill, prerequisite: null, difficulty: 2, qtype: 'single_choice', stem: `Q ${id}`, options: ['a', 'b', 'c', 'd'],
  correct: { index: 1 }, explanation: 'because', misconception: 'common slip', weight: 1, critical: false, objective_id: null, ...over,
});
const bank = ['pct', 'risk', 'compound', 'liquidity', 'index', 'pct', 'risk', 'compound', 'liquidity', 'index', 'dividends'].map((s, i) => q(`d${i}`, s));
const right: Response = { index: 1 };
const wrong: Response = { index: 0 };

describe('diagnostic question selection', () => {
  it('picks five questions covering five distinct skills, deterministically from the seed', () => {
    const a = selectDiagnostic(bank, 5, new Set(), 42);
    expect(a).toHaveLength(5);
    expect(new Set(a.map((x) => x.skill)).size).toBe(5);
    expect(selectDiagnostic(bank, 5, new Set(), 42).map((x) => x.question_id)).toEqual(a.map((x) => x.question_id));
  });
  it('avoids questions from the previous attempt when the bank allows', () => {
    const first = selectDiagnostic(bank, 5, new Set(), 7);
    const second = selectDiagnostic(bank, 5, new Set(first.map((x) => x.question_id)), 8);
    expect(second.filter((x) => first.some((f) => f.question_id === x.question_id))).toEqual([]);
  });
  it('falls back to seen questions only when the unseen pool is too small', () => {
    const small = bank.slice(0, 6);
    const r = selectDiagnostic(small, 5, new Set(small.slice(0, 4).map((x) => x.question_id)), 1);
    expect(r).toHaveLength(5);
  });
  it('never exposes the correct answer, explanation or misconception before submission', () => {
    const pub = publicQuestion(q('x', 'pct', { qtype: 'numeric', options: [], correct: { value: 12.5, abs_tol: 0.1, unit: '%' } }));
    const text = JSON.stringify(pub);
    expect(text).not.toContain('12.5');
    expect(pub).not.toHaveProperty('correct');
    expect(pub).not.toHaveProperty('explanation');
    expect(pub).not.toHaveProperty('misconception');
    expect(pub.unit).toBe('%');
  });
});

describe('grading', () => {
  it('grades single choice, multi-select (order-insensitive) and numeric within tolerance', () => {
    expect(isCorrect(q('a', 's'), { index: 1 })).toBe(true);
    expect(isCorrect(q('a', 's'), { index: 2 })).toBe(false);
    expect(isCorrect(q('a', 's'), null)).toBe(false);
    const ms = q('m', 's', { qtype: 'multi_select', correct: { indexes: [0, 2] } });
    expect(isCorrect(ms, { indexes: [2, 0] })).toBe(true);
    expect(isCorrect(ms, { indexes: [0] })).toBe(false);
    expect(isCorrect(ms, { indexes: [0, 2, 3] })).toBe(false);
    const num = q('n', 's', { qtype: 'numeric', options: [], correct: { value: 21, abs_tol: 0.5 } });
    expect(isCorrect(num, { value: 21.4 })).toBe(true);
    expect(isCorrect(num, { value: 21.5 })).toBe(true);
    expect(isCorrect(num, { value: 21.6 })).toBe(false);
    expect(isCorrect(num, { value: Number.NaN })).toBe(false);
    expect(isCorrect(num, { index: 21 })).toBe(false);
  });
});

describe('placement scoring', () => {
  const five = bank.slice(0, 5);
  it('all correct → high readiness and direct entry', () => {
    const r = scoreDiagnostic(five, five.map(() => right), DEFAULT_RULES);
    expect(r.readiness).toBe('high');
    expect(r.recommendation.action).toBe('enrol');
    expect(r.ratio).toBe(1);
  });
  it('one ordinary mistake (4/5 = 80%) is still high readiness: one slip does not block', () => {
    const r = scoreDiagnostic(five, [wrong, right, right, right, right], DEFAULT_RULES);
    expect(r.readiness).toBe('high');
    expect(r.skills_to_review).toEqual([five[0]!.skill]);
  });
  it('one critical miss at 80% → borderline, with the reason stated', () => {
    const qs = five.map((x, i) => (i === 0 ? { ...x, critical: true } : x));
    const r = scoreDiagnostic(qs, [wrong, right, right, right, right], DEFAULT_RULES);
    expect(r.readiness).toBe('borderline');
    expect(r.reasons.join(' ')).toMatch(/core prerequisite/);
    expect(r.recommendation.action).toBe('review_then_retest');
  });
  it('two critical misses → low readiness even with a high score elsewhere', () => {
    const qs = five.map((x, i) => (i < 2 ? { ...x, critical: true, weight: 0.5 } : { ...x, weight: 3 }));
    const r = scoreDiagnostic(qs, [wrong, wrong, right, right, right], DEFAULT_RULES, { precedingCourseTitle: 'ATLAS: MARKET DECODER' });
    expect(r.ratio).toBeGreaterThan(0.8);
    expect(r.readiness).toBe('low');
    expect(r.recommendation.text).toContain('ATLAS: MARKET DECODER');
  });
  it('uses weights: a heavy question missed lowers the ratio more', () => {
    const qs = five.map((x, i) => ({ ...x, weight: i === 0 ? 4 : 1 }));
    const r = scoreDiagnostic(qs, [wrong, right, right, right, right], DEFAULT_RULES);
    expect(r.score).toBe(4);
    expect(r.max).toBe(8);
    expect(r.readiness).toBe('borderline');
  });
  it('below the low threshold → low; boundary values are inclusive as documented', () => {
    expect(scoreDiagnostic(five, [right, wrong, wrong, wrong, wrong], DEFAULT_RULES).readiness).toBe('low');
    expect(scoreDiagnostic(five, [right, right, wrong, wrong, wrong], DEFAULT_RULES).readiness).toBe('borderline');
  });
  it('rules are configurable per course version', () => {
    const strict = { ...DEFAULT_RULES, high_min: 1 };
    expect(scoreDiagnostic(five, [wrong, right, right, right, right], strict).readiness).toBe('borderline');
  });
  it('always carries the rough-estimate caveat and rejects mismatched responses', () => {
    expect(scoreDiagnostic(five, five.map(() => right), DEFAULT_RULES).caveat).toMatch(/rough readiness estimate/);
    expect(() => scoreDiagnostic(five, [right], DEFAULT_RULES)).toThrow();
  });
});

describe('retake limits', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  it('allows three attempts in a rolling week and says when the next one opens', () => {
    const d = (h: number) => new Date(now.getTime() - h * 3_600_000);
    expect(attemptsRemaining([d(1), d(2)], now, DEFAULT_RULES).remaining).toBe(1);
    const full = attemptsRemaining([d(1), d(2), d(30)], now, DEFAULT_RULES);
    expect(full.remaining).toBe(0);
    expect(full.next_allowed_at).toBe(new Date(d(30).getTime() + 7 * 86_400_000).toISOString());
    expect(attemptsRemaining([d(24 * 8), d(24 * 9), d(24 * 10)], now, DEFAULT_RULES).remaining).toBe(3);
  });
});

describe('mastery and spaced review', () => {
  it('needs at least three pieces of evidence and a high recent estimate; a miss can undo it', () => {
    let m = updateMastery(null, true);
    expect(m.state).toBe('learning');
    m = updateMastery(m, true);
    expect(m.estimate).toBe(0.75);
    m = updateMastery(m, true);
    expect(m).toEqual({ evidence_count: 3, correct_count: 3, estimate: 0.875, state: 'mastered' });
    m = updateMastery(m, false);
    expect(m.state).toBe('learning');
    expect(m.estimate).toBe(0.4375);
  });
  it('moves up one Leitner box when correct, back to box 1 when wrong', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    expect(nextReview(null, true, now)).toEqual({ box: 1, due_at: '2026-10-20T00:00:00.000Z' });
    expect(nextReview(1, true, now)).toEqual({ box: 2, due_at: '2026-10-22T00:00:00.000Z' });
    expect(nextReview(5, true, now).box).toBe(5);
    expect(nextReview(4, false, now)).toEqual({ box: 1, due_at: '2026-10-20T00:00:00.000Z' });
  });
});
