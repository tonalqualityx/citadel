/**
 * The chat copy gate (phase C spec 9.2). Pure: `gateReply(text, ctx, kind)`.
 *
 * Citadel runs it in `complete` on what the MODEL writes and nothing else: the reply, every ask
 * question, the summary, the handoff draft_reply, and the model's part of an email body. Lines the
 * bundle or a template renders (the plan allowance, the handoff banner, an email greeting, sign-off
 * and reference) are appended by Citadel after gating and are never gated. It is the only gate; the
 * runner relies on its 422. The model never decides what a client may be told, so every rule here
 * fails closed. The assistant's fixed lines (fixed-lines.ts) are exempt word for word.
 *
 * All rules read the FOLDED text: NFKC, zero-width and bidi characters removed, curly apostrophes
 * straightened, non-breaking hyphens made plain. Order: person, dash, link, internal words, names;
 * then the content rules (estimate, promise, approval, commitment, number words, unsourced digits,
 * source) and length. The first failing rule comes back with the text that matched.
 */
import { PROMISES } from '@/lib/portal/intake/promises';
import { bastWordError, foldForNameCheck } from '@/lib/portal/thread';
import { MASK, maskText, SOURCE_PATTERN, type Provenance } from '@/lib/portal/chat/provenance';
import { FIXED_LINE_LIST } from '@/lib/portal/chat/fixed-lines';
import { isCommonWord } from '@/lib/portal/chat/common-words';

/** The only fields the gate reads. Anything a template renders is outside it. */
export const GATED_FIELDS = ['reply', 'ask.question', 'summary', 'draft_reply', 'email_body_model_part'] as const;

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
/** `field` is a short model-written value the client sees on the summary card or in a title (no length rule). */
export type GateKind = 'reply' | 'ask' | 'summary' | 'draft' | 'email' | 'field';

export interface GateContext {
  provenance: Provenance;
  /** Staff first names (User table), added to the built-in list. Plain English words are the loader's job to drop. */
  staffNames: string[];
  /** Other clients' names (cached list, the signed-in client's own excluded). */
  otherClientNames: string[];
  /** Other clients' site domains (e.g. herbapumps.com); their name and brand slug are matched too. */
  otherClientDomains?: string[];
  /** The signed-in client's own name(s) and domains: always allowed, even where a word is shared with another client. */
  ownClientNames?: string[];
  /** The client's own domains, e.g. herbapumps.com. */
  clientDomains: string[];
  /** The portal origin(s); only https://<host>/portal/... is a link the client may be given. */
  portalOrigins: string[];
  /** Report URLs returned by a reports read in this job. */
  reportUrls: string[];
  /** The contact's own address. */
  contactEmail: string | null;
  /** The site's own page titles: a page called "Price" or "Free Shipping" may be named verbatim. */
  pageNames?: string[];
}

export const SUPPORT_EMAIL = 'support@becomeindelible.com';
export const REPLY_MAX_WORDS = 70;
export const REPLY_MAX_SENTENCES = 4;
export const SUMMARY_MAX_WORDS = 80;
/** Staff names that are never to be spoken, whatever the table says. */
export const BUILT_IN_STAFF = ['Mike', 'Michael', 'Ashlei', 'Sabeen', 'Nils', 'Ange', 'Angela', 'Reshi'];

const fail = (rule: GateRule, match: string): GateResult => ({ ok: false, rule, match: match.slice(0, 120) });

/** The form a reader sees: compatibility-normalised, invisible characters gone, quotes and hyphens plain. */
export function foldText(text: string): string {
  return foldForNameCheck(text)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑]/g, '-');
}

// ---- person ---------------------------------------------------------------------------------

