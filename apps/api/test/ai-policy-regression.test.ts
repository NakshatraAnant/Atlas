import { describe, expect, it } from 'vitest';
import { classify } from '../src/modules/ai/policy.js';
import { resolveCompanies } from '../src/modules/ai/orchestrator.js';

// Regressions found by the AI evaluation suite in session 4.
describe('assistant policy regressions', () => {
  it.each([
    'Will Bakul Autoparts go up next month?',
    'Will Elaichi Infra Materials go up next month?',
    'Is Everest Capital undervalued enough to invest in?',
    'Is Kaveri Foods worth investing in?',
    'Kaveri Foods is going to double, right?',
  ])('refuses as advice/prediction: %s', (q) => expect(classify(q).intent).toBe('advice'));
  it.each(['What is the forex rate for USD today?', 'What is the bitcoin price?', 'What is the weather in Mumbai?'])('treats as off topic: %s', (q) => expect(classify(q).intent).toBe('off_topic'));
  it.each([
    'How did Kaveri Foods operating margin rise over the last eight quarters?',
    'Why did the market fall today?',
    'What is ROCE and how is it calculated?',
    'Compare debt to equity for IT companies',
    'Explain the drawdown in my backtest',
  ])('keeps research questions as research: %s', (q) => expect(classify(q).intent).toBe('research'));
  it('flags a company name that is not in the catalogue instead of ignoring it', () => {
    const cat = [{ company_id: 'x', short_name: 'Kaveri Foods', legal_name: 'Kaveri Foods Ltd', former_names: [], symbols: ['KAVERIFOOD'], coverage: 'full', sector: 'FMCG' }] as never;
    expect(resolveCompanies('What is the ROCE of Tata Motors?', cat).unknown).toBe('Tata Motors');
    expect(resolveCompanies('What is the ROCE of Kaveri Foods?', cat).matched).toHaveLength(1);
    expect(resolveCompanies('What was revenue growth for March?', cat).unknown).toBeNull();
    expect(resolveCompanies('Show breadth for Nifty', cat).unknown).toBeNull();
  });
});

describe('missing values in the evidence trail', () => {
  it('a claim with no value never supports a number in the text (no fabricated zero)', async () => {
    const { checkClaims } = await import('../src/modules/ai/claims.js');
    const claims = [{ id: 'cl_1', value: null, label: 'Debt to equity, latest', evidenceId: 'mv.x.debt_equity.LATEST.consolidated' }];
    expect(checkClaims('Debt to equity is 0.', claims).unmatched).toEqual(['0']);
    expect(checkClaims('Debt to equity is not meaningful.', claims).passed).toBe(true);
  });
});
