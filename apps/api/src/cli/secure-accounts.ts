// Gives every seeded @atlas.test account a new random password (and the admin a new authenticator secret),
// signs out their sessions, and writes the new values to a local git-ignored file. The development values in
// seed.ts are public, so an installation that others can reach must not accept them.
//   tsx src/cli/secure-accounts.ts <output file>
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dbOptions, loadConfig } from '../config.js';
import { openDb } from '../db/db.js';
import { base32Encode, encryptSecret, hashPassword, randomToken } from '../lib/crypto.js';

const out = process.argv[2];
if (!out) throw new Error('usage: secure-accounts <output file>');
const cfg = loadConfig();
const db = await openDb(dbOptions(cfg));
try {
  const users = await db.query<{ user_id: string; email: string; totp: boolean }>(`SELECT user_id, email, totp_enabled_at IS NOT NULL AS totp FROM app.users WHERE email LIKE '%@atlas.test' AND status='active' ORDER BY email`);
  const lines = ['ATLAS local accounts. Keep this file private; it is not in git.', ''];
  const changes = await Promise.all(users.map(async (u) => {
    const password = randomToken(18);
    const totp = u.totp ? base32Encode(randomBytes(20)) : null;
    lines.push(`${u.email}  password: ${password}${totp ? `  authenticator secret: ${totp}` : ''}`);
    return { id: u.user_id, hash: await hashPassword(password), totp: totp && encryptSecret(totp, cfg.APP_SECRET) };
  }));
  // Written first: a failed write must not leave accounts nobody can sign in to.
  writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
  await db.tx(async (t) => {
    for (const c of changes) {
      await t.query(`UPDATE app.users SET password_hash=$2, totp_secret=COALESCE($3, totp_secret), recovery_codes='[]', updated_at=now() WHERE user_id=$1`, [c.id, c.hash, c.totp]);
      await t.query(`UPDATE app.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [c.id]);
    }
  });
  console.log(`${users.length} accounts changed. New credentials: ${out}`);
} finally {
  await db.close();
}
