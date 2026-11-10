# Running ATLAS on this computer

Every command is run from the ATLAS folder (`C:\Users\anant\Desktop\Atlas`) in a terminal.

## Everyday use

| To | Run |
|---|---|
| Start | `node scripts/atlas.mjs start`, then open http://localhost:3000 |
| Stop | `node scripts/atlas.mjs stop` |
| Restart (after changing `.env.local`) | `node scripts/atlas.mjs restart` |
| Apply code changes to the web app | `node scripts/atlas.mjs stop`, then `npm run build -w @atlas/shared` and `npm run build -w @atlas/web`, then `start`. `restart` reuses the existing web build; the API runs from source and picks up changes on restart. (`update` does all of this but also runs `npm install`.) |
| See whether it is running | `node scripts/atlas.mjs status` |
| Read the logs | `node scripts/atlas.mjs logs api` (or `web`) |

**Automatic restart.** If the API crashes, a supervisor restarts it after 5 s, 15 s, 60 s and so on (at most 5 times an hour). Each restart is noted in `.atlas/logs/api.log`. A normal `stop` is never restarted.

**After the computer restarts, ATLAS does not start by itself.** The supervisor lives inside the launcher process, which ends with your Windows session (this is why ATLAS was down on 5 Nov 2026: Windows had restarted on 3 Nov). Run `node scripts/atlas.mjs start` after signing in. Stale files in `.atlas/run` are harmless; `start` checks that the recorded processes are really alive. To start it automatically you could create a Windows Task Scheduler task "At log on" that runs the same command in the project folder; this was not set up for you, because it changes system configuration.

**Automatic data updates** (no action needed):

| Data | When |
|---|---|
| Indian indices | 08:00 and 20:30 IST |
| Crypto | About every 15 minutes |
| Commodities and macro | Checked every 3 hours; each series fetched at most once or twice a day |

If a provider limits requests, ATLAS pauses that provider and resumes it by itself.

## Settings (`.env.local`, never share or commit this file)

| Setting | Purpose |
|---|---|
| `EODHD_API_TOKEN` | Indian indices |
| `FRED_API_KEY` | Macro and commodity benchmarks |
| `EIA_API_KEY` | US energy inventories |
| `COINGECKO_DEMO_API_KEY` | Crypto |
| `DATA_GOV_IN_API_KEY` | Indian mandi prices (not set yet: register free at data.gov.in, then add it) |
| `ALLOW_SYNTHETIC_DATA=false` | Real-data mode (customers see only real data). `true` brings back the fictional demo sections, labelled "Demo data" |

After changing the file, run `node scripts/atlas.mjs restart`. A missing key turns off only the features that need it.

## Checking health

| Who | Where |
|---|---|
| Customers | **Data sources** page and the public **Status** page |
| Operators | Sign in as an administrator with two-step verification, then **Admin → Data providers** |

The operator view shows:
- provider state, pauses and reset times (when known);
- the request log, with no keys stored;
- quotas: EODHD daily, CoinGecko monthly;
- datasets that are not fresh, and job failures;
- the latest backup.

Use **Resume now** to end a pause early.

## Backups and recovery

| To | Run |
|---|---|
| Back up (stops ATLAS briefly) | `node scripts/atlas.mjs backup` |
| Test the newest backup safely (restores a copy, checks it, starts an API on it, then deletes the copy) | `node scripts/atlas.mjs verify-backup` |
| Restore (moves the current data aside, never deletes it) | `node scripts/atlas.mjs restore backups/<file>.tar.gz` |

Backups contain user accounts and notes: keep them private.

## Tests

| Suite | Run |
|---|---|
| Unit and API | `npm test` |
| Real PostgreSQL | `npm run test:postgres` |
| Browser (stop ATLAS first; it uses the same ports) | `npm run test:e2e` |

None of these calls the real data providers or spends their quotas.
