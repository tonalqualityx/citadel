/**
 * Bast chat v2, VERIFY-4 R1 and R2: chat-lane text is plain text, in one exact stored form.
 *
 * Every write from the chat lane to a field the worker reads goes through here before anything else looks at it (the
 * field filter, the reach check, the card, the write, the tap):
 * - every string loses its invisible and direction-control characters (Unicode Cf, and control characters other than a
 *   line break) and gets plain line breaks (`plainString`);
 * - a description or notes becomes plain paragraphs, one per line of text, stored as the exact BlockNote JSON string
 *   the column will hold (`chatRichText`). A link keeps its words and its address in the text ("brief
 *   (https://...)"). Bold and italic go. Anything that cannot be said in plain words (an image, a table, a file, a
 *   property with a value) is refused with RICH_TEXT_REFUSED_TEXT, never dropped;
 * - a checklist becomes items of text only (`chatChecklist`). Ids, ticks and who ticked them are the server's: an item
 *   whose text matches a current item keeps that item's id and tick, a new one gets an id derived from the task, its
 *   place and its text, and is not ticked. Sections and any other key are refused with CHECKLIST_REFUSED_TEXT.
 *
 * Ids are derived, not random: the same input always gives the same bytes, so what the reach check compares, what the
 * card shows and what is stored are the same, and a tap writes exactly what the card showed (VERIFY-4 Y7).
 */
import { createHash } from 'crypto';
import { ApiError } from '@/lib/api/errors';

export const RICH_TEXT_REFUSED_TEXT = "That has formatting the chat can't write, like a picture or a table. Send it as plain text.";
export const CHECKLIST_REFUSED_TEXT = 'A checklist from the chat is a list of lines of text.';
export const UNDO_FORMATTING_TEXT = "That can't be put back as plain text. Open the task.";

const INVISIBLE = /[\p{Cf}\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu;

/** Invisible and control characters out (a tab becomes a space), line breaks plain (a single-line field's own rule then refuses a line break). */
export function plainString(v: string): string {
  return v.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(/\t/g, ' ').replace(INVISIBLE, '');
}

/** A uuid-shaped id from a seed: the same seed, the same id. */
export function derivedId(...parts: (string | number)[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const DEFAULT_PROPS = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' } as const;

/** One stored paragraph, in the key order the column holds. */
function paragraph(id: string, text: string) {
  return { id, type: 'paragraph', props: { ...DEFAULT_PROPS }, content: text ? [{ type: 'text', text, styles: {} }] : [], children: [] };
}

const refuseRich = () => new ApiError(RICH_TEXT_REFUSED_TEXT, 403, 'chat_field_refused');
const BLOCK_TYPES = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem'];
const BLOCK_KEYS = ['id', 'type', 'props', 'content', 'children'];
/** Props that carry no words: only these keys, only these values. */
function propsCarryNoWords(props: unknown): boolean {
  if (props === undefined || props === null) return true;
  if (typeof props !== 'object' || Array.isArray(props)) return false;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (k === 'textColor' || k === 'backgroundColor') {
      if (v !== 'default') return false;
    } else if (k === 'textAlignment') {
      if (!['left', 'center', 'right', 'justify'].includes(v as string)) return false;
    } else if (k === 'level' || k === 'start') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1000) return false;
    } else if (k === 'checked') {
      if (typeof v !== 'boolean') return false;
    } else return false;
  }
  return true;
}
function stylesCarryNoWords(styles: unknown): boolean {
  if (styles === undefined) return true;
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return false;
  return Object.values(styles as Record<string, unknown>).every((v) => typeof v === 'boolean' || v === 'default');
}

/** The visible words of BlockNote inline content, a link as "words (address)". Throws for anything else. */
function inlineText(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw refuseRich();
  let out = '';
  for (const c of content) {
    if (!c || typeof c !== 'object') throw refuseRich();
    const o = c as Record<string, unknown>;
    if (o.type === 'text') {
      if (Object.keys(o).some((k) => !['type', 'text', 'styles'].includes(k)) || typeof o.text !== 'string' || !stylesCarryNoWords(o.styles)) throw refuseRich();
      out += o.text;
    } else if (o.type === 'link') {
      if (Object.keys(o).some((k) => !['type', 'href', 'content'].includes(k)) || typeof o.href !== 'string') throw refuseRich();
      const label = inlineText(o.content);
      out += label && label !== o.href ? `${label} (${o.href})` : o.href;
    } else throw refuseRich();
  }
  return out;
}

