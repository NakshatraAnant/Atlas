import { describe, expect, it } from 'vitest';
import { ownership, percentPath, recoveryGainPct, spread, submitOrder, vwap, type Book } from '../src/learning-sims.js';

const book: Book = {
  bids: [{ id: 1, side: 'buy', price: 99, qty: 100 }, { id: 2, side: 'buy', price: 98, qty: 200 }],
  asks: [{ id: 3, side: 'sell', price: 101, qty: 100 }, { id: 4, side: 'sell', price: 102, qty: 200 }],
};

describe('order matching (price-time priority)', () => {
  it('walks the book for a market buy: the lesson example averages ₹101.60', () => {
    const r = submitOrder(book, { id: 10, side: 'buy', price: null, qty: 250 });
    expect(r.trades).toEqual([{ buyId: 10, sellId: 3, price: 101, qty: 100 }, { buyId: 10, sellId: 4, price: 102, qty: 150 }]);
    expect(vwap(r.trades)).toBeCloseTo(101.6, 10);
    expect(r.book.asks).toEqual([{ id: 4, side: 'sell', price: 102, qty: 50 }]);
  });
  it('a sell limit at the best bid trades at the resting bid price', () => {
    const r = submitOrder(book, { id: 11, side: 'sell', price: 99, qty: 40 });
    expect(r.trades).toEqual([{ buyId: 1, sellId: 11, price: 99, qty: 40 }]);
    expect(r.book.bids[0]).toEqual({ id: 1, side: 'buy', price: 99, qty: 60 });
  });
  it('a non-crossing limit order rests in the book; equal prices keep arrival order', () => {
    const r = submitOrder(book, { id: 12, side: 'buy', price: 99, qty: 10 });
    expect(r.trades).toEqual([]);
    expect(r.book.bids.map((o) => o.id)).toEqual([1, 12, 2]);
    const s = submitOrder(r.book, { id: 13, side: 'sell', price: 99, qty: 105 });
    expect(s.trades.map((t) => [t.buyId, t.qty])).toEqual([[1, 100], [12, 5]]);
  });
  it('unfilled market quantity is cancelled, not rested; partly filled limit rests', () => {
    const m = submitOrder(book, { id: 14, side: 'buy', price: null, qty: 400 });
    expect(m.unfilled).toBe(100);
    expect(m.book.bids.some((o) => o.id === 14)).toBe(false);
    const l = submitOrder(book, { id: 15, side: 'buy', price: 101, qty: 150 });
    expect(l.book.bids[0]).toEqual({ id: 15, side: 'buy', price: 101, qty: 50 });
  });
  it('rejects invalid quantities and prices', () => {
    expect(() => submitOrder(book, { id: 16, side: 'buy', price: 100, qty: 0 })).toThrow();
    expect(() => submitOrder(book, { id: 17, side: 'buy', price: 100, qty: 1.5 })).toThrow();
    expect(() => submitOrder(book, { id: 18, side: 'buy', price: -1, qty: 1 })).toThrow();
  });
  it('spread matches the lesson practice: ₹249/₹251 → ₹2, 0.8% of mid', () => {
    const s = spread({ bids: [{ id: 1, side: 'buy', price: 249, qty: 50 }], asks: [{ id: 2, side: 'sell', price: 251, qty: 80 }] })!;
    expect(s.abs).toBe(2);
    expect(s.pct_of_mid).toBeCloseTo(0.8, 10);
    expect(spread({ bids: [], asks: [] })).toBeNull();
  });
});

describe('returns arithmetic used in lessons', () => {
  it('+20%, −10%, +5% compounds to 13.4%, not the naive 15%', () => {
    const p = percentPath(100, [20, -10, 5]);
    expect(p.total_pct).toBeCloseTo(13.4, 10);
    expect(p.naive_sum_pct).toBe(15);
    expect(p.values[3]).toBeCloseTo(113.4, 10);
  });
  it('recovery gains: −20% needs +25%, −50% needs +100%, −100% cannot recover', () => {
    expect(recoveryGainPct(20)).toBeCloseTo(25, 10);
    expect(recoveryGainPct(50)).toBeCloseTo(100, 10);
    expect(recoveryGainPct(100)).toBe(Infinity);
  });
  it('ownership percentage and dilution', () => {
    expect(ownership(1000, 1_00_00_000)).toBeCloseTo(0.01, 12);
    expect(ownership(10_000, 12_50_000)).toBeCloseTo(0.8, 12);
    expect(() => ownership(5, 0)).toThrow();
    expect(() => ownership(11, 10)).toThrow();
  });
});
