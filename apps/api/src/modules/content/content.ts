// Product content: help centre (SUP-02), beginner lessons (LRN-01..04), methodology pages (MTH),
// draft legal pages (CPL-05, SUP-04; pending counsel). Content passes the content rules (tested).

export interface Lesson {
  slug: string;
  order: number;
  title: string;
  minutes: number;
  body: string[];
  product_links: { label: string; href: string }[];
  quiz: { q: string; options: string[]; answer: number; why: string }[];
  /** Latest price date used in examples; must be at least 30 days before publication (LRN-04). */
  price_data_cutoff: string | null;
  published_on: string;
  editorial_checklist: { no_recommendations: boolean; no_future_price_claims: boolean; price_data_30_days_old: boolean; reviewer: string; signed_on: string | null };
}

const CHECK = (cutoff: string | null) => ({ no_recommendations: true, no_future_price_claims: true, price_data_30_days_old: true, reviewer: 'Pending editorial reviewer', signed_on: null as string | null, cutoff });

export const LESSONS: Lesson[] = [
  { slug: 'how-markets-work', order: 1, title: 'How the stock market works', minutes: 6, price_data_cutoff: null, published_on: '2026-10-18', editorial_checklist: CHECK(null),
    body: ['A listed share is a part-ownership of a company that trades on an exchange such as NSE or BSE. Prices move as buyers and sellers agree on trades during the session (09:15–15:30 IST).', 'An index such as a broad-market index tracks a basket of shares. A price-return index follows prices only; a total-return index also assumes dividends are reinvested.', 'Breadth describes how many shares rose or fell: an index can rise while most shares fall, if a few large companies move a lot.', 'ATLAS uses end-of-day data: values are final after the close and nothing is shown as live.'],
    product_links: [{ label: 'Read today’s briefing', href: '/app' }, { label: 'Market overview', href: '/app/market' }],
    quiz: [
      { q: 'What does a total-return index include that a price-return index does not?', options: ['Dividends reinvested', 'Trading volume', 'Foreign holdings'], answer: 0, why: 'Total-return series assume dividends are reinvested on the ex-date.' },
      { q: 'If the index rose but 300 of 500 shares fell, the move was…', options: ['Broad', 'Narrow', 'Impossible'], answer: 1, why: 'A rise led by a minority of (large) shares is narrow.' },
      { q: 'ATLAS prices are…', options: ['Live', 'End of day', 'Delayed by one minute'], answer: 1, why: 'Release 1.0 uses end-of-day data only.' },
    ] },
  { slug: 'reading-financial-statements', order: 2, title: 'Reading financial statements', minutes: 8, price_data_cutoff: null, published_on: '2026-10-18', editorial_checklist: CHECK(null),
    body: ['The profit and loss statement shows revenue, expenses and profit over a period (a quarter or a financial year, April to March).', 'The balance sheet shows what a company owns (assets) and owes (liabilities) at a date; equity is the difference.', 'The cash flow statement shows cash actually received and paid: operating, investing and financing.', 'Consolidated statements include subsidiaries; standalone statements cover the listed entity alone. ATLAS labels which one you are seeing.'],
    product_links: [{ label: 'Open a company’s statements', href: '/app/companies' }],
    quiz: [
      { q: 'Which statement shows a company’s position at a single date?', options: ['Profit and loss', 'Balance sheet', 'Cash flow'], answer: 1, why: 'The balance sheet is a snapshot at the period end.' },
      { q: 'FY27 in Indian convention covers…', options: ['Jan–Dec 2027', 'Apr 2026–Mar 2027', 'Apr 2027–Mar 2028'], answer: 1, why: 'FY27 runs from April 2026 to March 2027.' },
      { q: 'Consolidated statements include…', options: ['Only the parent', 'The parent and its subsidiaries', 'Only subsidiaries'], answer: 1, why: 'Consolidated means the group as a whole.' },
    ] },
  { slug: 'revenue-profit-cash', order: 3, title: 'Revenue, profit and cash flow', minutes: 7, price_data_cutoff: null, published_on: '2026-10-18', editorial_checklist: CHECK(null),
    body: ['Revenue is what a company earns from its operations. Operating profit is revenue minus operating costs, before depreciation, finance costs, other income and tax.', 'Operating margin is operating profit divided by revenue; it shows how much of each rupee of sales is left after operating costs.', 'Profit is not cash. Cash conversion compares operating cash flow with operating profit; persistently low conversion is a pattern worth reviewing.', 'Free cash flow is operating cash flow minus capital expenditure.'],
    product_links: [{ label: 'See ratios with definitions', href: '/methodology/metrics' }],
    quiz: [
      { q: 'Operating margin is…', options: ['Net profit ÷ assets', 'Operating profit ÷ revenue', 'Revenue ÷ equity'], answer: 1, why: 'See operating_margin v3.' },
      { q: 'Free cash flow in ATLAS is…', options: ['Operating cash flow − capex', 'Net profit + depreciation', 'Revenue − costs'], answer: 0, why: 'PRD CMP-05 definition.' },
      { q: 'Cash conversion below 50% for three years is…', options: ['Proof of a problem', 'A pattern that requires review', 'Irrelevant'], answer: 1, why: 'Quality flags describe patterns; they do not imply conclusions.' },
    ] },
  { slug: 'valuation-ratios', order: 4, title: 'Valuation ratios', minutes: 7, price_data_cutoff: null, published_on: '2026-10-18', editorial_checklist: CHECK(null),
    body: ['Price to earnings (P/E) compares market capitalisation with trailing-twelve-month profit. If profit is negative, P/E is not meaningful (n/m).', 'Price to book compares market value with shareholders’ equity; EV/EBITDA adds debt and subtracts cash to compare with operating profit.', 'A ratio is context, not a verdict: compare it with the company’s own history and with peers on the same date.', 'ATLAS never shows price targets or “fair values”.'],
    product_links: [{ label: 'Valuation context on a company page', href: '/app/companies' }],
    quiz: [
      { q: 'A company with a loss has a P/E of…', options: ['Zero', 'n/m', 'A negative number to compare'], answer: 1, why: 'Negative earnings make P/E not meaningful.' },
      { q: 'EV/EBITDA uses enterprise value, which adds…', options: ['Debt minus cash', 'Dividends', 'Revenue'], answer: 0, why: 'Enterprise value = market cap + borrowings − cash.' },
      { q: 'Does ATLAS publish a fair value for shares?', options: ['Yes', 'No'], answer: 1, why: 'No targets or fair values anywhere (CMP-08).' },
    ] },
  { slug: 'basic-charts', order: 5, title: 'Basic charts and moving averages', minutes: 6, price_data_cutoff: '2026-09-15', published_on: '2026-10-18', editorial_checklist: CHECK('2026-09-15'),
    body: ['A price chart shows closing prices over time. ATLAS adjusts past prices for splits, bonuses and rights so returns stay continuous; dividends are not adjusted in the price series.', 'A 50-day moving average is the average of the last 50 closes. It smooths noise and lags turning points.', 'The 52-week range shows the highest and lowest adjusted close of the last 252 sessions.', 'Examples in this lesson use price data that is at least 30 days old and say nothing about future prices.'],
    product_links: [{ label: 'Technical context on a company page', href: '/app/companies' }],
    quiz: [
      { q: 'Why are past prices adjusted after a 1:1 bonus?', options: ['To keep returns continuous', 'To raise the price', 'To hide the bonus'], answer: 0, why: 'Adjustment removes the mechanical price drop.' },
      { q: 'A moving average…', options: ['Predicts the next price', 'Smooths and lags', 'Is set by the exchange'], answer: 1, why: 'It describes the past; it does not predict.' },
      { q: 'The 52-week range covers about…', options: ['52 sessions', '252 sessions', '5 years'], answer: 1, why: 'About 252 trading sessions make a year.' },
    ] },
  { slug: 'peer-analysis', order: 6, title: 'Comparing a company with its peers', minutes: 6, price_data_cutoff: null, published_on: '2026-10-18', editorial_checklist: CHECK(null),
    body: ['Peers are companies in a similar industry and of similar size. ATLAS picks a default set and lets paid plans edit it.', 'Compare like with like: align periods (trailing twelve months, or the same financial year) and flag different year ends.', 'Use medians rather than averages; one outlier can distort an average.', 'Banks and NBFCs use sector-specific measures; operating margin and ROCE are not meaningful for them.'],
    product_links: [{ label: 'Peer comparison', href: '/app/companies' }],
    quiz: [
      { q: 'Why align periods?', options: ['Different year ends distort comparisons', 'It is required by law', 'To include forecasts'], answer: 0, why: 'Mismatched periods compare different times.' },
      { q: 'Why use a median?', options: ['It ignores outliers better', 'It is always higher', 'It is the only option'], answer: 0, why: 'Medians are robust to outliers.' },
      { q: 'For a bank, ROCE is…', options: ['The key measure', 'Not meaningful for the sector', 'Always zero'], answer: 1, why: 'Financial-sector template (CMP-06).' },
    ] },
  { slug: 'risk-and-volatility', order: 7, title: 'Risk, volatility and leverage', minutes: 6, price_data_cutoff: '2026-09-15', published_on: '2026-10-18', editorial_checklist: CHECK('2026-09-15'),
    body: ['Volatility measures how much returns vary. ATLAS shows 20-day realised volatility, annualised.', 'Drawdown is the fall from a previous peak; the maximum drawdown is the worst such fall in a period.', 'Leverage (debt to equity) increases the effect of business changes on shareholders.', 'Past volatility can change; it is a description, not a forecast.'],
    product_links: [{ label: 'Volatility in the market overview', href: '/app/market' }],
    quiz: [
      { q: 'Maximum drawdown is…', options: ['The worst fall from a peak', 'The average return', 'The lowest price ever'], answer: 0, why: 'Peak-to-trough fall.' },
      { q: 'Higher leverage tends to…', options: ['Reduce the effect of changes', 'Amplify the effect on shareholders', 'Have no effect'], answer: 1, why: 'Debt magnifies outcomes for equity.' },
      { q: 'Realised volatility is…', options: ['Historical', 'A forecast'], answer: 0, why: 'It is measured on past returns.' },
    ] },
  { slug: 'reading-a-backtest', order: 8, title: 'Reading a backtest honestly', minutes: 8, price_data_cutoff: null, published_on: '2026-10-18', editorial_checklist: CHECK(null),
    body: ['A backtest applies fixed rules to past data. It shows what would have happened, not what will happen.', 'Costs matter: Indian delivery trades pay STT, exchange charges, stamp duty, GST and slippage. ATLAS includes them by default and watermarks runs without them.', 'Beware few trades, results driven by a handful of trades, short periods and testing many variants — these are why ATLAS shows robustness warnings.', 'Survivorship bias arises when a test uses only companies that still exist today. ATLAS uses point-in-time universes that include later-delisted names.'],
    product_links: [{ label: 'Quant Research Lab', href: '/app/lab' }, { label: 'Backtest methodology', href: '/methodology/backtests' }],
    quiz: [
      { q: 'A strategy tested with 12 trades…', options: ['Is reliable', 'May be noise', 'Proves the rule works'], answer: 1, why: 'Fewer than 30 trades triggers a warning.' },
      { q: 'Survivorship bias comes from…', options: ['Including delisted companies', 'Testing only today’s survivors', 'Using costs'], answer: 1, why: 'Point-in-time universes avoid it.' },
      { q: 'Historical results…', options: ['Predict future returns', 'Do not indicate future performance'], answer: 1, why: 'Standard disclosure.' },
    ] },
];

