import { seededRandom } from './learning-sims-courses.js';

// Deterministic educational models behind the Crypto Academy scenes. These are SIMPLIFIED, LABELLED
// MODELS for teaching, never descriptions of a real asset or protocol. Tests: test/crypto-sims.test.ts.

// ───────────────────────────── Tokenomics ─────────────────────────────

export interface UnlockTranche { label: string; amount: number; cliffMonths: number; vestingMonths: number }

export interface TokenomicsInput {
  /** Tokens circulating at month 0. */
  initialCirculating: number;
  /** Tokens locked in tranches at month 0 (part of total supply but not circulating). */
  tranches: UnlockTranche[];
  /** New tokens issued per month (emissions), added to circulating supply. */
  monthlyEmission: number;
  /** Share of circulating supply burned (destroyed) each month, 0–1. */
  monthlyBurnRate: number;
  /** Maximum supply cap; emissions stop when total supply reaches it. null = no cap. */
  maxSupply: number | null;
  /** Illustrative constant token price, used only to show market cap and FDV arithmetic. */
  price: number;
  months: number;
}

export interface TokenomicsMonth { month: number; circulating: number; locked: number; total: number; unlocked: number; emitted: number; burned: number; marketCap: number; fdv: number; circulatingShare: number; monthlyDilution: number }

/**
 * Month-by-month supply path:
 *   unlocked_m = Σ tranche linear vesting after the cliff (amount / vestingMonths per month; all at once if vestingMonths = 0)
 *   emitted_m  = min(monthlyEmission, maxSupply − total) (never negative)
 *   burned_m   = monthlyBurnRate × (circulating after unlocks and emissions)
 *   total      = circulating + locked;  market cap = circulating × price;  FDV = (maxSupply ?? total) × price
 */
export function simulateTokenomics(i: TokenomicsInput): TokenomicsMonth[] {
  let circ = i.initialCirculating;
  const remaining = i.tranches.map((t) => t.amount);
  const out: TokenomicsMonth[] = [];
  const locked = () => remaining.reduce((a, b) => a + b, 0);
  out.push(row(0, 0, 0, 0, circ));
  for (let m = 1; m <= i.months; m++) {
    let unlocked = 0;
    i.tranches.forEach((t, k) => {
      if (m <= t.cliffMonths || remaining[k]! <= 0) return;
      const step = t.vestingMonths <= 0 ? remaining[k]! : Math.min(remaining[k]!, t.amount / t.vestingMonths);
      remaining[k]! -= step;
      unlocked += step;
    });
    const before = circ;
    circ += unlocked;
    const total = circ + locked();
    const emitted = i.maxSupply === null ? i.monthlyEmission : Math.max(0, Math.min(i.monthlyEmission, i.maxSupply - total));
    circ += emitted;
    const burned = circ * Math.min(1, Math.max(0, i.monthlyBurnRate));
    circ -= burned;
    out.push(row(m, unlocked, emitted, burned, circ, before));
  }
  return out;

  function row(month: number, unlocked: number, emitted: number, burned: number, c: number, before?: number): TokenomicsMonth {
    const total = c + locked();
    return { month, circulating: c, locked: locked(), total, unlocked, emitted, burned, marketCap: c * i.price, fdv: (i.maxSupply ?? total) * i.price, circulatingShare: c / (i.maxSupply ?? total), monthlyDilution: before && before > 0 ? c / before - 1 : 0 };
  }
}

// ───────────────────────────── Constant-product AMM ─────────────────────────────

export interface Pool { x: number; y: number; fee: number }

/** Swap dx of token X into the pool (x·y = k, fee taken from the input). Returns tokens Y out and the new pool. */
export function swapXForY(p: Pool, dx: number): { dy: number; pool: Pool; priceBefore: number; priceAfter: number; executionPrice: number; priceImpact: number; feePaid: number } {
  if (!(dx > 0)) throw new Error('dx must be positive');
  const dxEff = dx * (1 - p.fee);
  const dy = (p.y * dxEff) / (p.x + dxEff);
  const pool = { x: p.x + dx, y: p.y - dy, fee: p.fee };
  const priceBefore = p.y / p.x;
  const priceAfter = pool.y / pool.x;
  const executionPrice = dy / dx;
  return { dy, pool, priceBefore, priceAfter, executionPrice, priceImpact: executionPrice / priceBefore - 1, feePaid: dx * p.fee };
}

