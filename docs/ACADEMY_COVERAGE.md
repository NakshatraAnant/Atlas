# Academy curriculum coverage

Required topic lists (agreed Academy expansion, 20 Oct 2026) mapped to the lessons that exist in `apps/api/src/modules/academy`. **Covered** means a lesson teaches the topic with an exercise and a graded quiz. **Partial** means the topic is touched inside another lesson but not taught in full. **Missing** means no lesson yet. All content is an AI-assisted draft in expert review; nothing here is expert-approved.

Totals, after batch 1 (20 Oct 2026):

| Course | Required topics | Covered | Partial | Missing | Lessons |
|---|---|---|---|---|---|
| MARKET DECODER | 17 | 11 | 3 | 3 | 14 |
| EQUITY DETECTIVE | 21 | 8 | 5 | 8 | 8 |
| SIGNAL ENGINEER | 27 | 9 | 4 | 14 | 6 |
| MARKET ARCHITECT | 22 | 7 | 2 | 13 | 6 |
| **All** | **87** | **35** | **14** | **38** | **34** |

Every course has a capstone with a rubric (`content/capstones.ts`). No course has a separate final assessment yet; the readiness check and lesson quizzes are the only graded instruments.

## MARKET DECODER (beginner)

| # | Required topic | Status | Where |
|---|---|---|---|
| 1 | How the Indian stock market works | Covered | md-l1, md-l2, md-l10, md-l11 |
| 2 | NSE, BSE, securities, symbols and ISINs | Covered (batch 1) | md-l10 |
| 3 | What shares represent | Covered | md-l1 |
| 4 | Exchanges, brokers, depositories and settlement | Covered (batch 1) | md-l11 |
| 5 | Primary versus secondary markets | Covered (batch 1) | md-l12 |
| 6 | Market indices and the Nifty 50 | Covered | md-l8 |
| 7 | Price, volume, market capitalisation and liquidity | Partial | md-l2 (order book, liquidity), md-l13 (volume) |
| 8 | Candlesticks, OHLC data and daily returns | Covered (batch 1) | md-l13, md-l3 |
| 9 | Percentage changes and compounding | Covered | md-l3, md-l6 |
| 10 | Basic financial statements | Missing (taught in EQUITY DETECTIVE ed-l1, ed-l2) | — |
| 11 | Revenue, expenses, profit, cash flow and debt | Missing (in EQUITY DETECTIVE) | — |
| 12 | Introductory valuation concepts | Missing (in EQUITY DETECTIVE ed-l7) | — |
| 13 | Volatility, drawdowns and risk | Covered | md-l4, md-l5 |
| 14 | Common investor misconceptions | Partial | md-l4, md-l5, md-l7 |
| 15 | Data sources, stale prices and misleading charts | Covered (batch 1) | md-l14 |
| 16 | A practical company-reading project | Partial | capstone |
| 17 | Final assessment and capstone | Covered (capstone); final assessment missing | capstones.ts |

## EQUITY DETECTIVE (intermediate)

| # | Required topic | Status | Where |
|---|---|---|---|
| 1 | Business models and industry structure | Missing | — |
| 2 | Reading annual reports | Missing | — |
| 3 | Standalone versus consolidated statements | Missing | (product shows both bases) |
| 4 | Revenue quality and growth drivers | Missing | — |
| 5 | Gross profit, EBITDA, EBIT and net profit | Covered | ed-l1 |
| 6 | Operating leverage and margins | Partial | ed-l5; Build the Business game |
| 7 | Balance-sheet analysis | Covered | ed-l2 |
| 8 | Working capital and cash-conversion cycles | Covered | ed-l3 |
| 9 | Operating cash flow versus reported earnings | Covered | ed-l3, ed-l4 |
| 10 | Free cash flow and capital expenditure | Missing | — |
| 11 | ROE and ROIC | Covered | ed-l5, ed-l6 (ROCE) |
| 12 | Debt, interest coverage and resilience | Partial | ed-l6 |
| 13 | Earnings quality and warning signs | Covered | ed-l4 |
| 14 | Ratio interpretation and limitations | Partial | ed-l5–ed-l8 |
| 15 | Peer comparison and sector context | Missing | — |
| 16 | P/E, P/B, EV/EBITDA | Covered | ed-l7, ed-l8 |
| 17 | Growth, valuation and expectations | Partial | ed-l7 (earnings yield) |
| 18 | Basic scenario and sensitivity analysis | Missing (in MARKET ARCHITECT ma-l2) | — |
| 19 | Corporate actions and comparisons | Missing | — |
| 20 | Evidence-backed company research report | Partial | capstone |
| 21 | Final assessment and capstone | Covered (capstone); final assessment missing | capstones.ts |

