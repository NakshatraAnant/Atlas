'use client';

import { ownership, percentPath, spread, submitOrder, vwap, type Book, type Trade } from '@atlas/shared';
import { useId, useMemo, useState } from 'react';

// Academy building blocks: answer inputs, the learning-loop stepper and the interactive labs.
// Labs run on the tested simulations in @atlas/shared and describe themselves in text, so the
// lesson is complete without seeing the visual.

export type QType = 'single_choice' | 'numeric' | 'multi_select';
export interface PublicQuestion { question_id: string; version: number; qtype: QType; stem: string; options: string[]; skill: string; difficulty: number; unit: string | null }
export type Answer = { index: number } | { indexes: number[] } | { value: number } | null;

export const STAGES = ['discover', 'observe', 'predict', 'investigate', 'decide', 'explain', 'review'] as const;
const STAGE_LABEL: Record<string, string> = { discover: 'Discover', observe: 'Observe', predict: 'Predict', investigate: 'Investigate', decide: 'Decide', explain: 'Explain', review: 'Review' };

export function DraftBanner({ what = 'This content' }: { what?: string }) {
  return <p className="warn" role="note"><strong>Draft, pending expert review.</strong> {what} was prepared with AI assistance and has not yet passed ATLAS's seven-point content review. Use it to learn, and report anything that looks wrong.</p>;
}

