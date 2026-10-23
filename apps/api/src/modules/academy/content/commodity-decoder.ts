import type { SourceCourse, SourceLesson } from '../curriculum.js';

// COMMODITY MARKETS DECODER (commodities track). Drafted with AI assistance; stored as in_review until a
// named reviewer completes the seven-point review. Worked examples use round, hypothetical numbers;
// guided ATLAS tasks use the stored, source-attributed series on the Commodities pages (EIA spot and IMF
// monthly prices via FRED). Nothing here is a recommendation or forecast.

const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;
const COMPLETION = 'This record shows which learning objectives you practised and the assessments you completed in the ATLAS Academy. It is not a professional qualification, licence or certification, and it says nothing about future investment results.';
const RULES = { high_min: 0.8, low_max: 0.4, critical_miss_low: 2, questions: 5, max_attempts_per_week: 3 };
const EIA_PRICES = { title: 'U.S. Energy Information Administration: spot prices (definitions)', url: 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm', note: 'How EIA defines the daily spot price series ATLAS stores.' };
const IMF_PCPS = { title: 'IMF Primary Commodity Prices', url: 'https://www.imf.org/en/Research/commodity-prices', note: 'Monthly average world prices and their definitions.' };
const CME_EDU = { title: 'CME Group education: futures fundamentals', url: 'https://www.cmegroup.com/education.html', note: 'Exchange education on contract specifications, expiry and settlement.' };
const SEBI_COMMODITY = { title: 'SEBI: commodity derivatives', url: 'https://www.sebi.gov.in/', note: 'The Indian regulator of commodity derivatives exchanges such as MCX and NCDEX.' };
const EIA_WPSR = { title: 'EIA Weekly Petroleum Status Report', url: 'https://www.eia.gov/petroleum/supply/weekly/', note: 'The weekly US inventory statistics referred to in this course.' };

// ═════════════ Module 1: prices and contracts ═════════════

const CM1: SourceLesson = {
  id: 'cm-l1', title: 'What a commodity price actually is', minutes: 14, objectives: ['cm-o1'], mastery_rule: RULE('cm-o1'), references: [EIA_PRICES, IMF_PCPS],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Four kinds of number with one name', body: [
      'A “price of oil” can be a spot assessment (what a published survey says physical crude changed hands for at one location on one day), a futures settlement (the exchange’s official price for a contract delivering in a named month), a monthly average of world prices, or a price index.',
      'They differ in location, timing, quality and unit. WTI at Cushing, Oklahoma and Brent in Europe are different crudes in different places; US gasoline is quoted per gallon, crude per barrel (42 US gallons), metals per metric ton, sugar and cotton in US cents per pound.',
      'None of the global benchmarks is an Indian price. Indian prices add freight, insurance, duties, taxes, the rupee exchange rate and local supply conditions; Indian exchange-traded futures (MCX, NCDEX) are separate contracts with their own specifications.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read the label before the number', href: '/app/commodities', steps: [
      'Open Commodities and find WTI crude oil and Copper in the global benchmark table.',
      'For each, note the “What it is” column (spot assessment or average price), the frequency, the unit and the date of the last value.',
      'Explain in one sentence why the copper value is dated the first of a month while WTI has a value for most business days.',
    ], alt_text: 'The Commodities table lists each series with its price type, frequency, last value, unit, date, one-month and one-year change and a freshness label.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A monthly average price and a month-end spot price for the same commodity in the same month: which is usually smoother over time?', options: ['The monthly average', 'The month-end spot price', 'They are always identical'], answer: 0, reveal: 'Averaging over about 21 business days removes much of the day-to-day noise, so monthly averages look smoother and their volatility is not comparable with daily data.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Converting units before comparing', steps: [
      'A hypothetical diesel price is 3.00 USD per gallon and crude is 80 USD per barrel.',
      'One barrel is 42 US gallons, so diesel is 3.00 × 42 = 126 USD per barrel.',
      'Only now can the two be compared: diesel is 126 − 80 = 46 USD per barrel above crude in this example.',
      'Comparing 3.00 with 80 directly would be meaningless: the units differ.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Jet fuel is 2.60 USD per gallon. What is that in USD per barrel?', hint: 'Multiply by 42.', answer_text: '2.60 × 42 = 109.20 USD per barrel.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why can a rise in a global benchmark price not be read directly as the same rise in an Indian price?', model_answer: 'The Indian price adds freight, insurance, duties, taxes and local margins, is affected by the rupee exchange rate and local supply, and may refer to a different grade, location or contract; each of these can move differently from the benchmark.' },
    { stage: 'review', kind: 'summary', points: ['Spot assessments, futures settlements, monthly averages and indices are different numbers.', 'Always check location, unit, frequency and date.', 'Global benchmarks are not Indian prices.'] },
  ],
  quiz: [
    { id: 'cm-q1-1', objective: 'cm-o1', skill: 'commodity_prices', difficulty: 1, qtype: 'numeric', stem: 'Heating oil is 2.50 USD per gallon. What is it in USD per barrel?', correct: { value: 105, abs_tol: 0.01 }, explanation: '2.50 × 42 = 105.', misconception: 'Forgetting the 42 gallons per barrel.' },
    { id: 'cm-q1-2', objective: 'cm-o1', skill: 'commodity_prices', difficulty: 2, qtype: 'single_choice', stem: 'An IMF monthly copper price is best described as:', options: ['A futures settlement for next month', 'An average of world prices over the month', 'The last trade of the month on an Indian exchange', 'A forecast'], correct: { index: 1 }, explanation: 'IMF primary commodity prices are monthly averages.', misconception: 'Treating an average as a single transaction price.' },
    { id: 'cm-q1-3', objective: 'cm-o1', skill: 'commodity_prices', difficulty: 2, qtype: 'single_choice', stem: 'Which statement about WTI and Brent is correct?', options: ['They are the same crude quoted twice', 'They are different crudes at different locations, so their prices can differ', 'Brent is always cheaper', 'WTI is an Indian benchmark'], correct: { index: 1 }, explanation: 'Quality, location and transport make them different benchmarks.', misconception: 'Assuming all crude oil has one price.' },
  ],
};

