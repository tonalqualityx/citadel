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
/** VERIFY-5 Z9: a line the card can always show in full. */
export const CHECKLIST_LINE_MAX = 500;
export const CHECKLIST_LINE_TEXT = `A checklist line can be up to ${CHECKLIST_LINE_MAX} characters.`;
export const UNDO_FORMATTING_TEXT = "That can't be put back as plain text. Open the task.";

/**
 * Characters nobody can see (VERIFY-5 Z2), by Unicode property rather than by list: every format character (Cf),
 * control (Cc, except the line break, which is the text's own), private-use (Co), unassigned (Cn) and lone surrogate
 * (Cs) code point, and every Default_Ignorable_Code_Point (variation selectors, Hangul fillers, the tag block, the
 * combining grapheme joiner, the Mongolian selectors), plus the two visible-as-nothing characters that are none of
 * these: the braille blank and the object replacement character.
 */
export const INVISIBLE = /(?!\n)[\p{Cf}\p{Cc}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}\u2800\uFFFC]/gu;

/** Line breaks made plain and tabs made spaces: the step before the invisible characters go. */
const plainBreaks = (v: string) => v.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(/\t/g, ' ');

/** Text without its invisible characters, in NFC, and how many were taken out (the card says how many). */
export function stripInvisible(v: string): { text: string; removed: number } {
  const b = plainBreaks(v);
  const removed = (b.match(INVISIBLE) ?? []).length;
  return { text: b.replace(INVISIBLE, '').normalize('NFC'), removed };
}

/** Invisible characters out, line breaks plain, NFC (a single-line field's own rule then refuses a line break). */
export function plainString(v: string): string {
  return stripInvisible(v).text;
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
  return plainParagraphs(lines, seed);
}

/** Lines of plain text as the exact stored paragraphs (null for none). */
export function plainParagraphs(lines: string[], seed: string): string | null {
  const ls = lines.filter((l) => l.trim().length > 0);
  if (ls.length === 0) return null;
  return JSON.stringify(ls.map((l, i) => paragraph(derivedId(seed, 'p', i, l), l)));
}

/** Every item text of a stored checklist, sections flattened (for a rewrite of older text). */
function itemTexts(stored: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.items)) {
      if (typeof o.title === 'string' && o.title.trim()) out.push(o.title);
      for (const i of o.items) visit(i);
    } else if (typeof o.text === 'string') out.push(o.text);
  };
  if (Array.isArray(stored)) stored.forEach(visit);
  return out;
}

export type PlainForm = { value: unknown; display: string };

/**
 * VERIFY-5 Z4: the plain form of a stored field the chat lane wrote earlier, when it holds more than the plain form
 * (block ids, types, styles, property names, tick metadata the server did not make, invisible characters), else null.
 * The card shows `display`, and the tap stores `value` in the same transaction, so what Bast reads after the tap is
 * exactly the plain text the card showed. Throws an ApiError when the plain form cannot be made (a line over the cap).
 */
export function plainFormOf(field: string, value: unknown, taskId: string): PlainForm | null {
  if (value === null || value === undefined) return null;
  if (field === 'description' || field === 'notes') {
    const lines = plainLines(value);
    if (lines && lines.every((l) => plainString(l) === l)) return null; // plain already, only its ids differ: nothing hidden
    const src = (lines ?? everyWord(value)).map((l) => plainString(l).replace(/[ ]+$/g, '')).filter((l) => l.trim());
    return { value: plainParagraphs(src, `${taskId}:${field}`), display: src.join('\n') };
  }
  if (field === 'requirements') {
    const texts = isPlainChecklist(value) ? (value as { text: string }[]).map((i) => i.text) : itemTexts(value);
    if (isPlainChecklist(value) && texts.every((t) => plainString(t).replace(/\n+/g, ' ').trim() === t)) return null;
    const list = chatChecklist(texts.filter((t) => plainString(t).trim()), value, `${taskId}:requirements`) ?? [];
    return { value: list, display: list.map((i, n) => `${n + 1}. ${i.text}`).join('\n') };
  }
  if (field === 'title' || field === 'promised_to') {
    if (typeof value !== 'string') return null;
    const p = plainString(value).trim();
    return p === value ? null : { value: p, display: p };
  }
  if (field === 'tags') {
    if (!Array.isArray(value)) return null;
    const p = (value as unknown[]).map((t) => (typeof t === 'string' ? plainString(t).trim() : String(t)));
    return p.every((t, i) => t === value[i]) ? null : { value: p, display: p.join(', ') || 'none' };
  }
  return null;
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
    if (text.length > CHECKLIST_LINE_MAX) throw new ApiError(CHECKLIST_LINE_TEXT, 403, 'chat_field_refused');
    const old = (have.get(text.toLowerCase()) ?? []).find((x) => !used.has(x));
    if (old) used.add(old);
    const done = !!old && (old.completed === true || old.is_complete === true);
    // The server's metadata only (VERIFY-5 Z4): an id, a time or a person carried from an older item only when it is a
    // uuid or an ISO time, so no words can ride in them; anything else is made again.
    const id = old && typeof old.id === 'string' && UUID_RE.test(old.id) ? old.id.toLowerCase() : derivedId(seed, 'r', i, text);
    return {
      id,
      type: 'item' as const,
      text,
      completed: done,
      completed_at: done && typeof old?.completed_at === 'string' && ISO_RE.test(old.completed_at) ? old.completed_at : null,
      completed_by: done && typeof old?.completed_by === 'string' && UUID_RE.test(old.completed_by) ? old.completed_by : null,
      sort_order: i,
    };
  });
}

