import type { SourceCourse, SourceLesson } from '../curriculum.js';

// TOKENOMICS DETECTIVE (intermediate), ON-CHAIN SIGNAL ENGINEER (advanced) and DIGITAL ASSET
// ARCHITECT (expert). Drafted with AI assistance; stored as in_review until a named reviewer completes
// the seven-point review. Hypothetical examples use round numbers and fictional tokens; guided ATLAS
// tasks use ATLAS's own stored, source-attributed data. Nothing here is a recommendation or forecast.

const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;
const COMPLETION = 'This record shows which learning objectives you practised and the assessments you completed in the ATLAS Academy. It is not a professional qualification, licence or certification, and it says nothing about future investment results.';
const RULES = { high_min: 0.8, low_max: 0.4, critical_miss_low: 2, questions: 5, max_attempts_per_week: 3 };
const DEFILLAMA = { title: 'DefiLlama API documentation (free endpoints)', url: 'https://api-docs.defillama.com/', note: 'Definitions and sources for TVL, fees, revenue and stablecoin data used in ATLAS.' };
const ETH_DOCS = { title: 'ethereum.org developer documentation', url: 'https://ethereum.org/en/developers/docs/', note: 'Official documentation of transactions, blocks, gas, logs and events.' };
const CG_METHOD = { title: 'CoinGecko methodology', url: 'https://www.coingecko.com/en/methodology', note: 'How the provider defines supply figures and market capitalisation.' };
const HARVEY = { title: 'Harvey, Liu and Zhu, “… and the Cross-Section of Expected Returns” (Review of Financial Studies, 2016)', url: 'https://doi.org/10.1093/rfs/hhv059', note: 'On multiple testing and why many published “signals” are false discoveries.' };

// ═════════════════════════════ TOKENOMICS DETECTIVE ═════════════════════════════

const TD1: SourceLesson = {
  id: 'td-l1', title: 'Three supplies and fully diluted valuation', minutes: 14, objectives: ['td-o1'], mastery_rule: RULE('td-o1'), references: [CG_METHOD],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Circulating, total, maximum', body: [
      'Circulating supply: tokens that can trade now (a provider estimate). Total supply: tokens that exist, minus those burned, including locked ones. Maximum supply: a hard cap written into the protocol, where one exists.',
      'Different providers can report different circulating figures for the same token because they classify locked, treasury and team wallets differently. Always read the methodology and the date.',
      'Fully diluted valuation (FDV) multiplies today’s price by the maximum (or total) supply. The ratio of market cap to FDV shows how much of the eventual supply already circulates.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Compare supply profiles', href: '/app/crypto/assets', steps: [
      'Sort the Explorer by market cap and open three assets: Bitcoin, Ethereum and a large token.',
      'On each Tokenomics tab, note circulating ÷ maximum (or total), and whether a maximum is defined.',
      'Write down which asset has the most supply still to come, and where that figure came from.',
    ], alt_text: 'Three Tokenomics tabs side by side, each listing circulating, total and maximum supply with the provider, date and methodology.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Token A: market cap $500 M, FDV $550 M. Token B: market cap $500 M, FDV $5 B. Which faces more potential dilution from new supply?', options: ['Token A', 'Token B', 'They are the same'], answer: 1, reveal: 'Token B has only 10% of its eventual supply circulating; nine times as many tokens could still arrive.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Market cap ÷ FDV', steps: [
      'A fictional token trades at $2. Circulating 150 M, maximum 1,000 M.',
      'Market cap = 150 M × 2 = $300 M. FDV = 1,000 M × 2 = $2,000 M.',
      'Market cap ÷ FDV = 300 ÷ 2,000 = 15%: 85% of the maximum supply is not yet circulating.',
      'If the price stayed at $2 while 850 M more tokens entered circulation, buyers would need to absorb $1.7 billion of new supply.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Circulating 300 M, maximum 1,200 M, price $0.80. Market cap, FDV and the share circulating?', hint: 'Share circulating = circulating ÷ maximum.', answer_text: 'Market cap $240 M; FDV $960 M; 300 ÷ 1,200 = 25% circulating.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why can two data providers show different market capitalisations for the same token at the same price?', model_answer: 'They estimate circulating supply differently, for example by counting or excluding treasury, team or locked wallets, so the same price times a different supply gives a different market cap.' },
    { stage: 'review', kind: 'summary', points: ['Circulating, total and maximum supply measure different things.', 'Market cap ÷ FDV shows how much of the eventual supply already circulates.', 'Supply figures are provider estimates: read the methodology and date.'] },
  ],
  quiz: [
    { id: 'td-q1-1', objective: 'td-o1', skill: 'supply_fdv', difficulty: 2, qtype: 'numeric', stem: 'Price $2, circulating 150 million, maximum 1,000 million. What is market cap ÷ FDV, in percent?', correct: { value: 15, abs_tol: 0.01, unit: '%' }, explanation: '$300 M ÷ $2,000 M = 15%.', misconception: 'Dividing FDV by market cap.' },
    { id: 'td-q1-2', objective: 'td-o1', skill: 'supply_fdv', difficulty: 1, qtype: 'single_choice', stem: 'Which supply figure excludes tokens that are locked and cannot yet trade?', options: ['Maximum supply', 'Total supply', 'Circulating supply', 'Burned supply'], correct: { index: 2 }, explanation: 'Circulating supply estimates what can trade now.', misconception: 'Confusing total and circulating.' },
    { id: 'td-q1-3', objective: 'td-o1', skill: 'supply_fdv', difficulty: 3, qtype: 'single_choice', stem: 'Two providers report different circulating supplies for one token. The most likely reason is…', options: ['One provider has a bug', 'They classify treasury, team or locked wallets differently', 'The token has two prices', 'Circulating supply is random'], correct: { index: 1 }, explanation: 'Circulating supply is an estimate that depends on methodology.', misconception: 'Assuming supply figures are objective facts.' },
  ],
};