const CM2: SourceLesson = {
  id: 'cm-l2', title: 'Futures contracts, expiry and the roll', minutes: 16, objectives: ['cm-o2'], prerequisites: ['cm-l1'], mastery_rule: RULE('cm-o2'), references: [CME_EDU, SEBI_COMMODITY],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'A contract with a date on it', body: [
      'A futures contract fixes today the price for a standard quantity and quality delivered (or cash-settled) in a named month. Each delivery month is a separate contract with its own price and expiry date.',
      'Gains and losses are settled daily through margin: a long position in a 1,000-barrel crude contract gains 1,000 USD when the settlement price rises by 1 USD, and loses the same when it falls.',
      'A single contract stops trading at expiry, so a long price history needs a rule for moving from one contract to the next (the roll). The rule changes the history you see, which is why every continuous series must state it.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Find out what ATLAS can and cannot show', href: '/app/commodities', steps: [
      'Open Commodities, then the Term structure tab.',
      'Read whether WTI futures by contract position are available in this installation, and what is needed if they are not.',
      'Open the Series tab and read the note on Indian exchange-traded futures: write down why nothing is shown there.',
    ], alt_text: 'The Term structure tab shows either the four WTI contract positions with their slope, or the reason they are unavailable; the Series tab explains that MCX and NCDEX data are licensed.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A “front-month” series switches from an expiring contract at 70.00 to the next contract at 72.00 on the same day. If the two series are simply joined, what does the joined history show that day?', options: ['A rise of about 2.9% that nobody earned', 'No change', 'A fall'], answer: 0, reveal: 'Joining two different contracts creates a jump of 2.00 ÷ 70.00 ≈ 2.86% that is a change of contract, not a price move. Back-adjusting or ratio-adjusting removes it, and the method must be stated.' },
    { stage: 'investigate', kind: 'worked_example', title: 'A back-adjusted continuous series', steps: [
      'Old contract: last day 70.00. New contract that day: 72.00. Gap = +2.00.',
      'Back-adjustment adds +2.00 to every earlier price of the old contract, so the joined series has no jump on the roll day.',
      'Returns are then continuous, but earlier price levels are no longer prices that ever traded; ratio adjustment (multiplying by 72 ÷ 70) keeps percentage returns instead.',
      'Either way, a backtest on a naive joined series would book the 2.86% jump as profit or loss.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A long position holds 2 contracts of 1,000 barrels. The settlement price falls from 81.40 to 79.90. What is the day’s mark-to-market result?', hint: 'Price change × barrels per contract × contracts.', answer_text: '(79.90 − 81.40) × 1,000 × 2 = −3,000 USD.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why must a commodity backtest state how its continuous series was built?', model_answer: 'Each contract expires, so a long series joins several contracts; a naive join creates artificial jumps on roll days that a strategy would wrongly count as gains or losses, while back- or ratio-adjustment changes the price levels. The method decides what the backtest measures.' },
    { stage: 'review', kind: 'summary', points: ['Each delivery month is a separate contract that expires.', 'Futures gains and losses are settled daily through margin.', 'A continuous series needs a roll rule; a naive join creates false jumps.'] },
  ],
  quiz: [
    { id: 'cm-q2-1', objective: 'cm-o2', skill: 'futures', difficulty: 2, qtype: 'numeric', stem: 'One contract of 1,000 barrels; the settlement rises from 75.20 to 76.70. What is the day’s gain for one long contract, in USD?', correct: { value: 1500, abs_tol: 0.5 }, explanation: '1.50 × 1,000 = 1,500 USD.', misconception: 'Using the price level instead of the change.' },
    { id: 'cm-q2-2', objective: 'cm-o2', skill: 'futures', difficulty: 3, qtype: 'numeric', stem: 'An expiring contract closes at 60.00 and the next contract trades at 61.50 on the roll day. What jump (in percent) appears if the two are joined without adjustment?', correct: { value: 2.5, abs_tol: 0.01, unit: '%' }, explanation: '1.50 ÷ 60.00 = 2.5%: a change of contract, not a return.', misconception: 'Treating the roll jump as a price move.' },
    { id: 'cm-q2-3', objective: 'cm-o2', skill: 'futures', difficulty: 2, qtype: 'single_choice', stem: 'Why does a continuous futures series need a stated roll method?', options: ['Because contracts expire and must be joined, and the joining rule changes the history', 'Because exchanges require it', 'It does not; any join is equivalent', 'To hide missing data'], correct: { index: 0 }, explanation: 'The join creates or removes jumps and changes levels.', misconception: 'Thinking a front-month series is one instrument.' },
  ],
};

