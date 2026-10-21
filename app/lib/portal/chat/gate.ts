/**
 * The chat copy gate (phase C spec 9.2). Pure: `gateReply(text, ctx, kind)`.
 *
 * Citadel runs it in `complete` on the reply, every ask question, the summary and the handoff
 * draft, and on every email body. It is the only gate; the runner relies on its 422. The model
 * never decides what a client may be told.
 *
 * Order: who is speaking (person), the dash law, links, internal words, names; then provenance
 * masking, after which the rules that read the masked text run (estimate, promise, approval,
 * commitment), then unsourced digits, the source rule and length. The first failing rule is
 * returned with the text that matched, so the runner can name it in the retry.
 */
import { PROMISES } from '@/lib/portal/intake/promises';
import { bastWordError, foldForNameCheck } from '@/lib/portal/thread';
import { MASK, maskText, type Provenance } from '@/lib/portal/chat/provenance';

export type GateRule =
  | 'person'
  | 'dash'
  | 'name'
  | 'internal'
  | 'link'
  | 'estimate'
  | 'promise'
  | 'approval'
  | 'commitment'
  | 'unsourced_number'
  | 'source'
  | 'length';

export type GateResult = { ok: true } | { ok: false; rule: GateRule; match: string };

/** What the text is. Length applies to replies and questions; a summary has its own cap. */
export type GateKind = 'reply' | 'ask' | 'summary' | 'draft' | 'email';

export interface GateContext {
  provenance: Provenance;
  /** Staff first names (User table). Words that are also plain English are the loader's job to drop. */
  staffNames: string[];
  /** Other clients' names (cached list, the signed-in client's own excluded). */
  otherClientNames: string[];
  /** The client's own domains, e.g. herbapumps.com. */
  clientDomains: string[];
  /** The portal origin(s), e.g. https://citadel.becomeindelible.com. */
  portalOrigins: string[];
  /** Report URLs returned by a reports read in this job. */
  reportUrls: string[];
  /** The contact's own address. */
  contactEmail: string | null;
}

export const SUPPORT_EMAIL = 'support@becomeindelible.com';
export const REPLY_MAX_WORDS = 70;
export const REPLY_MAX_SENTENCES = 4;
export const SUMMARY_MAX_WORDS = 80;

const fail = (rule: GateRule, match: string): GateResult => ({ ok: false, rule, match: match.slice(0, 120) });

// ---- person ---------------------------------------------------------------------------------

const PERSON: RegExp[] = [
  /\b(?:i am|i'm|im|this is)\s+(?:a\s+|an\s+|your\s+)?(?:real\s+|actual\s+|live\s+)?(?:human|person|member of (?:the|our) team|team member|staff member|employee)\b/i,
  /\b(?:i am|i'm|im)\s+not\s+(?:an?\s+)?(?:ai|bot|robot|assistant|machine|program)\b/i,
  /\b(?:as|being)\s+a\s+(?:human|person)\b/i,
  /\bmy name is\b/i,
  /\bi(?:'m| am) (?:mike|ashlei)\b/i,
];

// ---- dash law -------------------------------------------------------------------------------

const DASH = /—|–|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;|(?:^|\s)-(?:\s|$)|--/i;

// ---- internal words -------------------------------------------------------------------------

const INTERNAL: RegExp[] = [
  /\bneeds-mike\b/i,
  /\bchat-(?:clarifying|handoff|question)\b/i,
  /\bawaiting-clarification\b/i,
  /\bportal-chat\b/i,
  /\bclient-sent-back\b/i,
  /\b[a-z_]+:[a-z_]+\b(?!\/\/)/i,
  /\binternal\s+(?:note|only|tag)s?\b/i,
  /\btickets?\b/i,
  /\bcitadel\b/i,
  /\bprompts?\b/i,
  /\bmodels?\b/i,
  /\b(?:llm|claude|anthropic|opus|sonnet|haiku|gpt|openai|mcp|json|api)\b/i,
  /\b(?:ga4_report|search_console|citadel_read|site_pages|bast_portal|portal_data|StructuredOutput)\b/i,
  /\b(?:tool call|tool result|function call)s?\b/i,
  /\bsystem message\b/i,
];

// ---- estimates ------------------------------------------------------------------------------

const ESTIMATE_WORD = /\b(?:about|around|roughly|approximately|nearly|estimates?d?|projected|should reach|on track to)\b/gi;

// ---- approval -------------------------------------------------------------------------------

const APPROVAL = /\b(?:approved|approve it|signed off|go ahead and|covered|in scope|out of scope|part of your plan)\b/i;

// ---- commitment -----------------------------------------------------------------------------

const COMMIT = /\b(?:we|i|the team)\s*(?:'ll|’ll|\s+will|\s+can|\s+are going to|'re going to|’re going to)\s+([a-z]+)/gi;
const COMMIT_OK = new Set(['review', 'read', 'reply', 'look', 'follow', 'check', 'see', 'ask', 'pass']);

// ---- links ----------------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BARE_DOMAIN = /\b(?:[a-z0-9-]+\.)+(?!(?:jpe?g|png|gif|webp|heic|heif|pdf|docx?|xlsx?|pptx?|txt|csv|svg|html?|php|js|css|zip)\b)[a-z]{2,}\b(?:\/\S*)?/gi;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostAllowed(host: string, ctx: GateContext): boolean {
  const h = host.replace(/^www\./, '');
  if (ctx.clientDomains.some((d) => h === d.toLowerCase().replace(/^www\./, '') || h.endsWith('.' + d.toLowerCase().replace(/^www\./, '')))) return true;
  if (ctx.portalOrigins.some((o) => hostOf(o) === h)) return true;
  return false;
}

function linkProblem(text: string, ctx: GateContext): string | null {
  const reportUrls = new Set(ctx.reportUrls);
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (reportUrls.has(url)) continue;
    if (!hostAllowed(hostOf(url), ctx)) return url;
  }
  const emails = new Set([SUPPORT_EMAIL, ...(ctx.contactEmail ? [ctx.contactEmail.toLowerCase()] : [])]);
  const withoutEmails = text.replace(EMAIL_RE, (e) => (emails.has(e.toLowerCase()) ? ' ' : e));
  for (const m of text.matchAll(EMAIL_RE)) if (!emails.has(m[0].toLowerCase())) return m[0];
  const withoutUrls = withoutEmails.replace(URL_RE, ' ');
  for (const m of withoutUrls.matchAll(BARE_DOMAIN)) {
    const d = m[0].replace(/[.,;:!?]+$/, '').replace(/\/.*$/, '');
    if (!/[a-z]/i.test(d.split('.')[0])) continue;
    if (!hostAllowed(d.toLowerCase(), ctx)) return d;
  }
  return null;
}

// ---- names ----------------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameHit(folded: string, names: string[]): string | null {
  for (const raw of names) {
    const name = foldForNameCheck(raw).trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(folded);
    if (m) return m[0];
  }
  return null;
}

