/**
 * Number provenance for the chat copy gate (phase C spec 9.2).
 *
 * Every number the assistant writes must trace to this job's tool results, the tools' own range
 * labels, or the context bundle. The tool-call log stores the numbers each result carried
 * (`EngineToolCall.result_numbers`, built here); the gate masks the ones that match and fails on
 * any digit that is left. Pure: no database, no clock.
 *
 * A stored number is a canonical decimal string ("1234.5"). Money-bearing keys (revenue, total,
 * balance, amount) are stored with a "money:" prefix so a dollar figure can only be backed by a
 * money-bearing field, never by a visitor count that happens to match.
 */

export const MASK = '⟦n⟧';
export const MONEY_PREFIX = 'money:';

const MONEY_KEY = /revenue|amount|balance|total|price|paid/i;
/** Identifier-shaped keys (ids, invoice numbers) never count as numbers a reply may quote. */
const ID_KEY = /(^|_)id$|^qbo/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/** "1,234.50" -> "1234.5"; "$5" -> "5"; "12%" -> "12"; null when it is not a plain number. */
export function canonicalNumber(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[$€£]/, '').replace(/%$/, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return fmt(n);
}

function fmt(n: number): string {
  // Number -> shortest string, no exponent for the sizes analytics produce.
  const s = String(Math.abs(n) < 1e21 ? n : n.toFixed(0));
  return s === '-0' ? '0' : s;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
}

/** Every way a stored value may be displayed: itself, and rounded to 0..4 places. */
export function displayVariants(n: number): string[] {
  const out = new Set<string>([fmt(n)]);
  for (let p = 0; p <= 4; p++) out.add(fmt(round(n, p)));
  return [...out];
}

/** A rate stored as 0.456 is shown as 45.6%: the percent forms, rounded to 0..2 places. */
export function percentVariants(n: number): string[] {
  const out = new Set<string>();
  const v = n * 100;
  for (let p = 0; p <= 2; p++) out.add(fmt(round(v, p)));
  return [...out];
}

/** Digit runs in a string (labels, dates), canonical. "Oct 1 to Oct 20, 2026" -> 1, 20, 2026. */
export function numbersInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const c = canonicalNumber(m[0]);
    if (c !== null) out.push(c);
  }
  return out;
}

/**
 * Walk a tool result and list the numbers it carries. Numeric values and numeric strings count
 * ("1234" from the GA4 API arrives as a string); dates add year, month and day; the top-level
 * `label` string is handled by buildProvenance. Keys whose names say money are prefixed.
 */
export function extractResultNumbers(result: unknown): string[] {
  const out = new Set<string>();
  const add = (n: number, money: boolean) => {
    if (money) {
      // A dollar figure is exact: the value itself or its two-decimal form, never a rounding.
      for (const v of new Set([fmt(n), fmt(round(n, 2))])) {
        out.add(v);
        out.add(MONEY_PREFIX + v);
      }
      return;
    }
    for (const v of displayVariants(n)) out.add(v);
    if (n > 0 && n <= 1) for (const v of percentVariants(n)) out.add('pct:' + v);
  };
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 8) return;
    if (ID_KEY.test(key) && typeof value !== 'object') return;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) add(value, MONEY_KEY.test(key));
    } else if (typeof value === 'string') {
      const iso = ISO_DATE.exec(value);
      if (iso) {
        out.add(fmt(Number(iso[1])));
        out.add(fmt(Number(iso[2])));
        out.add(fmt(Number(iso[3])));
      } else if (/^-?\d[\d,]*(\.\d+)?$/.test(value)) {
        const c = canonicalNumber(value);
        if (c !== null) add(Number(c), MONEY_KEY.test(key));
      }
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v, key, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === 'label') continue;
        walk(v, k, depth + 1);
      }
    }
  };
  walk(result, '', 0);
  return [...out];
}

export interface ProvenanceCall {
  tool: string;
  /** For citadel_read: the read kind (invoices, requests...). */
  kind?: string;
  result_numbers: string[];
  /** The tool's own range label, when the result carried one. */
  label?: string | null;
}

