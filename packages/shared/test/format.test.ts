import { describe, expect, it } from 'vitest';
import { fiscalQuarterOf, fiscalYearOf, formatCrore, formatDate, formatIndianNumber, formatIstDateTime, formatLakhCrore, formatRupees, quarterLabel } from '../src/format.js';

describe('Indian number formatting (NFR-08)', () => {
  it('groups digits in lakh/crore style', () => {
    expect(formatIndianNumber(1234567, 0)).toBe('12,34,567');
    expect(formatIndianNumber(123, 0)).toBe('123');
    expect(formatIndianNumber(1000, 0)).toBe('1,000');
    expect(formatIndianNumber(100000, 0)).toBe('1,00,000');
    expect(formatIndianNumber(-98765432.105, 2)).toBe('-9,87,65,432.11');
  });
  it('formats rupees and crore', () => {
    expect(formatRupees(1234567)).toBe('₹12,34,567');
    expect(formatRupees(-500)).toBe('-₹500');
    expect(formatCrore(2242.3)).toBe('2,242.30');
    expect(formatLakhCrore(1250000)).toBe('₹12.50 lakh');
    expect(formatLakhCrore(11900000)).toBe('₹1.19 crore');
  });
  it('rejects non-finite values', () => {
    expect(() => formatIndianNumber(Number.NaN)).toThrow();
  });
});

describe('dates and fiscal periods', () => {
  it('formats DD MMM YYYY', () => expect(formatDate('2026-10-16')).toBe('16 Oct 2026'));
  it('converts to IST', () => expect(formatIstDateTime('2026-10-16T15:00:00Z')).toBe('16 Oct 2026, 20:30 IST'));
  it('assigns Indian financial years (FY27 = Apr 2026 to Mar 2027)', () => {
    expect(fiscalYearOf('2026-04-01')).toBe(2027);
    expect(fiscalYearOf('2027-03-31')).toBe(2027);
    expect(fiscalYearOf('2026-03-31')).toBe(2026);
  });
  it('assigns fiscal quarters', () => {
    expect(fiscalQuarterOf('2026-04-15')).toBe(1);
    expect(fiscalQuarterOf('2026-09-30')).toBe(2);
    expect(fiscalQuarterOf('2026-12-31')).toBe(3);
    expect(fiscalQuarterOf('2027-02-01')).toBe(4);
    expect(quarterLabel(2027, 1)).toBe('Q1 FY27');
  });
});