export interface HelpArticle {
  slug: string;
  category: 'data' | 'billing' | 'ai' | 'methodology' | 'account' | 'research';
  title: string;
  body: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: 'where-data-comes-from', category: 'data', title: 'Where ATLAS data comes from', body: 'ATLAS uses licensed end-of-day prices, corporate actions, announcements, index data and standardised fundamentals. The sources page lists each dataset, its schedule, delay and status. In development environments, a synthetic dataset of fictional companies is used and labelled on every page.' },
  { slug: 'end-of-day-not-live', category: 'data', title: 'Why prices are end of day, not live', body: 'Release 1.0 uses end-of-day data because real-time display carries per-user exchange fees above the subscription price. Every value shows its as-of date; nothing is labelled live.' },
  { slug: 'stale-labels', category: 'data', title: 'What a “Stale” label means', body: 'If a dataset misses its freshness target, values show “Stale — last updated <time>”. Data that fails validation is never published; the last validated value stays visible with the label.' },
  { slug: 'missing-values', category: 'data', title: 'Not reported, Not available and n/m', body: 'Not reported: the company did not disclose the item. Not available: the source does not provide it. n/m: not meaningful, for example a P/E for a loss-making company or ROCE for a bank.' },
  { slug: 'restatements', category: 'data', title: 'How restated figures are shown', body: 'When a company restates a period, ATLAS shows the restated value, marks it, and keeps the originally reported value available. Backtests use the version that was known on each date.' },
  { slug: 'source-conflicts', category: 'data', title: 'Source conflict badges', body: 'If the data vendor and the XBRL filing differ by more than 0.5% or ₹0.5 crore, ATLAS shows a conflict badge with both values, both sources and the tolerance rule, and the issue enters the data-quality queue.' },
  { slug: 'corporate-actions', category: 'data', title: 'Splits, bonuses and adjusted prices', body: 'Raw prices are stored as traded. Charts and indicators use prices adjusted for splits, bonuses and rights so returns stay continuous. Dividends are reflected only in total-return series.' },
  { slug: 'report-an-error', category: 'data', title: 'Reporting a data or AI error', body: 'Use “Report an issue” on any value or answer. The report captures the value, its provenance and the page. Data operations triage reports within 2 business days and publish confirmed corrections in the correction log.' },
  { slug: 'coverage', category: 'data', title: 'Which companies are covered', body: 'About 500 companies have full profiles. Others are searchable with a “not yet covered” state and a request button; requests are reviewed weekly.' },
  { slug: 'plans-and-limits', category: 'billing', title: 'Plans, limits and what happens at a limit', body: 'Free, Plus (₹499 + GST a month) and Pro Research (₹1,499 + GST a month). Reaching a limit shows what the next plan adds; it never blocks access to saved work.' },
  { slug: 'gst-and-invoices', category: 'billing', title: 'GST and tax invoices', body: 'Prices are shown before GST, which is added at 18%. A tax invoice is available under Billing for every successful charge; you can add a GSTIN for business purchases.' },
  { slug: 'payment-methods', category: 'billing', title: 'Paying with UPI Autopay or a card mandate', body: 'Checkout happens on the payment gateway’s page. ATLAS never sees your card or UPI details; the gateway handles mandates and pre-debit notifications.' },
  { slug: 'change-plan', category: 'billing', title: 'Upgrading and downgrading', body: 'Upgrades apply immediately with a prorated charge. Downgrades take effect at the end of the paid period; content above the lower plan’s limits becomes read-only, never deleted.' },
  { slug: 'cancel', category: 'billing', title: 'Cancelling your subscription', body: 'Cancel from Billing in two screens. A reason survey is optional. Auto-renewal and the mandate stop immediately; access continues to the end of the paid period.' },
  { slug: 'failed-payments', category: 'billing', title: 'If a renewal payment fails', body: 'You get an email and an in-app notice. The gateway retries on its schedule and you keep full access for 7 days; after that the plan moves to Free with all data kept.' },
  { slug: 'refunds', category: 'billing', title: 'Refund policy', body: 'Proposed policy: a full refund on request within 7 days of the first paid charge. Contact support; refunds include a credit note. (Pending counsel review.)' },
  { slug: 'how-ai-answers-work', category: 'ai', title: 'How AI answers work', body: 'The assistant checks the question against its rules, fetches data only through ATLAS tools, lets the calculation service do the arithmetic, writes a six-part answer and checks every number against tool outputs before showing it. If a number cannot be matched, you see a table instead.' },
  { slug: 'ai-will-not', category: 'ai', title: 'What the assistant will not do', body: 'It does not give buy, sell or hold views, price targets, allocations, predictions or tips, and it does not follow instructions contained in documents or notes.' },
  { slug: 'six-parts', category: 'ai', title: 'The six parts of an answer', body: 'Direct answer, relevant figures, method, sources and periods, uncertainties and limitations, and links to inspect the data. A part may say “not applicable” with a reason.' },
  { slug: 'ai-limits', category: 'ai', title: 'AI question allowances', body: 'Free includes 10 questions a month, Plus 60 and Pro Research 200 (fair use). Onboarding questions and policy replies do not count. There is a limit of 10 questions a minute.' },
  { slug: 'ai-history', category: 'ai', title: 'Conversation history and deletion', body: 'Threads are saved for 12 months by default. Deleting a thread removes it from your history now and from analytics samples within 30 days.' },
  { slug: 'metric-definitions', category: 'methodology', title: 'Where to find metric definitions', body: 'Every metric links to a definition page with its formula, inputs, units, edge cases, sources and version history.' },
  { slug: 'backtest-costs', category: 'methodology', title: 'Costs in backtests', body: 'Backtests include brokerage (user-set), STT, exchange transaction charges, SEBI fee, stamp duty, GST and slippage from a versioned cost table shown on every report.' },
  { slug: 'quality-flags', category: 'methodology', title: 'Financial quality checks', body: 'Rule-based checks such as weak cash conversion or rising receivable days show the rule, threshold, observed values and periods and say “requires review”. They imply no conclusion.' },
  { slug: 'regime-labels', category: 'methodology', title: 'Market regime labels', body: 'Trend, volatility and breadth labels follow published rules; open a label to see its rule, inputs and current values. Rule changes create a new version and a correction-log entry.' },
  { slug: 'account-security', category: 'account', title: 'Securing your account', body: 'Use a long unique password and turn on two-step verification with an authenticator app. You can see active sessions and sign out everywhere from Account.' },
  { slug: 'privacy-and-consent', category: 'account', title: 'Privacy choices', body: 'Marketing emails and non-essential analytics run only with your consent. You can change each toggle at any time; withdrawal takes effect within 24 hours.' },
  { slug: 'export-and-delete', category: 'account', title: 'Exporting your data or deleting your account', body: 'Export notes, watchlists, saved screens and backtest configurations as JSON and CSV. Deletion requires your password; access ends immediately and personal data is erased within 30 days except records the law requires us to keep.' },
  { slug: 'watchlists-alerts', category: 'research', title: 'Watchlists and alerts', body: 'Add companies from search, company pages or the screener. Material-change alerts email you when results are filed, selected announcements arrive, promoter holdings change by 1 point or more, pledges change or an auditor changes — at most 20 emails a day, with a digest option.' },
  { slug: 'notes-workspaces', category: 'research', title: 'Notes and saved workspaces', body: 'Notes are private by default and autosave. Table snapshots keep their original as-of date and source. A reopened workspace shows data as saved and offers “refresh to latest” with a list of changed figures.' },
];