// ---- sentences and words --------------------------------------------------------------------

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[^\s])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Choice lists are numbered "1." / "2)": the numbering is not a claim. */
function stripListNumbering(text: string): string {
  return text.replace(/^[ \t]*\d{1,2}[.)][ \t]+/gm, '');
}

const SOURCE_NAME = /google analytics|search console/i;
const DATE_NAMED = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\d{4}-\d{2}-\d{2}|⟦n⟧\s*(?:to|through|-)\s*⟦n⟧/i;

const DURATION_AFTER_MASK = new RegExp(`(?<!(?:last|past|previous|prior)\\s)${MASK}\\s*(?:minutes?|hours?|days?|weeks?|months?|years?|business days?)\\b`, 'i');

export function gateReply(text: string, ctx: GateContext, kind: GateKind = 'reply'): GateResult {
  const folded = foldForNameCheck(text);

  for (const re of PERSON) {
    const m = re.exec(text);
    if (m) return fail('person', m[0]);
  }
  {
    const m = DASH.exec(text);
    if (m) return fail('dash', m[0].trim() || '-');
  }
  {
    const link = linkProblem(text, ctx);
    if (link) return fail('link', link);
  }
  {
    // Allowed links and addresses may contain an internal-sounding word (the portal host); the
    // words around them may not.
    const plain = text.replace(URL_RE, ' ').replace(EMAIL_RE, ' ');
    for (const re of INTERNAL) {
      const m = re.exec(plain);
      if (m) return fail('internal', m[0]);
    }
  }

  if (bastWordError(text)) return fail('name', 'Bast');
  {
    const staff = nameHit(folded, ctx.staffNames);
    if (staff) return fail('name', staff);
    const other = nameHit(folded, ctx.otherClientNames);
    if (other) return fail('name', other);
  }
  const body = stripListNumbering(text);
  const { masked, analytics } = maskText(body, ctx.provenance);

  // estimate: a hedge word within a few words of any number (masked or not).
  for (const m of masked.matchAll(ESTIMATE_WORD)) {
    const from = Math.max(0, (m.index ?? 0) - 24);
    const window = masked.slice(from, (m.index ?? 0) + m[0].length + 24);
    if (/\d|⟦n⟧/.test(window)) return fail('estimate', m[0]);
  }

  for (const [name, re] of PROMISES) {
    const m = re.exec(masked);
    if (m) return fail('promise', `${name}: ${m[0].trim()}`);
  }
  {
    const m = DURATION_AFTER_MASK.exec(masked);
    if (m) return fail('promise', `duration: ${m[0].trim()}`);
  }
  {
    const m = APPROVAL.exec(text);
    if (m) return fail('approval', m[0]);
  }
  for (const m of text.matchAll(COMMIT)) {
    if (!COMMIT_OK.has(m[1].toLowerCase())) return fail('commitment', m[0]);
  }

  {
    const m = /\d/.exec(masked);
    if (m) {
      const at = m.index ?? 0;
      return fail('unsourced_number', masked.slice(Math.max(0, at - 12), at + 12));
    }
  }

  if (analytics.length > 0) {
    const sentences = sentencesOf(masked);
    const spans: Array<[number, number]> = [];
    let cursor = 0;
    for (const s of sentences) {
      const start = masked.indexOf(s, cursor);
      spans.push([start, start + s.length]);
      cursor = start + s.length;
    }
    for (const a of analytics) {
      const i = spans.findIndex(([s, e]) => a.index >= s && a.index < e + 1);
      const own = i >= 0 ? sentences[i] : masked;
      const prev = i > 0 ? sentences[i - 1] : '';
      const near = `${prev} ${own}`;
      if (!SOURCE_NAME.test(near) || !DATE_NAMED.test(near)) return fail('source', a.token);
    }
  }

  if (kind === 'reply' || kind === 'ask') {
    const n = wordCount(text);
    if (n > REPLY_MAX_WORDS) return fail('length', `${n} words`);
    const s = sentencesOf(stripListNumbering(text)).length;
    if (s > REPLY_MAX_SENTENCES) return fail('length', `${s} sentences`);
  } else if (kind === 'summary') {
    const n = wordCount(text);
    if (n > SUMMARY_MAX_WORDS) return fail('length', `${n} words`);
  }

  return { ok: true };
}

export { MASK };
