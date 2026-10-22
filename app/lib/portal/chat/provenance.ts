/**
 * Number provenance for the chat copy gate (phase C spec 9.2).
 *
 * A number in a reply is backed only by a VALUE in this job's tool results (never a range label, an
 * id, an invoice number, a date, a UUID or a timestamp). The tool-call log stores those values in
 * `EngineToolCall.result_numbers`; the gate masks the ones that match and fails on any digit left.
 *
 * - Plain values back plain numbers. Rates (0.456) back only their percent form (45.6%).
 * - Money-named fields (balance, total, revenue, amount, price, paid) back only an exact dollar
 *   figure ($750.50), never a bare number and never a rounding.
 * - A date is backed only as a WHOLE date that equals a date in a tool's own range label, written
 *   in a sentence that names that tool's source (Google Analytics, Search Console).
 * - What the client wrote may be echoed only inside quotation marks, plus a bare year they named.
 * - So may text a page_text lookup in this job returned: a quoted phrase found on the client's own page
 *   is the site's words, sourced, not ours.
 * Pure: no database, no clock.
 */

export const MASK = '⟦n⟧';
export const DATE_MASK = '⟦d⟧';
export const MONEY_MASK = '⟦$⟧';
export const MONEY_PREFIX = 'money:';
export const PCT_PREFIX = 'pct:';

const MONEY_KEY = /revenue|amount|balance|^total$|_total$|price|paid/i;
/** Identifier-shaped keys never count as numbers a reply may quote: ids, invoice and doc numbers, dates. */
const ID_KEY = /(^|_)id$|^qbo|number$|^doc|date$|^day$|^month$|^year$|time$|timestamp|_at$|^at$/i;

/** "1,234.50" -> "1234.5"; "$5" -> "5"; "12%" -> "12"; null when it is not a plain number. */
export function canonicalNumber(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[$€£]/, '').replace(/%$/, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return fmt(n);
}

function fmt(n: number): string {
  const s = String(Math.abs(n) < 1e21 ? n : n.toFixed(0));
  return s === '-0' ? '0' : s;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
}

/** How a stored value may be written: itself, and (for a fraction) rounded to one or two places. */
export function displayVariants(n: number): string[] {
  const out = new Set<string>([fmt(n)]);
  if (!Number.isInteger(n)) {
    out.add(fmt(round(n, 1)));
    out.add(fmt(round(n, 2)));
  }
  return [...out];
}

/** A rate stored as 0.456 is shown as 45.6%: the percent forms, to one or two places. */
export function percentVariants(n: number): string[] {
  const v = n * 100;
  return [...new Set([fmt(round(v, 1)), fmt(round(v, 2))])];
}

/** Digit runs in a string, canonical. */
export function numbersInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const c = canonicalNumber(m[0]);
    if (c !== null) out.push(c);
  }
  return out;
}

/**
 * Walk a tool result and list the VALUES it carries (numbers and numeric strings, as the GA4 API
 * returns them). Identifier-shaped and date-shaped keys, eight-digit date strings and ISO dates are
 * skipped. Money-named keys are prefixed `money:` and are NOT listed as plain numbers; fractions
 * between 0 and 1 also list their percent form as `pct:`. The `label` key is read by the caller.
 */