export const METHODOLOGY_PAGES: Record<string, { title: string; sections: { heading: string; body: string }[] }> = {
  backtests: {
    title: 'Backtest methodology',
    sections: [
      { heading: 'Engine', body: 'Deterministic, vectorised engine. Signals are computed on the adjusted close; orders fill at the next session’s open with slippage in basis points; long only; equal weights; capital ₹10,00,000 by default. Positions still open at the end are closed at the final close for the report; nothing represents a current position or signal.' },
      { heading: 'Costs', body: 'A versioned Indian equity delivery cost table: brokerage (user-set, default zero), STT 0.1% on buys and sells, NSE transaction charges, SEBI turnover fee, stamp duty on buys, GST on brokerage and exchange charges, DP charges on sells. The default values must be verified against current schedules before release and quarterly. A zero-cost run requires an explicit toggle and is watermarked “Costs excluded”.' },
      { heading: 'Liquidity', body: 'Trades are skipped (or capped, if chosen) when the position exceeds 5% of 20-day average traded value or the security’s average traded value is below ₹1 crore. Skipped trades are listed with the reason.' },
      { heading: 'Bias controls', body: 'Look-ahead: signals use only data available at the close; fundamentals are used from their filing time. Survivorship: universes are point-in-time and include securities later delisted; delisted holdings exit at the last traded price and are flagged. Corporate actions: adjusted series keep returns continuous through splits, bonuses and rights.' },
      { heading: 'Reproducibility', body: 'Every run stores its data snapshot, engine version, cost-table version, parameters, universe, benchmark and timestamps. Re-running on the same snapshot gives the same results hash.' },
      { heading: 'Robustness', body: 'Warnings appear at the top of every report and export: fewer than 30 trades, results driven by a few trades, short periods, single-security selection risk, sensitivity to doubled costs, many variants in one session and benchmark mismatch.' },
      { heading: 'Limitations', body: 'Historical and simulated results do not indicate future performance. Fills at the open may differ from real executions; taxes on gains are not modelled; dividends are credited on the ex-date.' },
    ],
  },
  ai: {
    title: 'How AI answers work',
    sections: [
      { heading: 'Pipeline', body: 'Intent and policy check → company and period resolution → data tools only → deterministic arithmetic in the calculation service → structured six-part answer → claim checker → content rules. Unmatched numbers trigger one regeneration, then a data table without narrative.' },
      { heading: 'What the assistant will not do', body: 'It will not recommend buying, selling or holding, give price targets, allocations or predictions, or follow instructions found inside filings, announcements or notes — that text is treated as data.' },
      { heading: 'Data rights', body: 'Fields whose licence does not permit AI processing are never sent to a model provider; the answer says when something was withheld.' },
      { heading: 'Versions', body: 'Every answer records the pipeline, model, prompt and tool versions. A change ships only after the evaluation suite passes; the latest results are shown below.' },
    ],
  },
};

