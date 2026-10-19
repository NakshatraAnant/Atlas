import type { SourceLesson } from '../curriculum.js';

// MARKET DECODER, module 5: how trading and market data work (batch 1, 20 Oct 2026).
// Original text. Examples use ATLAS's synthetic companies or labelled hypothetical numbers; no real
// prices or records are presented. Status: in_review (AI-assisted draft) until the seven-point review.

const SEBI = { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'Investor education from the Indian securities regulator, including how trading and settlement work.' };
const NSDL = { title: 'NSDL: depository services and ISIN', url: 'https://nsdl.co.in/', note: 'National Securities Depository Limited; allots ISINs in India and holds securities in demat form.' };
const CDSL = { title: 'CDSL: depository services', url: 'https://www.cdslindia.com/', note: 'Central Depository Services (India) Limited, the second Indian depository.' };
const NSE = { title: 'National Stock Exchange of India', url: 'https://www.nseindia.com/', note: 'Exchange rules, trading hours, circulars and investor material. Read on the site; its terms prohibit automated collection.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

export const MD_MODULE_5_OBJECTIVES = [
  { id: 'md-o10', statement: 'Identify a listed security by exchange, trading symbol, BSE code and ISIN, and explain why an ISIN is the safer identifier.', skill: 'identifiers' },
  { id: 'md-o11', statement: 'Trace a trade from order to settlement: broker, exchange, clearing corporation and depository.', skill: 'trade_lifecycle' },
  { id: 'md-o12', statement: 'Distinguish the primary market (new shares from the company) from the secondary market (shares changing hands).', skill: 'primary_secondary' },
  { id: 'md-o13', statement: 'Read OHLC data and candlesticks, and calculate a daily return from closing prices.', skill: 'ohlc' },
  { id: 'md-o14', statement: 'Recognise stale prices, unadjusted series and misleading chart scales before drawing conclusions.', skill: 'data_literacy' },
];

export const MD_MODULE_5: SourceLesson[] = [
  {
    id: 'md-l10', title: 'NSE, BSE, symbols and ISINs', minutes: 12, objectives: ['md-o10'], prerequisites: ['md-l1'], mastery_rule: RULE('md-o10'), references: [NSE, NSDL],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'One company, several names', body: [
        'India has two main stock exchanges for shares: the National Stock Exchange (NSE) and BSE. Many companies are listed on both, so the same share can be bought on either exchange.',
        'Each exchange gives the share its own identifier. NSE uses a trading symbol made of letters (for example, ATLAS\'s synthetic company Kaveri Foods uses KAVERIFOOD). BSE uses a six-digit scrip code (Kaveri Foods: 500100). Both are convenient for people, but symbols can change when a company renames itself.',
        'The International Securities Identification Number (ISIN) identifies the security itself, not the exchange listing. It has 12 characters: a two-letter country code (IN for India), a nine-character national code and a final check digit. In India, ISINs are allotted by NSDL.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Find all three identifiers in ATLAS', href: '/app/companies', steps: [
        'Open Companies and search for Kaveri.',
        'Open the Kaveri Foods profile.',
        'Under the company name, find the NSE symbol, the BSE code and the identifier ending in X. ATLAS\'s synthetic ISINs start with XX so they can never be mistaken for real Indian ISINs (which start with IN).',
        'Try searching by the BSE code 500100 instead of the name: you reach the same company.',
      ], alt_text: 'A guided task on the Companies screen: search for a company, open its profile and read its NSE symbol, BSE code and ISIN.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A company changes its name and its NSE symbol. Which identifier stays the same for its existing shares?', options: ['The NSE symbol', 'The company name', 'The ISIN', 'None of them'], answer: 2, reveal: 'The ISIN identifies the security, so it normally stays the same through a name or symbol change. That is why data systems match records by ISIN rather than by symbol.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Why matching by symbol goes wrong', steps: [
        'Suppose a dataset stores prices under the symbol OLDNAME until March and NEWNAME from April.',
        'A chart built from the symbol NEWNAME alone starts in April and silently loses the earlier history.',
        'Matching by ISIN joins both periods into one series, because the share itself never changed.',
        'ATLAS stores every identifier with the dates it was valid, and searches former names too.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'How many characters does an Indian ISIN have, and what does it start with?', hint: 'Country code, national code, check digit.', answer_text: '12 characters, starting with IN (2 + 9 + 1).' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why might two websites show different "prices" for the same company at the same moment?', model_answer: 'They may be quoting different exchanges (NSE and BSE trade separately), different times or a delayed feed. Checking the exchange and the timestamp explains most differences.' },
      { stage: 'review', kind: 'summary', points: ['NSE uses letter symbols; BSE uses six-digit scrip codes.', 'The ISIN identifies the security itself: 12 characters, IN for India, allotted by NSDL.', 'Symbols and names can change; matching data by ISIN avoids broken histories.'] },
    ],
    quiz: [
      { id: 'md-q10-1', objective: 'md-o10', skill: 'identifiers', difficulty: 1, qtype: 'single_choice', stem: 'Which identifier is a six-digit number used by BSE?', options: ['NSE symbol', 'BSE scrip code', 'ISIN', 'PAN'], correct: { index: 1 }, explanation: 'BSE identifies listed securities with numeric scrip codes such as 500100.', misconception: 'Thinking every exchange uses letter symbols.' },
      { id: 'md-q10-2', objective: 'md-o10', skill: 'identifiers', difficulty: 2, qtype: 'single_choice', stem: 'A company renames itself and gets a new NSE symbol. To keep its full price history together, a data system should match records by:', options: ['The new symbol', 'The old symbol', 'The ISIN', 'The company website'], correct: { index: 2 }, explanation: 'The ISIN identifies the security and normally survives name and symbol changes.', misconception: 'Treating a trading symbol as permanent.' },
      { id: 'md-q10-3', objective: 'md-o10', skill: 'identifiers', difficulty: 2, qtype: 'numeric', stem: 'How many characters does an ISIN have?', correct: { value: 12, abs_tol: 0 }, explanation: 'Two-letter country code, nine-character national code and one check digit: 12 in total.', misconception: 'Confusing the ISIN with the six-digit BSE code.' },
    ],
  },
  {
    id: 'md-l11', title: 'From order to demat: brokers, clearing and settlement', minutes: 14, objectives: ['md-o11'], prerequisites: ['md-l2'], mastery_rule: RULE('md-o11'), references: [SEBI, NSDL, CDSL],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Who does what in a trade', body: [
        'You do not trade directly on an exchange. A registered stock broker sends your order to the exchange, where it is matched with an opposite order (MARKET DECODER lesson 2 showed how).',
        'Once matched, a clearing corporation steps in between buyer and seller and guarantees that both sides are settled. This removes the risk that the person on the other side fails to pay or deliver.',
        'Shares are held electronically ("dematerialised", or demat) in a depository: NSDL or CDSL. You reach your demat account through a depository participant, often your broker. In India, equity trades settle on T+1: one working day after the trade, shares and money move.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'See where a session\'s prices come from', href: '/app/market', steps: [
        'Open Market and read the session date and the "End of day" or "Stale" label.',
        'Note that ATLAS shows end-of-day data: prices after the session closes, not live trades.',
        'Open Methodology → Data sources to see each dataset\'s schedule and delay.',
      ], alt_text: 'A guided task on the Market screen: read the session date and freshness label, then the data-source schedule.' },
      { stage: 'predict', kind: 'prediction', prompt: 'You buy shares on a Monday that is a normal trading day. Under T+1, when do the shares normally reach your demat account?', options: ['The same Monday', 'Tuesday', 'Wednesday', 'The following Monday'], answer: 1, reveal: 'T+1 means one working day after the trade date, so Tuesday (if it is a working day). Holidays push settlement to the next working day.' },
      { stage: 'investigate', kind: 'worked_example', title: 'A trade, step by step (hypothetical)', steps: [
        'Monday 10:15: you place a buy order for 10 shares through your broker; it is matched on the exchange at ₹250.',
        'The clearing corporation becomes the counterparty to both sides and works out what each broker owes.',
        'Your broker collects ₹2,500 plus charges from you; the seller\'s shares are delivered from their demat account.',
        'Tuesday: settlement completes and the 10 shares appear in your demat account at NSDL or CDSL.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Name the two Indian depositories.', hint: 'One is "national", one is "central".', answer_text: 'NSDL (National Securities Depository Limited) and CDSL (Central Depository Services (India) Limited).' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why does a clearing corporation make trading safer for an individual investor?', model_answer: 'It guarantees settlement, so you do not depend on the unknown person on the other side of your trade paying or delivering.' },
      { stage: 'review', kind: 'summary', points: ['Broker → exchange (matching) → clearing corporation (guarantee) → depository (demat holding).', 'Indian equity trades settle T+1: one working day after the trade.', 'NSDL and CDSL hold shares electronically; you reach them through a depository participant.'] },
    ],
    quiz: [
      { id: 'md-q11-1', objective: 'md-o11', skill: 'trade_lifecycle', difficulty: 1, qtype: 'single_choice', stem: 'Where are your shares held after you buy them?', options: ['At the exchange', 'In a demat account at a depository', 'With the company that issued them', 'With SEBI'], correct: { index: 1 }, explanation: 'Shares are held electronically in a demat account at NSDL or CDSL.', misconception: 'Thinking the exchange holds your shares.' },
      { id: 'md-q11-2', objective: 'md-o11', skill: 'trade_lifecycle', difficulty: 2, qtype: 'single_choice', stem: 'What does the clearing corporation do?', options: ['Sets the share price', 'Recommends which shares to buy', 'Guarantees settlement between buyers and sellers', 'Holds your demat account'], correct: { index: 2 }, explanation: 'It becomes the counterparty to both sides and guarantees settlement.', misconception: 'Confusing clearing with price discovery or custody.' },
      { id: 'md-q11-3', objective: 'md-o11', skill: 'trade_lifecycle', difficulty: 2, qtype: 'multi_select', stem: 'Select every party involved in a normal share purchase in India.', options: ['A stock broker', 'An exchange', 'A clearing corporation', 'A depository', 'The company\'s auditor'], correct: { indexes: [0, 1, 2, 3] }, explanation: 'Broker, exchange, clearing corporation and depository each have a role; the auditor checks the company\'s accounts, not trades.', misconception: 'Leaving out clearing or the depository.' },
    ],
  },
  {
    id: 'md-l12', title: 'Primary and secondary markets', minutes: 12, objectives: ['md-o12'], prerequisites: ['md-l1'], mastery_rule: RULE('md-o12'), references: [SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Where shares are born, and where they change hands', body: [
        'In the primary market a company sells new shares and receives the money: an initial public offering (IPO) when it first lists, or later issues such as rights issues.',
        'In the secondary market existing shares change hands between investors on an exchange. The company receives nothing from these trades; the price simply reflects what buyers and sellers agree.',
        'In an Indian IPO, investors bid within a price band. With ASBA, the bid amount is blocked in the investor\'s bank account and only debited if shares are allotted.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Spot primary-market events in disclosures', href: '/app/companies', steps: [
        'Open any company profile and select Disclosures.',
        'Look for announcements about fund raising, rights issues or allotments: these are primary-market events.',
        'Compare them with ordinary daily trading shown under Price & technicals: that is the secondary market.',
      ], alt_text: 'A guided task on a company profile: find fund-raising announcements in Disclosures and compare them with daily trading data.' },
      { stage: 'predict', kind: 'prediction', prompt: 'You buy 100 shares of a listed company on the exchange. How much of your money goes to the company?', options: ['All of it', 'Half of it', 'None of it', 'It depends on the price'], answer: 2, reveal: 'None. On the secondary market you pay the seller, not the company. The company raised money only when the shares were first issued.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Following ₹1 crore (hypothetical)', steps: [
        'A company issues 1,00,000 new shares at ₹100 in an IPO: it receives ₹1 crore to invest in the business (primary market).',
        'A year later the shares trade at ₹140. An investor sells 1,000 shares to another investor for ₹1,40,000 (secondary market).',
        'That ₹1,40,000 goes from buyer to seller; the company\'s bank balance does not change.',
        'The company still cares about its share price: it affects future fund raising and how shareholders judge management.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A company announces a rights issue at ₹80 a share. Primary or secondary market?', hint: 'Who receives the money?', answer_text: 'Primary: the company issues new shares and receives the money.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why is an IPO price band not a promise about future prices?', model_answer: 'The band reflects what the company and its advisers expect demand to be at the time of issue. After listing, the price is set by secondary-market trading and can be higher or lower.' },
      { stage: 'review', kind: 'summary', points: ['Primary market: new shares, money goes to the company (IPO, rights issue).', 'Secondary market: existing shares change hands; the company receives nothing.', 'Indian IPO bids are made within a price band; ASBA blocks the money until allotment.'] },
    ],
    quiz: [
      { id: 'md-q12-1', objective: 'md-o12', skill: 'primary_secondary', difficulty: 1, qtype: 'single_choice', stem: 'Which is a primary-market transaction?', options: ['Buying shares from another investor on NSE', 'Subscribing to a company\'s IPO', 'Selling shares you already own', 'Watching a share price on a chart'], correct: { index: 1 }, explanation: 'In an IPO the company issues new shares and receives the money.', misconception: 'Thinking every share purchase funds the company.' },
      { id: 'md-q12-2', objective: 'md-o12', skill: 'primary_secondary', difficulty: 2, qtype: 'numeric', stem: 'A company sells 50,000 new shares at ₹120 in a rights issue. How much does the company raise, in rupees (before costs)?', correct: { value: 6000000, abs_tol: 0.5, unit: '₹' }, explanation: '50,000 × ₹120 = ₹60,00,000.', misconception: 'Mixing up the number of shares and the price per share.' },
      { id: 'md-q12-3', objective: 'md-o12', skill: 'primary_secondary', difficulty: 2, qtype: 'single_choice', stem: 'With ASBA, what happens to an IPO bid amount before allotment?', options: ['It is paid to the company immediately', 'It is blocked in your bank account and debited only on allotment', 'It is held by the exchange', 'It is invested in a mutual fund'], correct: { index: 1 }, explanation: 'ASBA (Application Supported by Blocked Amount) blocks the money; it is debited only for the shares allotted.', misconception: 'Assuming the money leaves your account on bidding.' },
    ],
  },
  {
    id: 'md-l13', title: 'Candlesticks, OHLC and daily returns', minutes: 13, objectives: ['md-o13'], prerequisites: ['md-l3'], mastery_rule: RULE('md-o13'), references: [NSE],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Four prices summarise a session', body: [
        'For each trading day, end-of-day data records four prices: Open (the first trade), High, Low and Close (the official closing price). Together they are called OHLC. Volume records how many shares changed hands.',
        'A candlestick draws one day: the body spans open to close, and thin lines (wicks) reach up to the high and down to the low. Colour conventions vary between charting tools, so always check the legend.',
        'Daily return compares closes: (today\'s close ÷ yesterday\'s close) − 1. It uses closes, not opens, so overnight moves are included.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Read OHLC on a company chart', href: '/app/companies', steps: [
        'Open Kaveri Foods and select Price & technicals.',
        'Hover over a recent day to read its open, high, low, close and volume.',
        'Check that the low is the smallest of the four prices and the high the largest: ATLAS rejects any record where that is not true.',
      ], alt_text: 'A guided task on the price chart of a synthetic company: read the open, high, low, close and volume of a session.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A candle has open ₹100, close ₹96, high ₹103 and low ₹95. Where is the body?', options: ['From ₹95 to ₹103', 'From ₹96 to ₹100', 'From ₹100 to ₹103', 'There is no body'], answer: 1, reveal: 'The body spans open to close: ₹96 to ₹100. The wicks extend to the high (₹103) and the low (₹95). The close is below the open, so it was a down day.' },
      { stage: 'investigate', kind: 'worked_example', title: 'Three daily returns (hypothetical closes)', steps: [
        'Closes: ₹200, ₹206, ₹201.85.',
        'Day 2: 206 ÷ 200 − 1 = 3.00%.',
        'Day 3: 201.85 ÷ 206 − 1 = −2.01%.',
        'Over both days: 201.85 ÷ 200 − 1 = 0.925%, which equals 1.03 × 0.9799 − 1, not 3.00% − 2.01%.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'Yesterday\'s close was ₹480; today\'s close is ₹492. What is today\'s return?', hint: 'Divide today\'s close by yesterday\'s, then subtract 1.', answer_text: '492 ÷ 480 − 1 = 2.5%.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why can a day be shown as "down" even though the share traded above yesterday\'s close for most of the session?', model_answer: 'The daily return uses only the closing price. A share can trade higher during the day and still close lower; the wicks show that range.' },
      { stage: 'review', kind: 'summary', points: ['OHLC: open, high, low, close for each session; volume counts shares traded.', 'A candle\'s body spans open to close; wicks reach the high and low.', 'Daily return = today\'s close ÷ yesterday\'s close − 1; returns compound, they do not add.'] },
    ],
    quiz: [
      { id: 'md-q13-1', objective: 'md-o13', skill: 'ohlc', difficulty: 1, qtype: 'single_choice', stem: 'In a candlestick, what do the wicks show?', options: ['Open and close', 'High and low', 'Volume', 'The previous day\'s close'], correct: { index: 1 }, explanation: 'Wicks extend to the session high and low; the body spans open to close.', misconception: 'Reading the body as the full trading range.' },
      { id: 'md-q13-2', objective: 'md-o13', skill: 'ohlc', difficulty: 2, qtype: 'numeric', stem: 'Yesterday\'s close was ₹250 and today\'s close is ₹245. What is today\'s return, in percent?', correct: { value: -2, abs_tol: 0.05, unit: '%' }, explanation: '245 ÷ 250 − 1 = −2%.', misconception: 'Dividing by today\'s price instead of yesterday\'s.' },
      { id: 'md-q13-3', objective: 'md-o13', skill: 'ohlc', difficulty: 2, qtype: 'single_choice', stem: 'Which OHLC record must be wrong?', options: ['O 100, H 105, L 98, C 104', 'O 100, H 101, L 99, C 99', 'O 100, H 99, L 97, C 98', 'O 100, H 100, L 95, C 95'], correct: { index: 2 }, explanation: 'The high (99) is below the open (100), which is impossible: the high must be the largest of the four prices.', misconception: 'Not checking that the high and low bound the open and close.' },
    ],
  },
  {
    id: 'md-l14', title: 'Data sources, stale prices and misleading charts', minutes: 14, objectives: ['md-o14'], prerequisites: ['md-l13'], mastery_rule: RULE('md-o14'), references: [SEBI],
    blocks: [
      { stage: 'discover', kind: 'text', title: 'Before you trust a number, check three things', body: [
        'When: is the price from today\'s session, yesterday\'s, or older? A "stale" price is one that has not been updated as expected, perhaps because a feed was delayed or the share did not trade.',
        'Adjusted or not: after a share split or bonus issue, the price per share falls even though nothing about the company\'s value changed. An unadjusted chart shows a sudden "crash" that never happened; an adjusted series rescales earlier prices so the history is comparable.',
        'How it is drawn: a chart whose vertical axis starts far above zero makes a small move look dramatic, and a carefully chosen start date can make almost any trend look strong.',
      ] },
      { stage: 'observe', kind: 'atlas_task', title: 'Find freshness and provenance in ATLAS', href: '/app/data-health', steps: [
        'Open Data health and read "Data in use": ATLAS currently runs on synthetic development data.',
        'In Sources and freshness, find the last data date for end-of-day prices and its freshness label.',
        'Open any figure on a company page: the evidence drawer shows its source, period and retrieval time.',
      ], alt_text: 'A guided task on the Data health page and a company evidence drawer: read the data mode, the last data date and a figure\'s provenance.' },
      { stage: 'predict', kind: 'prediction', prompt: 'A share trading at ₹1,000 has a 1:5 split (each share becomes five). The next day an unadjusted chart shows ₹202. What happened to the company\'s value?', options: ['It fell about 80%', 'Roughly nothing changed: ₹202 × 5 = ₹1,010', 'It rose 1%', 'It cannot be known'], answer: 1, reveal: 'Each old share became five shares worth about ₹202 each, so a holding is worth about ₹1,010: a 1% rise, not an 80% fall. Only an adjusted series shows this correctly.' },
      { stage: 'investigate', kind: 'worked_example', title: 'The same move, two charts (hypothetical)', steps: [
        'A share moves from ₹500 to ₹510, a 2% rise.',
        'Chart A has a vertical axis from ₹0 to ₹600: the line barely moves.',
        'Chart B has an axis from ₹498 to ₹512: the line climbs most of the height of the chart.',
        'Both are "correct", but only the percentage change (2%) tells you the size of the move.',
      ] },
      { stage: 'decide', kind: 'guided_practice', prompt: 'A price page shows a timestamp from three trading days ago. What should you conclude before using it?', hint: 'Is it current?', answer_text: 'The price is stale. Find out why (holiday, suspension, delayed feed, no trading) before treating it as today\'s value.' },
      { stage: 'explain', kind: 'reflection', prompt: 'Why should a long-term price chart use adjusted prices?', model_answer: 'Splits, bonuses and similar corporate actions change the price per share without changing value. Adjusting earlier prices keeps the history comparable, so returns are measured correctly.' },
      { stage: 'review', kind: 'summary', points: ['Check when a price is from; a stale price needs an explanation.', 'Splits and bonuses need adjusted series, or charts show false crashes.', 'Axis ranges and start dates change how a chart feels; percentages tell you the real size of a move.'] },
    ],
    quiz: [
      { id: 'md-q14-1', objective: 'md-o14', skill: 'data_literacy', difficulty: 1, qtype: 'single_choice', stem: 'What is a "stale" price?', options: ['A price that has not been updated as expected', 'A price below last year\'s', 'An adjusted price', 'Any closing price'], correct: { index: 0 }, explanation: 'Stale means older than it should be, for example because a feed was delayed or the share did not trade.', misconception: 'Thinking stale means low or old-fashioned.' },
      { id: 'md-q14-2', objective: 'md-o14', skill: 'data_literacy', difficulty: 2, qtype: 'numeric', stem: 'A share at ₹900 has a 1:3 split (each share becomes three). With no change in value, what should the price per share be, in rupees?', correct: { value: 300, abs_tol: 0.01, unit: '₹' }, explanation: '₹900 ÷ 3 = ₹300 per share; the holding is still worth the same.', misconception: 'Reading the post-split price as a loss.' },
      { id: 'md-q14-3', objective: 'md-o14', skill: 'data_literacy', difficulty: 2, qtype: 'single_choice', stem: 'Two charts of the same 2% move look very different. What is the most likely reason?', options: ['One uses fake data', 'They use different vertical-axis ranges', 'One is adjusted for inflation', 'The share traded on different exchanges'], correct: { index: 1 }, explanation: 'Narrowing the axis range exaggerates small moves; the percentage change is the same.', misconception: 'Judging the size of a move from the slope of a chart.' },
    ],
  },
];