export function extractResultNumbers(result: unknown): string[] {
  const out = new Set<string>();
  const add = (n: number, money: boolean) => {
    if (money) {
      for (const v of new Set([fmt(n), fmt(round(n, 2))])) out.add(MONEY_PREFIX + v);
      return;
    }
    for (const v of displayVariants(n)) out.add(v);
    if (n > 0 && n <= 1) for (const v of percentVariants(n)) out.add(PCT_PREFIX + v);
  };
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 8) return;
    if (ID_KEY.test(key) && typeof value !== 'object') return;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) add(value, MONEY_KEY.test(key));
    } else if (typeof value === 'string') {
      if (/^\d{8}$/.test(value) && /^(19|20)/.test(value)) return; // a GA4 date, 20261001
      if (/^-?\d[\d,]*(\.\d+)?$/.test(value)) {
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

// ---- dates ----------------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+((?:19|20)\d{2}))?\b/gi;

export interface ParsedDate {
  m: number;
  d: number;
  y: number | null;
}

function parseDates(text: string): Array<ParsedDate & { start: number; end: number }> {
  const out: Array<ParsedDate & { start: number; end: number }> = [];
  for (const m of text.matchAll(DATE_RE)) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    out.push({ m: idx, d: Number(m[2]), y: m[3] ? Number(m[3]) : null, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** Dates in a range label; a date with no year takes the year of the last dated item in the label. */
export function labelDates(label: string): ParsedDate[] {
  const ds = parseDates(label);
  const year = [...ds].reverse().find((x) => x.y !== null)?.y ?? null;
  return ds.map((x) => ({ m: x.m, d: x.d, y: x.y ?? year }));
}

// ---- provenance -----------------------------------------------------------------------------

export interface ProvenanceCall {
  tool: string;
  /** For citadel_read: the read kind (invoices, requests...). */
  kind?: string;
  result_numbers: string[];
  /** The tool's own range label, when the result carried one. */
  label?: string | null;
}

export interface Provenance {
  /** canonical plain value -> the tools whose results carried it */
  numbers: Map<string, Set<string>>;
  /** canonical percent value -> tools */
  percents: Map<string, Set<string>>;
  /** exact dollar figure -> tools (citadel_read:invoices, ga4_report) */
  money: Map<string, Set<string>>;
  /** The numbers in the client's own words, echoed only inside quotation marks (a bare year too). */
  clientNumbers: Set<string>;
  /** The client's own message texts. A quoted span found verbatim in one is their words, not ours. */
  clientTexts: string[];
  /** Page text this job's page_text lookups returned. A quoted span found verbatim in it is the site's own words (sourced). */
  pageTexts: string[];
  labels: string[];
  labelDates: ParsedDate[];
}

export function emptyProvenance(): Provenance {
  return { numbers: new Map(), percents: new Map(), money: new Map(), clientNumbers: new Set(), clientTexts: [], pageTexts: [], labels: [], labelDates: [] };
}

function put(map: Map<string, Set<string>>, key: string, tool: string) {
  const s = map.get(key) ?? new Set<string>();
  s.add(tool);
  map.set(key, s);
}

export const toolKey = (c: Pick<ProvenanceCall, 'tool' | 'kind'>) => (c.kind ? `${c.tool}:${c.kind}` : c.tool);

/** Tools whose numbers are analytics claims: they need a named source and dates. */
export const SOURCE_PATTERN: Record<string, RegExp> = {
  ga4_report: /google analytics/i,
  search_console: /search console/i,
};

export function buildProvenance(calls: ProvenanceCall[], clientNumbers: string[] = [], clientTexts: string[] = [], pageTexts: string[] = []): Provenance {
  const p = emptyProvenance();
  for (const c of calls) {
    const tool = toolKey(c);
    if (c.label) {
      p.labels.push(c.label);
      p.labelDates.push(...labelDates(c.label));
    }
    for (const raw of c.result_numbers) {
      if (raw.startsWith(MONEY_PREFIX)) put(p.money, raw.slice(MONEY_PREFIX.length), tool);
      else if (raw.startsWith(PCT_PREFIX)) put(p.percents, raw.slice(PCT_PREFIX.length), tool);
      else put(p.numbers, raw, tool);
    }
  }
  for (const n of clientNumbers) p.clientNumbers.add(n);
  p.clientTexts = clientTexts;
  p.pageTexts = pageTexts;
  return p;
}

// ---- masking --------------------------------------------------------------------------------

function sentenceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /[^.!?\n]*(?:[.!?]+(?=\s|$)|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      if (re.lastIndex > text.length) break;
      continue;
    }
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/**
 * Replace each WHOLE date that equals a date in a tool's range label, written in a sentence that
 * names that tool's source. Any other date is left for the promise rule to refuse.
 */
function maskDates(text: string, prov: Provenance): string {
  if (prov.labelDates.length === 0) return text;
  const spans = sentenceSpans(text);
  const sources = Object.values(SOURCE_PATTERN);
  let out = '';
  let last = 0;
  for (const d of parseDates(text)) {
    const sentence = spans.find(([s, e]) => d.start >= s && d.start < e);
    const around = sentence ? text.slice(sentence[0], sentence[1]) : '';
    if (!sources.some((re) => re.test(around))) continue;
    const ok = prov.labelDates.some((l) => l.m === d.m && l.d === d.d && (d.y === null || l.y === null || d.y === l.y));
    if (!ok) continue;
    out += text.slice(last, d.start) + DATE_MASK;
    last = d.end;
  }
  return out + text.slice(last);
}

function quoteSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/"[^"]*"|“[^”]*”/g)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return spans;
}

export interface AnalyticsHit {
  token: string;
  /** Position in `masked`. */
  index: number;
  tools: string[];
}

export interface MaskResult {
  /** Backed numbers, dollar figures and dates replaced; what is left is a claim nothing backs. */
  masked: string;
  /** Only whole dates and exact dollar figures replaced: the promise rules read the digits. */
  promiseText: string;
  analytics: AnalyticsHit[];
}

const TOKEN = /[$€£]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|\s?percent\b)?/gi;

export function maskText(text: string, prov: Provenance): MaskResult {
  const dated = maskDates(text, prov);
  const quotes = quoteSpans(dated);
  const analytics: AnalyticsHit[] = [];
  let masked = '';
  let promiseText = '';
  let last = 0;
  for (const m of dated.matchAll(TOKEN)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    const pre = dated.slice(last, idx);
    masked += pre;
    promiseText += pre;
    last = idx + raw.length;
    const canon = canonicalNumber(raw.replace(/\s?percent$/i, ''));
    if (canon === null) {
      masked += raw;
      promiseText += raw;
      continue;
    }
    const isMoney = /^[$€£]/.test(raw);
    const isPct = /%$|percent$/i.test(raw);
    const inQuote = quotes.some(([s, e]) => idx >= s && idx < e);
    let tools: Set<string> | undefined;
    let kind: 'money' | 'plain' | null = null;
    if (isMoney) {
      tools = prov.money.get(canon);
      if (tools) kind = 'money';
    } else if (isPct) {
      tools = prov.percents.get(canon);
      if (tools) kind = 'plain';
    } else {
      tools = prov.numbers.get(canon);
      if (tools) kind = 'plain';
      else if (prov.clientNumbers.has(canon) && (inQuote || /^(19|20)\d{2}$/.test(canon))) kind = 'plain';
    }
    if (kind === null) {
      masked += raw;
      promiseText += raw;
      continue;
    }
    const start = masked.length;
    masked += kind === 'money' ? MONEY_MASK : MASK;
    promiseText += kind === 'money' ? MONEY_MASK : raw;
    const analyticTools = [...(tools ?? [])].filter((t) => t in SOURCE_PATTERN);
    if (analyticTools.length > 0) analytics.push({ token: raw, index: start, tools: analyticTools });
  }
  masked += dated.slice(last);
  promiseText += dated.slice(last);
  return { masked, promiseText, analytics };
}
