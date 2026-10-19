import { checkContent } from '@atlas/shared';
import type { Db } from '../../db/db.js';
import { badRequest, conflict, notFound } from '../../lib/http.js';
import { HELP_ARTICLES, METHODOLOGY_PAGES } from './content.js';

// Content management (PRD ADM-06) for methodology pages and help articles, on app.content_pages.
// Draft → in_review → published, versioned (a published version is never edited; a new version
// supersedes it). Built-in pages remain the fallback until a version is published. Every draft is
// checked against the advice-language rules before it can enter review. Academy lessons have
// their own seven-point review (modules/academy).

export type CmsKind = 'methodology' | 'help';
export interface Section { heading: string; body: string }
export const PUBLISH_CHECKS = ['factual', 'methodology_consistent', 'advice_language', 'accessibility', 'rights'] as const;

interface PageRow { slug: string; kind: CmsKind; version: number; title: string; body: string; status: string; author_user_id: string | null; editorial_checklist: Record<string, unknown> | null; published_at: string | null; created_at: string }

export function builtIn(kind: CmsKind, slug: string): { title: string; sections: Section[]; category?: string } | null {
  if (kind === 'methodology') return METHODOLOGY_PAGES[slug] ?? null;
  const a = HELP_ARTICLES.find((h) => h.slug === slug);
  return a ? { title: a.title, sections: [{ heading: a.title, body: a.body }], category: a.category } : null;
}

export async function publishedPage(db: Db, kind: CmsKind, slug: string): Promise<{ title: string; sections: Section[]; version: number; published_at: string } | null> {
  const r = await db.maybeOne<PageRow>(`SELECT * FROM app.content_pages WHERE kind=$1 AND slug=$2 AND status='published' ORDER BY version DESC LIMIT 1`, [kind, slug]);
  return r ? { title: r.title, sections: JSON.parse(r.body) as Section[], version: r.version, published_at: r.published_at! } : null;
}

export async function listContent(db: Db) {
  const rows = await db.query<PageRow>(`SELECT slug, kind, version, title, status, author_user_id, published_at, created_at FROM app.content_pages WHERE kind IN ('methodology','help') ORDER BY kind, slug, version DESC`);
  const builtins = [...Object.entries(METHODOLOGY_PAGES).map(([slug, p]) => ({ kind: 'methodology' as const, slug, title: p.title })), ...HELP_ARTICLES.map((a) => ({ kind: 'help' as const, slug: a.slug, title: a.title }))];
  return { builtins, versions: rows, checks: PUBLISH_CHECKS };
}

export async function createDraft(db: Db, authorId: string, input: { kind: CmsKind; slug: string; title: string; sections: Section[] }): Promise<{ slug: string; version: number }> {
  // New slugs are allowed (the route validates the format); edits of built-in pages reuse their slug.
  return db.tx(async (t) => {
    const v = (await t.one<{ v: number }>(`SELECT coalesce(max(version), 0)::int + 1 AS v FROM app.content_pages WHERE slug=$1`, [input.slug])).v;
    await t.query(`INSERT INTO app.content_pages (slug, kind, version, title, body, status, author_user_id) VALUES ($1,$2,$3,$4,$5,'draft',$6)`, [input.slug, input.kind, v, input.title, JSON.stringify(input.sections), authorId]);
    return { slug: input.slug, version: v };
  });
}

export function languageViolations(title: string, sections: Section[]) {
  return checkContent([title, ...sections.flatMap((s) => [s.heading, s.body])].join('\n'));
}

export async function submitForReview(db: Db, slug: string, version: number): Promise<void> {
  const r = await db.maybeOne<PageRow>(`SELECT * FROM app.content_pages WHERE slug=$1 AND version=$2`, [slug, version]);
  if (!r) throw notFound();
  if (r.status !== 'draft') throw conflict(`Only drafts can be submitted (this version is ${r.status}).`);
  const v = languageViolations(r.title, JSON.parse(r.body) as Section[]);
  if (v.length) throw badRequest('The draft contains language that reads as investment advice or a recommendation. Rephrase it before review.', { violations: v });
  await db.query(`UPDATE app.content_pages SET status='in_review' WHERE slug=$1 AND version=$2`, [slug, version]);
}

export async function publish(db: Db, reviewerId: string, slug: string, version: number, checklist: Record<string, unknown>): Promise<void> {
  await db.tx(async (t) => {
    const r = await t.maybeOne<PageRow>(`SELECT * FROM app.content_pages WHERE slug=$1 AND version=$2 FOR UPDATE`, [slug, version]);
    if (!r) throw notFound();
    if (r.status !== 'in_review') throw conflict(`Only versions in review can be published (this version is ${r.status}).`);
    await t.query(`UPDATE app.content_pages SET status='retired' WHERE slug=$1 AND kind=$2 AND status='published'`, [slug, r.kind]);
    await t.query(`UPDATE app.content_pages SET status='published', published_at=now(), editorial_checklist=$3, reviewer_user_ids=array_append(reviewer_user_ids, $4::uuid) WHERE slug=$1 AND version=$2`, [slug, version, JSON.stringify(checklist), reviewerId]);
  });
}
