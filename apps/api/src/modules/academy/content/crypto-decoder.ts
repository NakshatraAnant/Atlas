import type { SourceCourse, SourceLesson, SourceQuestion } from '../curriculum.js';

// CRYPTO MARKET DECODER (beginner). Drafted with AI assistance; stored as in_review until a named
// reviewer completes the seven-point review. Examples use round, hypothetical numbers or are taken
// from ATLAS's own stored, source-attributed data in the guided ATLAS tasks. Nothing here describes
// a recommendation or a forecast.

const NAKAMOTO = { title: 'Bitcoin: A Peer-to-Peer Electronic Cash System (Nakamoto, 2008)', url: 'https://bitcoin.org/bitcoin.pdf', note: 'The original description of a proof-of-work blockchain; section 11 has the confirmation arithmetic.' };
const ETH_DOCS = { title: 'ethereum.org developer documentation', url: 'https://ethereum.org/en/developers/docs/', note: 'Official introduction to accounts, transactions, blocks and gas.' };
const SEBI_CAUTION = { title: 'SEBI investor education resources', url: 'https://investor.sebi.gov.in/', note: 'General investor education; crypto assets are not securities regulated by SEBI, so investor protections differ.' };
const RULE = (o: string) => `Objective ${o} is mastered after at least 3 graded answers with a recent-accuracy estimate of 80% or more.`;

const L1: SourceLesson = {
  id: 'cd-l1', title: 'Digital assets and the shared ledger', minutes: 14, objectives: ['cd-o1'], mastery_rule: RULE('cd-o1'), references: [NAKAMOTO, ETH_DOCS],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'A ledger nobody owns', body: [
      'A digital asset such as bitcoin is a balance recorded on a blockchain: a ledger of transactions that thousands of independent computers (nodes) keep copies of and check against the same rules.',
      'New transactions are grouped into blocks. Each block contains the hash (a fingerprint) of the block before it, so the blocks form a chain. Nobody can quietly edit an old entry, because every later block depends on it.',
      'There is no central bookkeeper. Instead, the network follows a consensus rule (proof of work, proof of stake) that decides who may add the next block and which version of the chain counts.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Follow one transaction', widget: 'tx_journey_3d', intro: 'Step through a transaction from signing to confirmation. Then edit a transaction inside an old block and watch what happens to the chain.', alt_text: 'A 3D ring of network nodes passes a glowing transaction to a chain of four blocks. A table lists each block, its previous-block hash, its transactions and whether its stored hash still matches its contents.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Someone edits an old transaction on their own copy of the ledger. What happens?', options: ['Every node accepts the edited copy', 'That block’s hash no longer matches, so other nodes reject the edited copy', 'The transaction is deleted for everyone'], answer: 1, reveal: 'The edit changes the block’s hash, and the next block still points at the old hash. Honest nodes see a broken chain and keep the original. To make the edit stick, the editor would have to rebuild every later block faster than the rest of the network.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Why old blocks are hard to change', steps: [
      'Block 101 stores the hash of block 100. Block 102 stores the hash of block 101, and so on.',
      'Change one transaction in block 100: its hash changes completely (a hash function turns any small change into a very different output).',
      'Block 101 now points at a hash that no longer exists, so block 101 must be rebuilt, which changes its hash, so block 102 must be rebuilt, and so on to the newest block.',
      'In proof of work each rebuilt block needs the same expensive computation as the original. An attacker would need to outpace the whole honest network, which is why each extra block on top makes a transaction harder to reverse.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A transaction is in block 800,000 and the newest block is 800,005. How many confirmations does it have?', hint: 'The block that contains the transaction counts as the first confirmation.', answer_text: '800,005 − 800,000 + 1 = 6 confirmations.' },
    { stage: 'explain', kind: 'reflection', prompt: 'In two sentences, explain how a blockchain keeps a trustworthy record without a central bookkeeper.', model_answer: 'Many independent nodes keep copies and check every block against the same rules, and each block includes the previous block’s hash. Changing history would mean redoing all later blocks faster than the honest network, which consensus rules make costly.' },
    { stage: 'review', kind: 'summary', points: ['A blockchain is an append-only ledger copied across many independent nodes.', 'Each block stores the hash of the previous block, linking them into a chain.', 'Confirmations count the blocks built on top of a transaction; more confirmations make reversal harder.'] },
  ],
  quiz: [
    { id: 'cd-q1-1', objective: 'cd-o1', skill: 'blockchain_basics', difficulty: 1, qtype: 'single_choice', stem: 'Which description of a blockchain is most accurate?', options: ['A database run by one company', 'An append-only ledger that many independent computers keep and check against shared rules', 'A type of cryptocurrency exchange', 'A government payment system'], correct: { index: 1 }, explanation: 'A public blockchain is replicated across many nodes; no single party controls the record.', misconception: 'Thinking a blockchain is a company database or an exchange.' },
    { id: 'cd-q1-2', objective: 'cd-o1', skill: 'blockchain_basics', difficulty: 2, qtype: 'single_choice', stem: 'Why is it hard to change an old transaction in a proof-of-work blockchain?', options: ['Transactions are encrypted so nobody can read them', 'Each block contains the previous block’s hash, so changing one block means redoing the work for every later block', 'A central administrator approves every change', 'Old blocks are deleted after a day'], correct: { index: 1 }, explanation: 'Hash links make every later block depend on the earlier one; rebuilding them requires out-computing the honest network.', misconception: 'Believing blockchains are secure because they are encrypted (most transaction data is public).' },
    { id: 'cd-q1-3', objective: 'cd-o1', skill: 'blockchain_basics', difficulty: 2, qtype: 'numeric', stem: 'A transaction is included in block 100,000. The newest block is 100,011. How many confirmations does it have?', correct: { value: 12, abs_tol: 0, unit: 'confirmations' }, explanation: '100,011 − 100,000 + 1 = 12: the block containing it counts as the first.', misconception: 'Forgetting to count the block that contains the transaction (answering 11).' },
  ],
};

