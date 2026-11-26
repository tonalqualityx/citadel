/** Retainer month wording. Pure and client-safe: nothing here touches prisma. */

const MONTH_RE = /^(\d{4})-(\d{2})$/;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthName(month: string): string {
  const p = parse(month);
  return p ? MONTH_NAMES[p.month] : month;
}
export function monthLabel(month: string): string {
  const p = parse(month);
  return p ? `${MONTH_NAMES[p.month]} ${p.year}` : month;
}

/** "3.5 h", "0.5 h", "2 h": hours to one decimal, no trailing zero. */
export function hoursText(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** "3 to 4 h" or "2 h" when low and high match. */
export function rangeText(low: number, high: number): string {
  const l = hoursText(low);
  const h = hoursText(high);
  return l === h ? h : `${l.replace(' h', '')} to ${h}`;
}


function parse(month: string): { year: number; month: number } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? { year: Number(m[1]), month: mo - 1 } : null;
}