/**
 * Impermanent loss of a 50/50 constant-product position relative to holding, when the price of X in Y
 * changes by ratio r = P_new / P_old (fees ignored): IL(r) = 2√r / (1 + r) − 1.
 */
export function impermanentLoss(r: number): number {
  if (!(r > 0)) throw new Error('price ratio must be positive');
  return (2 * Math.sqrt(r)) / (1 + r) - 1;
}

/** Value of an LP position vs holding, in Y, after the price of X moves from p0 to p1 (no fees). */
export function lpVsHold(x0: number, y0: number, p1: number): { hold: number; lp: number; x1: number; y1: number } {
  const k = x0 * y0;
  const x1 = Math.sqrt(k / p1);
  const y1 = Math.sqrt(k * p1);
  return { hold: x0 * p1 + y0, lp: x1 * p1 + y1, x1, y1 };
}

// ───────────────────────────── Toy hashing and a hash-linked chain ─────────────────────────────

/**
 * FNV-1a 32-bit. A TOY hash for showing that changing any input changes the output. It is NOT
 * cryptographically secure; real blockchains use SHA-256 (Bitcoin) or Keccak-256 (Ethereum).
 */
export function toyHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface ToyBlock { height: number; prev: string; txs: string[]; nonce: number; hash: string }

export function toyBlockHash(b: Omit<ToyBlock, 'hash'>): string {
  return toyHash(`${b.height}|${b.prev}|${b.txs.join(';')}|${b.nonce}`);
}

/** Find the smallest nonce whose toy hash starts with `zeros` hex zeros (proof-of-work, toy difficulty). */
export function toyMine(height: number, prev: string, txs: string[], zeros: number, maxTries = 2_000_000): ToyBlock | null {
  const target = '0'.repeat(zeros);
  for (let nonce = 0; nonce < maxTries; nonce++) {
    const hash = toyBlockHash({ height, prev, txs, nonce });
    if (hash.startsWith(target)) return { height, prev, txs, nonce, hash };
  }
  return null;
}

/** First block whose stored hash or link no longer matches after an edit (null = chain valid). */
export function verifyToyChain(chain: ToyBlock[]): number | null {
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i]!;
    if (toyBlockHash(b) !== b.hash) return i;
    if (i > 0 && b.prev !== chain[i - 1]!.hash) return i;
  }
  return null;
}

// ───────────────────────────── Consensus (expected values) ─────────────────────────────

/** Proof of work: expected share of blocks equals share of hash power; expected blocks in n. */
export function powExpectedBlocks(hashShares: number[], blocks: number): number[] {
  const t = hashShares.reduce((a, b) => a + b, 0);
  return hashShares.map((h) => (t > 0 ? (h / t) * blocks : 0));
}

/** Probability an attacker with share q ever catches up from z blocks behind (Nakamoto 2008, §11). */
export function catchUpProbability(q: number, z: number): number {
  const p = 1 - q;
  if (q >= p) return 1;
  const lambda = z * (q / p);
  let sum = 1;
  let poisson = Math.exp(-lambda);
  for (let k = 0; k <= z; k++) {
    if (k > 0) poisson *= lambda / k;
    sum -= poisson * (1 - (q / p) ** (z - k));
  }
  return Math.max(0, Math.min(1, sum));
}

/** Proof-of-stake toy: validator chosen with probability proportional to stake, using a seeded draw. */
export function posSelect(stakes: number[], draws: number, seed = 7): number[] {
  const rnd = seededRandom(seed);
  const total = stakes.reduce((a, b) => a + b, 0);
  const counts = stakes.map(() => 0);
  for (let d = 0; d < draws; d++) {
    let x = rnd() * total;
    for (let i = 0; i < stakes.length; i++) {
      x -= stakes[i]!;
      if (x < 0) {
        counts[i]!++;
        break;
      }
    }
  }
  return counts;
}
