/**
 * The `page_text` read (phase C tool five, pilot finding 2026-10-21): the visible text of ONE page on
 * the job's client's OWN site, so the assistant can find "done right the first time" on the Home page
 * instead of handing a plain deletion to a person.
 *
 * - The URL is built only from the Site record's origin and a SitePage row's path. No caller ever
 *   supplies a URL; a path that is not a known SitePage of a site the client owns is a 404, and a
 *   path that would resolve to another origin is refused.
 * - Redirects are followed by hand, at most three, and only to the same host (www. ignored).
 * - 5 second timeout, 300 KB read cap, 10 minute cache per page (parsed text, not raw HTML).
 * - The text is sectioned by h1, h2 and h3. With `find`, only the sections that hold the phrase come
 *   back, each with its heading and the sentence the phrase sits in (case, quote and dash insensitive).
 */
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

export const PAGE_TEXT_TIMEOUT_MS = 5_000;
export const PAGE_TEXT_MAX_BYTES = 300 * 1024;
export const PAGE_TEXT_CACHE_MS = 10 * 60_000;
export const PAGE_TEXT_MAX_CHARS = 4_000;
export const PAGE_TEXT_MAX_MATCHES = 8;
export const PAGE_TEXT_FIND_MAX = 200;
const MAX_REDIRECTS = 3;
const CACHE_MAX_ENTRIES = 200;
const SENTENCE_MAX = 400;
const USER_AGENT = 'Indelible-PageText/1.0 (+https://becomeindelible.com; portal assistant)';

export interface PageSection {
  heading: string | null;
  level: 1 | 2 | 3 | null;
  blocks: string[];
}

export interface PageTextParams {
  site_id?: string | null;
  page_id?: string | null;
  path?: string | null;
  find?: string | null;
}

export interface PageTarget {
  pageId: string;
  siteId: string;
  title: string;
  path: string;
  url: string;
  origin: string;
}

// ---- parsing (pure) -------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
  laquo: '«', raquo: '»', deg: '°', eacute: 'é', egrave: 'è', aacute: 'á', ntilde: 'ñ', uuml: 'ü',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();

const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th',
  'thead', 'tbody', 'tfoot', 'br', 'hr', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'figure', 'figcaption', 'form', 'fieldset', 'legend', 'label',
  'button', 'address', 'details', 'summary', 'body', 'html', 'caption',
]);

/** Visible text in heading sections. Scripts, styles, head, svg, iframes and comments never count. */
export function htmlToSections(html: string): { title: string | null; sections: PageSection[] } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = titleMatch ? clean(titleMatch[1]) || null : null;
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|canvas|object|math|select)\b[\s\S]*?<\/\1\s*>/gi, ' ');

  const sections: PageSection[] = [{ heading: null, level: null, blocks: [] }];
  let buf = '';
  let headingLevel: 1 | 2 | 3 | null = null;
  let headingBuf = '';
  const flush = () => {
    const text = clean(buf);
    buf = '';
    if (!text) return;
    const blocks = sections[sections.length - 1].blocks;
    if (blocks[blocks.length - 1] !== text) blocks.push(text);
  };

  const TAG = /<(\/?)([a-zA-Z][\w:-]*)(?:\s[^>]*)?\/?>/g;
  let last = 0;
  for (const m of body.matchAll(TAG)) {
    const text = body.slice(last, m.index);
    if (headingLevel) headingBuf += text;
    else buf += text;
    last = (m.index ?? 0) + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const hl = /^h([1-3])$/.exec(name);
    if (hl) {
      if (!closing) {
        flush();
        headingLevel = Number(hl[1]) as 1 | 2 | 3;
        headingBuf = '';
      } else if (headingLevel) {
        const heading = clean(headingBuf);
        if (heading) sections.push({ heading, level: headingLevel, blocks: [] });
        headingLevel = null;
        headingBuf = '';
      }
      continue;
    }
    if (BLOCK.has(name)) {
      if (headingLevel) headingBuf += ' ';
      else flush();
    }
  }
  const tail = body.slice(last);
  if (headingLevel) {
    const heading = clean(headingBuf + tail);
    if (heading) sections.push({ heading, level: headingLevel, blocks: [] });
  } else {
    buf += tail;
    flush();
  }
  return { title, sections: sections.filter((s) => s.heading !== null || s.blocks.length > 0) };
}

