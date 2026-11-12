/**
 * Designer Portal v2: the in-house markdown subset renderer (SPEC 4.1).
 *
 * Allowed: paragraphs, unordered and ordered lists, bold, italics, links, headings h3 and h4. Everything else is shown
 * as literal text. The renderer builds React elements from parsed tokens: it never produces an HTML string, never
 * touches dangerouslySetInnerHTML, and raw HTML in the input is just characters that React escapes.
 *
 * Links: only well formed `https:` URLs with no credentials, whitespace or control characters become links. Anything
 * else renders as the literal source text.
 *
 * Bounded work: input over MAX_MARKDOWN_CHARS is truncated with a visible note, nesting is capped, and the scanner
 * uses indexOf and single pass loops (no backtracking regular expressions).
 */
import * as React from 'react';

export const MAX_MARKDOWN_CHARS = 20_000;
const MAX_DEPTH = 5;

/** The one place a link target is judged. Returns the normalised URL or null. */
export function safeHttpsUrl(raw: string): string | null {
  if (raw.length === 0 || raw.length > 2000) return null;
  // Whitespace, control characters, backslashes and non-ASCII spacing tricks are refused outright.
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x5c || c === 0x2028 || c === 0x2029 || c === 0xa0 || c === 0xfeff) return null;
  }
  if (raw.slice(0, 8).toLowerCase() !== 'https://') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url.href;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

interface Ctx {
  n: number;
  lastBold: number;
  lastStar: number;
  lastClose: number;
}

function inline(text: string, depth: number, allowLinks: boolean, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const ctx: Ctx = {
    n: 0,
    lastBold: text.lastIndexOf('**'),
    lastStar: text.lastIndexOf('*'),
    lastClose: text.lastIndexOf(']('),
  };
  let buf = '';
  const flush = () => {
    if (buf) { out.push(buf); buf = ''; }
  };
  const push = (node: React.ReactNode) => { flush(); out.push(node); };
  const nested = (s: string, links: boolean) => (depth + 1 > MAX_DEPTH ? [s] : inline(s, depth + 1, links, `${key}.${ctx.n}`));
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '*' && text[i + 1] === '*') {
      const j = i + 2 <= ctx.lastBold ? text.indexOf('**', i + 2) : -1;
      if (j > i + 2) {
        push(<strong key={`${key}b${ctx.n++}`}>{nested(text.slice(i + 2, j), allowLinks)}</strong>);
        i = j + 2;
        continue;
      }
      buf += '**';
      i += 2;
      continue;
    }
    if (ch === '*' || (ch === '_' && !isWordChar(text[i - 1]))) {
      let j = -1;
      if (ch === '*' ? i < ctx.lastStar : true) {
        let from = i + 1;
        for (;;) {
          const k = text.indexOf(ch, from);
          if (k === -1) break;
          if (ch === '*' && text[k + 1] === '*') { from = k + 2; continue; }
          if (ch === '_' && isWordChar(text[k + 1])) { from = k + 1; continue; }
          j = k;
          break;
        }
      }
      if (j > i + 1 && text[i + 1] !== ' ') {
        push(<em key={`${key}i${ctx.n++}`}>{nested(text.slice(i + 1, j), allowLinks)}</em>);
        i = j + 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '[' && allowLinks && i < ctx.lastClose) {
      const close = text.indexOf('](', i + 1);
      const label = close === -1 ? '' : text.slice(i + 1, close);
      const end = close === -1 ? -1 : text.indexOf(')', close + 2);
      if (close > i + 1 && end !== -1 && label.indexOf('[') === -1) {
        const raw = text.slice(close + 2, end);
        const href = safeHttpsUrl(raw);
        if (href) {
          push(
            <a key={`${key}a${ctx.n++}`} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {nested(label, false)}
            </a>,
          );
        } else {
          buf += text.slice(i, end + 1); // refused: the literal source, so the reader sees what it was
        }
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: 3 | 4; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] };

const UL = /^[-*+] +(.*)$/;
const OL = /^\d{1,9}[.)] +(.*)$/;
const H = /^(#{3,4}) +(.*)$/;

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const endPara = () => { if (para.length) { blocks.push({ t: 'p', text: para.join(' ') }); para = []; } };
  const endList = () => { if (list) { blocks.push(list); list = null; } };
  for (const rawLine of src.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trimEnd();
    if (line.trim() === '') { endPara(); endList(); continue; }
    const h = H.exec(line);
    if (h) {
      endPara(); endList();
      blocks.push({ t: 'h', level: h[1].length === 3 ? 3 : 4, text: h[2].trim() });
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      endPara();
      const t = ul ? 'ul' : 'ol';
      if (list && list.t !== t) endList();
      if (!list) list = { t, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (list && /^\s+\S/.test(rawLine)) { // a wrapped list item
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara(); endList();
  return blocks;
}

/** Render the subset to React nodes. Safe for any string: nothing in it can become markup. */
export function renderMarkdownSubset(source: string): React.ReactNode {
  const truncated = source.length > MAX_MARKDOWN_CHARS;
  const src = truncated ? source.slice(0, MAX_MARKDOWN_CHARS) : source;
  const blocks = parseBlocks(src);
  return (
    <>
      {blocks.map((b, i) => {
        const key = `m${i}`;
        if (b.t === 'h') {
          const kids = inline(b.text, 0, true, key);
          return b.level === 3
            ? <h3 key={key} className="mt-4 text-base font-semibold text-text-main">{kids}</h3>
            : <h4 key={key} className="mt-3 text-sm font-semibold text-text-main">{kids}</h4>;
        }
        if (b.t === 'ul' || b.t === 'ol') {
          const Tag = b.t;
          return (
            <Tag key={key} className={`my-2 space-y-1 pl-5 ${b.t === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((it, j) => <li key={`${key}-${j}`}>{inline(it, 0, true, `${key}-${j}`)}</li>)}
            </Tag>
          );
        }
        return <p key={key} className="my-2">{inline(b.text, 0, true, key)}</p>;
      })}
      {truncated && (
        <p role="note" className="my-2 text-xs italic text-text-sub" data-testid="markdown-truncated">
          This text is longer than {MAX_MARKDOWN_CHARS.toLocaleString('en-US')} characters, so only the first part is shown here.
        </p>
      )}
    </>
  );
}

export function MarkdownSubset({ source, className }: { source: string; className?: string }) {
  return <div className={className ?? 'text-sm leading-relaxed text-text-main'}>{renderMarkdownSubset(source)}</div>;
}