export const LEGAL_PAGES: Record<string, { title: string; status: string; body: string[] }> = {
  privacy: {
    title: 'Privacy notice (draft for counsel review)',
    status: 'DRAFT — not yet reviewed by counsel. Aligned in intent with the Digital Personal Data Protection Act, 2023 and its Rules.',
    body: [
      'What we collect: your email, password hash, optional display name, research preferences, consent records, your saved research (notes, watchlists, screens, backtests, conversations), billing records and technical logs. We do not collect brokerage credentials, portfolios or bank data.',
      'Why: to provide the service, secure accounts, bill subscriptions, meet legal obligations and, only with your consent, send marketing and run non-essential analytics.',
      'Where: personal data is stored in India (AWS Mumbai region in production). Model providers process AI questions under data-processing terms that forbid training on your data.',
      'How long: account content until you delete it or your account; AI conversations 12 months by default; tax invoices as tax law requires; security logs at least 180 days in India.',
      'Your rights: access, correction, export and erasure from Account; withdraw consent at any time as easily as you gave it.',
      'Grievances: contact the grievance officer (details to be published before launch). We acknowledge within the period counsel specifies.',
    ],
  },
  terms: {
    title: 'Terms of use (draft for counsel review)',
    status: 'DRAFT — not yet reviewed by counsel.',
    body: ['ATLAS provides research tools, data and explanations for information and education. It is not investment advice and does not recommend securities.', 'You must be 18 or older. Keep your account secure; do not share it or scrape the service.', 'Subscriptions renew monthly until cancelled; cancellation stops renewal and access continues to the end of the paid period.', 'Data may be delayed, incomplete or corrected. Check the linked sources before relying on a figure.'],
  },
  grievance: {
    title: 'Grievance redressal',
    status: 'DRAFT — officer name, address and acknowledgement period to be confirmed by counsel (SUP-04).',
    body: ['Raise a grievance from Support → Grievance or by email to the grievance officer (to be published).', 'We record every grievance in a register, acknowledge it within the period counsel specifies and aim to resolve it within the escalation timeline published here.'],
  },
};

export const RELEASE_NOTES = [{ version: '0.1.0 (pre-release)', date: '2026-10-18', notes: ['First end-to-end build: market briefing, company research, screener, Quant Lab, assistant, watchlists, alerts, billing sandbox, admin console.'] }];
