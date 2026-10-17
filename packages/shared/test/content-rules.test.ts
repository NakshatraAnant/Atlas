import { describe, expect, it } from 'vitest';
import { checkContent, isContentClean, STANDARD_DISCLOSURE } from '../src/index.js';

describe('content rules (CPL-02, PRD §10.2)', () => {
  it.each([
    'Investors should buy Kaveri Foods now.',
    'We recommend accumulating this stock.',
    'Strong buy on Zenith Motors.',
    'The target price is ₹2,100.',
    'The stock will reach ₹1,900 by March.',
    'This is a sure-shot multibagger.',
    'Guaranteed returns of 20%.',
    'Act now — last chance to subscribe!',
    'Upside of 25% from here.',
    'Book profits after results.',
    'Add on dips.',
  ])('blocks: %s', (t) => {
    expect(checkContent(t).some((v) => v.action === 'block')).toBe(true);
  });

  it.each([
    'Operating margin was 18.4% in Q1 FY27, up from 16.9% a year earlier.',
    'Promoter shareholding was unchanged at 54.2%.',
    'Benchmark: buy-and-hold price return of the index.',
    'The company announced a buyback.',
    'Exit rule: the fast average crosses below the slow average; signals on the close.',
    'ATLAS does not give recommendations or price targets.',
    'Sharpe ratio uses the 91-day T-bill as the risk-free rate.',
    STANDARD_DISCLOSURE.text,
  ])('allows: %s', (t) => {
    expect(checkContent(t)).toEqual([]);
  });

  it('marks causal certainty for rewrite unless evidence is linked', () => {
    const t = 'The index fell because of the policy announcement.';
    const v = checkContent(t);
    expect(v).toHaveLength(1);
    expect(v[0]!.action).toBe('rewrite');
    expect(isContentClean(t, { causalEvidenceLinked: true })).toBe(true);
  });
});