// ═════════════ Module 2: curves and spreads ═════════════

const CM3: SourceLesson = {
  id: 'cm-l3', title: 'Contango, backwardation and roll yield', minutes: 15, objectives: ['cm-o3'], prerequisites: ['cm-l2'], mastery_rule: RULE('cm-o3'), references: [CME_EDU, EIA_PRICES],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'The shape of the curve', body: [
      'Lining up the prices of successive delivery months gives the futures curve. When later months are priced above the nearest one the curve is in contango; when they are below it, backwardation.',
      'Contango often reflects the cost of storing and financing a commodity until later delivery; backwardation often appears when nearby supply is tight and users pay more for prompt delivery. These are tendencies, not rules.',
      'Holding futures means repeatedly rolling from an expiring contract into a later one. In contango each roll replaces a cheaper contract with a dearer one, a drag known as negative roll yield; in backwardation the effect is reversed.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read a curve state', href: '/app/commodities', steps: [
      'Open the Term structure tab. If EIA data are configured, note the four contract positions, the slope from position 1 to 4 and the stated state.',
      'If they are not configured, read the method note and work the guided practice below instead.',
      'In either case, write down why a “position 2” series is not one single contract over time.',
    ], alt_text: 'The Term structure tab lists WTI contract positions 1 to 4 with their prices, the slope and contango or backwardation, or explains that an EIA key is needed.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Nearest contract 70.00, second contract 71.40. Is the curve in contango or backwardation at the front?', options: ['Contango', 'Backwardation', 'Flat'], answer: 0, reveal: 'The later contract is above the nearest one, so the front of the curve is in contango.' },
    { stage: 'investigate', kind: 'worked_example', title: 'A simple roll-yield proxy', steps: [
      'Nearest 70.00, second 71.40, expiries about one month apart.',
      'Monthly roll effect ≈ 70.00 ÷ 71.40 − 1 = −1.96%.',
      'Annualised proxy ≈ −1.96% × 12 = −23.5%: the drag from rolling if the curve kept this shape and spot prices did not move.',
      'Real roll returns differ because the curve changes shape, expiries are not exactly a month apart, and prices move.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Nearest 80.00, second 78.00. Compute the annualised roll-yield proxy (C1 ÷ C2 − 1) × 12.', hint: '80 ÷ 78 − 1 first.', answer_text: '80 ÷ 78 − 1 = 2.564%; × 12 ≈ 30.8% a year (backwardation).' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why can a long-only commodity futures index lag the spot price for years?', model_answer: 'If the curve stays in contango, each roll replaces an expiring contract with a more expensive later one, so the index loses the roll yield over and over, even when the spot price is unchanged.' },
    { stage: 'review', kind: 'summary', points: ['Contango: later contracts above the nearest; backwardation: below.', 'Rolling in contango creates a drag; in backwardation a gain.', 'Roll-yield proxies assume a stable curve and monthly expiries.'] },
  ],
  quiz: [
    { id: 'cm-q3-1', objective: 'cm-o3', skill: 'term_structure', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'Contract 1 is 50.00 and contract 4 is 53.00. The curve is in:', options: ['Contango', 'Backwardation', 'Neither'], correct: { index: 0 }, explanation: 'Later contracts priced above the nearest: contango.', misconception: 'Reversing the two terms.' },
    { id: 'cm-q3-2', objective: 'cm-o3', skill: 'term_structure', difficulty: 3, qtype: 'numeric', stem: 'C1 = 60.00 and C2 = 61.20, about a month apart. What is the annualised roll-yield proxy (C1 ÷ C2 − 1) × 12, in percent?', correct: { value: -23.53, abs_tol: 0.05, unit: '%' }, explanation: '60 ÷ 61.2 − 1 = −1.961%; × 12 = −23.53%.', misconception: 'Dividing C2 by C1.' },
    { id: 'cm-q3-3', objective: 'cm-o3', skill: 'term_structure', difficulty: 2, qtype: 'single_choice', stem: 'In a persistent contango, rolling long futures positions tends to:', options: ['Add a gain', 'Create a drag relative to the spot price', 'Have no effect', 'Make the spot price rise'], correct: { index: 1 }, explanation: 'Each roll replaces a cheaper contract with a dearer one.', misconception: 'Assuming futures returns equal spot returns.' },
  ],
};

const CM4: SourceLesson = {
  id: 'cm-l4', title: 'Location and processing spreads', minutes: 14, objectives: ['cm-o4'], prerequisites: ['cm-l1'], mastery_rule: RULE('cm-o4'), references: [EIA_PRICES],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Differences that carry information', body: [
      'A location spread compares the same commodity in two places, for example Brent minus WTI. It reflects transport costs, quality differences and regional supply and demand.',
      'A crack spread compares a refined product with crude oil, in the same unit: product price per gallon × 42 − crude price per barrel. It is a rough indicator of refining margins, not a refinery’s actual profit.',
      'Spreads are only meaningful on dates both legs have a price, in a common unit and currency. A spread at an unusual level is a description, not an instruction.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read the spreads', href: '/app/commodities', steps: [
      'Open the Spreads tab.',
      'For Brent − WTI and the heating-oil crack, note today’s value, the 3-year mean and the percentile.',
      'Read the note under each spread and write down one reason the heating-oil crack is not a refinery margin.',
    ], alt_text: 'The Spreads tab shows each spread’s latest value, 3-year mean, range and percentile with a 12-month line chart and a method note.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Heating oil rises from 2.50 to 2.60 USD per gallon while WTI stays at 80. What happens to the 1:1 crack?', options: ['It rises by 4.20 USD per barrel', 'It rises by 0.10', 'It does not change'], answer: 0, reveal: 'The product price rose 0.10 per gallon, which is 0.10 × 42 = 4.20 per barrel.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Computing a crack', steps: [
      'Heating oil 2.50 USD/gal; WTI 80.00 USD/bbl (same date).',
      'Heating oil per barrel: 2.50 × 42 = 105.00.',
      'Crack = 105.00 − 80.00 = 25.00 USD per barrel.',
      'If either price is missing that day, the spread for that day is missing too: no filling from another date.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Brent 84.30, WTI 80.10 on the same day. What is Brent − WTI?', hint: 'Same unit already (USD per barrel).', answer_text: '84.30 − 80.10 = 4.20 USD per barrel.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why must both legs of a spread be taken from the same date?', model_answer: 'Otherwise the spread mixes price changes over time with the difference between the two commodities, so it would measure timing rather than the relationship it is meant to describe.' },
    { stage: 'review', kind: 'summary', points: ['Location spreads compare places; crack spreads compare products with crude.', 'Convert to a common unit first (42 gallons per barrel).', 'Use same-date prices only; a missing leg means a missing spread.'] },
  ],
  quiz: [
    { id: 'cm-q4-1', objective: 'cm-o4', skill: 'spreads', difficulty: 2, qtype: 'numeric', critical: true, stem: 'Diesel 3.20 USD per gallon, WTI 90.00 USD per barrel. What is the 1:1 crack, in USD per barrel?', correct: { value: 44.4, abs_tol: 0.01 }, explanation: '3.20 × 42 = 134.40; 134.40 − 90.00 = 44.40.', misconception: 'Subtracting 90 from 3.20 without converting units.' },
    { id: 'cm-q4-2', objective: 'cm-o4', skill: 'spreads', difficulty: 1, qtype: 'single_choice', stem: 'Brent − WTI is an example of:', options: ['A location spread', 'A calendar spread', 'A crack spread', 'A currency spread'], correct: { index: 0 }, explanation: 'Same commodity, different places and grades.', misconception: 'Confusing spread types.' },
    { id: 'cm-q4-3', objective: 'cm-o4', skill: 'spreads', difficulty: 2, qtype: 'single_choice', stem: 'On a day when the WTI price is missing, the heating-oil crack for that day should be:', options: ['Computed with the previous day’s WTI', 'Treated as missing', 'Set to zero', 'Computed with the average WTI price'], correct: { index: 1 }, explanation: 'A spread needs both legs on the same date.', misconception: 'Forward-filling a missing leg.' },
  ],
};