/** BlockNote blocks to lines of plain text: a list item keeps a "- " or "1. " in front. Throws for anything else. */
function blockLines(blocks: unknown[], depth = 0): string[] {
  if (depth > 5) throw refuseRich();
  const lines: string[] = [];
  let n = 0;
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw refuseRich();
    const o = b as Record<string, unknown>;
    if (!BLOCK_TYPES.includes(o.type as string) || Object.keys(o).some((k) => !BLOCK_KEYS.includes(k)) || !propsCarryNoWords(o.props)) throw refuseRich();
    if (o.id !== undefined && typeof o.id !== 'string') throw refuseRich();
    n = o.type === 'numberedListItem' ? n + 1 : 0;
    const text = inlineText(o.content);
    const lead = '  '.repeat(depth);
    const prefix = o.type === 'bulletListItem' ? '- ' : o.type === 'numberedListItem' ? `${n}. ` : o.type === 'checkListItem' ? ((o.props as { checked?: boolean } | undefined)?.checked ? '[x] ' : '[ ] ') : '';
    lines.push(`${lead}${prefix}${text}`);
    if (o.children !== undefined) {
      if (!Array.isArray(o.children)) throw refuseRich();
      lines.push(...blockLines(o.children, depth + 1));
    }
  }
  return lines;
}

/** The plain lines a chat value stands for (a string, a JSON string of blocks, or blocks). */
function chatLines(value: unknown): string[] {
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(t);
      } catch {
        parsed = undefined;
      }
      if (Array.isArray(parsed)) return blockLines(parsed).map(plainString);
    }
    return plainString(value).split('\n');
  }
  if (Array.isArray(value)) return blockLines(value).map(plainString);
  throw refuseRich();
}

/**
 * A chat description or notes, as the exact string the column will hold: plain paragraphs (one per line; blank lines
 * dropped, spaces at the ends of a line trimmed), or null for nothing. `seed` makes the ids (task id and field).
 */
export function chatRichText(value: unknown, seed: string): string | null {
  if (value === null || value === undefined) return null;
  const lines = chatLines(value)
    .map((l) => l.replace(/[ ]+$/g, ''))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  return JSON.stringify(lines.map((l, i) => paragraph(derivedId(seed, 'p', i, l), l)));
}

/** True when a stored rich text is plain paragraphs exactly as `chatRichText` writes them (or empty). */
export function isPlainRichText(stored: unknown): boolean {
  if (stored === null || stored === undefined || stored === '') return true;
  if (typeof stored !== 'string') return false;
  let blocks: unknown;
  try {
    blocks = JSON.parse(stored);
  } catch {
    return false; // a plain string the renderer would convert: formatting is not certain
  }
  if (!Array.isArray(blocks)) return false;
  return blocks.every((b) => {
    const o = b as Record<string, unknown>;
    if (!o || o.type !== 'paragraph' || typeof o.id !== 'string') return false;
    if (Object.keys(o).some((k) => !BLOCK_KEYS.includes(k))) return false;
    if (!propsCarryNoWords(o.props) || (Array.isArray(o.children) && o.children.length > 0)) return false;
    const c = o.content;
    return Array.isArray(c) && c.every((x) => x && x.type === 'text' && typeof x.text === 'string' && (!x.styles || Object.values(x.styles).every((v) => v === false)));
  });
}

/** The lines of a stored rich text when it is plain (`isPlainRichText`), else null. */
export function plainLines(stored: unknown): string[] | null {
  if (!isPlainRichText(stored)) return null;
  if (stored === null || stored === undefined || stored === '') return [];
  return (JSON.parse(stored as string) as { content: { text: string }[] }[]).map((b) => b.content.map((x) => x.text).join(''));
}

export type ChecklistItem = { id: string; type: 'item'; text: string; completed: boolean; completed_at: string | null; completed_by: string | null; sort_order: number };