const L2: SourceLesson = {
  id: 'cd-l2', title: 'Blocks, fees and confirmations on a real network', minutes: 15, objectives: ['cd-o1'], prerequisites: ['cd-l1'], mastery_rule: RULE('cd-o1'),
  references: [{ title: 'mempool.space REST API documentation', url: 'https://mempool.space/docs/api/rest', note: 'The public Bitcoin data source ATLAS uses for recent blocks and fee estimates.' }, { title: 'ethereum.org: Blocks', url: 'https://ethereum.org/en/developers/docs/blocks/', note: 'Official explanation of Ethereum block production and timing.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Blocks have limited space', body: [
      'A block can only hold so many transactions. When more people want to transact than fit, they compete with fees: block producers usually include the transactions paying the most per unit of block space first.',
      'On Bitcoin the fee rate is measured in satoshis per virtual byte (sat/vB); one bitcoin is 100,000,000 satoshis. On Ethereum, fees are paid in gas, priced in gwei (one billionth of an ether), with a base fee that the protocol adjusts every block and burns.',
      'Bitcoin aims for one block about every ten minutes; Ethereum produces a block slot every 12 seconds. Block times are averages and targets, not exact timetables.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read real recent blocks in ATLAS', href: '/app/crypto/onchain', steps: [
      'Open Digital Assets → On-chain. Note the freshness label: the data is a rolling window of recent blocks from free public endpoints, not a full archive.',
      'For Bitcoin, read the latest block height, its time (UTC) and its transaction count, and the average interval between the stored blocks.',
      'For Ethereum, compare the block interval and the base fee in gwei with Bitcoin’s fee estimates in sat/vB.',
      'Open the metric definitions and note what a transaction count does not tell you (it is not a count of users).',
    ], alt_text: 'The On-chain page shows, for Bitcoin and Ethereum, summary metrics with their definitions and a table of the latest stored blocks with height, time, transaction count, size and fees.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Bitcoin targets about one block every ten minutes. Over one hour, how many blocks would you expect on average?', options: ['1', '6', '60'], answer: 1, reveal: '60 ÷ 10 = 6 on average. Real intervals vary a lot because finding a block is random; some arrive a minute apart, some take half an hour.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Working out a fee rate', steps: [
      'A transaction takes 250 virtual bytes of block space and pays 2,500 satoshis in fees.',
      'Fee rate = 2,500 ÷ 250 = 10 sat/vB.',
      'If the mempool estimate for the next block is 15 sat/vB, this transaction may wait for a quieter period; if it is 5 sat/vB, it is likely to be picked soon.',
      'The fee does not depend on the amount sent: sending 0.001 BTC or 10 BTC in a transaction of the same size costs the same.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A 200 vB transaction pays 3,000 satoshis. What is its fee rate?', hint: 'Divide the fee by the size.', answer_text: '3,000 ÷ 200 = 15 sat/vB.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is a block producer’s choice of transactions mostly about fee rate rather than the amount being sent?', model_answer: 'Block space is the scarce resource, so producers earn the most by filling it with the transactions that pay the most per byte (or per unit of gas). The value transferred does not use more space.' },
    { stage: 'review', kind: 'summary', points: ['Block space is limited, so transactions compete by fee rate.', 'Bitcoin fees are quoted in sat/vB; Ethereum uses gas priced in gwei with a burned base fee.', 'Block intervals are averages; transaction counts are not user counts.'] },
  ],
  quiz: [
    { id: 'cd-q2-1', objective: 'cd-o1', skill: 'blockchain_basics', difficulty: 2, qtype: 'numeric', stem: 'A 400 vB transaction pays 6,000 satoshis. What is its fee rate in sat/vB?', correct: { value: 15, abs_tol: 0.01, unit: 'sat/vB' }, explanation: '6,000 ÷ 400 = 15 sat/vB.', misconception: 'Dividing size by fee, or relating the fee to the amount sent.' },
    { id: 'cd-q2-2', objective: 'cd-o1', skill: 'blockchain_basics', difficulty: 2, qtype: 'single_choice', stem: 'Pending transactions compete for space in the next block. Which do block producers usually include first?', options: ['The oldest ones', 'Those sending the largest amounts', 'Those paying the highest fee per unit of block space', 'A random selection'], correct: { index: 2 }, explanation: 'Producers maximise fee income from limited space, so fee rate is the main factor.', misconception: 'Thinking larger transfers get priority.' },
    { id: 'cd-q2-3', objective: 'cd-o1', skill: 'blockchain_basics', difficulty: 3, qtype: 'single_choice', stem: 'Ethereum produces blocks about every 12 seconds and Bitcoin about every 10 minutes. What can you conclude from this alone?', options: ['Ethereum is more secure', 'Bitcoin is used by more people', 'The networks have different designs; block interval alone says nothing about security or usage', 'Ethereum transactions are free'], correct: { index: 2 }, explanation: 'Block interval is a design parameter. Security, usage and cost depend on many other factors.', misconception: 'Reading one technical parameter as a verdict on quality.' },
  ],
};

const L3: SourceLesson = {
  id: 'cd-l3', title: 'Coins versus tokens', minutes: 12, objectives: ['cd-o2'], prerequisites: ['cd-l1'], mastery_rule: RULE('cd-o2'),
  references: [{ title: 'ethereum.org: ERC-20 token standard', url: 'https://ethereum.org/en/developers/docs/standards/tokens/erc-20/', note: 'How fungible tokens are defined on Ethereum.' }, ETH_DOCS],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Native coins and the tokens built on top', body: [
      'A native coin belongs to a blockchain’s own protocol and pays its transaction fees: BTC on Bitcoin, ETH on Ethereum, SOL on Solana.',
      'A token is created by a smart contract on an existing blockchain: for example ERC-20 tokens on Ethereum or SPL tokens on Solana. The same issuer can deploy the “same” token on several chains; each deployment is a separate contract.',
      'Ticker symbols are not unique. Different, unrelated assets can share a symbol, which is why ATLAS identifies every asset by a unique id and every contract by its address together with its network.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Tell coins and tokens apart in ATLAS', href: '/app/crypto/assets', steps: [
      'Open Digital Assets → Explorer and set Type to “Native coins”, then to “Tokens”.',
      'Open a stablecoin and read its contracts on the Price & overview tab: one asset, several networks, a different address on each.',
      'Search for a short symbol and look at the CoinGecko id shown next to each result; notice that the id, not the symbol, identifies the asset.',
    ], alt_text: 'The Explorer table filtered by type, and an asset page listing contract addresses by network with their source and verification status.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Two different assets both use the symbol “XYZ”. How should a research tool tell them apart?', options: ['By the symbol', 'By a unique identifier, such as a database id or a contract address on a named network', 'By whichever has the higher price'], answer: 1, reveal: 'Symbols collide often. A unique id, or a contract address together with its network, identifies an asset without ambiguity.' },
    { stage: 'investigate', kind: 'worked_example', title: 'One name, several assets', steps: [
      'A dollar stablecoin issuer deploys its token on Ethereum and on Solana. Both are “the same” stablecoin, but they are two contracts on two networks, and a transfer on one network never appears on the other.',
      'Wrapped bitcoin (WBTC) is a token on Ethereum that represents bitcoin held by a custodian. It is not bitcoin itself: its value depends on the custodian honouring redemptions.',
      'An Ethereum-style address such as 0xa0b8… can exist on many EVM networks. Quoting it without the network name leaves the asset ambiguous.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'You send a token on Ethereum. Which asset pays the transaction fee?', hint: 'Fees are always paid in the network’s native coin.', answer_text: 'ETH, the native coin, pays the gas fee, even when the asset being sent is a token.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is a ticker symbol not enough to identify a crypto asset?', model_answer: 'Anyone can create a token with any symbol, so unrelated assets share tickers and imitation tokens copy famous names. A unique id, or a contract address on a named network, is needed.' },
    { stage: 'review', kind: 'summary', points: ['Native coins belong to a chain’s protocol and pay its fees.', 'Tokens are smart-contract assets; one token can have separate contracts on several networks.', 'Identify assets by unique ids and contracts by address plus network, never by symbol alone.'] },
  ],
  quiz: [
    { id: 'cd-q3-1', objective: 'cd-o2', skill: 'coins_tokens', difficulty: 1, qtype: 'single_choice', stem: 'Which of these is a native coin?', options: ['ETH on Ethereum', 'A dollar stablecoin on Ethereum', 'WBTC on Ethereum', 'Any ERC-20 token'], correct: { index: 0 }, explanation: 'ETH is Ethereum’s own asset and pays its fees; the others are tokens issued by contracts.', misconception: 'Treating every well-known asset as a coin.' },
    { id: 'cd-q3-2', objective: 'cd-o2', skill: 'coins_tokens', difficulty: 2, qtype: 'single_choice', stem: 'A contract address starting “0xA0b8…” is quoted without a network. What is the problem?', options: ['None: addresses are unique across all blockchains', 'The same address format is used on many EVM networks, so the contract is only identified together with its network', 'Addresses must be in upper case', 'Only tokens on Bitcoin have addresses'], correct: { index: 1 }, explanation: 'EVM networks share the address format; the network is part of the identity.', misconception: 'Assuming an address is globally unique.' },
    { id: 'cd-q3-3', objective: 'cd-o2', skill: 'coins_tokens', difficulty: 2, qtype: 'multi_select', stem: 'Which statements are true? Select all that apply.', options: ['Tokens are created by smart contracts on an existing blockchain', 'A ticker symbol uniquely identifies an asset', 'A wrapped token depends on a custodian or bridge for its value', 'Native coins pay the network’s transaction fees'], correct: { indexes: [0, 2, 3] }, explanation: 'Symbols are not unique; the other three statements are true.', misconception: 'Trusting the symbol as an identity.' },
  ],
};

const L4: SourceLesson = {
  id: 'cd-l4', title: 'Wallets, addresses and keys', minutes: 16, objectives: ['cd-o2'], prerequisites: ['cd-l3'], mastery_rule: RULE('cd-o2'),
  references: [ETH_DOCS, NAKAMOTO],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'A wallet holds keys, not coins', body: [
      'Coins and tokens live on the blockchain. A wallet holds the private keys that can authorise spending them. Whoever controls a private key controls the funds at its addresses.',
      'From the private key the wallet derives a public key, and from that an address. You can share an address freely so people can send to it; you never share the private key.',
      'Most wallets back up their keys as a seed phrase of 12 or 24 words. The seed phrase is the keys: anyone who sees it can take the funds, and nobody can reverse that. Legitimate services never ask for it.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Sign and verify a transaction (toy keys)', widget: 'signing', intro: 'Sign a message with a toy private key, then let a “node” verify it with the public key. Change one character and verify again.', alt_text: 'A two-column lab: on the left a message, its digest and a signature produced with a toy private key; on the right the verification arithmetic with the public key and a valid or invalid result.' },
    { stage: 'predict', kind: 'prediction', prompt: 'Someone asks for your seed phrase to “verify your wallet”. What could they do with it?', options: ['Nothing; it is only a password hint', 'Take full control of the funds', 'Only view your balance'], answer: 1, reveal: 'The seed phrase regenerates every private key in the wallet, so it gives complete control. Any request for it is an attempt to take the funds.' },
    { stage: 'investigate', kind: 'worked_example', title: 'What a signature proves', steps: [
      'The wallet turns the transaction into a short digest and signs it with the private key.',
      'Nodes check the signature using only the public key. A valid check proves the transaction was authorised by the key holder and has not been changed since it was signed.',
      'Change the amount by one digit and the digest changes, so the old signature no longer verifies: the network rejects it.',
      'Nothing secret travels across the network; that is why public-key signatures let strangers verify each other without sharing passwords.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'You lose your phone, but you kept your seed phrase written down safely offline. Can you get the funds back?', hint: 'Think about what the seed phrase contains.', answer_text: 'Yes: restoring the seed phrase in compatible wallet software regenerates the keys. If both the device and the seed phrase are lost, the funds are unreachable.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Explain the difference between custody on an exchange and self-custody in a wallet.', model_answer: 'On an exchange, the exchange controls the keys and owes you a balance, so you depend on its solvency and security. In self-custody you control the keys yourself, so nobody can freeze or lose them for you, but nobody can recover them for you either.' },
    { stage: 'review', kind: 'summary', points: ['Wallets hold private keys; funds are recorded on the blockchain.', 'Addresses are safe to share; private keys and seed phrases never are.', 'Signatures prove authorisation and integrity without revealing the key.'] },
  ],
  quiz: [
    { id: 'cd-q4-1', objective: 'cd-o2', skill: 'wallets_keys', difficulty: 1, qtype: 'single_choice', stem: 'What does a crypto wallet actually hold?', options: ['The coins themselves', 'The keys that control funds recorded on the blockchain', 'A bank account number', 'A copy of the whole blockchain, always'], correct: { index: 1 }, explanation: 'Balances are recorded on the ledger; the wallet holds the keys that can move them.', misconception: 'Thinking coins are stored inside the wallet app.' },
    { id: 'cd-q4-2', objective: 'cd-o2', skill: 'wallets_keys', difficulty: 1, qtype: 'single_choice', stem: 'Which can be shared safely so that others can send you funds?', options: ['Seed phrase', 'Private key', 'Receiving address', 'Wallet password'], correct: { index: 2 }, explanation: 'An address only lets people send to you; the others give control of the funds.', misconception: 'Believing a seed phrase or key is needed to receive funds.' },
    { id: 'cd-q4-3', objective: 'cd-o2', skill: 'wallets_keys', difficulty: 2, qtype: 'single_choice', stem: 'A node receives a transaction whose amount was changed after it was signed. What happens?', options: ['It is accepted with the new amount', 'The signature check fails and the transaction is rejected', 'The original sender is asked to confirm by email', 'The amount is averaged'], correct: { index: 1 }, explanation: 'The signature covers the exact transaction; any change makes verification fail.', misconception: 'Thinking signatures only identify the sender, not the content.' },
  ],
};

const L5: SourceLesson = {
  id: 'cd-l5', title: 'Exchanges, market pairs and venue prices', minutes: 15, objectives: ['cd-o3'], prerequisites: ['cd-l3'], mastery_rule: RULE('cd-o3'),
  references: [{ title: 'Binance Spot API documentation: market data', url: 'https://developers.binance.com/docs/binance-spot-api-docs', note: 'How one venue publishes its own order books, trades and candles.' }, { title: 'CoinGecko API documentation', url: 'https://docs.coingecko.com/', note: 'How an aggregator publishes reference prices across venues.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Every pair on every venue is its own market', body: [
      'A crypto exchange runs a separate order book for each market pair, such as BTC/USDT or BTC/USD. The second asset in the pair is the quote currency: the price is how many units of it one unit of the first asset costs.',
      'The same coin trades on many venues and against many quote currencies, so there is no single “the price”. Prices on liquid venues stay close because traders move between them, but they are not identical.',
      'Data aggregators such as CoinGecko compute a reference price across venues. It is useful for an overview, but it is not a price you can trade at on any one exchange. Crypto venues trade around the clock, every day.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Walk a simulated order book', widget: 'depth_3d', intro: 'Send a market order into a made-up order book and see how it fills against several price levels.', alt_text: 'A 3D depth chart of green bid columns and red ask columns either side of the spread, with a table of the trades produced by a market order and the resulting best bid and ask.' },
    { stage: 'predict', kind: 'prediction', prompt: 'At the same moment BTC is 81,310 on one venue’s BTC/USDT book and 81,277 on another venue’s BTC/USD book. Why can they differ?', options: ['One of them must be wrong', 'They are different markets with their own order books and quote currencies', 'The issuer of bitcoin sets different prices'], answer: 1, reveal: 'Each venue and each quote currency has its own buyers and sellers. USDT and USD are also not exactly the same thing, so prices differ slightly.' },
    { stage: 'investigate', kind: 'worked_example', title: 'The average price of a market order', steps: [
      'Asks waiting: 3 at 100.1, 6 at 100.2, 10 at 100.5.',
      'A market buy for 12 units takes 3 at 100.1, then 6 at 100.2, then 3 at 100.5.',
      'Cost = 3 × 100.1 + 6 × 100.2 + 3 × 100.5 = 300.3 + 601.2 + 301.5 = 1,203.0.',
      'Average price = 1,203.0 ÷ 12 = 100.25, higher than the best ask of 100.1. Thinner books mean bigger gaps.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Best bid 99.9, best ask 100.1. What is the spread as a percentage of the mid-price?', hint: 'Spread = ask − bid; mid = (ask + bid) ÷ 2.', answer_text: 'Spread 0.2; mid 100.0; 0.2 ÷ 100 = 0.2%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why does ATLAS label Binance prices “venue-specific” and CoinGecko prices “reference”?', model_answer: 'A Binance price is what one pair on one exchange traded at, in its own quote currency; CoinGecko’s price is an average across many venues that nobody can trade at directly. Mixing them would hide real differences.' },
    { stage: 'review', kind: 'summary', points: ['Each pair on each venue is a separate market with its own order book.', 'Reference prices are aggregates, not tradable prices.', 'Market orders walk the book; thin books mean higher price impact.'] },
  ],
  quiz: [
    { id: 'cd-q5-1', objective: 'cd-o3', skill: 'market_pairs', difficulty: 2, qtype: 'numeric', stem: 'Asks waiting: 5 units at 10.0 and 10 units at 10.2. A market buy for 10 units fills against them. What is the average price?', correct: { value: 10.1, abs_tol: 0.001 }, explanation: '5 × 10.0 + 5 × 10.2 = 101; 101 ÷ 10 = 10.1.', misconception: 'Assuming the whole order fills at the best ask.' },
    { id: 'cd-q5-2', objective: 'cd-o3', skill: 'market_pairs', difficulty: 1, qtype: 'single_choice', stem: 'What is an aggregated “reference price” for a crypto asset?', options: ['The price set by the asset’s issuer', 'A provider’s average across many venues; not a price you can trade at on any one exchange', 'The last trade on the largest exchange', 'A guaranteed redemption price'], correct: { index: 1 }, explanation: 'Aggregators combine many venues’ prices into one reference figure.', misconception: 'Treating an aggregate as an executable quote.' },
    { id: 'cd-q5-3', objective: 'cd-o3', skill: 'market_pairs', difficulty: 2, qtype: 'single_choice', stem: 'BTC/USDT and BTC/USD are…', options: ['Two names for the same market', 'Different markets: the quote currencies differ and each venue has its own order book', 'Always exactly the same price', 'Only available on one exchange'], correct: { index: 1 }, explanation: 'Quote currency and venue both define the market.', misconception: 'Treating USDT and USD as interchangeable.' },
  ],
};

const L6: SourceLesson = {
  id: 'cd-l6', title: 'Market capitalisation and circulating supply', minutes: 14, objectives: ['cd-o4'], prerequisites: ['cd-l5'], mastery_rule: RULE('cd-o4'),
  references: [{ title: 'CoinGecko methodology', url: 'https://www.coingecko.com/en/methodology', note: 'How the provider defines circulating supply and market capitalisation.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Price times supply, with caveats', body: [
      'Market capitalisation = price × circulating supply. Circulating supply is a provider’s estimate of the tokens that can currently trade; it excludes, for example, tokens locked for a team.',
      'Fully diluted valuation (FDV) = price × maximum supply, or total supply where no maximum is defined. A large gap between the two means many tokens could still reach the market.',
      'Market capitalisation is not the money invested, and it cannot all be turned into cash at the last price: selling many tokens would push the price down, especially in a thin market.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Read supply figures with their definitions', href: '/app/crypto/assets/bitcoin?tab=tokenomics', steps: [
      'Open Bitcoin’s Tokenomics tab: read circulating, total and maximum supply and the provider methodology note.',
      'Compare market capitalisation and fully diluted valuation on the Price & overview tab.',
      'Open Ethereum’s Tokenomics tab and notice that no maximum supply is defined; ATLAS shows it as “no maximum defined”, never as zero.',
    ], alt_text: 'The Tokenomics tab lists circulating, total and maximum supply with the provider, observation date and methodology, and explains what is not available.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A token has 100 million circulating and a 1 billion maximum supply, and trades at $2. What are its market capitalisation and FDV?', options: ['Both $200 million', 'Market cap $200 million, FDV $2 billion', 'Market cap $2 billion, FDV $200 million'], answer: 1, reveal: '100 M × $2 = $200 M; 1,000 M × $2 = $2,000 M = $2 billion.' },
    { stage: 'investigate', kind: 'worked_example', title: 'A round-number example', steps: [
      'Hypothetical price: $50,000. Circulating supply: 20,000,000 coins. Maximum supply: 21,000,000.',
      'Market cap = 20,000,000 × 50,000 = $1,000,000,000,000 = $1 trillion.',
      'FDV = 21,000,000 × 50,000 = $1.05 trillion; circulating is 20 ÷ 21 ≈ 95.2% of the maximum, so little dilution remains.',
      'A token with 10% of its maximum circulating could have an FDV ten times its market cap.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'A token trades at $0.50 with 400 million circulating and 1 billion total supply (no maximum defined). Market cap and FDV?', hint: 'With no maximum, FDV uses total supply.', answer_text: 'Market cap = 400 M × 0.50 = $200 M. FDV = 1,000 M × 0.50 = $500 M.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is a high market capitalisation not proof that an asset is liquid?', model_answer: 'Market cap only multiplies the last price by the circulating supply. If few buyers and sellers are active, a large sale would move the price sharply, so the headline figure could not be realised.' },
    { stage: 'review', kind: 'summary', points: ['Market cap = price × circulating supply; FDV uses maximum or total supply.', 'Circulating supply is a provider estimate with its own methodology.', 'Neither figure is money invested or cash that could be realised.'] },
  ],
  quiz: [
    { id: 'cd-q6-1', objective: 'cd-o4', skill: 'market_cap_supply', difficulty: 1, qtype: 'numeric', stem: 'A token trades at $4 with 25 million tokens circulating. What is its market capitalisation, in millions of dollars?', correct: { value: 100, abs_tol: 0.01, unit: '$ million' }, explanation: '25 M × $4 = $100 M.', misconception: 'Using total or maximum supply instead of circulating.' },
    { id: 'cd-q6-2', objective: 'cd-o4', skill: 'market_cap_supply', difficulty: 2, qtype: 'numeric', stem: 'The same token has a maximum supply of 100 million. What is its fully diluted valuation, in millions of dollars?', correct: { value: 400, abs_tol: 0.01, unit: '$ million' }, explanation: '100 M × $4 = $400 M.', misconception: 'Confusing FDV with market cap.' },
    { id: 'cd-q6-3', objective: 'cd-o4', skill: 'market_cap_supply', difficulty: 3, qtype: 'single_choice', stem: 'Why can market capitalisation overstate what holders could realise in cash?', options: ['It is calculated in a different currency', 'It multiplies the last price by every circulating token, but selling many tokens would move the price down in a thin market', 'It includes tokens that were burned', 'It is always rounded up'], correct: { index: 1 }, explanation: 'The last price applies to small trades; large sales walk down the order book.', misconception: 'Treating market cap as money in the bank.' },
  ],
};

const L7: SourceLesson = {
  id: 'cd-l7', title: 'Stablecoins', minutes: 14, objectives: ['cd-o5'], prerequisites: ['cd-l6'], mastery_rule: RULE('cd-o5'),
  references: [{ title: 'Report on Stablecoins (US President’s Working Group on Financial Markets, November 2021)', url: 'https://home.treasury.gov/system/files/136/StableCoinReport_Nov1_508.pdf', note: 'Official overview of stablecoin designs and risks.' }, { title: 'DefiLlama stablecoin data', url: 'https://defillama.com/stablecoins', note: 'The source of the stablecoin supply series shown in ATLAS.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Tokens designed to hold a value', body: [
      'A stablecoin aims to keep a steady value against a reference, usually one US dollar. How well it does that depends on its design.',
      'Fiat-reserve stablecoins: an issuer holds cash and short-term government debt and redeems tokens for dollars. The risk is in the reserves, the issuer and redemption access; the issuer can usually freeze tokens.',
      'Crypto-collateralised stablecoins are backed by more crypto than they issue (over-collateralised) and liquidate positions automatically if collateral falls. Algorithmic designs with little or no collateral have failed: TerraUSD lost its peg in May 2022.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Find stablecoins in ATLAS', href: '/app/crypto/defi', steps: [
      'On the DeFi page, read the total stablecoin supply chart and its source and date.',
      'Open a dollar stablecoin from the Explorer and read its price, type (token) and contracts on several networks.',
      'Notice that ATLAS shows the stablecoin’s reference price as reported; it does not assume it equals $1.',
    ], alt_text: 'The DeFi page with a chart of total USD-pegged stablecoin supply over two years, and a stablecoin asset page with its contracts.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A dollar stablecoin trades at $0.97 for several days. What does that suggest?', options: ['Nothing; all stablecoins trade there every day', 'The market doubts that it can be redeemed for $1, or redemption is difficult', 'Its supply has doubled'], answer: 1, reveal: 'A persistent discount means holders value it below $1: doubts about reserves, frozen redemptions or a failing mechanism.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Over-collateralisation in numbers', steps: [
      'A user locks $150 of ETH to mint 100 stablecoins: a collateral ratio of 150%.',
      'ETH falls 30%: the collateral is now worth $105, a ratio of 105%.',
      'If the protocol’s liquidation threshold is 110%, the position is liquidated: collateral is sold to repay the 100 stablecoins.',
      'The buffer protects stablecoin holders; the borrower bears the loss.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Collateral worth $300 backs 200 stablecoins. What is the ratio, and what is it after the collateral falls 20%?', hint: 'Ratio = collateral value ÷ stablecoins issued.', answer_text: '300 ÷ 200 = 150%. After a 20% fall: 240 ÷ 200 = 120%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'What could make a fiat-reserve stablecoin lose its peg?', model_answer: 'Doubts about the quality or existence of the reserves, the issuer being unable or unwilling to redeem, legal action, or a run where many holders try to redeem at once.' },
    { stage: 'review', kind: 'summary', points: ['Stablecoins aim to track a reference value; designs differ in where the risk sits.', 'Fiat-reserve, crypto-collateralised and algorithmic designs have different failure modes.', 'Price below the peg for a sustained period signals doubt about redemption.'] },
  ],
  quiz: [
    { id: 'cd-q7-1', objective: 'cd-o5', skill: 'stablecoins', difficulty: 2, qtype: 'numeric', stem: 'Collateral worth $1,200 backs 800 stablecoins. What is the collateral ratio, in percent?', correct: { value: 150, abs_tol: 0.01, unit: '%' }, explanation: '1,200 ÷ 800 = 1.5 = 150%.', misconception: 'Dividing the stablecoins by the collateral.' },
    { id: 'cd-q7-2', objective: 'cd-o5', skill: 'stablecoins', difficulty: 1, qtype: 'single_choice', stem: 'Which describes a fiat-reserve stablecoin?', options: ['Its price is held stable by an algorithm with no reserves', 'An issuer holds cash and short-term government debt and redeems tokens for dollars', 'It is issued by a central bank', 'It is backed by more volatile crypto than it issues'], correct: { index: 1 }, explanation: 'Reserve stablecoins rely on an issuer’s reserves and redemption.', misconception: 'Confusing private stablecoins with central bank money.' },
    { id: 'cd-q7-3', objective: 'cd-o5', skill: 'stablecoins', difficulty: 2, qtype: 'single_choice', stem: 'A dollar stablecoin trades at $0.95 for several days. What does this most likely indicate?', options: ['A normal daily fluctuation', 'Doubt about its reserves or about redemption at $1', 'That the dollar has strengthened', 'That its blockchain is congested'], correct: { index: 1 }, explanation: 'A sustained discount reflects doubt about the mechanism that is meant to hold the peg.', misconception: 'Assuming a stablecoin is always worth exactly its peg.' },
  ],
};

const L8: SourceLesson = {
  id: 'cd-l8', title: 'Crypto volatility', minutes: 15, objectives: ['cd-o6'], prerequisites: ['cd-l6'], mastery_rule: RULE('cd-o6'),
  references: [{ title: 'ATLAS: Digital Assets → asset → Analytics → Formulas and assumptions', note: 'The exact definitions, windows and annualisation conventions ATLAS uses, shown next to every calculated figure.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Large moves are normal here', body: [
      'Crypto prices have historically moved far more than broad share-market indices. Realised volatility measures how much daily returns vary; ATLAS annualises it with √365 because crypto trades every calendar day (Indian equities use √252 trading sessions).',
      'Large falls have repeated: major coins have more than once lost over 70% from a peak. Arithmetic makes recovery hard: after a 50% fall, the price must double to get back.',
      'Volatility describes the past. It does not say which direction prices go next, and it can change quickly.',
    ] },
    { stage: 'observe', kind: 'interactive', title: 'Volatility and drawdowns in stored Bitcoin history', widget: 'quant_3d', intro: 'Explore rolling volatility and drawdowns calculated by ATLAS from stored daily candles. If not enough history is stored yet, the scene says so instead of inventing data.', alt_text: 'A 3D chart with a front row of blue columns for rolling 30-day volatility and a back row of red columns hanging down for drawdown from the running peak, with the source series named above.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A price moves +10%, −10%, +10% on three days, starting at 100. Where does it end?', options: ['110 (+10%)', '108.9 (+8.9%)', '100 (unchanged)'], answer: 1, reveal: '100 × 1.1 × 0.9 × 1.1 = 108.9. Returns compound; they do not add.' },
    { stage: 'investigate', kind: 'worked_example', title: 'Annualising daily volatility', steps: [
      'Suppose daily returns have a standard deviation of 3%.',
      'If daily returns were independent, variance would grow with time, so the standard deviation grows with the square root of time.',
      'Annualised volatility ≈ 3% × √365 ≈ 3% × 19.105 ≈ 57.3%.',
      'For a market that trades 252 sessions a year, the same 3% gives 3% × √252 ≈ 47.6%: the convention changes the number, so always state it.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'Daily volatility is 2%. What is the annualised figure using √365?', hint: '√365 ≈ 19.105.', answer_text: '2% × 19.105 ≈ 38.2%.' },
    { stage: 'explain', kind: 'reflection', prompt: 'Why is it misleading to compare a crypto asset’s volatility calculated with √365 against a stock’s calculated with √252 without saying so?', model_answer: 'The annualisation convention changes the figure even for identical daily volatility; comparing the two without stating the convention mixes different assumptions.' },
    { stage: 'review', kind: 'summary', points: ['Crypto volatility has historically been much higher than broad equity indices.', 'Returns compound; a −50% fall needs +100% to recover.', 'State the annualisation convention: √365 for crypto, √252 for exchange sessions.'] },
  ],
  quiz: [
    { id: 'cd-q8-1', objective: 'cd-o6', skill: 'crypto_risk', difficulty: 2, qtype: 'numeric', stem: 'Daily volatility is 4%. What is the annualised volatility using √365, in percent? (√365 ≈ 19.105)', correct: { value: 76.42, abs_tol: 0.1, unit: '%' }, explanation: '4 × 19.105 = 76.42%.', misconception: 'Multiplying by 365 instead of its square root.' },
    { id: 'cd-q8-2', objective: 'cd-o6', skill: 'crypto_risk', difficulty: 2, qtype: 'numeric', stem: 'A coin falls 75% from its peak. What percentage gain does it need to get back to the peak?', correct: { value: 300, abs_tol: 0.05, unit: '%' }, explanation: '100 → 25; returning to 100 needs 75 ÷ 25 = 300%.', misconception: 'Assuming the recovery equals the fall (75%).' },
    { id: 'cd-q8-3', objective: 'cd-o6', skill: 'crypto_risk', difficulty: 2, qtype: 'single_choice', stem: 'Why does ATLAS annualise crypto volatility with √365 but Indian equity volatility with √252?', options: ['Crypto is riskier', 'Crypto trades every calendar day; Indian equities trade on about 252 sessions a year', 'It is a regulatory requirement', 'To make crypto look less volatile'], correct: { index: 1 }, explanation: 'The convention follows the number of trading periods in a year.', misconception: 'Thinking the factor expresses a judgement about risk.' },
  ],
};

const L9: SourceLesson = {
  id: 'cd-l9', title: 'Security, scams and counterparty risk', minutes: 13, objectives: ['cd-o6'], prerequisites: ['cd-l4'], mastery_rule: RULE('cd-o6'),
  references: [SEBI_CAUTION, { title: 'Reserve Bank of India: cautions on virtual currencies', url: 'https://www.rbi.org.in/', note: 'The RBI has repeatedly cautioned users about the risks of virtual currencies; check its press releases for the current position.' }],
  blocks: [
    { stage: 'discover', kind: 'text', title: 'Irreversible transfers attract fraud', body: [
      'Blockchain transfers cannot be reversed by a bank or a help desk. That makes crypto attractive to fraudsters, and most losses come from deception rather than broken cryptography.',
      'Common patterns: fake websites and apps that capture seed phrases; “support staff” who ask for keys; giveaways promising to send back double; imitation tokens using famous names; contracts that request unlimited permission to move your tokens; schemes that promise fixed high returns.',
      'Keeping coins on an exchange adds counterparty risk: the exchange holds the keys, and if it fails or freezes withdrawals, customers may lose access. Several large exchanges have failed this way.',
    ] },
    { stage: 'observe', kind: 'atlas_task', title: 'Check identity before trusting a name', href: '/app/crypto/assets', steps: [
      'Search the Explorer for a well-known name and note how many different assets and ids appear.',
      'Open the genuine asset and read its contract addresses and their source (provider-reported, not verified by ATLAS).',
      'Note the advice on the asset page: always check a contract address against the project’s official sources.',
    ], alt_text: 'The Explorer search results show several assets with similar names, each with a distinct id; the asset page lists contract addresses with a provenance note.' },
    { stage: 'predict', kind: 'prediction', prompt: 'A message promises to send back double any coins you transfer to an address. What is it?', options: ['A promotion by the project', 'A scam: transfers cannot be reversed and nothing comes back', 'A staking reward'], answer: 1, reveal: 'This is one of the most common crypto scams. Legitimate projects do not ask you to send funds to receive more.' },
    { stage: 'investigate', kind: 'worked_example', title: 'A checklist before sending', steps: [
      'Check the whole receiving address, not just the first and last few characters (some malware swaps copied addresses).',
      'Check the network: sending a token on the wrong network can make it unrecoverable.',
      'For tokens, check the contract address against the project’s official site or documentation, not a search result or a message.',
      'Consider a small test transfer first. And remember: nobody legitimate asks for a seed phrase or private key.',
    ] },
    { stage: 'decide', kind: 'guided_practice', prompt: 'You sent a stablecoin on the wrong network to an exchange deposit address. Can the network reverse it?', hint: 'Think about who controls blockchain transfers.', answer_text: 'No. The blockchain cannot reverse it; only the receiving exchange might be able to help, and it is not obliged to.' },
    { stage: 'explain', kind: 'reflection', prompt: 'What is counterparty risk when coins are held on an exchange?', model_answer: 'The exchange controls the keys and owes customers balances. If it is hacked, insolvent or freezes withdrawals, customers depend on it to make them whole, which it may not do.' },
    { stage: 'review', kind: 'summary', points: ['Most losses come from deception: phishing, fake support, giveaways, imitation tokens.', 'Transfers are irreversible; check address, network and contract before sending.', 'Exchange custody means depending on the exchange’s solvency and security.'] },
  ],
  quiz: [
    { id: 'cd-q9-1', objective: 'cd-o6', skill: 'crypto_risk', difficulty: 1, qtype: 'multi_select', stem: 'Which are warning signs of a scam? Select all that apply.', options: ['A promise of fixed high daily returns', 'A request for your seed phrase', 'Pressure to transfer immediately', 'Open-source code that anyone can inspect'], correct: { indexes: [0, 1, 2] }, explanation: 'Promised returns, requests for secrets and pressure are classic signs; open code is not.', misconception: 'Trusting urgency or promised returns.' },
    { id: 'cd-q9-2', objective: 'cd-o6', skill: 'crypto_risk', difficulty: 2, qtype: 'single_choice', stem: 'Coins held in an exchange account are…', options: ['Stored in your personal wallet', 'Held by the exchange on your behalf, so you depend on its solvency and security', 'Insured by the blockchain', 'Impossible to lose'], correct: { index: 1 }, explanation: 'The exchange controls the keys; customers have a claim against it.', misconception: 'Believing exchange balances are self-custodied.' },
    { id: 'cd-q9-3', objective: 'cd-o6', skill: 'crypto_risk', difficulty: 2, qtype: 'single_choice', stem: 'A token with a famous project’s name has a different contract address from the one on the project’s official site. What is it most likely?', options: ['A newer official version', 'An imitation token; the name proves nothing', 'The same token on a test network', 'A data error'], correct: { index: 1 }, explanation: 'Anyone can deploy a token with any name; the official contract address is what identifies it.', misconception: 'Trusting the token name.' },
  ],
};

const DIAGNOSTIC: SourceQuestion[] = [
  { id: 'cd-d01', skill: 'blockchain_basics', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'A public blockchain is best described as:', options: ['A company’s private database', 'A shared ledger kept and checked by many independent computers', 'A stock exchange', 'A bank account'], correct: { index: 1 }, explanation: 'Many nodes keep and verify copies of the same ledger.', misconception: 'Thinking one organisation runs it.' },
  { id: 'cd-d02', skill: 'blockchain_basics', difficulty: 2, qtype: 'numeric', stem: 'A transaction is in block 500. The latest block is 503. How many confirmations does it have?', correct: { value: 4, abs_tol: 0 }, explanation: '503 − 500 + 1 = 4.', misconception: 'Not counting the block that contains it.' },
  { id: 'cd-d03', skill: 'wallets_keys', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'Which of these must never be shared with anyone?', options: ['Your receiving address', 'Your seed phrase', 'A transaction id', 'The name of your wallet app'], correct: { index: 1 }, explanation: 'The seed phrase gives full control of the funds.', misconception: 'Thinking support staff may need it.' },
  { id: 'cd-d04', skill: 'coins_tokens', difficulty: 2, qtype: 'single_choice', stem: 'Two unrelated assets share the ticker “ABC”. What identifies each one?', options: ['The ticker', 'A unique id, or a contract address on a named network', 'Their prices', 'Their logos'], correct: { index: 1 }, explanation: 'Tickers are not unique.', misconception: 'Trusting symbols as identities.' },
  { id: 'cd-d05', skill: 'market_pairs', difficulty: 2, qtype: 'single_choice', stem: 'On an exchange, BTC/USDT means:', options: ['The price of USDT in BTC', 'The price of one BTC in USDT, in that venue’s order book', 'A global average price', 'A loan of BTC'], correct: { index: 1 }, explanation: 'The quote currency is the second asset.', misconception: 'Reading the pair backwards.' },
  { id: 'cd-d06', skill: 'market_cap_supply', difficulty: 2, qtype: 'numeric', critical: true, stem: 'A token trades at $2 with 50 million circulating. What is its market capitalisation, in millions of dollars?', correct: { value: 100, abs_tol: 0.01 }, explanation: '50 M × $2 = $100 M.', misconception: 'Using maximum supply.' },
  { id: 'cd-d07', skill: 'stablecoins', difficulty: 2, qtype: 'single_choice', stem: 'A stablecoin aims to:', options: ['Double in value each year', 'Keep a steady value against a reference such as one US dollar', 'Track the price of bitcoin', 'Pay a fixed interest rate'], correct: { index: 1 }, explanation: 'Stablecoins target a peg; how well depends on their design.', misconception: 'Thinking stablecoins promise returns.' },
  { id: 'cd-d08', skill: 'crypto_risk', difficulty: 1, qtype: 'single_choice', critical: true, stem: 'A website promises to return double any crypto you send to it. This is:', options: ['A promotion', 'A common scam', 'A staking product', 'Government support'], correct: { index: 1 }, explanation: 'Giveaway doubling schemes are scams.', misconception: 'Trusting promised returns.' },
  { id: 'cd-d09', skill: 'percentages', difficulty: 2, qtype: 'numeric', stem: 'A price falls 50%. What percentage gain is needed to get back to where it started?', correct: { value: 100, abs_tol: 0.05 }, explanation: '50 → 100 is +100%.', misconception: 'Answering 50%.' },
  { id: 'cd-d10', skill: 'crypto_risk', difficulty: 2, qtype: 'single_choice', stem: 'A blockchain transfer sent to the wrong address can usually be:', options: ['Reversed by the network on request', 'Reversed by your bank', 'Not reversed by the network; only the recipient could return it', 'Cancelled within 24 hours'], correct: { index: 2 }, explanation: 'Confirmed transfers are final on the network.', misconception: 'Expecting bank-style chargebacks.' },
  { id: 'cd-d11', skill: 'market_cap_supply', difficulty: 3, qtype: 'single_choice', stem: 'Fully diluted valuation differs from market capitalisation because it uses:', options: ['A different price', 'Maximum (or total) supply instead of circulating supply', 'Only exchange volume', 'Inflation-adjusted values'], correct: { index: 1 }, explanation: 'FDV assumes every possible token exists at today’s price.', misconception: 'Treating FDV as a forecast.' },
];

export const CRYPTO_DECODER: SourceCourse = {
  id: 'crypto-decoder',
  position: 5,
  title: 'ATLAS: CRYPTO MARKET DECODER',
  tagline: 'How blockchains and digital assets work, and how to read their markets.',
  description: 'Start here if you are new to crypto. You will learn what a blockchain records, how coins differ from tokens, what wallets and keys do, how exchange prices differ from reference prices, what market capitalisation and supply mean, how stablecoins work, and why volatility and fraud are central risks.',
  audience: 'Beginners comfortable with percentages; no prior crypto knowledge needed.',
  prerequisites: 'Percentages and simple arithmetic. The MARKET DECODER course is helpful but not required.',
  completion_statement: 'This record shows which learning objectives you practised and the assessments you completed in the ATLAS Academy. It is not a professional qualification, licence or certification, and it says nothing about future investment results.',
  rules: { high_min: 0.8, low_max: 0.4, critical_miss_low: 2, questions: 5, max_attempts_per_week: 3 },
  objectives: [
    { id: 'cd-o1', statement: 'Explain what a blockchain records, how blocks link and what confirmations and fees mean.', skill: 'blockchain_basics' },
    { id: 'cd-o2', statement: 'Distinguish coins from tokens and explain what wallets, addresses, keys and signatures do.', skill: 'wallets_keys' },
    { id: 'cd-o3', statement: 'Explain market pairs, venue-specific prices, reference prices and how orders fill.', skill: 'market_pairs' },
    { id: 'cd-o4', statement: 'Calculate and interpret market capitalisation, circulating supply and fully diluted valuation.', skill: 'market_cap_supply' },
    { id: 'cd-o5', statement: 'Describe stablecoin designs and what a loss of peg signals.', skill: 'stablecoins' },
    { id: 'cd-o6', statement: 'Quantify crypto volatility correctly and recognise security, fraud and counterparty risks.', skill: 'crypto_risk' },
  ],
  modules: [
    { id: 'cd-m1', title: 'What a blockchain is', summary: 'The shared ledger, blocks, hashes, fees and confirmations.', lessons: [L1, L2] },
    { id: 'cd-m2', title: 'Coins, tokens and keys', summary: 'Native coins versus tokens, and what wallets and signatures really do.', lessons: [L3, L4] },
    { id: 'cd-m3', title: 'Markets and prices', summary: 'Market pairs and venues, market capitalisation and supply, and stablecoins.', lessons: [L5, L6, L7] },
    { id: 'cd-m4', title: 'Risk', summary: 'Volatility measured correctly, and the security and fraud risks specific to crypto.', lessons: [L8, L9] },
  ],
  diagnostic: DIAGNOSTIC,
};