## SIGNAL ENGINEER (advanced)

| # | Required topic | Status | Where |
|---|---|---|---|
| 1 | Data types, frequency and provenance | Missing | — |
| 2 | Adjusted versus unadjusted prices | Missing | — |
| 3 | Corporate actions and return calculations | Missing | — |
| 4 | Simple and logarithmic returns | Partial | se-l1 (simple only) |
| 5 | Compounding and geometric returns | Covered | se-l1 |
| 6 | Volatility and rolling statistics | Covered | se-l1 |
| 7 | Drawdowns and downside risk | Covered | se-l1 |
| 8 | Moving averages and trend definitions | Missing | (rule builder uses SMA) |
| 9 | Momentum and relative strength | Missing | — |
| 10 | Normalisation and standardisation | Missing | — |
| 11 | Correlation versus causation | Missing | — |
| 12 | Distributions and outliers | Missing | — |
| 13 | Sample size and statistical uncertainty | Partial | se-l2 |
| 14 | Look-ahead bias | Covered | se-l3 |
| 15 | Survivorship bias | Covered | se-l3 |
| 16 | Selection bias and data leakage | Partial | se-l3 |
| 17 | Overfitting and multiple testing | Covered | se-l4 |
| 18 | Benchmark selection | Covered | se-l6 |
| 19 | Walk-forward evaluation | Partial | se-l5 |
| 20 | Train/test separation | Missing | — |
| 21 | Transaction costs and liquidity | Covered | se-l6 |
| 22 | Signal definition and reproducibility | Missing | — |
| 23 | Risk-adjusted performance | Missing | — |
| 24 | Robustness and sensitivity testing | Missing | — |
| 25 | Explainable screeners | Missing | — |
| 26 | Documented analytical pipeline | Missing | — |
| 27 | Final quantitative research capstone | Covered (capstone) | capstones.ts |

## MARKET ARCHITECT (expert)

| # | Required topic | Status | Where |
|---|---|---|---|
| 1 | Integrating business quality and market evidence | Missing | — |
| 2 | Research question formulation | Missing | — |
| 3 | Thesis, counter-thesis, disconfirming evidence | Partial | ma-l6 |
| 4 | Business drivers and competitive positioning | Missing | — |
| 5 | Forecasting assumptions | Missing | — |
| 6 | Revenue, margin and cash-flow modelling | Missing | — |
| 7 | Valuation triangulation | Missing | — |
| 8 | DCF and sensitivity | Covered | ma-l1, ma-l2 (3D surface lab) |
| 9 | Scenario and probability-weighted reasoning | Covered | ma-l2 |
| 10 | Margin of safety and valuation uncertainty | Missing | — |
| 11 | Macro and sector exposure | Missing | — |
| 12 | Concentration and correlation risk | Covered | ma-l3 |
| 13 | Portfolio construction concepts | Missing | — |
| 14 | Risk budgeting and position-sizing theory | Missing | — |
| 15 | Drawdown and downside scenarios | Covered | ma-l4 |
| 16 | Liquidity and execution limitations | Missing | — |
| 17 | Monitoring and thesis invalidation | Missing | — |
| 18 | Catalyst calendars and corporate events | Missing | — |
| 19 | Model validation and audit trails | Covered | ma-l5 |
| 20 | Investment-committee-style communication | Partial | ma-l6 |
| 21 | Integrated research dossier | Covered (capstone) | capstones.ts |
| 22 | Final capstone presentation | Covered (capstone) | capstones.ts |

## How remaining content is added

In batches of about five lessons. Each batch goes through `test/academy-content.test.ts`, which checks seven stages, valid answer keys, objectives that are both taught and assessed, and no advice language. Each lesson stays in review until a named reviewer completes the seven-point review. Real-data exercises wait for a licensed data feed (see `docs/DATA_RIGHTS_AND_PROVIDERS.md`); until then exercises use clearly labelled hypothetical or synthetic data.
