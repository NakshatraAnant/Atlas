import type { Db } from '../db/db.js';

// Bulk writes through a single JSON parameter (json_populate_recordset). This works identically
// on PGlite and node-postgres and avoids building statements with thousands of placeholders.

export async function bulkInsert(
  db: Db,
  table: string,
  rows: Record<string, unknown>[],
  opts: { onConflict?: string; chunk?: number } = {},
): Promise<number> {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]!);
  const chunk = opts.chunk ?? 4000;
  const colList = cols.map((c) => `"${c}"`).join(', ');
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const res = await db.query<{ n: number }>(
      `WITH ins AS (
         INSERT INTO ${table} (${colList})
         SELECT ${colList} FROM json_populate_recordset(NULL::${table}, $1::json)
         ${opts.onConflict ?? ''}
         RETURNING 1)
       SELECT count(*)::int AS n FROM ins`,
      [JSON.stringify(part)],
    );
    inserted += res[0]?.n ?? 0;
  }
  return inserted;
}
