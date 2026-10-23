# Quantitative methods (ATLAS research)

All calculations live in one tested layer, `packages/shared/src/crypto-analytics.ts` and `packages/shared/src/research-analytics.ts`, and are used by the API (`apps/api/src/modules/research`, `apps/api/src/modules/crypto`). Tests with hand-calculated expectations: `packages/shared/test/*.test.ts`.

## Conventions

| Topic | Rule |
|---|---|
| Observations | `{t, v}`: UTC epoch ms and a positive price, sorted, one per day. |
| Gaps | Never filled. A daily return across a gap is not computed (crypto: consecutive UTC days only; sessions: breaks longer than 5 calendar days are skipped). |
| Returns | Simple `p_t/p_{t−1} − 1` for performance; log `ln(p_t/p_{t−1})` for volatility and correlation. Period return = end ÷ start − 1 with the start taken N calendar days earlier (nearest earlier within 3 days for crypto, 5 for sessions; actual span reported). |
| Annualisation | Crypto √365 (continuous trading); exchange sessions √252. Cross-asset comparisons that include any session calendar use shared session dates and √252. The factor is returned with every result. |
| Alignment | Intersection of dates (UTC date of each observation); crypto weekend days drop out when an equity is included. Crypto daily observations close 00:00 UTC; Indian sessions close 10:00 UTC (stated). Quote currencies are not converted (stated). |
| Basis | Equity series are `raw` (price return; splits can create jumps) or `adjusted_split_dividend` (approximate total return). The basis is shown with every series; adjustment is applied once. |

## Metrics

| Metric | Formula | Minimum data |
|---|---|---|
| Volatility | sample stdev of log returns × √N | 90% of the window's returns (crypto); 40 session returns in 90 days |
| Max / current drawdown | p_t ÷ running max − 1 | 2 observations |
| CAGR | (end/start)^(365.25/days) − 1 | span ≥ 1 year |
| Sharpe | (mean r − rf/N) ÷ stdev r × √N over the last 365 returns; rf from `RESEARCH_RISK_FREE_RATE` (default 0, shown) | 30 returns |
| Sortino | as Sharpe with downside deviation √mean(min(0, r − rf/N)²) | 30 returns; null when no downside |
| Correlation | Pearson on aligned returns | 30 aligned returns (90-day window), rolling: 80% of window (60% for sessions) |
| Beta | cov(a, b) ÷ var(b) on aligned returns | 30 aligned returns |
| Regime | trend: close vs 200-observation SMA; volatility: 30-day vol vs its full-history median | 230 observations |
| Portfolio | target weights summing to 1; monthly rebalance at the close of each month's last shared date, or buy-and-hold; arithmetic contribution Σ wᵢ,ₜ rᵢ,ₜ; HHI and effective holdings 1/HHI | 2 shared dates |
| Stress | shock return Σ wᵢ sᵢ; stressed vol √(wᵀΣ′w)·√N with Σ′ᵢⱼ = clip(ρᵢⱼ + Δρ)·σᵢσⱼ·k² | 30 aligned returns |
| Walk-forward | grid search on each training window (best total return), evaluation on the next unseen test window, warm-up from the end of training; chained out-of-sample curve | train ≥ slowest SMA + 30; test ≥ 30 |
| Event study | market model α + β·benchmark over 120 days ending before the window; abnormal = actual − expected; CAR over ±window; t = CAR ÷ (σ_resid·√n) | 120 + 2×window days around day 0 |
| Discovery rules | vol ratio (last 30 / prior 90) ≥ 1.75 or ≤ 0.5; volume ratio (last 7 / prior 90) ≥ 2.5; |30-day return − BTC| ≥ 25 pp; |30-day corr − prior 90-day corr| ≥ 0.4; any quarantine in 7 days | as stated |

Insufficient data returns `{ ok: false, reason }`; the UI shows "—" with the reason. Nothing is ever shown as zero for lack of data.

## Limits stated to users

Descriptive statistics of the past only; correlation is not causation; backtests carry look-ahead (prevented by next-close execution), survivorship (single surviving instrument) and data-snooping risk (grid chosen by a person); costs and slippage are user assumptions; no forecasts or recommendations.