export function StageStepper({ current, onPick, maxReached }: { current: number; onPick: (i: number) => void; maxReached: number }) {
  return (
    <ol className="stepper" aria-label="Lesson stages">
      {STAGES.map((s, i) => (
        <li key={s} className={i === current ? 'on' : i <= maxReached ? 'done' : ''}>
          <button type="button" onClick={() => onPick(i)} disabled={i > maxReached} aria-current={i === current ? 'step' : undefined}>
            <span className="n" aria-hidden="true">{i + 1}</span>{STAGE_LABEL[s]}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function QuestionInput({ q, value, onChange, disabled, outcome, index }: { q: PublicQuestion; value: Answer; onChange: (a: Answer) => void; disabled?: boolean; index: number; outcome?: { correct: boolean; correct_answer: any; explanation: string; misconception: string | null } }) {
  const name = `q-${q.question_id}`;
  const correctIdx: number[] = outcome ? ('index' in outcome.correct_answer ? [outcome.correct_answer.index] : 'indexes' in outcome.correct_answer ? outcome.correct_answer.indexes : []) : [];
  return (
    <fieldset className={`qcard${outcome ? (outcome.correct ? ' right' : ' wrong') : ''}`}>
      <legend><span className="mu">Question {index + 1}</span><br /><strong>{q.stem}</strong></legend>
      {q.qtype === 'numeric' ? (
        <label className="field">
          Your answer{q.unit ? ` (${q.unit})` : ''}
          <input type="number" inputMode="decimal" step="any" value={value && 'value' in value && Number.isFinite(value.value) ? value.value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : { value: Number(e.target.value) })} style={{ maxWidth: 220 }} />
        </label>
      ) : (
        q.options.map((o, k) => {
          const checked = q.qtype === 'single_choice' ? !!value && 'index' in value && value.index === k : !!value && 'indexes' in value && value.indexes.includes(k);
          return (
            <label key={k} className={`opt${outcome && correctIdx.includes(k) ? ' key' : ''}`}>
              <input
                type={q.qtype === 'single_choice' ? 'radio' : 'checkbox'} name={name} checked={checked} disabled={disabled}
                onChange={() => {
                  if (q.qtype === 'single_choice') onChange({ index: k });
                  else {
                    const cur = value && 'indexes' in value ? value.indexes : [];
                    onChange({ indexes: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
                  }
                }}
              />
              <span>{o}</span>
              {outcome && correctIdx.includes(k) && <span className="sr-only"> (correct answer)</span>}
            </label>
          );
        })
      )}
      {q.qtype === 'multi_select' && !outcome && <p className="mu">Select all that apply.</p>}
      {outcome && (
        <div className="feedback" role="status">
          <p><strong>{outcome.correct ? 'Correct.' : 'Not quite.'}</strong> {'value' in outcome.correct_answer && <>Answer: {outcome.correct_answer.value}{outcome.correct_answer.unit ? ` ${outcome.correct_answer.unit}` : ''}. </>}{outcome.explanation}</p>
          {outcome.misconception && <p className="mu">Common slip: {outcome.misconception}</p>}
        </div>
      )}
    </fieldset>
  );
}

export const answered = (a: Answer) => a !== null && ('index' in a || ('indexes' in a && a.indexes.length > 0) || ('value' in a && Number.isFinite(a.value)));

// ───────────── Interactive labs ─────────────

export function Lab({ widget }: { widget: string }) {
  if (widget === 'ownership_split') return <OwnershipLab />;
  if (widget === 'order_book') return <OrderBookLab />;
  if (widget === 'percent_path') return <PercentPathLab />;
  return <p className="mu">This interactive is not available.</p>;
}

function OwnershipLab() {
  const [issued, setIssued] = useState(1000000);
  const [held, setHeld] = useState(10000);
  const [newIssue, setNewIssue] = useState(0);
  const total = issued + newIssue;
  const before = ownership(Math.min(held, issued), issued);
  const after = ownership(Math.min(held, issued), total);
  const id = useId();
  return (
    <div className="lab">
      <div className="row">
        <label>Shares issued<input type="number" min={1} value={issued} onChange={(e) => setIssued(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></label>
        <label>Shares you hold<input type="number" min={0} max={issued} value={held} onChange={(e) => setHeld(Math.max(0, Math.min(issued, Math.round(Number(e.target.value) || 0))))} /></label>
        <label>New shares issued later<input type="range" min={0} max={issued} step={Math.max(1, Math.round(issued / 100))} value={newIssue} onChange={(e) => setNewIssue(Number(e.target.value))} aria-describedby={id} /></label>
      </div>
      <div className="bar" aria-hidden="true"><i style={{ width: `${Math.max(0.5, after)}%` }} /><b style={{ width: `${(newIssue / total) * 100}%` }} /></div>
      <p id={id} aria-live="polite">You own <strong>{fmtPct(before)}</strong> of {issued.toLocaleString('en-IN')} shares.{newIssue > 0 && <> After {newIssue.toLocaleString('en-IN')} new shares are issued, the same holding is <strong>{fmtPct(after)}</strong>: diluted by {fmtPct(before - after)} points.</>}</p>
    </div>
  );
}

function OrderBookLab() {
  const start: Book = { bids: [{ id: 1, side: 'buy', price: 99, qty: 100 }, { id: 2, side: 'buy', price: 98, qty: 200 }], asks: [{ id: 3, side: 'sell', price: 101, qty: 100 }, { id: 4, side: 'sell', price: 102, qty: 200 }] };
  const [book, setBook] = useState<Book>(start);
  const [trades, setTrades] = useState<(Trade & { seq: number })[]>([]);
  const [nextId, setNextId] = useState(5);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('market');
  const [price, setPrice] = useState(101);
  const [qty, setQty] = useState(250);
  const [msg, setMsg] = useState<string>('');
  const s = spread(book);
  const place = () => {
    try {
      const r = submitOrder(book, { id: nextId, side, price: type === 'market' ? null : price, qty });
      setBook(r.book);
      setTrades([...r.trades.map((t, i) => ({ ...t, seq: nextId * 100 + i })), ...trades].slice(0, 12));
      setNextId(nextId + 1);
      const avg = vwap(r.trades);
      setMsg(r.trades.length ? `Traded ${r.trades.reduce((a, t) => a + t.qty, 0)} shares at an average of ₹${avg!.toFixed(2)}${r.unfilled ? `; ${r.unfilled} could not be filled and were cancelled` : ''}.` : type === 'limit' ? `No matching ${side === 'buy' ? 'sellers' : 'buyers'} at ₹${price}: your order now waits in the book.` : 'Nothing to trade against.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="lab">
      <div className="row">
        <label>Side<select value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
        <label>Type<select value={type} onChange={(e) => setType(e.target.value as 'limit' | 'market')}><option value="market">Market (best available)</option><option value="limit">Limit</option></select></label>
        {type === 'limit' && <label>Price (₹)<input type="number" step="0.5" min={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} style={{ width: 100 }} /></label>}
        <label>Quantity<input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(Math.round(Number(e.target.value)))} style={{ width: 100 }} /></label>
        <button type="button" className="btn" onClick={place}>Send order</button>
        <button type="button" className="btn s" onClick={() => { setBook(start); setTrades([]); setNextId(5); setMsg(''); }}>Reset</button>
      </div>
      <p aria-live="polite" className="mu">{msg || 'Try a market buy of 250 shares, then a sell limit at ₹99.'}</p>
      <div className="grid2">
        <table><caption>Buy orders (bids), best first</caption><thead><tr><th>Order</th><th>Price</th><th>Qty</th></tr></thead>
          <tbody>{book.bids.length ? book.bids.map((o) => <tr key={o.id}><td>#{o.id}</td><td>₹{o.price}</td><td>{o.qty}</td></tr>) : <tr><td colSpan={3} className="mu">No buyers waiting</td></tr>}</tbody></table>
        <table><caption>Sell orders (asks), best first</caption><thead><tr><th>Order</th><th>Price</th><th>Qty</th></tr></thead>
          <tbody>{book.asks.length ? book.asks.map((o) => <tr key={o.id}><td>#{o.id}</td><td>₹{o.price}</td><td>{o.qty}</td></tr>) : <tr><td colSpan={3} className="mu">No sellers waiting</td></tr>}</tbody></table>
      </div>
      <p className="mu">{s ? `Spread: ₹${s.abs.toFixed(2)} (${s.pct_of_mid.toFixed(2)}% of the mid-price).` : 'No spread: one side of the book is empty.'}</p>
      {trades.length > 0 && <table><caption>Trades, newest first</caption><thead><tr><th>Buyer</th><th>Seller</th><th>Price</th><th>Qty</th></tr></thead><tbody>{trades.map((t) => <tr key={t.seq} className="fresh"><td>#{t.buyId}</td><td>#{t.sellId}</td><td>₹{t.price}</td><td>{t.qty}</td></tr>)}</tbody></table>}
    </div>
  );
}

function PercentPathLab() {
  const [moves, setMoves] = useState<number[]>([10, -10]);
  const p = useMemo(() => percentPath(100, moves), [moves]);
  const max = Math.max(...p.values, 100) * 1.1;
  const w = 320, h = 140, step = w / Math.max(1, p.values.length - 1);
  const pts = p.values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(' ');
  return (
    <div className="lab">
      <div className="row">
        {moves.map((m, i) => (
          <label key={i}>Move {i + 1} (%)<input type="number" step={1} min={-99} max={500} value={m} onChange={(e) => setMoves(moves.map((x, j) => (j === i ? Math.max(-99, Math.min(500, Number(e.target.value) || 0)) : x)))} style={{ width: 80 }} /></label>
        ))}
        {moves.length < 6 && <button type="button" className="btn s" onClick={() => setMoves([...moves, 0])}>Add a move</button>}
        {moves.length > 1 && <button type="button" className="btn s" onClick={() => setMoves(moves.slice(0, -1))}>Remove last</button>}
      </div>
      <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} role="img" aria-label={`₹100 becomes ${p.values.map((v) => `₹${v.toFixed(2)}`).join(', then ')}`} className="pathsvg">
        <line x1={0} x2={w} y1={h - (100 / max) * h} y2={h - (100 / max) * h} className="base" />
        <polyline points={pts} />
        {p.values.map((v, i) => <circle key={i} cx={i * step} cy={h - (v / max) * h} r={3.5} />)}
      </svg>
      <p aria-live="polite">₹100 ends at <strong>₹{p.values[p.values.length - 1]!.toFixed(2)}</strong>: a total change of <strong>{p.total_pct.toFixed(2)}%</strong>. Simply adding the moves would suggest {p.naive_sum_pct.toFixed(2)}%.</p>
    </div>
  );
}

const fmtPct = (x: number) => `${x < 0.1 ? x.toFixed(4) : x.toFixed(2)}%`;