const PERSON: RegExp[] = [
  /\b(?:i am|i'm|im|this is)\s+(?:a\s+|an\s+|your\s+)?(?:real\s+|actual\s+|live\s+)?(?:human|person|member of (?:the|our) team|team member|staff member|employee)\b/i,
  /\b(?:i am|i'm|im)\s+not\s+(?:an?\s+)?(?:ai|bot|robot|assistant|machine|program)\b/i,
  /\b(?:as|being)\s+a\s+(?:human|person)\b/i,
  /\bmy name is\b/i,
];

// ---- dash law -------------------------------------------------------------------------------

const DASH = /[‒–—―−﹘﹣]|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;|&minus;|&#8722;|(?:^|\s)-(?:\s|$)|--/i;

// ---- internal words -------------------------------------------------------------------------

const INTERNAL: RegExp[] = [
  /\bneeds[-_ ]?mike\b/i,
  /\bchat[-_](?:clarifying|handoff|question)\b/i,
  /\bawaiting[-_]clarification\b/i,
  /\bportal[-_]chat\b/i,
  /\bclient[-_]sent[-_]back\b/i,
  /\b[a-z0-9]+_[a-z0-9_]+\b/i, // any snake_case token: tags and tool names
  /\b[a-z_]+:[a-z_]+\b(?!\/\/)/i,
  /\binternal\s+(?:note|only|tag)s?\b/i,
  /\b(?:support|help ?desk|service) tickets?\b|\bticket (?:number|id|#)/i,
  /\bcitadel\b/i,
  /\bprompts?\b/i,
  /\b(?:ai|language|machine[- ]learning) models?\b|\bthe model behind\b/i,
  /\b(?:llm|claude|anthropic|opus|sonnet|haiku|gpt|openai|mcp|json|ga4|ga 4|quickbooks|slack)\b/i,
  /\badmin (?:panel|area|screen)\b/i,
  /\b(?:the|a|our) (?:bot|ai|chatbot|robot)\b/i,
  /\b(?:tool call|tool result|function call)s?\b/i,
  /\bsystem message\b/i,
];

// ---- content words --------------------------------------------------------------------------

const NUMBER_WORD = new RegExp(
  '\\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|' +
    '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|' +
    'hundreds?|thousands?|millions?|dozens?|twice)\\b',
  'gi'
);
/** Money, time and traffic nouns: a number word beside one of these is a claim about money, time or numbers. */
const COUNT_NOUN =
  /\b(?:dollars?|bucks?|cents?|hours?|days?|weeks?|months?|years?|minutes?|visits?|visitors?|sessions?|clicks?|impressions?|leads?|orders?|sales|customers?|users?|views|pageviews|people|percent|per ?cent|searches|rankings?|positions?|calls?)\b/i;
/** Always a figure of speech about change in numbers, never an item count. */
const GROWTH_WORD = /\b(?:doubled?|tripled?|quadrupled?)\b(?!-check)/i;
const HALF_NUMBER = /\bby half\b|\bhalf (?:an?|the) (?:hour|day|week|month|year|price|cost|amount)\b|\bhalf[- ](?:off|price)\b/i;

/** A number word within three words of a money, time or traffic noun; or a growth word; or "half" used as a figure. */
function numberWordProblem(text: string): string | null {
  const g = GROWTH_WORD.exec(text);
  if (g) return g[0];
  const h = HALF_NUMBER.exec(text);
  if (h) return h[0];
  const words = text.split(/\s+/);
  for (const m of text.matchAll(NUMBER_WORD)) {
    const before = text.slice(0, m.index ?? 0).split(/\s+/).filter(Boolean).slice(-3).join(' ');
    const after = text.slice((m.index ?? 0) + m[0].length).split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    if (COUNT_NOUN.test(before) || COUNT_NOUN.test(after)) return m[0];
  }
  void words;
  return null;
}

const MONEY_WORDS = /\b(?:dollars?|bucks?|cents?|free|complimentary|on the house|no (?:extra |additional )?charge|costs?|costing|discounts?|percent off|refunds?|waive[ds]?|fees?|comp(?:ed)?|gratis)\b|\bnothing extra\b/i;

/** Money promises with no money word in them: "we won't charge you", "nothing to pay", "your rate stays the same". */
const MONEY_PROMISE = /\b(?:we|i|indelible|you)\s+(?:won't|will not|will never|wouldn't|would not|don't|do not|never)\s+(?:be\s+)?(?:charg|bill|invoic)\w*|\byou\s+(?:(?:won't|will not|wouldn't|would not|don't|do not|never)\s+)?(?:(?:have|need) to\s+)?(?:pay|owe)\s+(?:anything|nothing|extra|more)\b|\bnothing to pay\b|\b(?:add|added|adds)\s+to\s+your\s+(?:bill|invoice)\b|\b(?:our\s+(?:prices|pricing|rates?)|your\s+(?:bill|invoices?|rate)|(?:monthly|annual)\s+(?:rates?|prices|pricing))\s+(?:stays?|remains?|(?:will not|won't|would not|wouldn't|does not|doesn't|do not|don't)\s+(?:change|go up|increase|rise))\b/i;

const TIME_WORDS = new RegExp(
  '\\b(?:today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tues|thurs?|' +
    '(?:this|next|last) (?:week|month|year|quarter|weekend)|the weekend|end of (?:the )?(?:day|week|month|year)|eod|eow|eom|asap|' +
    'soon|sooner|shortly|fortnight|overnight|right away|immediately|same[- ]day|next[- ]day|' +
    '(?:an? )?(?:day|week|month|hour|minute)s? or (?:two|so)|a few (?:days|weeks|hours|minutes|months)|' +
    '(?:within|in|under|inside|over) (?:an?|one) (?:hour|day|week|month|minute|year)|' +
    // "within the hour", "in a couple of days": a time frame with no digit in it (pilot ruling 2026-10-21:
    // the simple-change timing line is the only time promise, and it passes only word for word).
    '(?:within|in|under|inside|before) the (?:hour|day|week|month|weekend)|' +
    'a couple (?:of )?(?:days|weeks|hours|minutes|months)|' +
    'within \\d+|q[1-4])\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\b',
  'i'
);

const ESTIMATE_WORD = /\b(?:about|around|roughly|approximately|nearly|estimates?d?|projected|should reach|on track to)\b/gi;

const APPROVAL = new RegExp(
  '\\b(?:approved|approve it|signed off|go ahead and|covers?|covered|coverage|in scope|out of scope|part of your plan|your plan(?!\\s+(?:page|section))|' +
    'retainer|allowance|within your (?:hours|plan|scope|budget)|hours (?:left|remaining)|comes? with your)\\b',
  'i'
);

// ---- commitments ----------------------------------------------------------------------------

const SUBJECT = "(?:we|i|our team|the team|team|someone|somebody|anyone|a person(?: on the team)?|one of us|indelible)";
/** it / this / that / they: only a delivery verb is a promise ("It will go to the team" is not). */
const WEAK_SUBJECT = "(?:they|it|this|that|he|she)";
const ADVERB = '(?:\\s+(?:absolutely|definitely|certainly|surely|gladly|happily|also|just|all|really|totally))?';
const MODAL =
  "(?:'ll|\\s+will|'d|\\s+would|\\s+can|\\s+could|\\s+should|\\s+shall|\\s+must|\\s+may|\\s+might|\\s+(?:am|are|is)\\s+going\\s+to|'re\\s+going\\s+to|'m\\s+going\\s+to|\\s+(?:plans?|aims?|hopes?|expects?|intends?)\\s+to|\\s+gonna)";
const COMMIT_RE = new RegExp(`\\b${SUBJECT}${ADVERB}${MODAL}(?![\\w'])([^.!?;\\n]*)`, 'gi');
const WEAK_COMMIT_RE = new RegExp(`\\b${WEAK_SUBJECT}${ADVERB}${MODAL}(?![\\w'])([^.!?;\\n]*)`, 'gi');
const STRICT_ACTION =
  /\b(?:build|built|fix|fixed|ship|shipped|deliver|delivered|send you|have it|done|finish|finished|publish|published|launch|launched|ready|live|complete|completed|resolved|handled|taken care)\b/i;
const ALLOWED_VERBS = new Set(['review', 'read', 'reply', 'look', 'follow', 'check', 'see', 'ask', 'pass']);
/** Any of these after a modal is work being promised, whatever else the clause says. */
const ACTION =
  /\b(?:fix(?:ed|es|ing)?|build|built|building|make|made|making|chang(?:e|ed|es|ing)|updat(?:e|ed|es|ing)|add(?:ed|ing)?|remov(?:e|ed|ing)|send|sent|sending|creat(?:e|ed|ing)|do|does|did|done|doing|get|got|getting|start(?:ed|ing)?|finish(?:ed|ing)?|complet(?:e|ed|ing)|deliver(?:ed|ing)?|waiv(?:e|ed|ing)|refund(?:ed|ing)?|credit(?:ed|ing)?|discount|schedul(?:e|ed|ing)|launch(?:ed|ing)?|publish(?:ed|ing)?|deploy(?:ed|ing)?|handl(?:e|ed|ing)|design(?:ed|ing)?|writ(?:e|ing)|wrote|install(?:ed|ing)?|upload(?:ed|ing)?|replac(?:e|ed|ing)|edit(?:ed|ing)?|mov(?:e|ed|ing)|redo|resolv(?:e|ed|ing)|implement(?:ed|ing)?|set up|take care|work(?:ing)? on|sort(?:ed)?|ship(?:ped|ping)?|have|give|gave|quote|invoice|bill|charge|ready|live|help|arrange|organi[sz]e|prepare|provide|offer|redesign|rebuild|restore|repair|improve|optimi[sz]e|migrate|renew|cancel|pause|approve|confirm|promise|guarantee)\b/i;
const COMMIT_PHRASES: RegExp[] = [
  /\bconsider it done\b/i,
  /\bwould be (?:happy|glad|pleased|delighted) to\b/i,
  /\b(?:happy|glad|pleased|delighted) to (?:help|do|build|fix|make|change|update|add)\b/i,
  /\bleave it (?:with|to) (?:me|us)\b/i,
  /\bon it\b/i,
  /\bi promise\b/i,
  /\brest assured\b/i,
  /\bno problem\b/i,
  /\bnot a problem\b/i,
  /\btake care of\b/i,
  /\bwe(?:'ve| have) got (?:this|it)\b/i,
];

function commitmentProblem(text: string): string | null {
  for (const re of COMMIT_PHRASES) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  for (const m of text.matchAll(WEAK_COMMIT_RE)) {
    if (STRICT_ACTION.test(m[1])) return m[0].trim().slice(0, 80);
  }
  for (const m of text.matchAll(COMMIT_RE)) {
    const clause = m[1].trim().replace(/^(?:not|never|also|still|really|just)\s+/i, '');
    const first = clause.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (clause && !ALLOWED_VERBS.has(first)) return m[0].trim().slice(0, 80);
    const hit = ACTION.exec(clause);
    if (hit) return m[0].trim().slice(0, 80);
    // "will review and <anything not an allowed verb>": every segment must start with an allowed verb.
    for (const seg of clause.split(/\s+(?:and|then|or|but)\s+|,/i)) {
      const w = seg.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (w && !ALLOWED_VERBS.has(w) && /^(?:[a-z]+)$/.test(w) && w.length > 3 && !/^(?:this|that|it|here|them|they|these|those|there|with|into|over|your|you|the|for|from|about|once|when|after|before|while)$/.test(w)) {
        return m[0].trim().slice(0, 80);
      }
    }
  }
  return null;
}

// ---- links ----------------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const BARE_DOMAIN = /\b(?:[a-z0-9-]+\.)+(?!(?:jpe?g|png|gif|webp|heic|heif|pdf|docx?|xlsx?|pptx?|txt|csv|svg|html?|php|js|css|zip)\b)[a-z]{2,}\b(?:\/[^\s]*)?/gi;

function hostOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).pathname;
  } catch {
    return '';
  }
}

