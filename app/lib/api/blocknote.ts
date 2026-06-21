/**
 * Markdown → BlockNote conversion for rich-text fields (task description / notes).
 *
 * Why: the task API historically stored whatever string it was given for
 * `description`/`notes`. A plain string (or Markdown) is NOT a BlockNote document,
 * and the read-only renderer feeds the stored value straight into BlockNote as
 * `initialContent` — which only accepts an array of blocks. The result was a
 * silently BLANK field. Converting Markdown / plain-string input into a BlockNote
 * block array at the API removes that whole class of bug, while still accepting raw
 * BlockNote arrays for back-compat.
 *
 * Scope: a deliberately bounded Markdown subset that matches how task descriptions
 * are actually authored by agents and humans — headings (#–###), paragraphs,
 * bullet/numbered lists, fenced code blocks, and inline bold / italic / code /
 * strikethrough / links. Anything else is preserved as plain paragraph text, so no
 * input is ever lost and nothing ever renders blank. This is intentionally NOT a
 * full CommonMark parser (no tables / blockquotes / images / nested lists); extend
 * the block/inline rules below as needs grow.
 *
 * Output shape matches the BlockNote documents already stored in Citadel:
 *   block:  { id, type, props?, content }
 *   inline: { type: 'text', text, styles }  |  { type: 'link', href, content }
 * `children` is intentionally omitted — existing rendered descriptions omit it, and
 * the renderer treats it as optional.
 */

export interface StyledText {
  type: 'text';
  text: string;
  styles: Record<string, boolean>;
}

export interface LinkInline {
  type: 'link';
  href: string;
  content: StyledText[];
}

export type InlineContent = StyledText | LinkInline;

export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content: InlineContent[];
}

function newId(): string {
  // crypto.randomUUID is a global in Node 18+ and modern browsers.
  return crypto.randomUUID();
}

function styledText(text: string, styles: Record<string, boolean>): StyledText {
  return { type: 'text', text, styles: { ...styles } };
}

// ============================================
// INLINE PARSING
// ============================================

type InlineRuleName = 'code' | 'link' | 'bold' | 'strike' | 'italic';

interface InlineRule {
  name: InlineRuleName;
  regex: RegExp;
}

// Order is the tie-break precedence when two rules match at the same index:
// code first (no nested formatting inside it), then links, then bold (so `**`
// wins over `*`), then strike, then italic.
const INLINE_RULES: InlineRule[] = [
  { name: 'code', regex: /`([^`]+)`/ },
  { name: 'link', regex: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { name: 'bold', regex: /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__/ },
  { name: 'strike', regex: /~~([\s\S]+?)~~/ },
  { name: 'italic', regex: /\*([^*\n]+?)\*|_([^_\n]+?)_/ },
];

/**
 * Parse a single run of text into BlockNote inline content, recursively applying
 * the accumulated `styles` to nested spans (e.g. bold inside italic).
 */
function parseInline(
  text: string,
  styles: Record<string, boolean> = {}
): InlineContent[] {
  if (!text) return [];

  let earliest: { index: number; rule: InlineRule; match: RegExpMatchArray } | null =
    null;
  for (const rule of INLINE_RULES) {
    const m = text.match(rule.regex);
    if (m && m.index !== undefined && (!earliest || m.index < earliest.index)) {
      earliest = { index: m.index, rule, match: m };
    }
  }

  if (!earliest) {
    return [styledText(text, styles)];
  }

  const { index, rule, match } = earliest;
  const before = text.slice(0, index);
  const after = text.slice(index + match[0].length);

  const result: InlineContent[] = [];
  if (before) result.push(...parseInline(before, styles));

  switch (rule.name) {
    case 'code':
      result.push(styledText(match[1], { ...styles, code: true }));
      break;
    case 'link': {
      const label = match[1];
      const href = match[2];
      const inner = parseInline(label, styles).filter(
        (n): n is StyledText => n.type === 'text'
      );
      result.push({
        type: 'link',
        href,
        content: inner.length ? inner : [styledText(label, styles)],
      });
      break;
    }
    case 'bold':
      result.push(...parseInline(match[1] ?? match[2], { ...styles, bold: true }));
      break;
    case 'strike':
      result.push(...parseInline(match[1], { ...styles, strike: true }));
      break;
    case 'italic':
      result.push(...parseInline(match[1] ?? match[2], { ...styles, italic: true }));
      break;
  }

  if (after) result.push(...parseInline(after, styles));
  return result;
}

// ============================================
// BLOCK PARSING
// ============================================

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const FENCE_RE = /^\s*```(.*)$/;

/**
 * Convert a Markdown / plain-text string into an array of BlockNote blocks.
 * Always returns at least one block for non-empty input, so the value never
 * renders blank.
 */
export function markdownToBlockNote(markdown: string): BlockNoteBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNoteBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) {
      blocks.push({ id: newId(), type: 'paragraph', content: parseInline(text) });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block — consume through the closing fence.
    const fence = line.match(FENCE_RE);
    if (fence) {
      flushParagraph();
      const language = fence[1].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      const code = codeLines.join('\n');
      blocks.push({
        id: newId(),
        type: 'codeBlock',
        props: language ? { language } : {},
        content: code ? [styledText(code, {})] : [],
      });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({
        id: newId(),
        type: 'heading',
        props: { level },
        content: parseInline(heading[2].trim()),
      });
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flushParagraph();
      blocks.push({
        id: newId(),
        type: 'bulletListItem',
        content: parseInline(bullet[1].trim()),
      });
      continue;
    }

    const numbered = line.match(NUMBERED_RE);
    if (numbered) {
      flushParagraph();
      blocks.push({
        id: newId(),
        type: 'numberedListItem',
        content: parseInline(numbered[1].trim()),
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();

  // Guarantee a non-empty document for non-empty input.
  if (blocks.length === 0) {
    blocks.push({ id: newId(), type: 'paragraph', content: [] });
  }
  return blocks;
}

// ============================================
// NORMALIZATION (used by API routes)
// ============================================

/**
 * Normalize any rich-text input into a BlockNote document (array of blocks) or
 * null. Accepts:
 *  - null / undefined / empty string  → null
 *  - an existing BlockNote array       → returned unchanged (back-compat)
 *  - a JSON-stringified BlockNote array → parsed to the array (back-compat)
 *  - a non-array object (e.g. legacy TipTap doc) → returned unchanged
 *  - any other string                  → converted from Markdown
 */
export function normalizeRichTextInput(value: unknown): BlockNoteBlock[] | any | null {
  if (value === null || value === undefined) return null;

  // Already a BlockNote document.
  if (Array.isArray(value)) return value;

  // A non-array object (e.g. a pre-parsed doc or legacy TipTap content) — leave it
  // for the renderer to handle.
  if (typeof value === 'object') return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // A JSON-stringified BlockNote array sent by some API callers.
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not JSON — treat as Markdown below.
      }
    }
    return markdownToBlockNote(value);
  }

  // Numbers / booleans / etc. — coerce to text.
  return markdownToBlockNote(String(value));
}

/**
 * Normalize rich-text input and serialize it for storage in a Text column, or
 * null. This is the single entry point the task routes use for description/notes.
 */
export function serializeRichText(value: unknown): string | null {
  const normalized = normalizeRichTextInput(value);
  if (normalized === null || normalized === undefined) return null;
  return JSON.stringify(normalized);
}