const refuseList = () => new ApiError(CHECKLIST_REFUSED_TEXT, 403, 'chat_field_refused');
/** Keys a checklist line from the chat may carry. Only `text` is read; the rest is the server's to set. */
const LINE_KEYS = ['id', 'type', 'text', 'completed', 'completed_at', 'completed_by', 'sort_order', 'is_complete'];

/** Current items of a stored checklist, flattened, for keeping ids and ticks. */
function currentItems(stored: unknown): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.items)) for (const i of o.items) visit(i);
    else if (typeof o.text === 'string') {
      const k = plainString(o.text).trim().toLowerCase();
      out.set(k, [...(out.get(k) ?? []), o]);
    }
  };
  if (Array.isArray(stored)) for (const r of stored) visit(r);
  return out;
}

/**
 * A chat checklist as the exact list the column will hold: items of text only. `current` is the stored checklist (its
 * matching items keep their id and tick); `seed` makes new ids (task id). Null clears it.
 */
export function chatChecklist(value: unknown, current: unknown, seed: string): ChecklistItem[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw refuseList();
  const have = currentItems(current);
  const used = new Set<unknown>();
  return value.map((v, i) => {
    let raw: unknown;
    if (typeof v === 'string') raw = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (Object.keys(o).some((k) => !LINE_KEYS.includes(k)) || (o.type !== undefined && o.type !== 'item')) throw refuseList();
      raw = o.text;
    }
    if (typeof raw !== 'string') throw refuseList();
    const text = plainString(raw).replace(/\n+/g, ' ').trim();
    if (!text) throw refuseList();
    const old = (have.get(text.toLowerCase()) ?? []).find((x) => !used.has(x));
    if (old) used.add(old);
    const done = !!old && (old.completed === true || old.is_complete === true);
    const id = old && typeof old.id === 'string' && /^[0-9a-f-]{8,64}$/i.test(old.id) ? old.id : derivedId(seed, 'r', i, text);
    return {
      id,
      type: 'item' as const,
      text,
      completed: done,
      completed_at: done && typeof old?.completed_at === 'string' ? old.completed_at : null,
      completed_by: done && typeof old?.completed_by === 'string' ? old.completed_by : null,
      sort_order: i,
    };
  });
}

/** True when a stored checklist is items of text with server metadata only (what `chatChecklist` writes). */
export function isPlainChecklist(stored: unknown): boolean {
  if (stored === null || stored === undefined) return true;
  if (!Array.isArray(stored)) return false;
  return stored.every((o) => o && typeof o === 'object' && (o.type === undefined || o.type === 'item') && typeof o.text === 'string' && Object.keys(o).every((k) => LINE_KEYS.includes(k)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const QUIET_KEYS = ['type', 'styles'];
const QUIET_VALUES = ['default', 'left', 'center', 'right', 'justify', 'item', 'section', 'paragraph', 'text', 'link'];

/**
 * Every string a session could read in a stored value that is not plain (older text, written before R1): the words,
 * and beside them every other string leaf, except ids and times (a uuid or an ISO time cannot carry words) and the
 * fixed values of formatting. Used by the card for text it did not write itself, so nothing is left unseen.
 */
export function everyWord(stored: unknown): string[] {
  let v: unknown = stored;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return t ? plainString(t).split('\n') : [];
    try {
      v = JSON.parse(t);
    } catch {
      return [plainString(t)];
    }
  }
  const out: string[] = [];
  const walk = (x: unknown, key: string | null): void => {
    if (typeof x === 'string') {
      if (key === 'id' || UUID_RE.test(x) || ISO_RE.test(x)) return;
      if (key !== null && QUIET_KEYS.includes(key)) return;
      if (key !== 'text' && QUIET_VALUES.includes(x)) return;
      if (x.trim()) out.push(key && key !== 'text' && key !== 'title' ? `${key}: ${plainString(x)}` : plainString(x));
      return;
    }
    if (Array.isArray(x)) x.forEach((y) => walk(y, key));
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x as Record<string, unknown>)) walk(y, k);
  };
  walk(v, null);
  return out;
}
