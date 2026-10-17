import type { Db } from '../../db/db.js';

// Field-level licence rights (Blueprint §3.3, PRD CPL-07, EXP-02/03). The most specific matching
// rights row wins (exact field over wildcard). A dataset with no signed or dev licence row has no rights.

export type Right = 'store' | 'display' | 'derive' | 'export' | 'ai_process' | 'public_web';

interface RightsRow {
  dataset: string;
  field_pattern: string;
  can_store: boolean;
  can_display: boolean;
  can_derive: boolean;
  can_export: boolean;
  can_ai_process: boolean;
  can_public_web: boolean;
  licence_status: string;
}

export interface RightsMatrix {
  can(dataset: string, field: string, right: Right): boolean;
  explain(dataset: string, field: string): { matched: string | null; rights: Record<Right, boolean> };
}

function matches(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function specificity(row: RightsRow, dataset: string): number {
  return (row.dataset === dataset ? 2 : 0) + (row.field_pattern === '*' ? 0 : row.field_pattern.endsWith('.*') ? 1 : 3);
}

export function buildRightsMatrix(rows: RightsRow[], opts: { allowDevLicences: boolean }): RightsMatrix {
  const usable = rows.filter((r) => r.licence_status === 'signed' || (opts.allowDevLicences && r.licence_status === 'dev_only'));
  const resolve = (dataset: string, field: string): RightsRow | null => {
    const candidates = usable.filter((r) => (r.dataset === dataset || r.dataset === '*') && matches(r.field_pattern, field));
    if (!candidates.length) return null;
    return candidates.sort((a, b) => specificity(b, dataset) - specificity(a, dataset))[0]!;
  };
  const toRights = (r: RightsRow | null): Record<Right, boolean> => ({
    store: !!r?.can_store, display: !!r?.can_display, derive: !!r?.can_derive, export: !!r?.can_export, ai_process: !!r?.can_ai_process, public_web: !!r?.can_public_web,
  });
  return {
    can: (dataset, field, right) => toRights(resolve(dataset, field))[right],
    explain: (dataset, field) => {
      const r = resolve(dataset, field);
      return { matched: r ? `${r.dataset}:${r.field_pattern}` : null, rights: toRights(r) };
    },
  };
}

export async function loadRightsMatrix(db: Db, opts: { allowDevLicences: boolean }): Promise<RightsMatrix> {
  const rows = await db.query<RightsRow>(
    `SELECT r.dataset, r.field_pattern, r.can_store, r.can_display, r.can_derive, r.can_export, r.can_ai_process, r.can_public_web, l.status AS licence_status
       FROM ref.licence_rights r JOIN ref.licences l USING (licence_id)
      WHERE l.end_date IS NULL OR l.end_date >= current_date`,
  );
  return buildRightsMatrix(rows, opts);
}