// ═════════════ Module 3: fundamentals and risk ═════════════

const CM5: SourceLesson = {
  id: 'cm-l5', title: 'Inventories and seasonality', minutes: 15, objectives: ['cm-o5'], prerequisites: ['cm-l3'], mastery_rule: RULE('cm-o5'), references: [EIA_WPSR],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Comparing like with like', body: [
      'Many commodities have seasonal patterns: natural gas demand peaks in winter heating seasons, gasoline in summer driving seasons, crops around harvests. Inventories rise and fall with these cycles.',
      'So an inventory level means little on its own. Analysts compare it with the same week in earlier years, for example as a z-score: (latest − average of earlier years) ÷ their standard deviation.',
      'A seasonal average of past price changes describes history. With only a few years per month it is noisy, and a pattern can disappear when supply, demand or market structure changes.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read a seasonality table', href: '/app/commodities/fred/DHHNGSP', steps: [
      'Open Henry Hub natural gas. Find the Seasonality table.',
      'Note the months with the largest average rise and fall, and the share of years with a rise.',
      'Read the “Years” row and the warning text, and write down how many years the averages rest on.',
    ], alt_text: 'The series page shows a 12-month table of mean change, share of years with a rise and the number of years, with a note on the basis and its limits.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A month shows an average rise of 6% over the past 3 years. How much confidence does that deserve?', options: ['Little: three observations are noisy', 'High: it happened every year', 'It guarantees a rise next year'], answer: 0, reveal: 'Three observations can easily share a coincidence. The page flags fewer than 5 years, and even long averages describe the past, not the future.' },
    { stage: 'investigate', kind: 'worked_example', title: 'A seasonal z-score', steps: [
      'Inventory in the same week of three earlier years: 400, 420 and 440 (thousand barrels, hypothetical).',
      'Average = 420. Sample standard deviation = 20.',
      'This week: 460. z = (460 − 420) ÷ 20 = 2.0: unusually high for the season.',
      'A high inventory is information about supply and demand, not a statement about the next price move.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Earlier years: 400, 420, 440; this week: 450. What is the z-score?', hint: 'Mean 420, standard deviation 20.', answer_text: '(450 − 420) ÷ 20 = 1.5.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why compare an inventory level with the same week of earlier years rather than with last week?', model_answer: 'Inventories follow seasonal cycles; last week is at a different point in the cycle, so a change from last week can be normal for the season. Comparing with the same week in earlier years separates unusual levels from the usual pattern.' },
    { stage: 'review', kind: 'summary', points: ['Seasonal patterns make raw levels hard to read.', 'Compare with the same week of earlier years (z-score).', 'Seasonal averages with few years are noisy and describe the past only.'] },
  ],
  quiz: [
    { id: 'cm-q5-1', objective: 'cm-o5', skill: 'fundamentals', difficulty: 2, qtype: 'numeric', stem: 'Same week in earlier years: 300, 330, 360; this week 285. What is the seasonal z-score? (Sample standard deviation of 300, 330, 360 is 30.)', correct: { value: -1.5, abs_tol: 0.01 }, explanation: 'Mean 330; (285 − 330) ÷ 30 = −1.5.', misconception: 'Comparing with the latest earlier year only.' },
    { id: 'cm-q5-2', objective: 'cm-o5', skill: 'fundamentals', difficulty: 2, qtype: 'single_choice', stem: 'A month’s average price change rests on 4 years of data. The fairest reading is:', options: ['A noisy description of the past', 'A reliable forecast', 'Proof of a seasonal law', 'Meaningless in all cases'], correct: { index: 0 }, explanation: 'Few observations; history only.', misconception: 'Treating seasonal averages as forecasts.' },
    { id: 'cm-q5-3', objective: 'cm-o5', skill: 'fundamentals', difficulty: 1, qtype: 'single_choice', stem: 'Why is natural gas demand often seasonal?', options: ['Heating demand varies with the weather and season', 'Exchanges close in winter', 'Prices are set once a year', 'It is not seasonal'], correct: { index: 0 }, explanation: 'Heating (and cooling) demand follows the seasons.', misconception: 'Ignoring physical demand cycles.' },
  ],
};