/** True when a stored checklist is items of text with server metadata only (what `chatChecklist` writes). */
/**
 * True when a stored checklist is exactly what `chatChecklist` writes: items of text, and metadata that cannot hold
 * words (a uuid id, a tick, an ISO time or null, a uuid person or null, a number). Anything else is shown through
 * `everyWord` and, when the chat wrote it, rewritten by the tap (VERIFY-5 Z4).
 */
export function isPlainChecklist(stored: unknown): boolean {
  if (stored === null || stored === undefined) return true;
  if (!Array.isArray(stored)) return false;
  return stored.every((o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const r = o as Record<string, unknown>;
    if (Object.keys(r).some((k) => !['id', 'type', 'text', 'completed', 'completed_at', 'completed_by', 'sort_order'].includes(k))) return false;
    return (
      typeof r.text === 'string' && (r.type === undefined || r.type === 'item') && typeof r.id === 'string' && UUID_RE.test(r.id) &&
      (r.completed === undefined || typeof r.completed === 'boolean') && (r.completed_at === undefined || r.completed_at === null || (typeof r.completed_at === 'string' && ISO_RE.test(r.completed_at))) &&
      (r.completed_by === undefined || r.completed_by === null || (typeof r.completed_by === 'string' && UUID_RE.test(r.completed_by))) &&
      (r.sort_order === undefined || typeof r.sort_order === 'number')
    );
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** BlockNote's structural keys and the keys of a checklist item: their names carry no words. */
const STRUCTURAL_KEYS = ['id', 'type', 'props', 'content', 'children', 'text', 'styles', 'href', 'textColor', 'backgroundColor', 'textAlignment', 'level', 'start', 'checked', 'bold', 'italic', 'underline', 'strike', 'code', 'title', 'items', 'completed', 'completed_at', 'completed_by', 'sort_order', 'is_complete', 'icon', 'rows', 'cells', 'columnWidths'];
/** Block, inline and item type names. */
const KNOWN_TYPES = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'text', 'link', 'item', 'section', 'table', 'tableContent', 'image', 'file', 'video', 'audio', 'codeBlock', 'quote', 'toggleListItem', 'pageBreak'];
const QUIET_VALUES = ['default', 'left', 'center', 'right', 'justify'];

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
  const say = (s: string) => {
    const p = plainString(s);
    if (p.trim()) out.push(p);
  };
  // VERIFY-5 Z4: every string that could hold words is printed. An id or a time only when it is not a uuid or an ISO
  // time; a type only when BlockNote does not have it; a style value whenever it is a string; and every key that is not
  // structural, with its value, as "key: value".
  const walk = (x: unknown, key: string | null): void => {
    if (typeof x === 'string') {
      if (UUID_RE.test(x) || ISO_RE.test(x)) return;
      if (key === 'type' && KNOWN_TYPES.includes(x)) return;
      if ((key === 'textColor' || key === 'backgroundColor' || key === 'textAlignment') && QUIET_VALUES.includes(x)) return;
      say(key === null || key === 'text' || key === 'title' ? x : `${key}: ${x}`);
      return;
    }
    if (typeof x === 'number' || typeof x === 'boolean' || x === null || x === undefined) return;
    if (Array.isArray(x)) x.forEach((y) => walk(y, key));
    else if (typeof x === 'object') {
      for (const [k, y] of Object.entries(x as Record<string, unknown>)) {
        if (!STRUCTURAL_KEYS.includes(k) && (key !== 'styles' || typeof y !== 'boolean')) say(`key: ${k}`);
        else if (key === 'styles' && typeof y === 'boolean' && !['bold', 'italic', 'underline', 'strike', 'code'].includes(k)) say(`key: ${k}`);
        walk(y, k);
      }
    }
  };
  walk(v, null);
  return out;
}
