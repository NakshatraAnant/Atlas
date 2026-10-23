# Implementation status: ATLAS Digital Assets (session 8, 22–23 Oct 2026)

Branch `feat/atlas-mvp`. Recovery point before this work: branch `backup/pre-digital-assets-2026-10-22`
(at `e14b6a6`), `backups/pre-digital-assets-2026-10-22.bundle` (all branches) and the database backup
`backups/atlas-backup-2026-10-22_17-35-08.tar.gz` (129.7 MB).

Status key: **V** implemented and verified · **I** implemented, verification incomplete · **P** partially
implemented · **B** blocked by an external dependency · **N** not implemented. Test evidence:
`docs/execution/TEST_RESULTS.md` ("23 Oct 2026, session 8").

## 1. Data sources and pipeline

| Requirement (spec §) | Status | Evidence / notes |
|---|---|---|
| Source research with official docs, dates, limits, terms (§3) | V | `docs/crypto/SOURCE_CAPABILITY_MATRIX.md`; registry `modules/crypto/registry.ts`; every endpoint exercised from this machine |
| CoinGecko adapter (keyless; Demo key from server env only) (§3.1) | V | markets (usd, inr), global, coin detail, 365-day chart, exchange tickers; 365-day keyless history limit verified (error 10012) |
| Binance public market data, venue-specific (§3.2) | V | exchangeInfo, daily klines back to 2017-08-17; WebSocket miniTicker; labelled venue/USDT everywhere |
| Coinbase Exchange public data (§3.3) | V | products, daily candles back to 2015-07-20 |
| DefiLlama free endpoints (§3.4) | V | protocols, TVL/fees/revenue histories, chain TVL, stablecoins; Pro-only datasets not used |
| Blockchain access: Ethereum and Bitcoin (§3.5) | V | PublicNode JSON-RPC (recent blocks), mempool.space (blocks, fee estimates). Solana: **N** (documented) |
| Additional sources only where they add coverage (§3.6) | V | GitHub releases (Bitcoin Core, Geth, Agave), Ethereum Foundation blog RSS |
| Canonical data model, provider-independent (§4.1) | V | migration `010_crypto.sql`: 22 tables in schema `crypto`; symbols never identities; pairs venue-specific; series per source/pair/quote |
| Provenance on every observation (§4.2) | V | source, job id, retrieval time, transform version, validation on every row; job stages recorded separately |
| Data quality: OHLC, timestamps, duplicates, gaps, outliers (suspect, not rejected), supply consistency, address normalisation, contract conflicts (§4.3) | V | `validate.ts` + quarantine table; tests in `crypto.test.ts` |
| Provider adapters with explicit unsupported capabilities (§5.1) | V | `providers.ts` `SOURCE_CAPABILITIES` |
| Scheduling (§5.2) | V | `scheduler.ts`; last-run read from the database so it survives restarts; verified running in the API (Sources & health shows jobs succeeding on schedule) |
| Request budgeting, cache, de-dup, back-off, no retry storms (§5.3) | V | `http.ts`; tests: throttling, cache, de-dup, 429 back-off, malformed/network errors |
| Resumable, bounded, idempotent backfill with coverage (§5.4) | V | per-series cursor; ≤30 requests per run; idempotent upserts proven in tests; coverage table in Sources & health |
| Backend owns provider requests; persistent records in DB (§5.5) | V | browser never calls a provider (CSP `connect-src 'self'`) |
| WebSocket reliability: reconnect with back-off, stale detection, ordering, clean shutdown (§5.6) | V | `live.ts`; tests for live → stale and out-of-order events; verified live in the browser (messages every second) |
| No silent fallback; honest stale states (§5.7) | V | outage test: failed job, source degraded, last values kept, marked stale |

## 2. Terminal and research