/** Allowed: any path on the client's own domains; https://<portal host>/portal/... ; this job's report URLs. */
function urlAllowed(url: string, ctx: GateContext): boolean {
  const clean = url.replace(/[.,;:!?]+$/, '');
  if (ctx.reportUrls.includes(clean)) return true;
  const host = hostOf(clean);
  if (!host) return false;
  if (ctx.clientDomains.some((d) => host === hostOf(d) || host.endsWith('.' + hostOf(d)))) return true;
  if (ctx.portalOrigins.some((o) => hostOf(o) === host)) {
    return /^https:\/\//i.test(clean) && /^\/portal(?:\/|$)/.test(pathOf(clean));
  }
  return false;
}

/** Returns the first disallowed link or address, and the text with every allowed one removed. */
function linkScan(text: string, ctx: GateContext): { bad: string | null; scrubbed: string } {
  const emails = new Set([SUPPORT_EMAIL, ...(ctx.contactEmail ? [ctx.contactEmail.toLowerCase()] : [])]);
  let scrubbed = text;
  for (const m of text.matchAll(EMAIL_RE)) {
    if (!emails.has(m[0].toLowerCase())) return { bad: m[0], scrubbed };
  }
  scrubbed = scrubbed.replace(EMAIL_RE, ' ');
  for (const m of text.matchAll(URL_RE)) {
    if (!urlAllowed(m[0], ctx)) return { bad: m[0].replace(/[.,;:!?]+$/, ''), scrubbed };
  }
  scrubbed = scrubbed.replace(URL_RE, ' ');
  for (const m of scrubbed.matchAll(BARE_DOMAIN)) {
    const d = m[0].replace(/[.,;:!?]+$/, '');
    if (!/[a-z]/i.test(d.split('.')[0])) continue;
    if (!urlAllowed(d, ctx)) return { bad: d, scrubbed };
  }
  return { bad: null, scrubbed: scrubbed.replace(BARE_DOMAIN, ' ') };
}