const CM6: SourceLesson = {
  id: 'cm-l6', title: 'Commodity risk, gaps and the negative-price day', minutes: 16, objectives: ['cm-o6'], prerequisites: ['cm-l1'], mastery_rule: RULE('cm-o6'), references: [EIA_PRICES, IMF_PCPS],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Measure at the right frequency', body: [
      'Volatility is annualised with the number of periods in a year for that series: about 252 for business-day prices, 52 for weekly and 12 for monthly data. Monthly averages are smoother, so their volatility is lower and cannot be compared with daily volatility.',
      'Days without a published value are gaps. A return across a long gap mixes several periods into one and is left out, never filled.',
      'On 20 April 2020 the EIA WTI spot price was −36.98 USD per barrel. A percentage return across a zero or negative price has no meaning, and drawdown from a peak is undefined once prices cross zero; these days must be handled explicitly, not averaged away.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Check how ATLAS states its assumptions', href: '/app/commodities/fred/DCOILWTICO', steps: [
      'Open WTI crude oil. Read the volatility card: note the annualisation and how many returns were used.',
      'Look for any note about returns left out because of gaps or non-positive prices.',
      'Compare with Copper (monthly): note its annualisation factor and explain why its volatility is not comparable with WTI’s.',
    ], alt_text: 'The WTI page shows one-year volatility with “daily × √252” and the number of returns, plus notes on returns left out across gaps or non-positive prices.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A price moves from 18.27 to −37.63. What is the percentage return?', options: ['About −306%', 'Undefined: a percentage change across zero has no meaning', '−100%'], answer: 1, reveal: 'Dividing by a positive price and landing below zero gives a number, but it does not describe a return an investor could earn or compound. Returns across non-positive prices are left out and counted.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Annualising correctly', steps: [
      'Daily returns with a standard deviation of 2.0%: annual volatility ≈ 2.0% × √252 = 2.0% × 15.87 = 31.7%.',
      'Monthly average prices with month-on-month standard deviation 4.0%: ≈ 4.0% × √12 = 13.9%.',
      'The second number is lower partly because averaging smooths prices, not only because the commodity is calmer.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Weekly returns have a standard deviation of 3.0%. What is the annualised volatility?', hint: 'Multiply by √52 ≈ 7.21.', answer_text: '3.0% × 7.21 ≈ 21.6% a year.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why should a research tool refuse to compute a drawdown over a window that contains a negative price?', model_answer: 'Drawdown measures the fall from a positive peak as a fraction of that peak; once prices cross zero the ratio stops describing a loss of value that can be compared or compounded, so a number would look precise but mislead.' },
    { stage: 'review', kind: 'summary', points: ['Annualise with the series’ own frequency (252, 52, 12).', 'Leave gaps as gaps; do not fill them.', 'Returns and drawdowns across zero or negative prices are undefined.'] },
  ],
  quiz: [
    { id: 'cm-q6-1', objective: 'cm-o6', skill: 'commodity_risk', difficulty: 2, qtype: 'numeric', critical: true, stem: 'Daily returns have a standard deviation of 1.5%. What is the annualised volatility using √252, in percent?', correct: { value: 23.81, abs_tol: 0.05, unit: '%' }, explanation: '1.5 × 15.875 = 23.81%.', misconception: 'Using √365 for business-day data or multiplying by 252.' },
    { id: 'cm-q6-2', objective: 'cm-o6', skill: 'commodity_risk', difficulty: 3, qtype: 'single_choice', stem: 'Daily WTI spot volatility is 35% and IMF monthly copper volatility is 15%. Which conclusion is justified?', options: ['Copper is less than half as risky as oil', 'None directly: the frequencies and price types differ', 'Oil is mispriced', 'Copper volatility is wrong'], correct: { index: 1 }, explanation: 'Monthly averages are smoothed; compare like with like.', misconception: 'Comparing volatilities across frequencies.' },
    { id: 'cm-q6-3', objective: 'cm-o6', skill: 'commodity_risk', difficulty: 2, qtype: 'single_choice', stem: 'A day without a published price should be:', options: ['Filled with the previous value', 'Left as a gap and excluded from returns across it', 'Set to zero', 'Interpolated'], correct: { index: 1 }, explanation: 'Filling invents observations and understates volatility.', misconception: 'Forward-filling missing data.' },
  ],
};

