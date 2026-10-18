// Deterministic simulations behind the Academy's interactive labs. Pure functions so the
// teaching widgets and their tests agree exactly (packages/shared/test/learning-sims.test.ts).

export type Side = 'buy' | 'sell';
export interface BookOrder {
  id: number;
  side: Side;
  /** Limit price in rupees; null = market order (takes the best available prices). */
  price: number | null;
  qty: number;
}
export interface Trade {
  buyId: number;
  sellId: number;
  price: number;
  qty: number;
}
export interface Book {
  bids: BookOrder[];
  asks: BookOrder[];
}

/** Bids best (highest) first, asks best (lowest) first; ties keep arrival order (time priority). */
function sortBook(book: Book): Book {
  return {
    bids: [...book.bids].sort((a, b) => (b.price ?? 0) - (a.price ?? 0) || a.id - b.id),
    asks: [...book.asks].sort((a, b) => (a.price ?? 0) - (b.price ?? 0) || a.id - b.id),
  };
}

/**
 * Price-time priority matching. An incoming order trades against resting orders at the RESTING
 * order's price while prices cross. Any unfilled limit quantity rests in the book; unfilled
 * market quantity is cancelled (as it would be with no counter-party).
 */
export function submitOrder(book: Book, order: BookOrder): { book: Book; trades: Trade[]; unfilled: number } {
  if (!(order.qty > 0) || !Number.isInteger(order.qty)) throw new Error('Quantity must be a positive whole number');
  if (order.price !== null && !(order.price > 0)) throw new Error('Limit price must be positive');
  const b = sortBook(book);
  const opposite = order.side === 'buy' ? b.asks : b.bids;
  const trades: Trade[] = [];
  let left = order.qty;
  const crosses = (resting: BookOrder) => order.price === null || (order.side === 'buy' ? resting.price! <= order.price : resting.price! >= order.price);
  while (left > 0 && opposite.length && crosses(opposite[0]!)) {
    const top = opposite[0]!;
    const q = Math.min(left, top.qty);
    trades.push({ buyId: order.side === 'buy' ? order.id : top.id, sellId: order.side === 'sell' ? order.id : top.id, price: top.price!, qty: q });
    left -= q;
    if (q === top.qty) opposite.shift();
    else opposite[0] = { ...top, qty: top.qty - q };
  }
  const rest = left > 0 && order.price !== null ? [{ ...order, qty: left }] : [];
  const next = order.side === 'buy' ? { bids: [...b.bids, ...rest], asks: opposite } : { bids: opposite, asks: [...b.asks, ...rest] };
  return { book: sortBook(next), trades, unfilled: order.price === null ? left : 0 };
}

export function vwap(trades: Trade[]): number | null {
  const q = trades.reduce((s, t) => s + t.qty, 0);
  return q ? trades.reduce((s, t) => s + t.price * t.qty, 0) / q : null;
}

export function spread(book: Book): { bid: number; ask: number; abs: number; pct_of_mid: number } | null {
  const s = sortBook(book);
  const bid = s.bids[0]?.price;
  const ask = s.asks[0]?.price;
  if (bid == null || ask == null) return null;
  return { bid, ask, abs: ask - bid, pct_of_mid: ((ask - bid) / ((ask + bid) / 2)) * 100 };
}

/** Value path of `start` through percentage moves; also returns the naive sum for comparison. */
export function percentPath(start: number, movesPct: number[]): { values: number[]; total_pct: number; naive_sum_pct: number } {
  const values = [start];
  for (const m of movesPct) values.push(values[values.length - 1]! * (1 + m / 100));
  return { values, total_pct: (values[values.length - 1]! / start - 1) * 100, naive_sum_pct: movesPct.reduce((s, m) => s + m, 0) };
}

/** Gain needed to recover from a loss of `lossPct` percent. */
export const recoveryGainPct = (lossPct: number): number => (lossPct >= 100 ? Infinity : (1 / (1 - lossPct / 100) - 1) * 100);

export function ownership(held: number, issued: number): number {
  if (!(issued > 0) || held < 0 || held > issued) throw new Error('Holding must be between 0 and the shares issued');
  return (held / issued) * 100;
}
