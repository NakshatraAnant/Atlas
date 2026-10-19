import { checkContent } from '@atlas/shared';
import { describe, expect, it } from 'vitest';
import { CURRICULUM, WIDGETS, type SourceQuestion } from '../src/modules/academy/curriculum.js';
import { isCorrect } from '../src/modules/academy/engine.js';

// Structural and policy checks over the whole authored curriculum (content is data; these tests
// stop malformed or advice-like content from ever reaching the database).

const STAGES = ['discover', 'observe', 'predict', 'investigate', 'decide', 'explain', 'review'];
const lessons = CURRICULUM.flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => ({ course: c, module: m, lesson: l }))));
const allQuestions: { q: SourceQuestion; course: string }[] = CURRICULUM.flatMap((c) => [...c.diagnostic, ...c.modules.flatMap((m) => m.lessons.flatMap((l) => l.quiz))].map((q) => ({ q, course: c.id })));

describe('curriculum completeness', () => {
  it('has four courses and no module without lessons', () => {
    expect(CURRICULUM.map((c) => c.title)).toEqual(['ATLAS: MARKET DECODER', 'ATLAS: EQUITY DETECTIVE', 'ATLAS: SIGNAL ENGINEER', 'ATLAS: MARKET ARCHITECT']);
    for (const c of CURRICULUM) for (const m of c.modules) expect(m.lessons.length, `${m.id} has lessons`).toBeGreaterThanOrEqual(2);
    expect(lessons.length).toBeGreaterThanOrEqual(29);
  });
  it('every course objective is taught by at least one lesson and assessed by at least three quiz questions', () => {
    for (const c of CURRICULUM) {
      for (const o of c.objectives) {
        const taught = c.modules.some((m) => m.lessons.some((l) => l.objectives.includes(o.id)));
        const assessed = c.modules.flatMap((m) => m.lessons.flatMap((l) => l.quiz)).filter((q) => q.objective === o.id).length;
        // md-o1..md-o3 objectives come from module 1; diagnostic-only objectives are not allowed.
        expect(taught, `${o.id} taught`).toBe(true);
        expect(assessed, `${o.id} assessed`).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('each course has a diagnostic bank of at least 10 questions over at least 5 skills, with critical items', () => {
    for (const c of CURRICULUM) {
      expect(c.diagnostic.length).toBeGreaterThanOrEqual(10);
      expect(new Set(c.diagnostic.map((q) => q.skill)).size).toBeGreaterThanOrEqual(5);
      expect(c.diagnostic.some((q) => q.critical)).toBe(true);
    }
  });
});

describe('lesson structure', () => {
  it.each(lessons.map((x) => [x.lesson.id, x] as const))('%s follows the seven-stage loop and is well-formed', (_id, { course, lesson }) => {
    expect(lesson.blocks.map((b) => b.stage)).toEqual(STAGES);
    expect(lesson.quiz.length).toBeGreaterThanOrEqual(3);
    expect(lesson.minutes).toBeGreaterThan(0);
    expect(lesson.references.length).toBeGreaterThan(0);
    const objectiveIds = new Set(course.objectives.map((o) => o.id));
    for (const o of lesson.objectives) expect(objectiveIds.has(o)).toBe(true);
    for (const q of lesson.quiz) expect(lesson.objectives).toContain(q.objective);
    for (const b of lesson.blocks) {
      if (b.kind === 'interactive') expect(WIDGETS).toContain(b.widget);
      if (b.kind === 'atlas_task') expect(b.href).toMatch(/^\/(app|methodology)/);
      if ('alt_text' in b) expect(b.alt_text.length).toBeGreaterThan(20);
      if (b.kind === 'prediction') expect(b.answer).toBeLessThan(b.options.length);
    }
    for (const p of lesson.prerequisites ?? []) expect(lessons.some((x) => x.lesson.id === p)).toBe(true);
  });
});

describe('questions', () => {
  it('ids are unique across the curriculum', () => {
    const ids = allQuestions.map((x) => x.q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const lessonIds = lessons.map((x) => x.lesson.id);
    expect(new Set(lessonIds).size).toBe(lessonIds.length);
  });
  it('every answer key is valid and its own correct answer grades as correct', () => {
    for (const { q } of allQuestions) {
      const opts = q.options ?? [];
      if (q.qtype === 'single_choice') {
        expect('index' in q.correct && q.correct.index < opts.length, q.id).toBe(true);
        expect(isCorrect({ qtype: q.qtype, correct: q.correct, options: opts }, { index: (q.correct as { index: number }).index })).toBe(true);
      } else if (q.qtype === 'multi_select') {
        expect('indexes' in q.correct && q.correct.indexes.every((i) => i < opts.length), q.id).toBe(true);
      } else {
        expect('value' in q.correct && Number.isFinite(q.correct.value) && q.correct.abs_tol >= 0, q.id).toBe(true);
        expect(opts.length, q.id).toBe(0);
      }
      expect(q.explanation.length).toBeGreaterThan(10);
      expect(q.misconception.length).toBeGreaterThan(5);
    }
  });
});

describe('content policy (education mode: no advice, recommendations or urgency)', () => {
  it('no lesson, question or course text reads as investment advice or a recommendation', () => {
    const texts: [string, string][] = [];
    for (const c of CURRICULUM) {
      texts.push([`${c.id}:meta`, [c.title, c.tagline, c.description, c.prerequisites, c.completion_statement].join('\n')]);
      for (const m of c.modules) for (const l of m.lessons) texts.push([l.id, JSON.stringify(l.blocks)]);
    }
    for (const { q } of allQuestions) texts.push([q.id, [q.stem, ...(q.options ?? []), q.explanation].join('\n')]);
    const bad = texts.map(([id, t]) => [id, checkContent(t, { mode: 'education' })] as const).filter(([, v]) => v.length);
    expect(bad).toEqual([]);
  });
});