export const COMMODITY_DECODER: SourceCourse = {
  id: 'commodity-decoder',
  position: 9,
  title: 'ATLAS: COMMODITY MARKETS DECODER',
  tagline: 'Benchmarks, futures, curves, spreads, inventories and risk, on real published series.',
  description: 'Learn what commodity prices measure, how futures and their expiry work, how to read contango and backwardation, compute spreads in the right units, put inventories and seasonality in context, and measure risk at the right frequency, using the benchmark series stored in ATLAS.',
  audience: 'Learners comfortable with percentages and returns who want to research commodity markets.',
  prerequisites: 'MARKET DECODER, or equivalent comfort with returns, volatility and percentages.',
  preceding: 'market-decoder',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'cm-o1', statement: 'Distinguish spot assessments, futures settlements, monthly averages and indices, and convert their units.', skill: 'commodity_prices' },
    { id: 'cm-o2', statement: 'Explain futures contracts, daily settlement and expiry, and why a continuous series needs a stated roll method.', skill: 'futures' },
    { id: 'cm-o3', statement: 'Read a futures curve as contango or backwardation and estimate a roll-yield proxy with its limits.', skill: 'term_structure' },
    { id: 'cm-o4', statement: 'Compute location and crack spreads in a common unit on same-date prices.', skill: 'spreads' },
    { id: 'cm-o5', statement: 'Interpret inventories against the same season in earlier years and judge seasonal averages by their sample size.', skill: 'fundamentals' },
    { id: 'cm-o6', statement: 'Measure volatility at the series’ own frequency and handle gaps and non-positive prices correctly.', skill: 'commodity_risk' },
  ],
  modules: [
    { id: 'cm-m1', title: 'Prices and contracts', summary: 'What a commodity price is; futures, expiry and the roll.', lessons: [CM1, CM2] },
    { id: 'cm-m2', title: 'Curves and spreads', summary: 'Contango, backwardation and roll yield; location and crack spreads.', lessons: [CM3, CM4] },
    { id: 'cm-m3', title: 'Fundamentals and risk', summary: 'Inventories and seasonality; volatility, gaps and negative prices.', lessons: [CM5, CM6] },
  ],
  diagnostic: [
    { id: 'cm-d01', skill: 'commodity_prices', difficulty: 1, qtype: 'numeric', critical: true, stem: 'Gasoline is 3.00 USD per gallon. What is it in USD per barrel (42 gallons)?', correct: { value: 126, abs_tol: 0.01 }, explanation: '3.00 × 42 = 126.', misconception: 'Forgetting unit conversion.' },
    { id: 'cm-d02', skill: 'commodity_prices', difficulty: 2, qtype: 'single_choice', stem: 'A global benchmark price for wheat in USD per metric ton is:', options: ['The price an Indian buyer pays', 'A world reference that excludes freight, duties, taxes and currency effects for India', 'An MCX futures price', 'A forecast'], correct: { index: 1 }, explanation: 'Local prices add many costs and currency effects.', misconception: 'Treating global benchmarks as local prices.' },
    { id: 'cm-d03', skill: 'futures', difficulty: 2, qtype: 'numeric', stem: 'A 1,000-barrel contract settles 0.80 USD lower. What is the loss on one long contract, in USD?', correct: { value: 800, abs_tol: 0.5 }, explanation: '0.80 × 1,000 = 800.', misconception: 'Ignoring contract size.' },
    { id: 'cm-d04', skill: 'futures', difficulty: 3, qtype: 'single_choice', critical: true, stem: 'A backtest on an unadjusted front-month series shows large one-day gains on contract expiry dates. The most likely cause is:', options: ['Roll jumps from joining different contracts', 'Genuine skill', 'Weekend effects', 'Currency moves'], correct: { index: 0 }, explanation: 'Naive joins create artificial jumps at each roll.', misconception: 'Trusting a naive continuous series.' },
    { id: 'cm-d05', skill: 'term_structure', difficulty: 2, qtype: 'single_choice', stem: 'Later delivery months priced below the nearest month is called:', options: ['Contango', 'Backwardation', 'Arbitrage', 'Settlement'], correct: { index: 1 }, explanation: 'Downward-sloping curve: backwardation.', misconception: 'Mixing up the terms.' },
    { id: 'cm-d06', skill: 'term_structure', difficulty: 3, qtype: 'numeric', stem: 'C1 = 90.00, C2 = 88.20. What is (C1 ÷ C2 − 1) × 12, in percent?', correct: { value: 24.49, abs_tol: 0.05, unit: '%' }, explanation: '90 ÷ 88.2 − 1 = 2.041%; × 12 = 24.49%.', misconception: 'Dividing C2 by C1.' },
    { id: 'cm-d07', skill: 'spreads', difficulty: 2, qtype: 'numeric', stem: 'Jet fuel 2.40 USD per gallon, WTI 75.00 USD per barrel. 1:1 crack in USD per barrel?', correct: { value: 25.8, abs_tol: 0.01 }, explanation: '2.40 × 42 = 100.80; 100.80 − 75 = 25.80.', misconception: 'Skipping the conversion.' },
    { id: 'cm-d08', skill: 'fundamentals', difficulty: 2, qtype: 'single_choice', stem: 'The best comparison for this week’s inventory level is:', options: ['Last week', 'The same week in earlier years', 'The all-time high', 'Next week’s estimate'], correct: { index: 1 }, explanation: 'Seasonal comparison separates unusual from normal.', misconception: 'Ignoring seasonality.' },
    { id: 'cm-d09', skill: 'commodity_risk', difficulty: 2, qtype: 'numeric', critical: true, stem: 'Monthly returns have a standard deviation of 4.0%. Annualised volatility using √12, in percent?', correct: { value: 13.86, abs_tol: 0.05, unit: '%' }, explanation: '4.0 × 3.464 = 13.86%.', misconception: 'Multiplying by 12.' },
    { id: 'cm-d10', skill: 'commodity_risk', difficulty: 3, qtype: 'single_choice', stem: 'A price series contains a negative value. The percentage return into and out of that day should be:', options: ['Computed normally', 'Treated as undefined and excluded', 'Set to −100%', 'Replaced with zero'], correct: { index: 1 }, explanation: 'Percentage changes across zero have no meaning.', misconception: 'Computing returns mechanically.' },
  ],
};