// ---- names ----------------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameHit(folded: string, names: string[]): string | null {
  for (const raw of names) {
    const name = foldText(raw).trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu');
    const m = re.exec(folded);
    if (m) return m[0];
  }
  return null;
}

const NAME_STOP = new Set(['the', 'and', 'inc', 'llc', 'ltd', 'co', 'company', 'group', 'vermont', 'northeast', 'news', 'site', 'store', 'shop']);

/** Letters-only words of a display name, in order ("Mitch's Maples" gives mitch, maples). */
export function nameTokens(name: string): string[] {
  return foldText(name)
    .toLowerCase()
    .replace(/'s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The words of a name that may match ON THEIR OWN: at least 4 letters, not a stop word, not a common English
 * word. "First Congregational Church" gives only "congregational"... unless that is common too; the full name
 * always matches as a phrase whatever its words are.
 */
export function distinctiveTokens(name: string): string[] {
  return nameTokens(name).filter((t) => t.length >= 4 && !/\d/.test(t) && !NAME_STOP.has(t) && !isCommonWord(t));
}

/** Brand slugs of a name and of a domain: "bootleggers" from bootleggers.com; the joined name when it is one coined word. */
function slugsOf(name: string | null, domain: string | null): string[] {
  const out: string[] = [];
  if (domain) {
    const label = hostOf(domain).split('.')[0] ?? '';
    if (label.length >= 5 && !isCommonWord(label.replace(/-/g, ''))) out.push(label);
  }
  if (name) {
    const toks = nameTokens(name);
    if (toks.length > 1) {
      const joined = toks.join('');
      if (joined.length >= 8) out.push(joined);
    }
  }
  return out;
}

/** What another client can be called by: full phrase, distinctive tokens, domain and brand slug. */
function clientNameForms(names: string[], domains: string[] = []): { phrases: string[]; singles: string[] } {
  const out: string[] = [];
  const phrases: string[] = [];
  for (const n of names) {
    const full = n.trim();
    // Indelible is us: the assistant says the company name in its own wording.
    if (!full || /^indelible(?:\s+(?:llc|inc))?$/i.test(full)) continue;
    phrases.push(full);
    out.push(...distinctiveTokens(full));
    out.push(...slugsOf(full, null));
  }
  for (const d of domains) {
    const host = hostOf(d);
    if (!host) continue;
    phrases.push(host);
    out.push(...slugsOf(null, host));
  }
  return { phrases, singles: out };
}

/** The signed-in client's own names and tokens are always allowed: take them out before the other-client rule reads. */
function maskOwn(text: string, own: string[]): string {
  const forms = new Set<string>();
  for (const n of own) {
    const full = foldText(n).trim();
    if (full.length >= 3) forms.add(full);
    for (const t of distinctiveTokens(full)) forms.add(t);
    for (const sl of slugsOf(full, null)) forms.add(sl);
    if (full.includes('.')) {
      const host = hostOf(full);
      if (host) forms.add(host);
      for (const sl of slugsOf(null, host)) forms.add(sl);
    }
  }
  let out = text;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(f)}(?![\\p{L}\\p{N}])`, 'giu'), ' OWN ');
  }
  return out;
}

/** "Mike" inside a quoted phrase that is the client's own wording (a business called "Mike's Bikes") is not the staff member. */
function hideMikeInOwnQuotes(text: string, own: string[]): string {
  const ownN = own.map(norm).filter((n) => n.length >= 3);
  return text.replace(/"([^"]{1,300})"/g, (whole, inner: string) => {
    if (!/\bmike\b/i.test(inner)) return whole;
    const n = norm(inner);
    return ownN.some((o) => n.includes(o)) ? ' QUOTE ' : whole;
  });
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

/** Staff-only spans in a handoff draft: "[TEAM: ...]" and "[TEAM NOTE: ...]". */
function stripTeamSpans(text: string): string {
  return text.replace(/\[TEAM(?:\s+NOTE)?\s*:[^\]]*\]/gi, ' ');
}

function maskPageNames(text: string, names: string[]): string {
  let out = text;
  const sorted = [...new Set(names.map((n) => foldText(n).trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  for (const n of sorted) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'giu'), ' PAGE ');
  }
  return out;
}

const SOURCE_ANY = Object.values(SOURCE_PATTERN);
const DATE_NAMED = /⟦d⟧/;

/** Phrases that read like a promise but are ordinary words on a web page or in a request. */
const ORDINARY_PHRASES: RegExp[] = [
  /\bfeel free\b/gi,
  /\bas soon as you\b/gi,
  /\bcover (?:photos?|images?|pictures?|pages?|letters?|art|stor(?:y|ies)|songs?)\b/gi,
  /\b(?:mon|tues?|wednes|thurs?|fri|satur|sun)day'?s? hours\b/gi,
  /\b(?:weekday|weekend|opening|business|store|holiday) hours\b/gi,
  /\b(?:the|your|new|updated)\s+(?:specials|menu|events|classes|deals|hours|schedule|lineup|offers|hours of operation)\s+(?:for|of)\s+(?:this|next)\s+week\b/gi,
  /\b(?:this|next)\s+week's\s+(?:specials|menu|events|classes|deals|hours|schedule|lineup|offers)\b/gi,
  // a price list, a pricing page, membership fees: names of things on a site
  /\b(?:price|pricing|rate|rates|fee|fees|menu)\s+(?:list|page|section|table|chart|sheet|schedule)\b/gi,
  /\b(?:membership|registration|tuition|class|admission|entry|enrollment|application|event)\s+(?:fees?|rates?|prices?)\b/gi,
];

function hideOrdinaryPhrases(text: string): string {
  let out = text;
  for (const re of ORDINARY_PHRASES) out = out.replace(re, ' ');
  return out;
}

/** The assistant's fixed lines, removed word for word before the rest is read. */
function removeFixedLines(text: string): string {
  let out = text;
  for (const line of [...FIXED_LINE_LIST].sort((a, b) => b.length - a.length)) out = out.split(foldText(line)).join(' ');
  return out;
}

const norm = (t: string) => foldText(t).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Quoted spans that appear verbatim in a client message, or in page text a page_text lookup in this job
 * returned: their words (or their site's), not ours, so the content rules skip them.
 */
function hideClientQuotes(text: string, clientTexts: string[]): string {
  if (clientTexts.length === 0) return text;
  const hay = clientTexts.map(norm);
  return text.replace(/"([^"]{1,300})"/g, (whole, inner: string) => {
    const needle = norm(inner).replace(/[.,;:!?]+$/, '');
    return needle.length >= 3 && hay.some((h) => h.includes(needle)) ? ' QUOTE ' : whole;
  });
}

/** Questions promise nothing: drop them before the commitment rule. */
function withoutQuestions(text: string): string {
  return sentencesOf(text).filter((x) => !x.trim().endsWith('?')).join('\n');
}

export function gateReply(input: string, ctx: GateContext, kind: GateKind = 'reply'): GateResult {
  const folded = foldText(kind === 'draft' ? stripTeamSpans(input) : input);
  const text = removeFixedLines(folded);

  for (const re of PERSON) {
    const m = re.exec(text);
    if (m) return fail('person', m[0]);
  }
  {
    const m = DASH.exec(text);
    if (m) return fail('dash', m[0].trim() || '-');
  }
  const links = linkScan(text, ctx);
  if (links.bad) return fail('link', links.bad);

  // Page titles the site itself uses may be named verbatim ("Price", "Free Shipping").
  const plain = maskPageNames(hideOrdinaryPhrases(links.scrubbed), ctx.pageNames ?? []);
  for (const re of INTERNAL) {
    const m = re.exec(plain);
    if (m) return fail('internal', m[0]);
  }
  if (bastWordError(text)) return fail('name', 'Bast');
  // Sourced quotes (the client's own words, or their own page's words from a page_text lookup) are not ours.
  const sourced = [...ctx.provenance.clientTexts, ...(ctx.provenance.pageTexts ?? [])];
  {
    // A short client-name form can be an ordinary word ("First" of a "First ... Church"); inside a sourced
    // quote ("done right the first time") it is the client's or their site's words, not a name we said.
    const own = ctx.ownClientNames ?? [];
    const quoted = hideClientQuotes(plain, sourced);
    const staff = nameHit(hideMikeInOwnQuotes(quoted, own), [...BUILT_IN_STAFF, ...ctx.staffNames]);
    if (staff) return fail('name', staff);
    // Full names read the text as written (another client's whole name is never ours); single words and slugs
    // read it with the signed-in client's own names taken out.
    const forms = clientNameForms(ctx.otherClientNames, ctx.otherClientDomains);
    const other = nameHit(quoted, forms.phrases) ?? nameHit(maskOwn(quoted, own), forms.singles);
    if (other) return fail('name', other);
  }

  const body = hideClientQuotes(stripListNumbering(plain), sourced);
  const { masked, promiseText, analytics } = maskText(body, ctx.provenance);

  for (const m of promiseText.matchAll(ESTIMATE_WORD)) {
    const from = Math.max(0, (m.index ?? 0) - 28);
    const window = promiseText.slice(from, (m.index ?? 0) + m[0].length + 28);
    if (/\d|⟦|couple|half|dozen|hundred|thousand|million|\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty)\b/i.test(window)) {
      return fail('estimate', m[0]);
    }
  }

  for (const [name, re] of PROMISES) {
    const m = re.exec(promiseText);
    if (m) return fail('promise', `${name}: ${m[0].trim()}`);
  }
  for (const re of [MONEY_WORDS, MONEY_PROMISE, TIME_WORDS]) {
    const m = re.exec(promiseText);
    if (m) return fail('promise', m[0].trim());
  }
  {
    const m = APPROVAL.exec(promiseText);
    if (m) return fail('approval', m[0]);
  }
  {
    const c = commitmentProblem(withoutQuestions(promiseText));
    if (c) return fail('commitment', c);
  }
  {
    const w = numberWordProblem(promiseText);
    if (w) return fail('unsourced_number', w);
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
    const namesSource = (x: string) => SOURCE_ANY.some((re) => re.test(x));
    for (const a of analytics) {
      const i = spans.findIndex(([s, e]) => a.index >= s && a.index < e + 1);
      if (i < 0) return fail('source', a.token);
      // The sentence that governs this number: its own, when it names a source; otherwise the nearest
      // earlier sentence that names one, reached through an unbroken run of sentences that carry sourced
      // numbers ("Google Search Console, Sep 21 to Oct 19, 2026, counted 48 clicks. The top searches were
      // ... 6.8."). That source must be one of the tools that returned the number, and the dates sit in
      // that sentence or the one before it. A number no earlier sentence sources, one cut off from its
      // source by a sentence without numbers, or one under another tool's source, still fails.
      let j = i;
      while (j >= 0 && !namesSource(sentences[j])) {
        if (j < i && !sentences[j].includes(MASK)) return fail('source', a.token);
        j--;
      }
      if (j < 0) return fail('source', a.token);
      const named = a.tools.some((t) => SOURCE_PATTERN[t]?.test(sentences[j]));
      const dated = sentences.slice(Math.max(0, j - 1), i + 1).some((x) => DATE_NAMED.test(x));
      if (!named || !dated) return fail('source', a.token);
    }
  }

  if (kind === 'reply' || kind === 'ask') {
    // The cap is on the model's own words: a fixed line (the timing line, the Search Console sentence)
    // is our copy and does not use up the reply's budget.
    const own = text.replace(/(^|\s)[.,;:!?()]+(?=\s|$)/g, ' ');
    const n = wordCount(own);
    if (n > REPLY_MAX_WORDS) return fail('length', `${n} words`);
    const s = sentencesOf(stripListNumbering(own)).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
    if (s > REPLY_MAX_SENTENCES) return fail('length', `${s} sentences`);
  } else if (kind === 'summary') {
    const n = wordCount(folded);
    if (n > SUMMARY_MAX_WORDS) return fail('length', `${n} words`);
  }

  return { ok: true };
}
