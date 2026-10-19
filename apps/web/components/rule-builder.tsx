'use client';

// No-code rule builder (PRD BKT-02). Produces the RuleSet the API validates; the plain-language
// preview mirrors the server's describeRules so the user sees exactly what will be tested.

export type IndKind = 'close' | 'sma' | 'rsi' | 'prev_high' | 'prev_low' | 'return_pct' | 'volatility_pct';
export type Operand = { kind: IndKind; period?: number } | { kind: 'value'; value: number };
export interface Cond { left: { kind: IndKind; period?: number }; op: '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below'; right: Operand }
export interface Group { combine: 'and' | 'or'; conditions: Cond[] }
export interface RuleSet { entry: Group; exit: Group; max_hold?: number }

const KINDS: { kind: IndKind; label: string; period?: number }[] = [
  { kind: 'close', label: 'Close' },
  { kind: 'sma', label: 'SMA', period: 50 },
  { kind: 'rsi', label: 'RSI', period: 14 },
  { kind: 'prev_high', label: 'Previous N-session high', period: 252 },
  { kind: 'prev_low', label: 'Previous N-session low', period: 126 },
  { kind: 'return_pct', label: 'N-session return %', period: 20 },
  { kind: 'volatility_pct', label: 'N-session volatility %', period: 20 },
];
const OPS: [Cond['op'], string][] = [['>', 'is above'], ['<', 'is below'], ['>=', 'is at or above'], ['<=', 'is at or below'], ['crosses_above', 'crosses above'], ['crosses_below', 'crosses below']];
const LABEL = (o: Operand) => (o.kind === 'value' ? String(o.value) : o.kind === 'close' ? 'close' : o.kind === 'sma' ? `SMA(${o.period})` : o.kind === 'rsi' ? `RSI(${o.period})` : o.kind === 'prev_high' ? `highest close of the previous ${o.period} sessions` : o.kind === 'prev_low' ? `lowest close of the previous ${o.period} sessions` : o.kind === 'return_pct' ? `${o.period}-session return %` : `${o.period}-session volatility %`);

export const DEFAULT_RULES: RuleSet = {
  entry: { combine: 'and', conditions: [{ left: { kind: 'sma', period: 50 }, op: 'crosses_above', right: { kind: 'sma', period: 200 } }] },
  exit: { combine: 'or', conditions: [{ left: { kind: 'sma', period: 50 }, op: 'crosses_below', right: { kind: 'sma', period: 200 } }] },
};

export function describe(r: RuleSet): string {
  const g = (grp: Group) => grp.conditions.map((c) => `${LABEL(c.left)} ${OPS.find((o) => o[0] === c.op)![1]} ${LABEL(c.right)}`).join(grp.combine === 'and' ? ' AND ' : ' OR ');
  return `Enter long when ${g(r.entry)}. Exit when ${g(r.exit)}${r.max_hold ? ` or after ${r.max_hold} sessions` : ''}.`;
}

function IndicatorPicker({ value, onChange, allowValue, label }: { value: Operand; onChange: (o: Operand) => void; allowValue?: boolean; label: string }) {
  return (
    <span className="rb-ind">
      <select aria-label={`${label}: indicator`} value={value.kind} onChange={(e) => {
        const k = e.target.value as IndKind | 'value';
        onChange(k === 'value' ? { kind: 'value', value: 30 } : { kind: k, period: KINDS.find((x) => x.kind === k)!.period });
      }}>
        {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        {allowValue && <option value="value">A number</option>}
      </select>
      {value.kind === 'value' ? (
        <input aria-label={`${label}: number`} type="number" step="any" value={value.value} onChange={(e) => onChange({ kind: 'value', value: Number(e.target.value) })} style={{ width: 90 }} />
      ) : value.period !== undefined ? (
        <input aria-label={`${label}: sessions`} type="number" min={2} max={300} step={1} value={value.period} onChange={(e) => onChange({ ...value, period: Math.round(Number(e.target.value)) })} style={{ width: 70 }} />
      ) : null}
    </span>
  );
}

function GroupEditor({ title, group, onChange }: { title: string; group: Group; onChange: (g: Group) => void }) {
  const set = (i: number, c: Cond) => onChange({ ...group, conditions: group.conditions.map((x, k) => (k === i ? c : x)) });
  return (
    <fieldset className="rb-group">
      <legend>{title}</legend>
      <label className="field">Combine conditions with
        <select value={group.combine} onChange={(e) => onChange({ ...group, combine: e.target.value as 'and' | 'or' })}><option value="and">AND (all must hold)</option><option value="or">OR (any may hold)</option></select>
      </label>
      {group.conditions.map((c, i) => (
        <div className="rb-cond" key={i}>
          <IndicatorPicker label={`${title} condition ${i + 1} left`} value={c.left} onChange={(o) => o.kind !== 'value' && set(i, { ...c, left: o })} />
          <select aria-label={`${title} condition ${i + 1} comparison`} value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as Cond['op'] })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <IndicatorPicker label={`${title} condition ${i + 1} right`} value={c.right} onChange={(o) => set(i, { ...c, right: o })} allowValue />
          {group.conditions.length > 1 && <button type="button" className="btn s" onClick={() => onChange({ ...group, conditions: group.conditions.filter((_, k) => k !== i) })} aria-label={`Remove ${title} condition ${i + 1}`}>Remove</button>}
        </div>
      ))}
      {group.conditions.length < 5 && <button type="button" className="btn s" onClick={() => onChange({ ...group, conditions: [...group.conditions, { left: { kind: 'close' }, op: '>', right: { kind: 'sma', period: 50 } }] })}>Add condition</button>}
    </fieldset>
  );
}

export function RuleBuilder({ value, onChange }: { value: RuleSet; onChange: (r: RuleSet) => void }) {
  return (
    <div className="rb">
      <GroupEditor title="Entry" group={value.entry} onChange={(entry) => onChange({ ...value, entry })} />
      <GroupEditor title="Exit" group={value.exit} onChange={(exit) => onChange({ ...value, exit })} />
      <label className="field">Maximum holding period in sessions (optional)
        <input type="number" min={1} max={500} value={value.max_hold ?? ''} onChange={(e) => onChange({ ...value, max_hold: e.target.value ? Math.round(Number(e.target.value)) : undefined })} style={{ width: 100 }} />
      </label>
      <p className="mu" aria-live="polite"><strong>Rules being tested:</strong> {describe(value)} Signals at the close; orders fill at the next session&apos;s open.</p>
    </div>
  );
}