/** Case, quote and dash insensitive: lower case, quotes and apostrophes gone, every dash a space. */
export function normFind(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′″“”„«»'"`]/g, '')
    .replace(/[‐-―−-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function needleOf(find: string): string {
  return normFind(find).replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, '');
}

export function sentencesOf(block: string): string[] {
  return block.split(/(?<=[.!?])\s+(?=["'“‘(]?[A-Z0-9])/).filter(Boolean);
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface PageMatch {
  heading: string | null;
  level: 1 | 2 | 3 | null;
  /** The sentence (or the heading itself) the phrase sits in. */
  sentence: string;
  in_heading: boolean;
}

export function findInSections(sections: PageSection[], find: string): PageMatch[] {
  const needle = needleOf(find);
  if (needle.length < 2) return [];
  const out: PageMatch[] = [];
  for (const s of sections) {
    if (s.heading && normFind(s.heading).includes(needle)) out.push({ heading: s.heading, level: s.level, sentence: s.heading, in_heading: true });
    for (const block of s.blocks) {
      if (!normFind(block).includes(needle)) continue;
      const hit = sentencesOf(block).find((x) => normFind(x).includes(needle)) ?? block;
      out.push({ heading: s.heading, level: s.level, sentence: cut(hit, SENTENCE_MAX), in_heading: false });
    }
  }
  return out;
}

/** The sectioned text, capped at PAGE_TEXT_MAX_CHARS in total. */
export function sectionedText(sections: PageSection[], maxChars = PAGE_TEXT_MAX_CHARS): { sections: Array<{ heading: string | null; level: number | null; text: string }>; truncated: boolean } {
  const out: Array<{ heading: string | null; level: number | null; text: string }> = [];
  let used = 0;
  for (const s of sections) {
    const text = s.blocks.join('\n');
    const cost = (s.heading?.length ?? 0) + text.length;
    if (used + cost > maxChars) {
      const room = maxChars - used - (s.heading?.length ?? 0);
      if (room > 40) out.push({ heading: s.heading, level: s.level, text: cut(text, room) });
      return { sections: out, truncated: true };
    }
    out.push({ heading: s.heading, level: s.level, text });
    used += cost;
  }
  return { sections: out, truncated: false };
}

// ---- the target: the client's own site + a SitePage path, nothing else ----------------------

function originOf(siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** The path form the model may send: "/about/", "about", or a full URL on the same site. */
function pathVariants(raw: string, origin: string): string[] | null {
  let p = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) {
    try {
      const u = new URL(p.startsWith('//') ? `https:${p}` : p);
      if (bareHost(u.hostname) !== bareHost(new URL(origin).hostname)) return null;
      p = u.pathname;
    } catch {
      return null;
    }
  }
  p = p.replace(/[?#].*$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  const bare = p.length > 1 ? p.replace(/\/+$/, '') : p;
  return [...new Set([p, bare, bare === '/' ? '/' : `${bare}/`])];
}

/** Resolves the page the read may fetch. 404 for any page or site that is not this client's own. */
export async function resolvePageTarget(clientId: string, params: PageTextParams): Promise<PageTarget> {
  if (!params.page_id && !(params.site_id && params.path)) throw new ApiError('page_id, or site_id with path, is required', 400);
  const page = params.page_id
    ? await prisma.sitePage.findFirst({
        where: { id: params.page_id, ...(params.site_id ? { site_id: params.site_id } : {}) },
        select: { id: true, site_id: true, title: true, path: true, site: { select: { client_id: true, is_deleted: true, url: true } } },
      })
    : await (async () => {
        const site = await prisma.site.findFirst({ where: { id: params.site_id!, client_id: clientId, is_deleted: false }, select: { url: true } });
        const origin = originOf(site?.url ?? null);
        if (!site || !origin) return null;
        const variants = pathVariants(params.path!, origin);
        if (!variants) return null;
        const rows = await prisma.sitePage.findMany({
          where: { site_id: params.site_id!, path: { in: variants } },
          orderBy: [{ missing_since: { sort: 'asc', nulls: 'first' } }],
          select: { id: true, site_id: true, title: true, path: true, site: { select: { client_id: true, is_deleted: true, url: true } } },
        });
        return rows[0] ?? null;
      })();
  if (!page || page.site.client_id !== clientId || page.site.is_deleted) throw new ApiError('Not found', 404);
  const origin = originOf(page.site.url);
  if (!origin) throw new ApiError('The site has no web address on record', 404);
  const path = page.path.startsWith('/') ? page.path : `/${page.path}`;
  if (path.startsWith('//')) throw new ApiError('Not found', 404);
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new ApiError('Not found', 404);
  return { pageId: page.id, siteId: page.site_id, title: page.title, path: page.path, url: url.toString(), origin };
}

// ---- fetching -------------------------------------------------------------------------------

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(all), truncated };
}

/**
 * GET the page's HTML. Redirects only to the same host (www. ignored), at most three. The whole
 * fetch, redirects and body included, shares one timeout.
 */
export async function fetchPageHtml(target: Pick<PageTarget, 'url' | 'origin'>, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<{ html: string; truncated: boolean; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? PAGE_TEXT_TIMEOUT_MS);
  const host = bareHost(new URL(target.origin).hostname);
  try {
    let url = target.url;
    for (let hop = 0; ; hop++) {
      const res = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9' } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc || hop >= MAX_REDIRECTS) throw new ApiError('The page could not be read', 502);
        const next = new URL(loc, url);
        if ((next.protocol !== 'https:' && next.protocol !== 'http:') || bareHost(next.hostname) !== host) throw new ApiError('The page redirects off the site', 502);
        url = next.toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ApiError(`The page answered ${res.status}`, 502);
      }
      const type = res.headers.get('content-type') ?? '';
      if (type && !/html/i.test(type)) {
        await res.body?.cancel().catch(() => undefined);
        throw new ApiError('The address is not a web page', 502);
      }
      const { text, truncated } = await readCapped(res, opts.maxBytes ?? PAGE_TEXT_MAX_BYTES);
      return { html: text, truncated, finalUrl: url };
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (ctrl.signal.aborted) throw new ApiError('The page did not answer in time', 504);
    throw new ApiError('The page could not be read', 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---- cache ----------------------------------------------------------------------------------

interface Cached {
  at: number;
  url: string;
  sections: PageSection[];
  truncated: boolean;
}
const cache = new Map<string, Cached>();

/** Test hook. */
export function resetPageTextCache(): void {
  cache.clear();
}

async function sectionsFor(target: PageTarget, now: number, fetchOpts?: { timeoutMs?: number }): Promise<{ sections: PageSection[]; truncated: boolean; cached: boolean }> {
  const key = `${target.pageId}|${target.url}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < PAGE_TEXT_CACHE_MS) return { sections: hit.sections, truncated: hit.truncated, cached: true };
  const { html, truncated } = await fetchPageHtml(target, fetchOpts);
  const { sections } = htmlToSections(html);
  cache.delete(key);
  cache.set(key, { at: now, url: target.url, sections, truncated });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return { sections, truncated, cached: false };
}

// ---- the read -------------------------------------------------------------------------------

export async function readPageText(clientId: string, params: PageTextParams, opts: { now?: number; timeoutMs?: number } = {}) {
  const find = (params.find ?? '').trim().slice(0, PAGE_TEXT_FIND_MAX);
  const target = await resolvePageTarget(clientId, params);
  const { sections, truncated, cached } = await sectionsFor(target, opts.now ?? Date.now(), { timeoutMs: opts.timeoutMs });
  const page = { id: target.pageId, site_id: target.siteId, title: target.title, path: target.path, url: target.url };
  if (find) {
    const all = findInSections(sections, find);
    const matches = all.slice(0, PAGE_TEXT_MAX_MATCHES);
    return { page, find, found: all.length > 0, match_count: all.length, matches, row_count: matches.length, cached, html_truncated: truncated };
  }
  const text = sectionedText(sections);
  return { page, sections: text.sections, truncated: text.truncated, row_count: text.sections.length, cached, html_truncated: truncated };
}
