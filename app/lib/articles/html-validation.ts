/**
 * Dependency-free HTML fragment well-formedness checker (C5 save-edits guard).
 *
 * Portal clients can hand-edit article bodies for WordPress-hosted sites, where the stored body
 * IS the rendered HTML. This is NOT a full HTML parser or sanitizer, and it never opines on style
 * or semantics (deprecated tags, missing alt text, etc.) — it only catches structural breakage
 * (an unclosed tag, mismatched nesting, a dangling closing tag) that would break the page when
 * WordPress renders it.
 *
 * Known, accepted limitations (fragment-oriented, not a full document):
 *   - Comments (`<!-- ... -->`) and doctype/CDATA/processing-instruction-like markers (`<!...>`,
 *     `<?...?>`) are skipped rather than validated.
 *   - Raw text content of `<script>`/`<style>` is not special-cased; article bodies are prose
 *     HTML, not scripts, so this is an acceptable simplification here.
 *   - A tag is treated as void either by name (the standard HTML void-element list) OR by a
 *     trailing `/` (`<div />`), matching how editors commonly emit self-closed tags.
 */

export type HtmlValidationResult = { valid: true } | { valid: false; message: string };

const VOID_ELEMENTS = new Set([
  'br',
  'img',
  'hr',
  'input',
  'meta',
  'link',
  'source',
  'wbr',
  'embed',
  'area',
  'base',
  'col',
  'track',
]);

interface OpenTag {
  name: string;
  index: number;
}

/** A short, readable excerpt of the source around `index`, for the "near ..." hint in messages. */
function contextSnippet(html: string, index: number): string {
  const start = Math.max(0, index - 15);
  const end = Math.min(html.length, index + 25);
  const snippet = html.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snippet + (end < html.length ? '…' : '');
}

/** Find the index of the '>' that closes the tag starting at `start` (the '<'), respecting quotes. */
function findTagEnd(html: string, start: number): number {
  let i = start + 1;
  let quote: string | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Check whether an HTML fragment is structurally well-formed: every non-void opening tag has a
 * matching closing tag, in properly nested order. Comments are ignored; attribute values may
 * contain '>' or '<' as long as they're inside matching quotes. Plain text/markdown with no real
 * tags (including stray '<' that isn't followed by a tag name) always passes.
 */
export function validateHtmlFragment(html: string): HtmlValidationResult {
  const stack: OpenTag[] = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] !== '<') {
      i++;
      continue;
    }

    // Comments: skip entirely, whatever they contain.
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      if (end === -1) break; // unterminated comment; nothing further to structurally validate
      i = end + 3;
      continue;
    }

    // Doctype / CDATA / processing-instruction-like markers — not tags we track.
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = findTagEnd(html, i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    const isClosing = html[i + 1] === '/';
    const nameStart = i + (isClosing ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(nameStart));
    if (!nameMatch) {
      // '<' not followed by a tag name (e.g. a stray "<" in prose) — plain text, not a tag.
      i++;
      continue;
    }

    const name = nameMatch[0].toLowerCase();
    const end = findTagEnd(html, i);
    if (end === -1) {
      return {
        valid: false,
        message: `You have an opening <${name}> tag that's never closed off with ">" near "${contextSnippet(html, i)}".`,
      };
    }

    const tagContent = html.slice(i, end + 1);
    const selfClosing = /\/\s*>$/.test(tagContent);

    if (isClosing) {
      if (stack.length === 0 || !stack.some((t) => t.name === name)) {
        return {
          valid: false,
          message: `You have a closing </${name}> tag without a matching opening <${name}> near "${contextSnippet(html, i)}".`,
        };
      }
      if (stack[stack.length - 1].name !== name) {
        const unclosed = stack[stack.length - 1];
        return {
          valid: false,
          message: `You have an opening <${unclosed.name}> without a closing </${unclosed.name}> before </${name}> near "${contextSnippet(html, unclosed.index)}".`,
        };
      }
      stack.pop();
    } else if (!VOID_ELEMENTS.has(name) && !selfClosing) {
      stack.push({ name, index: i });
    }
    // void / self-closing elements: nothing to push, no closing tag expected.

    i = end + 1;
  }

  if (stack.length > 0) {
    // Report the innermost still-open tag — the one closest to where a client would expect to see
    // the missing close.
    const unclosed = stack[stack.length - 1];
    return {
      valid: false,
      message: `You have an opening <${unclosed.name}> without a closing </${unclosed.name}> near "${contextSnippet(html, unclosed.index)}".`,
    };
  }

  return { valid: true };
}