| Requirement | Status | Evidence / notes |
|---|---|---|
| Digital Assets entry in navigation; equities untouched (§2.2) | V | `components/shell.tsx`; equity e2e journeys re-run |
| Global overview: provider totals, dominance, majors, movers, heatmap, volatility, DeFi, events, source status (§6.1) | V | `/app/crypto`; totals are CoinGecko's own (not computed from a sample) |
| Market categories (§6.1) | P | CoinGecko category stored per asset from detail calls (filled gradually); no category overview page |
| Asset explorer with server-side search, sort, filter, pagination (§6.2) | V | `/app/crypto/assets`; API rejects `per>100` |
| Asset detail: identity, contracts, provider ids, charts, stats, freshness, coverage, relevant panels (§6.3) | V | `/app/crypto/assets/[key]` with Price & overview, Analytics, Tokenomics, Markets, Events, My notes |
| Charts: candlesticks, volume, periods, hover, UTC axes, gaps shown, table view (§11.3) | V | `PriceChart` in `components/crypto.tsx`; user-selectable display time zone **N** (UTC only, stated) |
| Returns, volatility, drawdown, correlation, beta, rolling, distribution, regimes, volume trend (§7) | V | `packages/shared/src/crypto-analytics.ts`, 34 hand-checked tests; API analytics equal an independent calculation (test) |
| Backtest with disclosed biases (§7.5) | V | SMA trend vs buy-and-hold, next-close execution, fees + slippage; no-look-ahead test |
| Factor research, event studies as a tool (§7.5) | N | Taught in ON-CHAIN SIGNAL ENGINEER; no automated event-study tool |
| Formula transparency (§7.6) | V | formulas returned with every analytics response and shown in the UI |
| Watchlist and research notes, private (§2.2) | V | API tests (privacy across users); e2e watchlist persists after reload |
| Supply analysis with definitions kept separate (§8.1) | V | daily supply snapshots; provider methodology; "no maximum defined" never 0 |
| Unlocks/vesting (§8.2) | B | no free verified source (DefiLlama unlocks are Pro); shown as not available |
| Holder concentration (§8.3) | N | no reliable free address-classification dataset; stated in the UI |
| DeFi research: protocols, TVL/fees/revenue histories, chains, stablecoins, methodology (§9.1) | V | `/app/crypto/defi`, `/app/crypto/defi/[id]` |
| Blockchain explorer (recent blocks, fees, gas, producers) (§9.2) | P | Bitcoin and Ethereum recent blocks; no transaction detail or token-transfer view |
| Network analytics (§9.3) | P | block interval, tx/block, base fee, gas utilisation, BTC fees per block, fee estimates; no active-address or staking metrics |
| Read-only, no custody or signing (§9.4) | V | nothing in the module accepts keys or signs; the Academy signing lab uses toy keys and warns never to enter real ones |
| Source-linked events with publication times, deduplicated (§10) | V | 668 events; scope stated in the UI ("not a general news feed") |
| Cross-asset research (§15) | P | crypto vs **your uploaded** equity price file, session-aligned, documented. ATLAS's own equity data is synthetic, so it is never compared with real crypto data. |
| INR display (§15.2) | V | CoinGecko-converted INR reference, labelled "converted reference", never presented as an INR venue price |
| Administration and observability (§16) | V | Sources & health page; admin-only manual runs and source enable/disable (two-step verification) |

## 3. Academy

| Requirement | Status | Evidence / notes |
|---|---|---|
| Four crypto courses in the existing Academy framework (§12.1) | V | CRYPTO MARKET DECODER (9 lessons), TOKENOMICS DETECTIVE (6), ON-CHAIN SIGNAL ENGINEER (6), DIGITAL ASSET ARCHITECT (6); 22 objectives; 41 diagnostic questions |
| Lesson structure (objective, prerequisites, explanation, worked example, visual aid, practice, check, assessment, feedback, reading, completion) (§12.2) | V | seven-stage loop enforced by `academy-content.test.ts` |
| Progress persistence, review gating (§12.3) | V | same engine as the equity courses; draft labels; production hides unreviewed content |
| Content review | B | all content `in_review`: needs a named subject-matter reviewer |
| 3D/interactive scenes A–G (§13) | V (A, B, C, E, F, G 3D; D interactive 2D) | `components/crypto-scenes.tsx` on the existing runtime; table fallbacks; reduced motion; scene F uses real stored data and refuses to simulate prices |
| Four rendered videos with captions, transcripts, posters (§14) | V | cd/td/oe/aa-intro rendered with the existing pipeline; script numbers checked against `@atlas/shared`; Edge playback check OK |

## 4. Equities real data

| Requirement | Status | Notes |
|---|---|---|
| Real Indian equity data from a legitimately accessible source | B | NSE/NSE Indices/BSE terms (unchanged) and Alpha Vantage (key + unreadable terms) — see `docs/DATA_RIGHTS_AND_PROVIDERS.md` and Data health. User-uploaded price files remain the permitted path. |

## 5. Defects found and fixed in this session

1. `scripts/atlas.mjs backup/restore` failed under Git Bash (GNU tar read `C:` as a remote host) → uses Windows `tar.exe`.
2. Video renderer: a `//` comment swallowed `width/height/fps/codecs/bytes` in the metadata, so newly rendered videos would never be listed → fixed; four new entries filled from the files.
3. Budget wait loop could spin forever under a frozen clock → bounded by time slept (found by tests).
4. An asset page could wait up to 65 s for a provider slot → on-demand metadata skipped when the budget is low.
5. Venue candle jobs reported success with zero pairs → fail with the missing precondition.
6. Copying `.env.example` would have broken start-up (empty `CRYPTO_*` values) → empty means unset; test added.
7. Academy e2e selectors became ambiguous with the new course names → exact matches.

## 6. Next steps

See `docs/execution/NEXT_ACTIONS.md`.

## Session 9 (23 Oct 2026)

Research hub (20 features: 15 verified, 3 partial, 1 blocked on credential path, 1 blocked on licensed fundamentals), Indian equity data path (blocked only on your provider key), progress engine v2, PostgreSQL concurrency, recovery drill. Full table: `docs/execution/ATLAS_MASTER_EXECUTION_STATUS.md`.
