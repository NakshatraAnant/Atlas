// Date helpers working on ISO 'YYYY-MM-DD' strings (UTC-based arithmetic, no local-time drift).

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function endOfMonth(year: number, month1: number): string {
  return new Date(Date.UTC(year, month1, 0)).toISOString().slice(0, 10);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** IST wall-clock timestamp for a date and 'HH:MM' -> ISO instant. */
export function istInstant(isoDate: string, hhmm: string): string {
  return new Date(`${isoDate}T${hhmm}:00+05:30`).toISOString();
}

/** Current IST date and minutes since midnight. */
export function istNow(now: Date = new Date()): { date: string; minutes: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export function quarterEnd(fiscalYear: number, q: number): string {
  // Q1 = Apr–Jun of (fiscalYear - 1)
  const calYear = q === 4 ? fiscalYear : fiscalYear - 1;
  const month = [6, 9, 12, 3][q - 1]!;
  return endOfMonth(calYear, month);
}

export function quarterStart(fiscalYear: number, q: number): string {
  const end = quarterEnd(fiscalYear, q);
  return addDays(addMonths(end.slice(0, 8) + '01', -2), 0);
}