const TD2: SourceLesson = {
  id: 'td-l2', title: 'Issuance, emissions and burns', minutes: 15, objectives: ['td-o2'], prerequisites: ['td-l1'], mastery_rule: RULE('td-o2'), references: [ETH_DOCS, { title: 'EIP-1559: fee market change for ETH 1.0 chain', url: 'https://eips.ethereum.org/EIPS/eip-1559', note: 'The Ethereum proposal that introduced burning the base fee.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Supply that changes every block', body: [
      'Issuance (or emissions) creates new tokens, often to pay block producers or to reward users of a protocol. Bitcoin’s issuance per block halves about every four years; Ethereum issues ETH to validators.',
      'Burns permanently remove tokens, for example the base fee of every Ethereum transaction since EIP-1559. Net supply change = issuance − burns, so a token can shrink when activity is high and grow when it is low.',
      'Issuance paid to participants is a cost borne by all holders through dilution; whether it buys something valuable (security, liquidity) is the analytical question.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Model emissions and burns', widget: 'tokenomics_3d', intro: 'Raise the monthly emission and the burn rate and watch circulating supply over four years. Find a combination where supply stops growing.', alt_text: 'A 3D chart with one column per month: blue circulating supply with gold locked supply stacked above; a table lists circulating, locked, market cap and FDV at months 0, 6, 12, 24, 36 and 48.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A token issues 2 M per month and burns 0.1% of circulating supply per month. Circulating is 1,000 M. Is supply growing or shrinking this month?', options: ['Growing', 'Shrinking', 'Exactly flat'], answer: 0, reveal: 'After issuance there are 1,002 M; 0.1% of that is about 1.0 M burned, half of the 2 M issued, so supply grows by about 1 M. The worked example shows the burn rate at which the two almost cancel.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Net supply change', steps: [
      'Start: 1,000 M circulating. Issue 2 M → 1,002 M.',
      'Burn 0.2% of 1,002 M = 2.004 M → 999.996 M.',
      'Net change ≈ −0.004 M: issuance and burns almost cancel, with burns very slightly ahead.',
      'At a burn of 0.1% (≈ 1.002 M) the same issuance would grow supply by about 1 M a month (≈ 1.2% a year).',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A chain issues 2,700 tokens a day to validators and burns 1,900 a day in fees. Net change per year (365 days)?', hint: 'Daily net × 365.', answer_text: '(2,700 − 1,900) × 365 = 800 × 365 = 292,000 tokens a year of net issuance.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is a token with a maximum supply cap not automatically free of dilution today?', model_answer: 'A cap limits the eventual total, but supply can keep entering circulation until the cap is reached through emissions and unlocks, so holders can still be diluted for years.' },
    { stage: 'review', kind: 'summary', points: ['Net supply change = issuance − burns.', 'Burn-based tokens can shrink or grow depending on activity.', 'Issuance is a cost to holders; ask what it pays for.'] },
  ],
  quiz: [
    { id: 'td-q2-1', objective: 'td-o2', skill: 'issuance_burn', difficulty: 2, qtype: 'numeric', stem: 'A chain issues 2,700 tokens a day and burns 1,900 a day. What is the net issuance over 365 days?', correct: { value: 292000, abs_tol: 0.5, unit: 'tokens' }, explanation: '(2,700 − 1,900) × 365 = 292,000.', misconception: 'Ignoring burns.' },
    { id: 'td-q2-2', objective: 'td-o2', skill: 'issuance_burn', difficulty: 2, qtype: 'single_choice', stem: 'Since EIP-1559, what happens to the base fee of an Ethereum transaction?', options: ['It goes to the block producer', 'It is burned (destroyed)', 'It is refunded', 'It goes to the Ethereum Foundation'], correct: { index: 1 }, explanation: 'The base fee is burned; the priority fee (tip) goes to the validator.', misconception: 'Thinking all fees go to validators.' },
    { id: 'td-q2-3', objective: 'td-o2', skill: 'issuance_burn', difficulty: 3, qtype: 'single_choice', stem: 'Circulating supply 1,000 M, issuance 2 M a month, burn 0.1% of circulating a month. Over the next month, supply…', options: ['Grows by about 1 M', 'Shrinks by about 1 M', 'Stays exactly the same', 'Doubles'], correct: { index: 0 }, explanation: 'Burn ≈ 1.002 M against 2 M issued, so net ≈ +1 M.', misconception: 'Assuming any burn makes supply fall.' },
  ],
};

const TD3: SourceLesson = {
  id: 'td-l3', title: 'Vesting schedules and unlocks', minutes: 16, objectives: ['td-o3'], prerequisites: ['td-l1'], mastery_rule: RULE('td-o3'), references: [CG_METHOD],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Tokens that arrive on a timetable', body: [
      'Teams and early investors usually receive tokens that are locked, then released on a schedule: a cliff (nothing for, say, 12 months), then linear vesting (an equal amount each month for, say, 24 months).',
      'Unlocks increase circulating supply. A large unlock relative to what already circulates can matter for analysis because new holders may wish to sell, although whether they do is uncertain.',
      'Reliable unlock data must come from the project’s own disclosures or contracts. ATLAS does not have a free, verified unlock source, so it shows unlocks as not available rather than estimating them.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Design a vesting schedule', widget: 'tokenomics_3d', intro: 'Set team and investor cliffs and vesting periods. Find the month with the largest jump in circulating supply.', alt_text: 'A 3D chart of monthly columns where gold locked supply turns blue as tranches vest; a table and a sentence report the largest single-month increase in circulating supply.' },
    { stage: 'predict', kind: 'prediction', prompt: '200 M team tokens with a 12-month cliff and 24-month linear vesting. How many unlock in month 13?', options: ['200 M', 'About 8.3 M', 'Nothing until month 36'], answer: 1, reveal: '200 M ÷ 24 ≈ 8.33 M per month from month 13 to month 36.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Unlock as a share of circulating supply', steps: [
      'Circulating supply before month 13: 400 M.',
      'Team unlock: 8.33 M; investor tranche (150 M, 6-month cliff, 12-month vesting) is still vesting at 12.5 M a month.',
      'Month-13 unlocks ≈ 20.8 M, a 5.2% increase in circulating supply in one month.',
      'Compare with average daily trading volume: if typical volume is 10 M tokens a day, the unlock equals about two days of trading.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: '90 M investor tokens, 6-month cliff, then 18 months linear. Monthly unlock, and when does vesting end?', hint: 'Vesting starts after the cliff.', answer_text: '90 ÷ 18 = 5 M per month, from month 7 to month 24.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why does ATLAS show unlock schedules as “not available” instead of estimating them from a whitepaper chart?', model_answer: 'Schedules change, charts are approximate and contract terms can differ; an estimate presented next to verified data would look more certain than it is. Showing “not available” keeps the gap visible.' },
    { stage: 'review', kind: 'summary', points: ['Cliffs delay unlocks; linear vesting spreads them out.', 'Measure an unlock against circulating supply and normal trading volume.', 'Use verified schedules only; label estimates as estimates.'] },
  ],
  quiz: [
    { id: 'td-q3-1', objective: 'td-o3', skill: 'vesting', difficulty: 2, qtype: 'numeric', stem: '240 M tokens vest linearly over 24 months after a 12-month cliff. How many unlock each month during vesting, in millions?', correct: { value: 10, abs_tol: 0.01, unit: 'M' }, explanation: '240 ÷ 24 = 10 M per month.', misconception: 'Dividing by cliff plus vesting (36).' },
    { id: 'td-q3-2', objective: 'td-o3', skill: 'vesting', difficulty: 2, qtype: 'numeric', stem: 'Circulating supply is 500 M. An unlock releases 25 M. By what percentage does circulating supply increase?', correct: { value: 5, abs_tol: 0.01, unit: '%' }, explanation: '25 ÷ 500 = 5%.', misconception: 'Dividing by maximum supply.' },
    { id: 'td-q3-3', objective: 'td-o3', skill: 'vesting', difficulty: 1, qtype: 'single_choice', stem: 'What is a “cliff” in a vesting schedule?', options: ['A sudden price fall', 'A period at the start during which no tokens unlock', 'The final unlock', 'A burn event'], correct: { index: 1 }, explanation: 'Nothing unlocks until the cliff ends.', misconception: 'Confusing a vesting cliff with a price move.' },
  ],
};

const TD4: SourceLesson = {
  id: 'td-l4', title: 'Protocol incentives and governance', minutes: 14, objectives: ['td-o4'], prerequisites: ['td-l2'], mastery_rule: RULE('td-o4'), references: [DEFILLAMA, ETH_DOCS],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Who is paid, and who decides', body: [
      'Protocols pay participants to do useful things: validators to secure the chain, liquidity providers to deposit assets, users to try a product. Payment can come from fees (paid by users) or from new token issuance (paid by all holders through dilution).',
      'Incentives funded by issuance can attract activity that leaves when rewards end. A useful check: how much activity remains when rewards fall?',
      'Governance tokens let holders vote on protocol changes. Voting power follows token balances, so concentrated holdings mean concentrated control, and low turnout means a few voters decide.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Fees versus incentives in the data', href: '/app/crypto/defi', steps: [
      'Open a large protocol on the DeFi page and read its fees and revenue over the last 30 days and their definitions.',
      'Note which part of fees the protocol keeps (revenue) and which goes to liquidity providers or other parties.',
      'Ask what the data cannot tell you: ATLAS does not have a free source for each protocol’s token emissions, so incentive costs are not shown.',
    ], alt_text: 'A protocol profile with TVL history, 30-day fees and revenue, daily fee and revenue charts, and DefiLlama definitions.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A protocol pays $10 M a month in newly issued tokens to liquidity providers and earns $2 M a month in fees. What does this suggest?', options: ['It is profitable', 'Activity is largely paid for by token issuance; fees cover a fifth of the incentive cost', 'Fees and incentives cannot be compared'], answer: 1, reveal: 'Holders fund $10 M of incentives through dilution while users pay $2 M in fees. The question is whether the activity would remain without the subsidy.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Concentrated voting power', steps: [
      'A governance token has 100 M tokens. The five largest holders have 40 M between them.',
      'Typical turnout is 10% of supply: 10 M tokens vote.',
      'If the top five vote together, their 40 M outweighs all other likely voters four to one.',
      'Address balances are not people, though: exchanges, bridges and contracts hold tokens for many users, so concentration needs careful classification before conclusions.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Monthly fees $6 M, of which 30% is kept by the protocol. Token incentives cost $4 M a month. Revenue minus incentives?', hint: 'Revenue is the share of fees the protocol keeps.', answer_text: 'Revenue = 30% × 6 = $1.8 M; 1.8 − 4 = −$2.2 M a month.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why can high activity paid for by token incentives be misleading?', model_answer: 'Participants may be there for the rewards rather than the product; the cost is borne by holders through dilution, and activity can fall sharply when rewards end.' },
    { stage: 'review', kind: 'summary', points: ['Incentives are paid from fees or from issuance; issuance dilutes holders.', 'Compare protocol revenue with incentive costs.', 'Voting power follows balances; addresses are not identities.'] },
  ],
  quiz: [
    { id: 'td-q4-1', objective: 'td-o4', skill: 'incentives_governance', difficulty: 2, qtype: 'numeric', stem: 'Monthly fees $6 M, of which the protocol keeps 30%. Token incentives cost $4 M a month. What is revenue minus incentives, in $ millions? (Use a negative number for a shortfall.)', correct: { value: -2.2, abs_tol: 0.001, unit: '$ M' }, explanation: '0.3 × 6 = 1.8; 1.8 − 4 = −2.2.', misconception: 'Comparing total fees, not revenue, with incentives.' },
    { id: 'td-q4-2', objective: 'td-o4', skill: 'incentives_governance', difficulty: 2, qtype: 'single_choice', stem: 'Who ultimately bears the cost of incentives paid in newly issued tokens?', options: ['Nobody: new tokens are free', 'Existing holders, through dilution', 'The exchange that lists the token', 'The blockchain’s validators'], correct: { index: 1 }, explanation: 'New supply spreads the same value over more tokens.', misconception: 'Thinking issuance costs nothing.' },
    { id: 'td-q4-3', objective: 'td-o4', skill: 'incentives_governance', difficulty: 3, qtype: 'single_choice', stem: 'The ten largest addresses hold 60% of a governance token. What should you check before concluding that ten people control it?', options: ['Nothing: the conclusion follows', 'Whether those addresses belong to exchanges, bridges, treasuries or contracts holding for many users', 'The token’s price', 'The number of transactions'], correct: { index: 1 }, explanation: 'Addresses are not identities; classification comes first.', misconception: 'Treating an address as a person.' },
  ],
};

const TD5: SourceLesson = {
  id: 'td-l5', title: 'Utility claims and market structure', minutes: 13, objectives: ['td-o5'], prerequisites: ['td-l1'], mastery_rule: RULE('td-o5'), references: [CG_METHOD, DEFILLAMA],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Separate the claim from the evidence', body: [
      'Projects describe what their token is for: paying fees, staking, governance, access to a service. A claim of utility is not evidence of demand. The evidence is in usage data, fees paid and who actually needs to hold the token.',
      'Market structure matters too: where the token trades, how deep the order books are, how much of the volume is on a few venues, and whether a large share of supply sits with a few holders.',
      'A token can be essential to a protocol’s operation and still see little value accrue to holders, for example if users only hold it briefly to pay a fee.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Check where a token trades', href: '/app/crypto/assets', steps: [
      'Open a mid-ranked token and read its Markets tab: which verified pairs exist on Binance and Coinbase Exchange?',
      'Compare its 24-hour volume with its market capitalisation on the Price & overview tab.',
      'Note that ATLAS only verifies pairs on two venues; absence there does not mean absence everywhere.',
    ], alt_text: 'An asset’s Markets tab lists verified pairs with venue, product, quote currency and trading status, and the overview shows market cap and 24-hour volume.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A token’s whitepaper says it is “required for every transaction”, but users can pay fees in another asset that the protocol converts automatically. Is holding the token required for users?', options: ['Yes, by definition', 'No: the claim and the mechanics differ', 'Only on weekends'], answer: 1, reveal: 'If the protocol converts fees automatically, users never need to hold the token; demand for it may be much weaker than the claim suggests.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Volume relative to market cap', steps: [
      'Token X: market cap $400 M, 24-hour volume $8 M (2%). Token Y: market cap $400 M, 24-hour volume $120 M (30%).',
      'Token X trades thinly: a large order could move its price a lot.',
      'Token Y’s high turnover may reflect real liquidity, or wash trading on low-quality venues; check which venues report the volume.',
      'Neither figure says anything about value; both describe trading conditions.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Market cap $250 M, 24-hour volume $5 M. What is volume as a share of market cap?', hint: 'Volume ÷ market cap.', answer_text: '5 ÷ 250 = 2%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Give one way to test a project’s claim that its token is “essential”.', model_answer: 'Check whether users must hold the token to use the protocol, using documentation and on-chain data, and whether fees are paid in it or converted automatically.' },
    { stage: 'review', kind: 'summary', points: ['A utility claim is not evidence of demand; look for usage and fee data.', 'Volume relative to market cap describes trading conditions, not value.', 'Check which venues report volume; some volume is not genuine.'] },
  ],
  quiz: [
    { id: 'td-q5-1', objective: 'td-o5', skill: 'disclosures', difficulty: 1, qtype: 'numeric', stem: 'Market cap $250 M, 24-hour volume $5 M. Volume as a percentage of market cap?', correct: { value: 2, abs_tol: 0.01, unit: '%' }, explanation: '5 ÷ 250 = 2%.', misconception: 'Dividing market cap by volume.' },
    { id: 'td-q5-2', objective: 'td-o5', skill: 'disclosures', difficulty: 2, qtype: 'single_choice', stem: 'Which is the strongest evidence that a token is needed by users?', options: ['The whitepaper says so', 'On-chain data shows users must hold and spend it to use the protocol', 'A high price', 'A large social-media following'], correct: { index: 1 }, explanation: 'Observed mechanics and usage are evidence; claims are not.', misconception: 'Accepting marketing claims as evidence.' },
    { id: 'td-q5-3', objective: 'td-o5', skill: 'disclosures', difficulty: 3, qtype: 'single_choice', stem: 'A token reports 24-hour volume equal to 80% of its market cap, mostly on little-known venues. What is a reasonable first question?', options: ['None; high volume is always good', 'Whether the volume is genuine or wash trading on those venues', 'Whether the price will rise', 'Whether the supply is capped'], correct: { index: 1 }, explanation: 'Unusually high volume on obscure venues is a known sign of inflated figures.', misconception: 'Taking reported volume at face value.' },
  ],
};

const TD6: SourceLesson = {
  id: 'td-l6', title: 'Evaluating project disclosures', minutes: 14, objectives: ['td-o5'], prerequisites: ['td-l5'], mastery_rule: RULE('td-o5'), references: [CG_METHOD, { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'General guidance on reading disclosures; crypto projects are not bound by securities disclosure rules.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Disclosures without a regulator', body: [
      'Listed companies file audited accounts under rules. Crypto projects publish whitepapers, documentation, blog posts and dashboards, usually without audit or a legal duty of accuracy.',
      'Useful checks: Is the token allocation stated (team, investors, community, treasury) with vesting terms? Are contract addresses published on the official site? Is the code open source and audited, and by whom? Is the treasury visible on-chain? Who can upgrade or pause the contracts?',
      'Record the date and source of every claim you rely on, and note what is not disclosed. Missing information is information.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Start a disclosure checklist', href: '/app/crypto/assets', steps: [
      'Open an asset and its My notes tab.',
      'Write a note listing: allocation disclosed (yes/no, source), vesting disclosed, contract address source, audits named, upgrade or pause powers, treasury address.',
      'Add the date of each source; your notes are private and saved with the asset.',
    ], alt_text: 'The My notes tab on an asset page with a text box and a list of saved, dated private notes.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A project says “audited” but names no auditor and links no report. How much weight should the claim carry?', options: ['Full weight', 'Little: an unverifiable claim is not evidence', 'It proves the code is safe'], answer: 1, reveal: 'Without the auditor’s name and the report, the claim cannot be checked; and even a real audit does not guarantee safety.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Scoring disclosure completeness', steps: [
      'List six items: allocation, vesting, contract addresses, audit reports, admin/upgrade powers, treasury address.',
      'Project P discloses four with sources and dates; allocation and admin powers are missing.',
      'Completeness = 4 ÷ 6 ≈ 67%. This is not a quality score: it shows where your analysis rests on gaps.',
      'Missing admin-power disclosure matters especially: whoever can upgrade a contract can change the rules.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A project discloses 5 of 8 checklist items. What share is undisclosed?', hint: 'Undisclosed ÷ total.', answer_text: '3 ÷ 8 = 37.5% undisclosed.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is “who can upgrade or pause the contracts” a key disclosure?', model_answer: 'Those keys can change how the protocol works, freeze funds or alter token rules, so they are a concentration of power and a security risk that holders need to know about.' },
    { stage: 'review', kind: 'summary', points: ['Crypto disclosures are usually unaudited and unregulated.', 'Check allocation, vesting, contracts, audits, admin powers and treasury.', 'Record sources and dates; treat missing items as gaps in evidence.'] },
  ],
  quiz: [
    { id: 'td-q6-1', objective: 'td-o5', skill: 'disclosures', difficulty: 1, qtype: 'numeric', stem: 'A project discloses 5 of 8 checklist items. What percentage is undisclosed?', correct: { value: 37.5, abs_tol: 0.01, unit: '%' }, explanation: '3 ÷ 8 = 37.5%.', misconception: 'Reporting the disclosed share.' },
    { id: 'td-q6-2', objective: 'td-o5', skill: 'disclosures', difficulty: 2, qtype: 'single_choice', stem: 'A project claims an audit but names no auditor and links no report. This claim is…', options: ['Strong evidence of safety', 'Unverifiable, so it carries little weight', 'Required by law', 'Irrelevant to analysis'], correct: { index: 1 }, explanation: 'Unverifiable claims are not evidence.', misconception: 'Accepting the word “audited” at face value.' },
    { id: 'td-q6-3', objective: 'td-o5', skill: 'disclosures', difficulty: 2, qtype: 'single_choice', stem: 'Why record the date of each disclosure you rely on?', options: ['For decoration', 'Projects change allocations, contracts and documents; a claim is only valid as of its date', 'Dates affect the token price', 'Regulators require it'], correct: { index: 1 }, explanation: 'Documentation changes; dated sources keep analysis honest.', misconception: 'Treating documentation as permanent.' },
  ],
};

export const TOKENOMICS_DETECTIVE: SourceCourse = {
  id: 'tokenomics-detective',
  position: 6,
  title: 'ATLAS: TOKENOMICS DETECTIVE',
  tagline: 'How token supply and incentives shape what you are analysing.',
  description: 'Learn to read supply figures and fully diluted valuation, model issuance, burns and vesting, judge incentives and governance, and test project claims against evidence.',
  audience: 'Learners who know what tokens, market capitalisation and supply are and want to analyse a token’s design.',
  prerequisites: 'CRYPTO MARKET DECODER, or equivalent knowledge of supply, market capitalisation and stablecoins.',
  preceding: 'crypto-decoder',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'td-o1', statement: 'Distinguish circulating, total and maximum supply and interpret fully diluted valuation.', skill: 'supply_fdv' },
    { id: 'td-o2', statement: 'Model issuance, emissions and burns and their net effect on supply.', skill: 'issuance_burn' },
    { id: 'td-o3', statement: 'Analyse vesting schedules and the size of unlocks relative to circulating supply.', skill: 'vesting' },
    { id: 'td-o4', statement: 'Evaluate protocol incentives and governance power, including who bears the cost.', skill: 'incentives_governance' },
    { id: 'td-o5', statement: 'Test utility claims and project disclosures against evidence and market structure.', skill: 'disclosures' },
  ],
  modules: [
    { id: 'td-m1', title: 'Supply', summary: 'Three supply definitions, FDV, issuance and burns.', lessons: [TD1, TD2] },
    { id: 'td-m2', title: 'Schedules and incentives', summary: 'Vesting and unlocks, incentive costs and governance.', lessons: [TD3, TD4] },
    { id: 'td-m3', title: 'Claims and evidence', summary: 'Utility claims, market structure and disclosure checklists.', lessons: [TD5, TD6] },
  ],
  diagnostic: [
    { id: 'td-d01', skill: 'supply_fdv', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'Market capitalisation is calculated with which supply?', options: ['Maximum', 'Total', 'Circulating', 'Burned'], correct: { index: 2 }, explanation: 'Market cap = price × circulating supply.', misconception: 'Using maximum supply.' },
    { id: 'td-d02', skill: 'supply_fdv', difficulty: 2, qtype: 'numeric', stem: 'Price $1, circulating 200 M, maximum 800 M. What is FDV, in $ millions?', correct: { value: 800, abs_tol: 0.01 }, explanation: '800 M × $1 = $800 M.', misconception: 'Using circulating supply.' },
    { id: 'td-d03', skill: 'issuance_burn', difficulty: 2, qtype: 'single_choice', stem: 'A token burns more per month than it issues. Its supply is…', options: ['Growing', 'Shrinking', 'Fixed', 'Unknown in principle'], correct: { index: 1 }, explanation: 'Net change is negative.', misconception: 'Ignoring burns.' },
    { id: 'td-d04', skill: 'vesting', difficulty: 2, qtype: 'numeric', critical: true, stem: '120 M tokens vest linearly over 12 months after the cliff. How many unlock per month, in millions?', correct: { value: 10, abs_tol: 0.01 }, explanation: '120 ÷ 12 = 10.', misconception: 'Including the cliff months.' },
    { id: 'td-d05', skill: 'vesting', difficulty: 1, qtype: 'single_choice', stem: 'During a vesting cliff:', options: ['Tokens unlock daily', 'No tokens unlock', 'All tokens unlock at once', 'Tokens are burned'], correct: { index: 1 }, explanation: 'The cliff is the initial period with no unlocks.', misconception: 'Confusing cliff and vesting.' },
    { id: 'td-d06', skill: 'incentives_governance', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'Rewards paid in newly issued tokens are funded by:', options: ['Nobody', 'Existing holders, through dilution', 'The government', 'Exchanges'], correct: { index: 1 }, explanation: 'New supply dilutes holders.', misconception: 'Treating issuance as free.' },
    { id: 'td-d07', skill: 'incentives_governance', difficulty: 3, qtype: 'single_choice', stem: 'Voting power in token governance usually depends on:', options: ['One person, one vote', 'Token balances', 'Length of membership', 'Social-media following'], correct: { index: 1 }, explanation: 'Votes are weighted by tokens held or delegated.', misconception: 'Assuming democratic one-person-one-vote.' },
    { id: 'td-d08', skill: 'disclosures', difficulty: 2, qtype: 'single_choice', stem: 'A whitepaper claims a token is essential. The best evidence for or against is:', options: ['The whitepaper itself', 'On-chain usage and the protocol’s actual mechanics', 'The token’s price', 'Celebrity endorsements'], correct: { index: 1 }, explanation: 'Observed behaviour beats claims.', misconception: 'Accepting claims as evidence.' },
    { id: 'td-d09', skill: 'disclosures', difficulty: 2, qtype: 'single_choice', stem: 'Who can upgrade or pause a protocol’s contracts is important because:', options: ['It changes the logo', 'Those keys can change rules or freeze funds', 'It sets the price', 'It is not important'], correct: { index: 1 }, explanation: 'Admin powers are a concentration of control and risk.', misconception: 'Ignoring admin keys.' },
    { id: 'td-d10', skill: 'percentages', difficulty: 1, qtype: 'numeric', stem: 'Circulating supply rises from 400 M to 420 M. Percentage increase?', correct: { value: 5, abs_tol: 0.01 }, explanation: '20 ÷ 400 = 5%.', misconception: 'Dividing by the new value.' },
  ],
};

// ═════════════════════════════ ON-CHAIN SIGNAL ENGINEER ═════════════════════════════

const OE1: SourceLesson = {
  id: 'oe-l1', title: 'Blocks, transactions and events as data', minutes: 16, objectives: ['oe-o1'], mastery_rule: RULE('oe-o1'), references: [ETH_DOCS, { title: 'Bitcoin developer reference', url: 'https://developer.bitcoin.org/reference/', note: 'Official reference for Bitcoin blocks, transactions and RPC calls.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Two ledger models', body: [
      'Bitcoin uses unspent transaction outputs (UTXOs): a transaction consumes earlier outputs and creates new ones. A “balance” is the sum of outputs an address can spend, computed by the reader.',
      'Ethereum uses accounts with balances and contract storage. Transactions call contracts; contracts emit event logs (for example a token Transfer event) that indexers read to reconstruct token movements.',
      'Raw chain data is precise but low-level. Every metric (active addresses, volume transferred) is a choice about how to aggregate it, and those choices change the answer.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Inspect stored blocks', href: '/app/crypto/onchain', steps: [
      'Compare one Bitcoin block and one Ethereum block in ATLAS: which fields exist for each network and which are “not available”?',
      'Open a block in the public explorer via the height link and find the same height, time and transaction count.',
      'Note why ATLAS shows Ethereum total fees per block as unavailable: it would need a receipt for every transaction.',
    ], alt_text: 'Two block tables for Bitcoin and Ethereum with different fields, and a link from each block height to the network’s public explorer.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A Bitcoin transaction spends one 1.0 BTC output to pay 0.3 BTC. Fee is 0.0001 BTC. What happens to the rest?', options: ['It disappears', 'It returns to the sender as a new “change” output', 'The miner keeps it'], answer: 1, reveal: 'Outputs are spent whole: 0.3 to the recipient, 0.6999 back as change, 0.0001 left as the fee for the miner.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Why “transfer volume” is slippery', steps: [
      'The 1.0 BTC transaction above moves 1.0 BTC of outputs, but only 0.3 BTC changes hands.',
      'Counting all outputs gives “volume” of 0.9999 BTC; excluding change gives 0.3 BTC.',
      'Identifying change requires heuristics that can be wrong, so different analytics firms report different volumes for the same day.',
      'Lesson: always ask how a chain metric was built before comparing it across sources.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'An output of 2.5 BTC pays 1.2 BTC with a 0.0005 BTC fee. How much is the change output?', hint: 'Input = payment + change + fee.', answer_text: '2.5 − 1.2 − 0.0005 = 1.2995 BTC.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why might two analytics providers report different daily transfer volumes for the same chain?', model_answer: 'They make different choices: whether to exclude change outputs, internal exchange movements or contract calls, and which heuristics to use, so the same raw data yields different aggregates.' },
    { stage: 'review', kind: 'summary', points: ['Bitcoin uses UTXOs; Ethereum uses accounts and event logs.', 'Metrics are aggregation choices on top of raw data.', 'Compare chain metrics only when their construction matches.'] },
  ],
  quiz: [
    { id: 'oe-q1-1', objective: 'oe-o1', skill: 'chain_data', difficulty: 2, qtype: 'numeric', stem: 'An output of 2.5 BTC pays 1.2 BTC with a fee of 0.0005 BTC. What is the change output, in BTC?', correct: { value: 1.2995, abs_tol: 0.00001, unit: 'BTC' }, explanation: '2.5 − 1.2 − 0.0005 = 1.2995.', misconception: 'Forgetting the fee.' },
    { id: 'oe-q1-2', objective: 'oe-o1', skill: 'chain_data', difficulty: 2, qtype: 'single_choice', stem: 'How do indexers usually reconstruct ERC-20 token transfers on Ethereum?', options: ['From Bitcoin UTXOs', 'From the Transfer event logs emitted by token contracts', 'From exchange order books', 'From account nicknames'], correct: { index: 1 }, explanation: 'Token contracts emit Transfer events that indexers read.', misconception: 'Thinking token balances are native fields of an account.' },
    { id: 'oe-q1-3', objective: 'oe-o1', skill: 'chain_data', difficulty: 3, qtype: 'single_choice', stem: 'Counting every output in a Bitcoin transaction as “volume” tends to…', options: ['Understate volume', 'Overstate the value actually changing hands, because change returns to the sender', 'Be exactly right', 'Count fees twice'], correct: { index: 1 }, explanation: 'Change outputs inflate naïve volume.', misconception: 'Assuming outputs equal payments.' },
  ],
};

const OE2: SourceLesson = {
  id: 'oe-l2', title: 'Network metrics and what they do not measure', minutes: 14, objectives: ['oe-o2'], prerequisites: ['oe-l1'], mastery_rule: RULE('oe-o2'), references: [ETH_DOCS, { title: 'mempool.space REST API documentation', url: 'https://mempool.space/docs/api/rest', note: 'Source of ATLAS’s Bitcoin block and fee data.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Activity is not adoption', body: [
      'Common network metrics: transaction count, active addresses, fees paid, block utilisation (gas used ÷ gas limit), validator or miner counts, stablecoin transfers.',
      'Each is easy to inflate or misread. One person can use thousands of addresses; one exchange address serves millions of people; bots generate transactions; low fees invite spam.',
      'Fees are harder to fake because someone pays them, which is why fee data is often a better signal of demand for block space than raw counts. Even so, fees depend on design (a cheap chain has low fees by intent).',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Who produces blocks?', widget: 'consensus_3d', intro: 'See how block production depends on hash power or stake, and how many confirmations it takes before reversing a block becomes unlikely.', alt_text: 'A ring of five 3D columns for block producers, sized by blocks produced out of 1,000, with sliders for each producer’s share and a calculator for the probability an attacker catches up.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Daily active addresses double in a week while total fees stay flat. Which explanation fits best?', options: ['Twice as many people use the network', 'Activity that pays little, such as many small automated transfers or address rotation, rose', 'Fees are being refunded'], answer: 1, reveal: 'More addresses with no more fees points to cheap, possibly automated activity rather than more paying users.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Utilisation from block data', steps: [
      'Ten Ethereum blocks used 18 M, 30 M, 14 M, 22 M, 30 M, 16 M, 20 M, 25 M, 12 M and 13 M gas against a 30 M limit.',
      'Total used = 200 M of 300 M available: utilisation = 66.7%.',
      'Ethereum’s base fee rises when blocks are more than half full and falls when less, so utilisation and fees move together.',
      'ATLAS computes the same mean from its stored window and states the window in the metric’s label.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Blocks used 15 M, 27 M and 18 M gas with a 30 M limit. Average utilisation?', hint: 'Sum used ÷ sum of limits.', answer_text: '60 M ÷ 90 M = 66.7%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why are fees often a better demand signal than active addresses?', model_answer: 'Fees cost real money, so they reflect willingness to pay for block space; addresses are free to create and can be multiplied by bots or a single user.' },
    { stage: 'review', kind: 'summary', points: ['Transaction and address counts measure activity, not users or adoption.', 'Fees reflect paid demand, within the chain’s design.', 'State the window and definition of every network metric.'] },
  ],
  quiz: [
    { id: 'oe-q2-1', objective: 'oe-o2', skill: 'network_metrics', difficulty: 2, qtype: 'numeric', stem: 'Three blocks used 15 M, 27 M and 18 M gas with a 30 M limit each. Average utilisation, in percent?', correct: { value: 66.67, abs_tol: 0.05, unit: '%' }, explanation: '60 ÷ 90 = 66.67%.', misconception: 'Dividing by one block’s limit.' },
    { id: 'oe-q2-2', objective: 'oe-o2', skill: 'network_metrics', difficulty: 2, qtype: 'single_choice', stem: 'Why is “active addresses” a weak measure of users?', options: ['It is always zero', 'One user can control many addresses, and one exchange address can serve many users', 'Addresses are secret', 'It only counts miners'], correct: { index: 1 }, explanation: 'Addresses are not people.', misconception: 'Equating addresses with users.' },
    { id: 'oe-q2-3', objective: 'oe-o2', skill: 'network_metrics', difficulty: 3, qtype: 'single_choice', stem: 'Transaction count rises 50% while total fees are unchanged on a chain with very low fees. A careful reading is…', options: ['Adoption grew 50%', 'Cheap activity grew; it may be automated and does not show more paying users', 'Fees are mis-measured', 'The chain is congested'], correct: { index: 1 }, explanation: 'Low-cost chains make it cheap to generate transactions.', misconception: 'Reading raw counts as adoption.' },
  ],
};

const OE3: SourceLesson = {
  id: 'oe-l3', title: 'Cleaning and aligning crypto time series', minutes: 16, objectives: ['oe-o3'], prerequisites: ['oe-l1'], mastery_rule: RULE('oe-o3'), references: [{ title: 'Binance Spot API documentation', url: 'https://developers.binance.com/docs/binance-spot-api-docs', note: 'Kline (candle) definitions: open time, close time and UTC intervals.' }, DEFILLAMA],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Garbage in, confident garbage out', body: [
      'Before analysing, check: duplicate timestamps, impossible candles (high below low), missing days, time-zone conventions, units, and whether two series are from the same venue and quote currency.',
      'Crypto daily candles are usually UTC days. Indian equity sessions close at 15:30 IST (10:00 UTC), so a “daily” crypto close and an equity close are about 14 hours apart.',
      'Never fill a gap with an invented value. Leave it missing and use methods that handle gaps; ATLAS does not compute a daily return across a missing day.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'See how ATLAS validates data', href: '/app/crypto/sources', steps: [
      'Open Sources & health and read the coverage table: series, observations, earliest and latest dates per source.',
      'Read the quarantine list: records rejected with a reason, never silently dropped.',
      'Open an asset’s price chart, choose “All stored” and look for a gap warning or flagged extreme moves in the table view.',
    ], alt_text: 'The Sources & health page with coverage per source, job freshness, provider documentation and a list of quarantined records with reasons.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A daily series has prices on Monday and Wednesday but not Tuesday. What is a valid daily return for Wednesday?', options: ['Wednesday ÷ Monday − 1', 'None: there is no Tuesday close, so the one-day return is undefined', 'Zero'], answer: 1, reveal: 'Wednesday ÷ Monday is a two-day return. Treating it as one day inflates volatility estimates and misaligns correlations.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Aligning two series', steps: [
      'Series A (Binance BTC/USDT) has days 1–10; series B (Coinbase ETH/USD) is missing day 6.',
      'Daily returns exist for A on days 2–10 (9 returns) and for B on days 2–5 and 8–10 (7 returns; day 6 and day 7 need day 6).',
      'Correlation uses only days where both have a return: days 2–5 and 8–10, 7 pairs.',
      'Mixing a Binance series with a Coinbase series also mixes venues and quote currencies; ATLAS’s matrix uses one source for all assets for that reason.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A series of 30 consecutive days is missing days 10 and 20. How many one-day returns can be computed?', hint: 'Each missing day removes the return into it and the return out of it.', answer_text: 'A full 30-day series has 29 returns; each missing day removes 2, so 29 − 4 = 25.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why should a crypto-versus-equity correlation state how the two calendars were aligned?', model_answer: 'Crypto trades every day in UTC days while equities trade on sessions with holidays and close at a different time, so different alignment choices produce different returns and correlations.' },
    { stage: 'review', kind: 'summary', points: ['Validate before you analyse: duplicates, impossible values, gaps, units, time zones.', 'Never fill gaps with invented values; skip returns across gaps.', 'Align series on the same calendar, venue and quote currency, and say how.'] },
  ],
  quiz: [
    { id: 'oe-q3-1', objective: 'oe-o3', skill: 'data_cleaning', difficulty: 2, qtype: 'numeric', stem: 'A 30-day daily series is missing days 10 and 20 (not adjacent). How many one-day returns can be computed?', correct: { value: 25, abs_tol: 0 }, explanation: '29 − 2 × 2 = 25.', misconception: 'Subtracting only one return per missing day.' },
    { id: 'oe-q3-2', objective: 'oe-o3', skill: 'data_cleaning', difficulty: 1, qtype: 'single_choice', stem: 'A candle shows a high below its low. What should a data pipeline do?', options: ['Swap the two values', 'Reject or quarantine the record with a reason', 'Set both to the close', 'Keep it as is'], correct: { index: 1 }, explanation: 'An impossible record is quarantined, not repaired by guesswork.', misconception: 'Silently fixing data.' },
    { id: 'oe-q3-3', objective: 'oe-o3', skill: 'data_cleaning', difficulty: 3, qtype: 'single_choice', stem: 'A crypto daily candle (UTC day) is compared with an NSE closing price for the same date. Roughly how far apart are the two closes in time?', options: ['They are simultaneous', 'About 14 hours', 'About 2 hours', 'One week'], correct: { index: 1 }, explanation: 'NSE closes at 10:00 UTC; the UTC day ends at 24:00 UTC.', misconception: 'Assuming “daily” means the same moment.' },
  ],
};

const OE4: SourceLesson = {
  id: 'oe-l4', title: 'Volatility and correlation done properly', minutes: 16, objectives: ['oe-o4'], prerequisites: ['oe-l3'], mastery_rule: RULE('oe-o4'), references: [{ title: 'ATLAS: Digital Assets → Research (correlation matrix and formulas)', note: 'The formulas, windows and minimum observation counts ATLAS uses.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Specify every choice', body: [
      'Realised volatility needs: return type (log or simple), sampling interval (daily), window (30 or 90 days), annualisation (√365 for crypto) and a minimum number of observations.',
      'Correlation measures how two return series move together, from −1 to +1, over a window. It changes over time, is sensitive to outliers and says nothing about cause.',
      'Beta against a benchmark (often bitcoin) = covariance ÷ benchmark variance: how much an asset moved, on average, per unit move of the benchmark.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Volatility clusters in stored history', widget: 'quant_3d', intro: 'Look at rolling volatility and drawdowns calculated from stored daily candles. Where do high-volatility periods sit relative to deep drawdowns?', alt_text: 'A 3D chart of rolling 30-day volatility columns in front of drawdown columns from stored Bitcoin history, labelled with the source series.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Two assets have a 90-day correlation of 0.85. What can you conclude?', options: ['One causes the other', 'Their daily returns tended to move in the same direction over those 90 days', 'They will stay correlated'], answer: 1, reveal: 'Correlation describes co-movement in the window only. It can change quickly, often rising in market-wide sell-offs.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Beta by hand', steps: [
      'Benchmark daily returns: +2%, −1%, +3%, −2%. Asset: +3%, −2%, +5%, −4%.',
      'Means: benchmark 0.5%, asset 0.5%.',
      'Covariance (sample): [(1.5)(2.5) + (−1.5)(−2.5) + (2.5)(4.5) + (−2.5)(−4.5)] ÷ 3 = (3.75 + 3.75 + 11.25 + 11.25) ÷ 3 = 10.0 (in %²).',
      'Benchmark variance: (2.25 + 2.25 + 6.25 + 6.25) ÷ 3 = 5.667. Beta = 10.0 ÷ 5.667 ≈ 1.76.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Covariance of an asset with bitcoin is 6 (%²) and bitcoin’s variance is 4 (%²). Beta?', hint: 'Beta = covariance ÷ benchmark variance.', answer_text: '6 ÷ 4 = 1.5.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why should a correlation always come with its window and number of observations?', model_answer: 'Correlation changes with the period and is unreliable with few observations; without the window and count a reader cannot judge how stable or meaningful it is.' },
    { stage: 'review', kind: 'summary', points: ['State return type, window, annualisation and minimum observations.', 'Correlation is window-dependent co-movement, not causation.', 'Beta = covariance ÷ benchmark variance.'] },
  ],
  quiz: [
    { id: 'oe-q4-1', objective: 'oe-o4', skill: 'quant_methods', difficulty: 2, qtype: 'numeric', stem: 'Covariance with bitcoin is 6 (%²); bitcoin’s variance is 4 (%²). What is the asset’s beta?', correct: { value: 1.5, abs_tol: 0.001 }, explanation: '6 ÷ 4 = 1.5.', misconception: 'Dividing variance by covariance.' },
    { id: 'oe-q4-2', objective: 'oe-o4', skill: 'quant_methods', difficulty: 2, qtype: 'single_choice', stem: 'A 90-day correlation of 0.85 between two assets means…', options: ['One drives the other', 'Their daily returns tended to move together over those 90 days', 'They will move together next month', 'They have similar prices'], correct: { index: 1 }, explanation: 'Correlation is descriptive and window-specific.', misconception: 'Reading correlation as causation or prediction.' },
    { id: 'oe-q4-3', objective: 'oe-o4', skill: 'quant_methods', difficulty: 3, qtype: 'numeric', stem: 'Daily log returns over 4 days: +2%, −2%, +2%, −2%. What is the sample standard deviation, in percent? (Mean is 0.)', correct: { value: 2.309, abs_tol: 0.01, unit: '%' }, explanation: 'Sum of squares = 16; ÷ (4 − 1) = 5.333; √5.333 = 2.309%.', misconception: 'Dividing by n instead of n − 1 (giving 2%).' },
  ],
};

const OE5: SourceLesson = {
  id: 'oe-l5', title: 'Event studies', minutes: 15, objectives: ['oe-o4'], prerequisites: ['oe-l4'], mastery_rule: RULE('oe-o4'), references: [{ title: 'MacKinlay, “Event Studies in Economics and Finance” (Journal of Economic Literature, 1997)', url: 'https://www.jstor.org/stable/2729691', note: 'The standard reference for event-study methodology.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Measuring what happened around an event', body: [
      'An event study measures returns around a dated event (a network upgrade, a listing change, a software release) relative to what was expected without it.',
      'Steps: define the event time precisely (publication time, not when you noticed it); choose an estimation window before the event to set “normal” returns (for example the average or a beta-adjusted benchmark return); measure abnormal returns in an event window; add them up.',
      'Crypto makes this hard: news often leaks early, events are announced long before they happen, and the whole market moves together. One event proves little; patterns need many comparable events.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Find datable events', href: '/app/crypto/events', steps: [
      'Open Events and filter to software releases or network upgrades.',
      'Note the publication time (source time) and whether the event happened then or later (an upgrade can be announced weeks ahead).',
      'Open the related asset’s price chart and find the date; remember that a chart alone cannot separate the event from market-wide moves.',
    ], alt_text: 'The events feed filtered by category, each item with its source publication time, category, linked source and associated networks.' },
    { stage: 'predict', kind: 'prediction', prompt: 'An asset rose 6% on the day of an upgrade. Bitcoin rose 5% that day and the asset’s beta to bitcoin is 1.2. What is the abnormal return?', options: ['+6%', '0%', '+1%'], answer: 1, reveal: 'Expected = 1.2 × 5% = 6%; abnormal = 6% − 6% = 0%. The whole market moved; the upgrade added nothing measurable.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Cumulative abnormal return', steps: [
      'Event window: days −1, 0, +1. Asset returns: +3%, +6%, −1%. Benchmark: +2%, +5%, −2%. Beta = 1.0.',
      'Abnormal returns: +1%, +1%, +1%.',
      'Cumulative abnormal return (CAR) = +3% over three days.',
      'With crypto volatility of several percent a day, +3% is well within normal noise for one event: it is weak evidence on its own.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Beta 0.8, benchmark +4%, asset +2% on the event day. Abnormal return?', hint: 'Abnormal = actual − beta × benchmark.', answer_text: '2% − 0.8 × 4% = 2% − 3.2% = −1.2%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why does it matter whether you date an event by its publication time or by when the change took effect?', model_answer: 'Prices can react when information becomes public, not when the change happens; using the wrong date measures returns in the wrong window and misses or misattributes the effect.' },
    { stage: 'review', kind: 'summary', points: ['Abnormal return = actual − expected (often beta × benchmark).', 'Date events by when information became public.', 'Single events are weak evidence; crypto moves together and is noisy.'] },
  ],
  quiz: [
    { id: 'oe-q5-1', objective: 'oe-o4', skill: 'quant_methods', difficulty: 2, qtype: 'numeric', stem: 'Beta 0.8, benchmark return +4%, asset return +2% on the event day. Abnormal return, in percent?', correct: { value: -1.2, abs_tol: 0.001, unit: '%' }, explanation: '2 − 0.8 × 4 = −1.2.', misconception: 'Subtracting the benchmark without beta.' },
    { id: 'oe-q5-2', objective: 'oe-o4', skill: 'quant_methods', difficulty: 2, qtype: 'single_choice', stem: 'Why is one event a weak basis for a conclusion?', options: ['Events are always fake', 'Daily crypto returns are noisy and market-wide moves dominate, so one abnormal return is easily chance', 'Event studies need exactly two events', 'Prices do not react to news'], correct: { index: 1 }, explanation: 'Noise swamps a single observation; patterns need many events.', misconception: 'Generalising from one case.' },
    { id: 'oe-q5-3', objective: 'oe-o4', skill: 'quant_methods', difficulty: 3, qtype: 'single_choice', stem: 'An upgrade was announced on 1 March and activated on 15 March. When would you expect a price reaction to new information?', options: ['Only on 15 March', 'Mainly around 1 March, when the information became public', 'On neither date', 'Exactly one month later'], correct: { index: 1 }, explanation: 'Markets react to information when it is published.', misconception: 'Dating by activation instead of announcement.' },
  ],
};

const OE6: SourceLesson = {
  id: 'oe-l6', title: 'Backtesting without fooling yourself', minutes: 17, objectives: ['oe-o5'], prerequisites: ['oe-l4'], mastery_rule: RULE('oe-o5'), references: [HARVEY],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'The biases that make backtests look good', body: [
      'Look-ahead bias: using information that was not available at the time (for example acting on a day’s close at that same close).',
      'Survivorship bias: testing only assets that still exist today; the many that failed or were delisted are missing.',
      'Data snooping and overfitting: trying many rules or parameters and reporting the best. With enough tries, something always looks good by chance.',
      'Costs and liquidity: fees, slippage and thin markets can erase a paper edge. Time-zone and interval mistakes create fake signals.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Run an honest backtest', href: '/app/crypto/research', steps: [
      'In Research, run the moving-average trend backtest on bitcoin with 50/200 days and 10 bp fees plus 5 bp slippage.',
      'Change the windows three times and note how much the result moves: that spread is what data snooping exploits.',
      'Read the assumptions list; note that execution happens at the next day’s close to avoid look-ahead.',
    ], alt_text: 'The Research page backtest form with fast and slow windows and cost inputs, a results table comparing the trend rule with buy and hold, two growth-of-1 charts and a list of assumptions and biases.' },
    { stage: 'predict', kind: 'prediction', prompt: 'You test 100 rules with no real edge at a 5% significance level. How many would you expect to look “significant” by chance?', options: ['0', 'About 5', 'About 50'], answer: 1, reveal: '100 × 5% = 5 false positives on average: the best of those will look impressive and mean nothing.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Costs on a frequent strategy', steps: [
      'A rule trades 60 times a year (each trade is a change of position).',
      'Fees 10 bp + slippage 10 bp = 20 bp per trade.',
      'Annual cost ≈ 60 × 0.20% = 12% of equity, before any edge.',
      'A backtest showing 10% a year before costs would lose about 2% a year after them.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: '40 trades a year at 15 bp all-in cost each. Approximate annual cost drag?', hint: 'Trades × cost per trade.', answer_text: '40 × 0.15% = 6% a year.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Name two ways to reduce the risk that a backtest result is a false discovery.', model_answer: 'Decide the rule and parameters before looking at the test period (or test on a held-out period), count every variant tried and adjust for multiple testing, and include realistic costs.' },
    { stage: 'review', kind: 'summary', points: ['Look-ahead, survivorship and data snooping all flatter backtests.', 'Costs scale with trading frequency and can erase a paper edge.', 'Past backtest performance does not predict future results.'] },
  ],
  quiz: [
    { id: 'oe-q6-1', objective: 'oe-o5', skill: 'backtesting_bias', difficulty: 2, qtype: 'numeric', stem: 'A rule trades 40 times a year at 15 bp all-in per trade. Approximate annual cost drag, in percent?', correct: { value: 6, abs_tol: 0.01, unit: '%' }, explanation: '40 × 0.15% = 6%.', misconception: 'Forgetting that every trade pays costs.' },
    { id: 'oe-q6-2', objective: 'oe-o5', skill: 'backtesting_bias', difficulty: 2, qtype: 'single_choice', stem: 'A backtest buys at the same day’s close on which its signal is calculated from that close. This is…', options: ['Fine', 'Look-ahead bias: the signal is not known until the close has happened', 'Survivorship bias', 'Slippage'], correct: { index: 1 }, explanation: 'Executing on information that only exists at that moment cannot be done in reality.', misconception: 'Ignoring execution timing.' },
    { id: 'oe-q6-3', objective: 'oe-o5', skill: 'backtesting_bias', difficulty: 3, qtype: 'single_choice', stem: 'Testing a strategy only on the 20 largest coins today, over the last eight years, mainly introduces…', options: ['Look-ahead bias', 'Survivorship bias: coins that were large eight years ago and later failed are excluded', 'Lower costs', 'Nothing'], correct: { index: 1 }, explanation: 'Today’s winners are known only with hindsight.', misconception: 'Using today’s universe for past tests.' },
  ],
};

export const ONCHAIN_ENGINEER: SourceCourse = {
  id: 'onchain-engineer',
  position: 7,
  title: 'ATLAS: ON-CHAIN SIGNAL ENGINEER',
  tagline: 'Analyse blockchain and market data quantitatively, without fooling yourself.',
  description: 'Work with blocks, transactions and events as data, judge network metrics, clean and align time series, measure volatility and correlation, run event studies and backtests, and recognise the biases that make results look better than they are.',
  audience: 'Learners comfortable with returns, volatility and basic statistics who want to analyse crypto data.',
  prerequisites: 'TOKENOMICS DETECTIVE, or equivalent; comfort with averages, standard deviation and percentages.',
  preceding: 'tokenomics-detective',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'oe-o1', statement: 'Interpret blocks, transactions, UTXOs, accounts and event logs as data.', skill: 'chain_data' },
    { id: 'oe-o2', statement: 'Judge what network metrics measure and what they do not.', skill: 'network_metrics' },
    { id: 'oe-o3', statement: 'Validate, clean and align crypto time series without inventing data.', skill: 'data_cleaning' },
    { id: 'oe-o4', statement: 'Calculate and interpret volatility, correlation, beta and event-study abnormal returns.', skill: 'quant_methods' },
    { id: 'oe-o5', statement: 'Design and read backtests that account for look-ahead, survivorship, snooping and costs.', skill: 'backtesting_bias' },
  ],
  modules: [
    { id: 'oe-m1', title: 'Reading chain data', summary: 'Ledger models, events and what network metrics really measure.', lessons: [OE1, OE2] },
    { id: 'oe-m2', title: 'Clean data, sound statistics', summary: 'Validation and alignment, then volatility, correlation and beta.', lessons: [OE3, OE4] },
    { id: 'oe-m3', title: 'Testing ideas', summary: 'Event studies and honest backtests.', lessons: [OE5, OE6] },
  ],
  diagnostic: [
    { id: 'oe-d01', skill: 'chain_data', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'In Bitcoin’s UTXO model, a “balance” is:', options: ['A field stored on each address', 'The sum of unspent outputs an address can spend', 'Set by miners', 'Stored by exchanges'], correct: { index: 1 }, explanation: 'Balances are computed from unspent outputs.', misconception: 'Assuming account balances exist natively.' },
    { id: 'oe-d02', skill: 'network_metrics', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'Active addresses are a weak measure of users because:', options: ['They are random', 'One user can control many addresses and one address can serve many users', 'They exclude fees', 'They are private'], correct: { index: 1 }, explanation: 'Addresses are not people.', misconception: 'Equating addresses with users.' },
    { id: 'oe-d03', skill: 'data_cleaning', difficulty: 2, qtype: 'single_choice', stem: 'A missing day in a daily price series should be:', options: ['Filled with the previous close', 'Left missing, with no one-day return computed across it', 'Filled with zero', 'Filled with the average'], correct: { index: 1 }, explanation: 'Invented values distort statistics.', misconception: 'Filling gaps silently.' },
    { id: 'oe-d04', skill: 'quant_methods', difficulty: 2, qtype: 'numeric', critical: true, stem: 'Covariance 9 (%²), benchmark variance 6 (%²). Beta?', correct: { value: 1.5, abs_tol: 0.001 }, explanation: '9 ÷ 6 = 1.5.', misconception: 'Inverting the ratio.' },
    { id: 'oe-d05', skill: 'quant_methods', difficulty: 1, qtype: 'single_choice', stem: 'A correlation of −0.9 means the two return series…', options: ['Are unrelated', 'Tended to move in opposite directions', 'Have opposite prices', 'Will diverge'], correct: { index: 1 }, explanation: 'Negative correlation means opposite co-movement.', misconception: 'Confusing returns with price levels.' },
    { id: 'oe-d06', skill: 'backtesting_bias', difficulty: 2, qtype: 'numeric', stem: 'You test 40 rules with no edge at the 5% level. Expected false positives?', correct: { value: 2, abs_tol: 0.001 }, explanation: '40 × 0.05 = 2.', misconception: 'Expecting none.' },
    { id: 'oe-d07', skill: 'backtesting_bias', difficulty: 2, qtype: 'single_choice', stem: 'Testing only coins that exist today introduces:', options: ['Look-ahead bias', 'Survivorship bias', 'Lower variance', 'Nothing'], correct: { index: 1 }, explanation: 'Failed coins are missing from the sample.', misconception: 'Ignoring delisted assets.' },
    { id: 'oe-d08', skill: 'data_cleaning', difficulty: 3, qtype: 'single_choice', stem: 'Crypto daily candles usually close at:', options: ['15:30 IST', '00:00 UTC', 'Market close in New York', 'Different times per coin'], correct: { index: 1 }, explanation: 'Most venues use UTC days.', misconception: 'Assuming exchange-session times.' },
    { id: 'oe-d09', skill: 'network_metrics', difficulty: 3, qtype: 'single_choice', stem: 'Which on-chain figure is hardest to inflate cheaply?', options: ['Active addresses', 'Transaction count', 'Total fees paid', 'Number of tokens created'], correct: { index: 2 }, explanation: 'Fees cost money to generate.', misconception: 'Trusting free-to-generate counts.' },
    { id: 'oe-d10', skill: 'percentages', difficulty: 1, qtype: 'numeric', stem: '30 trades a year at 0.2% cost each. Annual cost drag, in percent?', correct: { value: 6, abs_tol: 0.001 }, explanation: '30 × 0.2 = 6.', misconception: 'Ignoring trade frequency.' },
  ],
};

// ═════════════════════════════ DIGITAL ASSET ARCHITECT ═════════════════════════════

const AA1: SourceLesson = {
  id: 'aa-l1', title: 'Protocol economics: TVL, fees and revenue', minutes: 16, objectives: ['aa-o2'], mastery_rule: RULE('aa-o2'), references: [DEFILLAMA],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Three numbers, three meanings', body: [
      'Total value locked (TVL): the value of assets deposited in a protocol’s contracts. It measures capital parked there, priced at market; it rises and falls with token prices even if nobody deposits or withdraws.',
      'Fees: what users pay to use the protocol. Revenue: the part of fees the protocol or its token holders keep; the rest usually goes to liquidity providers or other participants.',
      'Definitions come from each data provider’s methodology. Comparing a protocol’s “revenue” with a company’s revenue, or summing TVL across protocols that deposit into each other, double counts or mislabels.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read a protocol profile', href: '/app/crypto/defi', steps: [
      'Open the largest protocol on the DeFi page; read TVL history, 30-day fees and 30-day revenue and their definitions.',
      'Compute revenue ÷ fees (the share kept) and fees ÷ TVL (how much activity the capital generates).',
      'Note the provider (DefiLlama) and that these figures are not comparable with company accounts.',
    ], alt_text: 'A protocol profile showing a two-year TVL chart, 30-day fees and revenue with daily charts, and DefiLlama’s definitions of each metric.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A protocol’s TVL fell 30% in a month in which no user withdrew anything. How?', options: ['Impossible', 'The prices of the deposited tokens fell', 'Fees were refunded'], answer: 1, reveal: 'TVL is priced at market: if deposited tokens lose 30% of their value, TVL falls 30% with no withdrawals.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Capital efficiency', steps: [
      'Protocol A: TVL $2 B, annualised fees $100 M. Protocol B: TVL $500 M, annualised fees $75 M.',
      'Fees ÷ TVL: A = 5%, B = 15%.',
      'B generates more activity per dollar deposited, but its revenue share and risks may differ, and both figures come from one provider’s adapters.',
      'Fees ÷ TVL is a description of activity, not a return that depositors earn.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Annual fees $40 M, of which $12 M is revenue. TVL $800 M. Revenue share of fees and fees ÷ TVL?', hint: 'Two divisions.', answer_text: 'Revenue share = 12 ÷ 40 = 30%; fees ÷ TVL = 40 ÷ 800 = 5%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why can summing the TVL of many protocols overstate the capital in DeFi?', model_answer: 'Assets deposited in one protocol are often redeposited in another (for example a liquid-staking token used as collateral), so the same capital is counted more than once.' },
    { stage: 'review', kind: 'summary', points: ['TVL is market-priced deposited capital, not money earned.', 'Revenue is the share of fees the protocol keeps.', 'Use one provider’s definitions consistently and beware double counting.'] },
  ],
  quiz: [
    { id: 'aa-q1-1', objective: 'aa-o2', skill: 'protocol_economics', difficulty: 2, qtype: 'numeric', stem: 'Annual fees $40 M, of which $12 M is protocol revenue. What share of fees does the protocol keep, in percent?', correct: { value: 30, abs_tol: 0.01, unit: '%' }, explanation: '12 ÷ 40 = 30%.', misconception: 'Dividing fees by revenue.' },
    { id: 'aa-q1-2', objective: 'aa-o2', skill: 'protocol_economics', difficulty: 2, qtype: 'single_choice', stem: 'TVL fell 30% in a month with no withdrawals. The likely reason is…', options: ['A data error', 'The market value of the deposited tokens fell', 'Revenue fell', 'TVL is random'], correct: { index: 1 }, explanation: 'TVL moves with token prices.', misconception: 'Reading TVL as a count of deposits.' },
    { id: 'aa-q1-3', objective: 'aa-o2', skill: 'protocol_economics', difficulty: 3, qtype: 'single_choice', stem: 'Why is a protocol’s “revenue” not comparable with a listed company’s revenue?', options: ['It is in a different currency', 'It is a data provider’s definition of fees kept by the protocol, not audited accounting revenue', 'Protocols have no users', 'It is always larger'], correct: { index: 1 }, explanation: 'Definitions and accounting standards differ.', misconception: 'Applying company metrics to protocols.' },
  ],
};

const AA2: SourceLesson = {
  id: 'aa-l2', title: 'DeFi mechanics and their risks', minutes: 17, objectives: ['aa-o2'], prerequisites: ['aa-l1'], mastery_rule: RULE('aa-o2'), references: [DEFILLAMA, { title: 'Uniswap v2 core whitepaper', url: 'https://docs.uniswap.org/whitepaper.pdf', note: 'The constant-product market maker used in the simulation.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Pools, swaps and who carries the risk', body: [
      'An automated market maker (AMM) holds two tokens in a pool and prices swaps with a formula, commonly x · y = k. Liquidity providers deposit both tokens and earn the swap fees.',
      'When prices move, arbitrageurs trade with the pool until its price matches the market. Liquidity providers end up with more of the token that fell and less of the one that rose: impermanent loss relative to simply holding.',
      'Other DeFi risks: smart-contract bugs, oracle manipulation, governance or admin-key changes, liquidation cascades in lending, and bridge failures.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Swap against a pool', widget: 'amm_pool_3d', intro: 'Change the pool size, swap size and fee, then move the price of X to see impermanent loss.', alt_text: 'A 3D view of the constant-product curve with markers for the pool state before and after a swap, sliders for reserves, swap size and fee, and a calculation of impermanent loss.' },
    { stage: 'predict', kind: 'prediction', prompt: 'You swap 10% of a pool’s X reserve into the pool (no fee). Compared with the pool price before the swap, your average price is…', options: ['The same', 'Worse: you receive about 9.1% fewer Y than at the starting price', 'Better'], answer: 1, reveal: 'y · dx ÷ (x + dx) with dx = 0.1x gives 0.0909y instead of 0.1y: about 9.1% less.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Impermanent loss at a 4× move', steps: [
      'Deposit 10 X and 1,000 Y (price 100 Y per X). k = 10,000.',
      'X’s price rises to 400. Arbitrage moves the pool to x = √(k ÷ 400) = 5 and y = √(k × 400) = 2,000.',
      'Pool value = 5 × 400 + 2,000 = 4,000 Y. Holding would be 10 × 400 + 1,000 = 5,000 Y.',
      'Loss versus holding = 4,000 ÷ 5,000 − 1 = −20% = 2√4 ÷ (1 + 4) − 1. Fees earned must exceed this to come out ahead.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Impermanent loss when the price ratio changes by r = 2.25?', hint: 'IL = 2√r ÷ (1 + r) − 1.', answer_text: '2 × 1.5 ÷ 3.25 − 1 = 3 ÷ 3.25 − 1 ≈ −7.7%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is the loss called “impermanent”, and when does it become permanent?', model_answer: 'If the price returns to where it was, the loss disappears; it becomes permanent when the provider withdraws while the price is different.' },
    { stage: 'review', kind: 'summary', points: ['AMMs price swaps by formula; large swaps have large price impact.', 'Liquidity providers face impermanent loss when prices move.', 'Contract, oracle, governance and liquidation risks sit alongside market risk.'] },
  ],
  quiz: [
    { id: 'aa-q2-1', objective: 'aa-o2', skill: 'protocol_economics', difficulty: 3, qtype: 'numeric', stem: 'Impermanent loss when the price ratio changes by r = 4, in percent? (IL = 2√r ÷ (1 + r) − 1)', correct: { value: -20, abs_tol: 0.01, unit: '%' }, explanation: '2 × 2 ÷ 5 − 1 = −0.2.', misconception: 'Thinking the loss equals the price move.' },
    { id: 'aa-q2-2', objective: 'aa-o2', skill: 'protocol_economics', difficulty: 2, qtype: 'numeric', stem: 'A pool has x = 100 and y = 100 (no fee). You swap 25 X into it. How many Y do you receive?', correct: { value: 20, abs_tol: 0.001 }, explanation: '100 × 25 ÷ (100 + 25) = 20.', misconception: 'Expecting 25 Y at the starting price.' },
    { id: 'aa-q2-3', objective: 'aa-o2', skill: 'protocol_economics', difficulty: 2, qtype: 'multi_select', stem: 'Which are risks for a DeFi depositor beyond price moves? Select all that apply.', options: ['Smart-contract bugs', 'Oracle manipulation', 'Admin keys changing the rules', 'The blockchain forgetting balances overnight'], correct: { indexes: [0, 1, 2] }, explanation: 'The first three are real and documented; ledgers do not forget balances.', misconception: 'Seeing only market risk.' },
  ],
};

const AA3: SourceLesson = {
  id: 'aa-l3', title: 'Liquidity and market risk', minutes: 15, objectives: ['aa-o3'], prerequisites: ['aa-l1'], mastery_rule: RULE('aa-o3'), references: [{ title: 'Coinbase Exchange API documentation', url: 'https://docs.cdp.coinbase.com/exchange/docs', note: 'Public order-book and trade data for one venue.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Can a position actually be traded?', body: [
      'Liquidity is the ability to trade size without moving the price much. Indicators: bid–ask spread, depth near the best price, daily volume, and how many venues list the pair.',
      'Liquidity disappears when it is most needed: in a sell-off, market makers widen spreads and pull orders, so price impact jumps.',
      'Market risk measures (volatility, drawdown, correlation) describe price behaviour; liquidity risk describes whether you could act on it. A research view needs both.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Order size and price impact', widget: 'depth_3d', intro: 'Increase the order size until the simulated book runs out. Watch the average price drift away from the best price.', alt_text: 'A 3D order-book depth chart that updates as a market order consumes levels, with the average fill price and the new best bid and ask written out.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A coin trades $5 M a day. Someone needs to trade $2 M of it at once. What is likely?', options: ['No price impact', 'Significant price impact: 40% of a day’s volume in one go', 'The exchange will refuse it'], answer: 1, reveal: 'Trading a large share of daily volume at once consumes much of the visible depth and moves the price.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Days to trade a position', steps: [
      'A position worth $3 M in a token with $10 M average daily volume.',
      'If no more than 10% of daily volume is traded to limit impact, the daily capacity is $1 M.',
      'Days to trade = 3 ÷ 1 = 3 days, during which the price can move a lot.',
      'Combine with volatility: at 80% annualised (≈ 4.2% a day), three days can easily mean a 7% move against you.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Position $6 M, average daily volume $20 M, participation limit 15%. Days to trade?', hint: 'Daily capacity = limit × volume.', answer_text: 'Capacity = 0.15 × 20 = $3 M/day; 6 ÷ 3 = 2 days.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is liquidity risk highest when market risk is highest?', model_answer: 'In stress, market makers widen spreads and reduce depth to protect themselves while many participants want to trade the same way, so impact rises exactly when prices are most volatile.' },
    { stage: 'review', kind: 'summary', points: ['Liquidity = spread, depth, volume and venue breadth.', 'Days-to-trade connects position size to volume.', 'Liquidity tends to vanish in stress.'] },
  ],
  quiz: [
    { id: 'aa-q3-1', objective: 'aa-o3', skill: 'liquidity_risk', difficulty: 2, qtype: 'numeric', stem: 'Position $6 M, average daily volume $20 M, participation limit 15%. How many days to trade it?', correct: { value: 2, abs_tol: 0.001, unit: 'days' }, explanation: '0.15 × 20 = 3; 6 ÷ 3 = 2.', misconception: 'Dividing the position by total volume.' },
    { id: 'aa-q3-2', objective: 'aa-o3', skill: 'liquidity_risk', difficulty: 2, qtype: 'numeric', stem: 'Best bid 49.5, best ask 50.5. Spread as a percentage of the mid-price?', correct: { value: 2, abs_tol: 0.001, unit: '%' }, explanation: 'Spread 1.0; mid 50.0; 1 ÷ 50 = 2%.', misconception: 'Dividing by the bid.' },
    { id: 'aa-q3-3', objective: 'aa-o3', skill: 'liquidity_risk', difficulty: 3, qtype: 'single_choice', stem: 'During a sharp sell-off, order-book depth usually…', options: ['Increases', 'Decreases, as market makers widen spreads and pull orders', 'Stays the same', 'Moves to stablecoins'], correct: { index: 1 }, explanation: 'Liquidity providers protect themselves in stress.', misconception: 'Assuming liquidity is constant.' },
  ],
};

const AA4: SourceLesson = {
  id: 'aa-l4', title: 'Scenario analysis', minutes: 16, objectives: ['aa-o4'], prerequisites: ['aa-l3'], mastery_rule: RULE('aa-o4'), references: [CG_METHOD, DEFILLAMA],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Ranges, not predictions', body: [
      'Scenario analysis asks “what would have to be true?” rather than “what will happen?”. You vary drivers (supply unlocks, fee growth, a stablecoin de-peg, a liquidity shock) and trace their effect.',
      'Good scenarios are internally consistent (high activity usually means high fees and high burns together) and include a severe-but-plausible stress case drawn from history, such as a 70% drawdown.',
      'Write down each assumption and its source. A scenario is a structured question, not a forecast.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Supply scenarios', widget: 'tokenomics_3d', intro: 'Build three schedules for the same fictional token: base, faster unlocks, and higher burns. Compare circulating supply at month 24.', alt_text: 'A 3D chart and table of monthly circulating and locked supply under adjustable unlock, emission and burn assumptions, with market cap and FDV at key months.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Circulating supply doubles over two years while market capitalisation stays the same. What happens to the price per token?', options: ['Doubles', 'Halves', 'Stays the same'], answer: 1, reveal: 'Price = market cap ÷ circulating supply; the same market cap over twice the tokens is half the price per token.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Three supply scenarios', steps: [
      'Fictional token: 400 M circulating today, market cap held at $400 M in every scenario to isolate supply.',
      'Base: 520 M circulating at month 24 → $0.77 per token. Fast unlocks: 640 M → $0.63. High burns: 470 M → $0.85.',
      'The spread between scenarios ($0.63–$0.85) comes from supply alone, before any change in demand.',
      'Holding market cap fixed is itself an assumption; state it.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Market cap held at $300 M; circulating supply rises from 300 M to 375 M. Price per token before and after?', hint: 'Price = market cap ÷ supply.', answer_text: 'Before $1.00; after 300 ÷ 375 = $0.80 (−20%).' },
    { stage: 'explain', kind: 'reflection', prompt: 'What makes a stress scenario “severe but plausible”?', model_answer: 'It is grounded in something that has actually happened (a historical drawdown, a de-peg, an exchange failure) and is internally consistent, rather than an arbitrary extreme or a mild case.' },
    { stage: 'review', kind: 'summary', points: ['Scenarios trace assumptions; they do not predict.', 'Keep drivers internally consistent and state every assumption.', 'Include a severe-but-plausible stress case grounded in history.'] },
  ],
  quiz: [
    { id: 'aa-q4-1', objective: 'aa-o4', skill: 'scenarios', difficulty: 2, qtype: 'numeric', stem: 'Market cap held at $300 M; circulating supply rises from 300 M to 375 M. What is the new price per token, in dollars?', correct: { value: 0.8, abs_tol: 0.0001, unit: '$' }, explanation: '300 ÷ 375 = 0.8.', misconception: 'Leaving price unchanged.' },
    { id: 'aa-q4-2', objective: 'aa-o4', skill: 'scenarios', difficulty: 2, qtype: 'single_choice', stem: 'The main purpose of scenario analysis is to…', options: ['Predict the price', 'Trace how outcomes depend on stated assumptions, including stress cases', 'Find the best scenario', 'Replace data collection'], correct: { index: 1 }, explanation: 'Scenarios structure uncertainty; they do not remove it.', misconception: 'Treating a scenario as a forecast.' },
    { id: 'aa-q4-3', objective: 'aa-o4', skill: 'scenarios', difficulty: 3, qtype: 'single_choice', stem: 'A “high activity” scenario assumes fees triple but burns stay unchanged on a chain that burns a share of every fee. What is wrong?', options: ['Nothing', 'It is internally inconsistent: burns rise with fees on that chain', 'Fees cannot triple', 'Burns are irrelevant'], correct: { index: 1 }, explanation: 'Linked drivers must move together.', misconception: 'Changing one driver in isolation.' },
  ],
};

const AA5: SourceLesson = {
  id: 'aa-l5', title: 'An integrated research process', minutes: 16, objectives: ['aa-o1'], prerequisites: ['aa-l1'], mastery_rule: RULE('aa-o1'), references: [CG_METHOD, DEFILLAMA, ETH_DOCS],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'From question to evidence', body: [
      'A repeatable process: (1) define the question; (2) establish identity (the exact asset, network and contracts); (3) gather source-attributed data with dates; (4) analyse supply, protocol economics, network activity, market liquidity and risk; (5) run scenarios; (6) record what is unknown.',
      'Keep data kinds separate: reference prices, venue prices, provider estimates, on-chain observations and your own calculations each carry different reliability.',
      'Prefer disconfirming evidence: write down what would make your view wrong, and look for it.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Assemble a research file in ATLAS', href: '/app/crypto/assets', steps: [
      'Pick one asset. On its page, record identity (id, network, contracts) and the data kinds shown in each section.',
      'Add supply and FDV from Tokenomics, the volatility, drawdown and correlation from Analytics, and verified pairs from Markets.',
      'If it has a protocol, add TVL, fees and revenue from DeFi. Save a dated note listing each figure with its source, and the gaps.',
    ], alt_text: 'An asset page with tabs for overview, analytics, tokenomics, markets, events and notes, each value showing its source and timestamp.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Your notes mix a CoinGecko reference price, a Binance BTC/USDT close and your own calculated volatility in one table without labels. What is the risk?', options: ['None', 'Readers cannot tell which figures are aggregates, venue-specific or derived, so comparisons may be invalid', 'The table will be too long'], answer: 1, reveal: 'Each data kind has different meaning and reliability; unlabelled mixing hides that.' },
    { stage: 'investigate', kind: 'worked_example', title: 'A one-page evidence map', steps: [
      'Identity: asset id, native coin or token, network, contract (provider-reported, date).',
      'Supply: circulating, total, maximum, FDV (provider estimate, date); unlocks: not available from verified sources.',
      'Market: 1-year return, 90-day volatility, maximum drawdown (calculated, series and window named); liquidity: verified pairs and volume.',
      'Unknowns: holder concentration, unlock schedule, admin powers. Each unknown is a reason for caution, not a blank to fill with a guess.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Your map has 12 items: 8 sourced and dated, 4 unknown. What share of the evidence is missing, and what do you write about it?', hint: 'Count, then describe.', answer_text: '4 ÷ 12 ≈ 33% missing; list each unknown explicitly with why it matters, and avoid conclusions that depend on them.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why write down what would prove your view wrong before you look for more data?', model_answer: 'It protects against confirmation bias: once you have a view, you tend to notice supporting evidence; naming the disconfirming evidence first makes you look for it.' },
    { stage: 'review', kind: 'summary', points: ['Question → identity → sourced data → analysis → scenarios → unknowns.', 'Keep data kinds labelled and separate.', 'Name disconfirming evidence and record gaps.'] },
  ],
  quiz: [
    { id: 'aa-q5-1', objective: 'aa-o1', skill: 'research_process', difficulty: 1, qtype: 'single_choice', stem: 'What should come first in a crypto research process after defining the question?', options: ['Price forecast', 'Establishing the exact identity: asset, network and contracts', 'Social-media sentiment', 'Choosing a position size'], correct: { index: 1 }, explanation: 'Everything else depends on analysing the right asset.', misconception: 'Starting from the price.' },
    { id: 'aa-q5-2', objective: 'aa-o1', skill: 'research_process', difficulty: 2, qtype: 'numeric', stem: 'An evidence map has 12 items, 4 of them unknown. What percentage is unknown?', correct: { value: 33.33, abs_tol: 0.05, unit: '%' }, explanation: '4 ÷ 12 = 33.3%.', misconception: 'Dividing unknown by known.' },
    { id: 'aa-q5-3', objective: 'aa-o1', skill: 'research_process', difficulty: 2, qtype: 'single_choice', stem: 'Why keep reference prices, venue prices and calculated metrics labelled separately?', options: ['For colour coding only', 'They have different meanings and reliability; mixing them invites invalid comparisons', 'Regulators require it', 'To save space'], correct: { index: 1 }, explanation: 'Labels preserve what each number is.', misconception: 'Treating all numbers as equivalent.' },
  ],
};

const AA6: SourceLesson = {
  id: 'aa-l6', title: 'Writing an evidence-based research report', minutes: 15, objectives: ['aa-o5'], prerequisites: ['aa-l5'], mastery_rule: RULE('aa-o5'), references: [HARVEY, { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'On the difference between education and advice.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'A report others can check', body: [
      'Structure: summary of findings; identity; data and sources (with dates and data kinds); supply and protocol economics; network activity; market and liquidity risk; scenarios; unknowns and limitations; methodology appendix.',
      'Every number cites its source or formula. Observations, calculations and interpretations are labelled as such. Words like “will”, “certain” and “guaranteed” do not belong in an analysis of uncertain outcomes.',
      'A research report describes evidence and uncertainty; it is not a recommendation. Readers make their own decisions.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Draft from your evidence map', href: '/app/crypto/research', steps: [
      'Use your research note from the previous lesson as the source list.',
      'Add one correlation from the Research matrix with its window, source and number of aligned days.',
      'Write a limitations paragraph that names at least three unknowns and one way each could change the picture.',
    ], alt_text: 'The Research page correlation matrix with its window, source and per-cell observation counts, used as cited evidence in a written report.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A draft says: “Supply growth will push the price down.” How should it be rewritten?', options: ['Keep it; it is clear', '“Circulating supply is scheduled to rise 25% over 12 months (source, date); holding market cap constant, that would mean a 20% lower price per token.”', 'Delete all mention of supply'], answer: 1, reveal: 'The rewrite states the evidence, the assumption and the arithmetic, and avoids a forecast.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Labelling claims', steps: [
      'Observed: “BTC/USDT on Binance closed at a stated level on a stated date (Binance daily candle).”',
      'Calculated: “90-day realised volatility of 52% (daily log returns, √365, 89 returns, ATLAS).”',
      'Interpretation: “Volatility is above its one-year median, which historically has coincided with larger drawdowns in this series.”',
      'Each label tells the reader how to verify the statement and how much weight it can bear.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Rewrite as evidence: “This token is very risky.”', hint: 'Replace the adjective with measured figures and their sources.', answer_text: 'For example: “Over the stored history, maximum drawdown was −78% and 90-day volatility is 95% annualised (ATLAS calculations on Binance daily candles); 85% of maximum supply is not yet circulating (CoinGecko, date).”' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why does a limitations section make a report more useful, not less?', model_answer: 'It tells readers where the conclusions could fail and what evidence is missing, so they can judge the weight to give the findings and what to check next.' },
    { stage: 'review', kind: 'summary', points: ['Every number cites a source or formula.', 'Label observations, calculations and interpretations.', 'State limitations; describe evidence, not recommendations.'] },
  ],
  quiz: [
    { id: 'aa-q6-1', objective: 'aa-o5', skill: 'evidence_reports', difficulty: 2, qtype: 'single_choice', stem: 'Which statement is written as evidence rather than opinion?', options: ['“This token is undervalued.”', '“Circulating supply rose from 400 M to 520 M between two dated CoinGecko snapshots.”', '“This will be the next big coin.”', '“Everyone is talking about it.”'], correct: { index: 1 }, explanation: 'It is sourced, dated and checkable.', misconception: 'Treating opinions as findings.' },
    { id: 'aa-q6-2', objective: 'aa-o5', skill: 'evidence_reports', difficulty: 2, qtype: 'numeric', stem: 'A report says circulating supply will rise 25% while market cap is held constant. By what percentage does the price per token change?', correct: { value: -20, abs_tol: 0.01, unit: '%' }, explanation: '1 ÷ 1.25 − 1 = −20%.', misconception: 'Answering −25%.' },
    { id: 'aa-q6-3', objective: 'aa-o5', skill: 'evidence_reports', difficulty: 2, qtype: 'single_choice', stem: 'A limitations section should…', options: ['Be left out to look confident', 'Name the unknowns and how each could change the conclusions', 'Repeat the summary', 'List the author’s holdings only'], correct: { index: 1 }, explanation: 'Limitations make uncertainty explicit.', misconception: 'Hiding uncertainty.' },
  ],
};

export const ASSET_ARCHITECT: SourceCourse = {
  id: 'asset-architect',
  position: 8,
  title: 'ATLAS: DIGITAL ASSET ARCHITECT',
  tagline: 'Build an integrated, evidence-based research process for digital assets.',
  description: 'Bring tokenomics, protocol economics, DeFi mechanics, network activity, liquidity and risk together; run scenarios; and write research reports in which every number is sourced and every uncertainty is stated.',
  audience: 'Learners who have completed the earlier crypto courses or work with crypto data already.',
  prerequisites: 'ON-CHAIN SIGNAL ENGINEER, or equivalent experience with crypto data, supply analysis and basic statistics.',
  preceding: 'onchain-engineer',
  completion_statement: COMPLETION,
  rules: RULES,
  objectives: [
    { id: 'aa-o1', statement: 'Run an integrated research process from identity to sourced evidence and stated unknowns.', skill: 'research_process' },
    { id: 'aa-o2', statement: 'Interpret protocol economics and DeFi mechanics, including TVL, fees, revenue and impermanent loss.', skill: 'protocol_economics' },
    { id: 'aa-o3', statement: 'Assess market liquidity and its interaction with market risk.', skill: 'liquidity_risk' },
    { id: 'aa-o4', statement: 'Build internally consistent scenarios, including severe-but-plausible stress cases.', skill: 'scenarios' },
    { id: 'aa-o5', statement: 'Write research reports that cite every figure, label claims and state limitations.', skill: 'evidence_reports' },
  ],
  modules: [
    { id: 'aa-m1', title: 'Protocol economics', summary: 'TVL, fees, revenue and how DeFi mechanisms move risk around.', lessons: [AA1, AA2] },
    { id: 'aa-m2', title: 'Risk and scenarios', summary: 'Liquidity, market risk and structured scenarios.', lessons: [AA3, AA4] },
    { id: 'aa-m3', title: 'Research you can defend', summary: 'An integrated process and evidence-based reporting.', lessons: [AA5, AA6] },
  ],
  diagnostic: [
    { id: 'aa-d01', skill: 'protocol_economics', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'Protocol “revenue” in DeFi data usually means:', options: ['All fees paid by users', 'The share of fees kept by the protocol or its token holders', 'TVL', 'Token price × supply'], correct: { index: 1 }, explanation: 'Revenue is the retained share of fees.', misconception: 'Equating fees and revenue.' },
    { id: 'aa-d02', skill: 'protocol_economics', difficulty: 3, qtype: 'numeric', stem: 'Impermanent loss at r = 1 (no price change), in percent?', correct: { value: 0, abs_tol: 0.001 }, explanation: '2 × 1 ÷ 2 − 1 = 0.', misconception: 'Expecting a loss without a move.' },
    { id: 'aa-d03', skill: 'liquidity_risk', difficulty: 2, qtype: 'numeric', critical: true, stem: 'Position $4 M, daily volume $20 M, participation limit 10%. Days to trade?', correct: { value: 2, abs_tol: 0.001 }, explanation: '0.1 × 20 = 2; 4 ÷ 2 = 2.', misconception: 'Ignoring the participation limit.' },
    { id: 'aa-d04', skill: 'liquidity_risk', difficulty: 2, qtype: 'single_choice', stem: 'Liquidity tends to be lowest:', options: ['In calm markets', 'In stressed, fast-falling markets', 'At weekends only', 'Never'], correct: { index: 1 }, explanation: 'Market makers pull back in stress.', misconception: 'Assuming constant liquidity.' },
    { id: 'aa-d05', skill: 'scenarios', difficulty: 2, qtype: 'single_choice', critical: true, stem: 'A scenario differs from a forecast because it:', options: ['Is always optimistic', 'Traces outcomes from stated assumptions without claiming they will happen', 'Uses more data', 'Is shorter'], correct: { index: 1 }, explanation: 'Scenarios are conditional.', misconception: 'Treating scenarios as predictions.' },
    { id: 'aa-d06', skill: 'scenarios', difficulty: 2, qtype: 'numeric', stem: 'Market cap held constant; supply rises 50%. Price change per token, in percent?', correct: { value: -33.33, abs_tol: 0.05 }, explanation: '1 ÷ 1.5 − 1 = −33.3%.', misconception: 'Answering −50%.' },
    { id: 'aa-d07', skill: 'research_process', difficulty: 1, qtype: 'single_choice', stem: 'Before analysing a token, you first confirm:', options: ['Its logo', 'The exact asset, network and contract address', 'Its popularity', 'Its all-time high'], correct: { index: 1 }, explanation: 'Identity comes first.', misconception: 'Skipping identity checks.' },
    { id: 'aa-d08', skill: 'evidence_reports', difficulty: 2, qtype: 'single_choice', stem: 'Which belongs in an evidence-based report?', options: ['“Guaranteed to rise”', '“90-day volatility 60% (daily log returns, √365, ATLAS)”', '“Everyone agrees”', '“Trust me”'], correct: { index: 1 }, explanation: 'Sourced, defined measurements.', misconception: 'Using certainty language.' },
    { id: 'aa-d09', skill: 'evidence_reports', difficulty: 2, qtype: 'single_choice', stem: 'A limitations section:', options: ['Weakens a report', 'Shows readers where conclusions could fail', 'Is optional filler', 'Lists sources only'], correct: { index: 1 }, explanation: 'It makes uncertainty explicit.', misconception: 'Hiding unknowns.' },
    { id: 'aa-d10', skill: 'protocol_economics', difficulty: 2, qtype: 'numeric', stem: 'Annual fees $60 M; TVL $1,200 M. Fees ÷ TVL, in percent?', correct: { value: 5, abs_tol: 0.001 }, explanation: '60 ÷ 1,200 = 5%.', misconception: 'Inverting the ratio.' },
  ],
};
