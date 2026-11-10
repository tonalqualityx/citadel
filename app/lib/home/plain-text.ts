/**
 * Home screen Slice 1: rich text to plain text for card summaries (design 2B: one to three
 * sentences, at most about 60 words).
 *
 * Task descriptions are stored as a JSON-stringified BlockNote block array (see
 * lib/api/blocknote.ts, which only goes the other way). Older rows can hold plain text or
 * Markdown, and a few hold a TipTap-style document object. All of these come out as a list
 * of plain paragraphs; nothing throws on odd input, and anything unreadable gives no text.
 *
 * Pure: no I/O, safe on the server and in the browser.
 */

import { CARD_SUMMARY_MAX_WORDS } from './rules';

export interface PlainParagraph {
  text: string;
  /** True for a heading block or a Markdown "#" line. firstParagraph skips these when it can. */
  heading: boolean;
}

const MAX_DEPTH = 40;

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Text of a BlockNote or TipTap inline content value (array of inline nodes, a string, or table content). */
function inlineText(content: unknown, depth: number): string {
  if (depth > MAX_DEPTH || content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => inlineText(c, depth + 1)).join('');
  if (typeof content !== 'object') return '';
  const node = content as Record<string, unknown>;
  // BlockNote table content: { type: 'tableContent', rows: [{ cells: [...] }] }
  if (Array.isArray(node.rows)) {
    return node.rows
      .map((row) => {
        const cells = (row as Record<string, unknown>)?.cells;
        if (!Array.isArray(cells)) return '';
        return cells
          .map((cell) => {
            const inner = cell && typeof cell === 'object' && !Array.isArray(cell) ? (cell as Record<string, unknown>).content : cell;
            return squash(inlineText(inner, depth + 1));
          })
          .filter(Boolean)
          .join(' ');
      })
      .filter(Boolean)
      .join(' ');
  }
  if (node.type === 'hardBreak') return ' ';
  if (typeof node.text === 'string') return node.text;
  if ('content' in node) return inlineText(node.content, depth + 1);
  return '';
}

function isHeadingType(type: unknown): boolean {
  return type === 'heading';
}

/** BlockNote document: an array of blocks { type, content, children }. */
function fromBlocks(blocks: unknown[], out: PlainParagraph[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const b of blocks) {
    if (typeof b === 'string') {
      const t = squash(b);
      if (t) out.push({ text: t, heading: false });
      continue;
    }
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const block = b as Record<string, unknown>;
    // A TipTap document nested in an array: walk it the TipTap way.
    if (block.type === 'doc') {
      fromTiptap(block, out, depth + 1);
      continue;
    }
    const text = squash(inlineText(block.content, depth + 1));
    if (text) out.push({ text, heading: isHeadingType(block.type) });
    if (Array.isArray(block.children)) fromBlocks(block.children, out, depth + 1);
  }
}

/** TipTap / ProseMirror style document: { type: 'doc', content: [nodes] }. */
function fromTiptap(node: Record<string, unknown>, out: PlainParagraph[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  const content = node.content;
  if (!Array.isArray(content)) {
    if (typeof node.text === 'string') {
      const t = squash(node.text);
      if (t) out.push({ text: t, heading: false });
    }
    return;
  }
  const inline = content.some((c) => {
    const t = (c as Record<string, unknown> | null)?.type;
    return t === 'text' || t === 'hardBreak';
  });
  if (inline) {
    const text = squash(inlineText(content, depth + 1));
    if (text) out.push({ text, heading: isHeadingType(node.type) });
    return;
  }
  for (const child of content) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      fromTiptap(child as Record<string, unknown>, out, depth + 1);
    }
  }
}

/** Strip the light Markdown that agents and people write in task descriptions. */
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, '$1$2') // italic *x*
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?=[^_\w]|$)/g, '$1$2') // italic _x_
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/`([^`]*)`/g, '$1'); // inline code
}

const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*)$/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE_LINE = /^\s*```/;
const QUOTE_LINE = /^\s*>\s?(.*)$/;

/** Plain text or Markdown: blank lines split paragraphs; headings and list items stand alone. */
function fromText(text: string, out: PlainParagraph[]): void {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    const t = squash(stripInlineMarkdown(para.join(' ')));
    para = [];
    if (t) out.push({ text: t, heading: false });
  };
  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      flush();
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const h = line.match(HEADING_LINE);
    if (h) {
      flush();
      const t = squash(stripInlineMarkdown(h[1]));
      if (t) out.push({ text: t, heading: true });
      continue;
    }
    const li = line.match(LIST_LINE);
    if (li) {
      flush();
      const t = squash(stripInlineMarkdown(li[1]));
      if (t) out.push({ text: t, heading: false });
      continue;
    }
    const q = line.match(QUOTE_LINE);
    para.push(q ? q[1] : line);
  }
  flush();
}

/**
 * Any stored rich-text value to plain paragraphs, in document order, empty ones dropped.
 * Accepts: null or undefined; a BlockNote block array; a JSON string of one; a TipTap
 * document object (or its JSON string); plain text or Markdown.
 */
export function richTextToParagraphs(value: unknown): PlainParagraph[] {
  const out: PlainParagraph[] = [];
  if (value == null) return out;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return out;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) return richTextToParagraphs(parsed);
      } catch {
        // Not JSON: read it as text below.
      }
    }
    fromText(value, out);
    return out;
  }
  if (Array.isArray(value)) {
    fromBlocks(value, out, 0);
    return out;
  }
  if (typeof value === 'object') {
    fromTiptap(value as Record<string, unknown>, out, 0);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean') fromText(String(value), out);
  return out;
}

/** The whole value as plain text, paragraphs separated by a blank line. */
export function toPlainText(value: unknown): string {
  return richTextToParagraphs(value)
    .map((p) => p.text)
    .join('\n\n');
}

/** The first paragraph that is not a heading; the first heading only when there is nothing else; '' when empty. */
export function firstParagraph(value: unknown): string {
  const paras = richTextToParagraphs(value);
  const body = paras.find((p) => !p.heading);
  return (body ?? paras[0])?.text ?? '';
}

/**
 * Cut text to at most `maxWords` words on a word boundary. A cut drops trailing , ; : and
 * adds an ellipsis. Whitespace is collapsed either way.
 */
export function truncateWords(text: string, maxWords: number = CARD_SUMMARY_MAX_WORDS): string {
  const words = squash(text).split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  const cut = words
    .slice(0, Math.max(1, maxWords))
    .join(' ')
    .replace(/[,;:]+$/, '');
  return `${cut}…`;
}

/** First paragraph, truncated for a card summary. '' when the value has no text. */
export function cardSummary(value: unknown, maxWords: number = CARD_SUMMARY_MAX_WORDS): string {
  return truncateWords(firstParagraph(value), maxWords);
}