export interface Provenance {
  /** Everything a number may be: results, labels, context. Plain canonical strings. */
  numbers: Set<string>;
  /** Percent forms ("45.6" for 0.456), valid only next to a percent sign. */
  percents: Set<string>;
  /** Dollar figures: only money-bearing fields of this job's reads. */
  money: Set<string>;
  /** Numbers that came from GA4 or Search Console (they need a named source and dates). */
  analytics: Set<string>;
  /** Source names and ranges the tools returned, e.g. "Google Analytics, Oct 1 to Oct 20, 2026". */
  labels: string[];
}

export function emptyProvenance(): Provenance {
  return { numbers: new Set(), percents: new Set(), money: new Set(), analytics: new Set(), labels: [] };
}

const ANALYTICS_TOOLS = new Set(['ga4_report', 'search_console']);

/**
 * Build the provenance for one job from its logged tool calls and the numbers in its context
 * bundle (allowance hours, today's date, what the client wrote).
 */
export function buildProvenance(calls: ProvenanceCall[], contextNumbers: string[] = []): Provenance {
  const p = emptyProvenance();
  for (const label of calls.map((c) => c.label).filter((l): l is string => Boolean(l))) {
    p.labels.push(label);
    for (const n of numbersInText(label)) {
      p.numbers.add(n);
    }
  }
  for (const c of calls) {
    const analytics = ANALYTICS_TOOLS.has(c.tool);
    for (const raw of c.result_numbers) {
      if (raw.startsWith(MONEY_PREFIX)) {
        p.money.add(raw.slice(MONEY_PREFIX.length));
      } else if (raw.startsWith('pct:')) {
        p.percents.add(raw.slice(4));
      } else {
        p.numbers.add(raw);
        if (analytics) p.analytics.add(raw);
      }
    }
  }
  for (const n of contextNumbers) p.numbers.add(n);
  // Whether a masked token is a date part is decided where it is written (isDateLike), not here:
  // a count of 20 and the 20th of the month are different claims.
  // Money is also a plain number (a balance may be written without a symbol).
  for (const m of p.money) p.numbers.add(m);
  return p;
}

const MONTH = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*$/i;

/** A token that is part of a date: a year, or a day number right after a month name. */
export function isDateLike(token: string, textBefore: string, textAfter: string): boolean {
  if (/^(19|20)\d{2}$/.test(token)) return true;
  if (/^\d{1,2}$/.test(token) && MONTH.test(textBefore)) return true;
  if (/^\d{1,2}$/.test(token) && /^\s*(?:,\s*)?(19|20)\d{2}\b/.test(textAfter) && MONTH.test(textBefore)) return true;
  return false;
}

export interface MaskResult {
  masked: string;
  /** Tokens (after masking) that came from analytics and are not dates. */
  analytics: Array<{ token: string; index: number }>;
}

const TOKEN = /[$€£]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;

/**
 * Replace every number the provenance backs with MASK. A number is backed when its canonical form
 * is in `numbers`, or (with a percent sign) in `percents`; a dollar figure only when it is in
 * `money`. Anything else stays as digits for the gate to fail on.
 */
export function maskText(text: string, prov: Provenance): MaskResult {
  const analytics: Array<{ token: string; index: number }> = [];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    const canon = canonicalNumber(raw);
    out += text.slice(last, idx);
    last = idx + raw.length;
    if (canon === null) {
      out += raw;
      continue;
    }
    const hasPct = raw.endsWith('%');
    const isMoney = /^[$€£]/.test(raw);
    const backed = isMoney
      ? prov.money.has(canon)
      : hasPct
        ? prov.numbers.has(canon) || prov.percents.has(canon)
        : prov.numbers.has(canon);
    if (!backed) {
      out += raw;
      continue;
    }
    out += MASK;
    const before = text.slice(Math.max(0, idx - 12), idx);
    const after = text.slice(idx + raw.length, idx + raw.length + 8);
    if (prov.analytics.has(canon) && !isDateLike(canon, before, after)) analytics.push({ token: raw, index: out.length - MASK.length });
  }
  out += text.slice(last);
  return { masked: out, analytics };
}
