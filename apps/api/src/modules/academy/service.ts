import { createHash } from 'node:crypto';
import type { Db } from '../../db/db.js';
import { CURRICULUM, type SourceCourse, type SourceQuestion } from './curriculum.js';
import type { BankQuestion, Correct, QType, ReadinessRules } from './engine.js';

// Curriculum persistence. `syncCurriculum` is idempotent: unchanged content is left alone; changed
// content becomes a NEW version (old versions are retired, never edited), so learner records that
// pin a version stay valid. New content always enters as `in_review`.

/** Order-independent JSON (jsonb reorders object keys) with numbers normalised, for change detection. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  if (typeof v === 'string' && v.trim() !== '' && /^-?d+(.d+)?$/.test(v)) return Number(v);
  return v;
}
const canon = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

export interface SyncReport {
  courses: number;
  new_course_versions: number;
  new_lesson_versions: number;
  new_question_versions: number;
}

export async function syncCurriculum(db: Db, curriculum: SourceCourse[] = CURRICULUM): Promise<SyncReport> {
  const report: SyncReport = { courses: 0, new_course_versions: 0, new_lesson_versions: 0, new_question_versions: 0 };
  await db.tx(async (t) => {
    for (const c of curriculum) {
      report.courses++;
      await t.query(`INSERT INTO acad.courses (course_id, position) VALUES ($1,$2) ON CONFLICT (course_id) DO UPDATE SET position=EXCLUDED.position`, [c.id, c.position]);
    }
    for (const c of curriculum) {
      const versionFields = { title: c.title, tagline: c.tagline, description: c.description, audience: c.audience, prerequisites: c.prerequisites, readiness_rules: c.rules, preceding_course_id: c.preceding ?? null, completion_statement: c.completion_statement };
      const latest = await t.maybeOne<Record<string, unknown> & { version: number }>(
        `SELECT version, title, tagline, description, audience, prerequisites, readiness_rules, preceding_course_id, completion_statement FROM acad.course_versions WHERE course_id=$1 ORDER BY version DESC LIMIT 1`,
        [c.id],
      );
      const { version: latestVersion, ...latestFields } = latest ?? { version: 0 };
      if (!latest || canon(latestFields) !== canon(versionFields)) {
        const v = latestVersion + 1;
        await t.query(
          `INSERT INTO acad.course_versions (course_id, version, title, tagline, description, audience, prerequisites, readiness_rules, preceding_course_id, completion_statement, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'in_review')`,
          [c.id, v, c.title, c.tagline, c.description, c.audience, c.prerequisites, JSON.stringify(c.rules), c.preceding ?? null, c.completion_statement],
        );
        await t.query(`UPDATE acad.course_versions SET status='retired' WHERE course_id=$1 AND version<$2 AND status <> 'retired'`, [c.id, v]);
        await t.query(`UPDATE acad.courses SET current_version=$2 WHERE course_id=$1`, [c.id, v]);
        report.new_course_versions++;
      }
      for (const [i, o] of c.objectives.entries()) {
        await t.query(`INSERT INTO acad.objectives (objective_id, course_id, statement, skill, position) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (objective_id) DO UPDATE SET statement=EXCLUDED.statement, skill=EXCLUDED.skill, position=EXCLUDED.position`, [o.id, c.id, o.statement, o.skill, i + 1]);
      }
      for (const [mi, m] of c.modules.entries()) {
        await t.query(`INSERT INTO acad.modules (module_id, course_id, position, title, summary) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (module_id) DO UPDATE SET position=EXCLUDED.position, title=EXCLUDED.title, summary=EXCLUDED.summary`, [m.id, c.id, mi + 1, m.title, m.summary]);
        for (const [li, l] of m.lessons.entries()) {
          const fields = { module_id: m.id, position: li + 1, title: l.title, minutes: l.minutes, objective_ids: l.objectives, prerequisite_lesson_ids: l.prerequisites ?? [], blocks: l.blocks, references_list: l.references, mastery_rule: l.mastery_rule };
          const prev = await t.maybeOne<Record<string, unknown> & { version: number }>(
            `SELECT version, module_id, position, title, minutes, objective_ids, prerequisite_lesson_ids, blocks, references_list, mastery_rule FROM acad.lessons WHERE lesson_id=$1 ORDER BY version DESC LIMIT 1`,
            [l.id],
          );
          const { version: pv, ...prevFields } = prev ?? { version: 0 };
          if (!prev || canon(prevFields) !== canon(fields)) {
            await t.query(
              `INSERT INTO acad.lessons (lesson_id, version, module_id, position, title, minutes, objective_ids, prerequisite_lesson_ids, blocks, references_list, mastery_rule, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'in_review')`,
              [l.id, pv + 1, m.id, li + 1, l.title, l.minutes, l.objectives, l.prerequisites ?? [], JSON.stringify(l.blocks), JSON.stringify(l.references), l.mastery_rule],
            );
            await t.query(`UPDATE acad.lessons SET status='retired' WHERE lesson_id=$1 AND version<$2 AND status <> 'retired'`, [l.id, pv + 1]);
            report.new_lesson_versions++;
          }
          for (const q of l.quiz) report.new_question_versions += await syncQuestion(t, c.id, 'quiz', q, l.id);
        }
      }
      for (const q of c.diagnostic) report.new_question_versions += await syncQuestion(t, c.id, 'diagnostic', q, null);
    }
  });
  return report;
}

async function syncQuestion(t: Db, courseId: string, purpose: 'diagnostic' | 'quiz', q: SourceQuestion, lessonId: string | null): Promise<number> {
  const fields = { course_id: courseId, purpose, lesson_id: lessonId, objective_id: q.objective ?? null, skill: q.skill, prerequisite: q.prerequisite ?? null, difficulty: q.difficulty, qtype: q.qtype, stem: q.stem, options: q.options ?? [], correct: q.correct, explanation: q.explanation, misconception: q.misconception, weight: q.weight ?? 1, critical: q.critical ?? false };
  const prev = await t.maybeOne<Record<string, unknown> & { version: number }>(
    `SELECT version, course_id, purpose, lesson_id, objective_id, skill, prerequisite, difficulty, qtype, stem, options, correct, explanation, misconception, weight, critical FROM acad.questions WHERE question_id=$1 ORDER BY version DESC LIMIT 1`,
    [q.id],
  );
  const { version: pv, ...prevFields } = prev ?? { version: 0 };
  if (prev && canon(prevFields) === canon(fields)) return 0;
  await t.query(
    `INSERT INTO acad.questions (question_id, version, course_id, purpose, lesson_id, objective_id, skill, prerequisite, difficulty, qtype, stem, options, correct, explanation, misconception, weight, critical, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'in_review')`,
    [q.id, pv + 1, courseId, purpose, lessonId, q.objective ?? null, q.skill, q.prerequisite ?? null, q.difficulty, q.qtype, q.stem, JSON.stringify(q.options ?? []), JSON.stringify(q.correct), q.explanation, q.misconception, q.weight ?? 1, q.critical ?? false],
  );
  await t.query(`UPDATE acad.questions SET status='retired' WHERE question_id=$1 AND version<$2 AND status <> 'retired'`, [q.id, pv + 1]);
  return 1;
}

// ───────────── Reads ─────────────

export const visibleStatuses = (showDrafts: boolean) => (showDrafts ? ['published', 'in_review'] : ['published']);

interface QuestionRow {
  question_id: string;
  version: number;
  objective_id: string | null;
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
  status: string;
}
const Q_COLS = `question_id, version, objective_id, skill, prerequisite, difficulty, qtype, stem, options, correct, explanation, misconception, weight, critical, status`;
const toBank = (r: QuestionRow): BankQuestion => ({ ...r, weight: Number(r.weight) });

export async function diagnosticBank(db: Db, courseId: string, statuses: string[]): Promise<BankQuestion[]> {
  const rows = await db.query<QuestionRow>(`SELECT ${Q_COLS} FROM acad.questions WHERE course_id=$1 AND purpose='diagnostic' AND status = ANY($2)`, [courseId, statuses]);
  return rows.map(toBank);
}

export async function questionsByRefs(db: Db, refs: { question_id: string; version: number }[]): Promise<BankQuestion[]> {
  if (!refs.length) return [];
  const rows = await db.query<QuestionRow>(
    `SELECT ${Q_COLS} FROM acad.questions q JOIN json_to_recordset($1::json) AS r(question_id text, version int) USING (question_id, version)`,
    [JSON.stringify(refs)],
  );
  const byKey = new Map(rows.map((r) => [`${r.question_id}@${r.version}`, toBank(r)]));
  return refs.map((r) => {
    const q = byKey.get(`${r.question_id}@${r.version}`);
    if (!q) throw new Error(`Question ${r.question_id} v${r.version} not found`);
    return q;
  });
}

export async function lessonQuiz(db: Db, lessonId: string, statuses: string[]): Promise<BankQuestion[]> {
  const rows = await db.query<QuestionRow>(`SELECT ${Q_COLS} FROM acad.questions WHERE lesson_id=$1 AND purpose='quiz' AND status = ANY($2) ORDER BY question_id`, [lessonId, statuses]);
  return rows.map(toBank);
}

export interface CourseVersionRow {
  course_id: string;
  version: number;
  title: string;
  tagline: string;
  description: string;
  audience: string;
  prerequisites: string;
  readiness_rules: ReadinessRules;
  preceding_course_id: string | null;
  completion_statement: string;
  status: string;
  position: number;
}

export async function currentCourses(db: Db, statuses: string[]): Promise<CourseVersionRow[]> {
  return db.query<CourseVersionRow>(
    `SELECT cv.course_id, cv.version, cv.title, cv.tagline, cv.description, cv.audience, cv.prerequisites, cv.readiness_rules, cv.preceding_course_id, cv.completion_statement, cv.status, c.position
       FROM acad.courses c JOIN acad.course_versions cv ON cv.course_id=c.course_id AND cv.version=c.current_version
      WHERE cv.status = ANY($1) ORDER BY c.position`,
    [statuses],
  );
}
