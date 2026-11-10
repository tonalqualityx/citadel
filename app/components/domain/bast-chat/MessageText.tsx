import * as React from 'react';

/**
 * Plain-text renderer for what Bast (or anything Bast read) wrote. Everything is a React text node, so HTML in the
 * text shows as text and nothing is ever injected. No markdown is interpreted beyond line breaks and simple lists.
 * Images are impossible by construction. A link is clickable only for the app's own paths and an exact short list
 * of https hosts (plan section 3, T2); any other address stays as text, which closes the image-beacon and
 * lookalike-link routes.
 */

export const ALLOWED_LINK_HOSTS: readonly string[] = ['citadel.becomeindelible.com', 'mail.google.com', 'drive.google.com'];

export interface TextPart {
  text: string;
  href?: string;
  external?: boolean;
}
export type TextBlock = { type: 'p'; lines: string[] } | { type: 'ul' | 'ol'; items: string[] };

/** The href for a token if it may be clickable, else null. */
export function safeHref(token: string): { href: string; external: boolean } | null {
  if (token.startsWith('https://')) {
    try {
      const u = new URL(token);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      if (!ALLOWED_LINK_HOSTS.includes(u.hostname.toLowerCase())) return null;
      return { href: u.toString(), external: true };
    } catch {
      return null;
    }
  }
  // The app's own paths: one leading slash, then a letter or digit. No "//host", no backslash, no scheme.
  if (/^\/[A-Za-z0-9][A-Za-z0-9\-._~/%?#=&+:@!$*,;]*$/.test(token)) return { href: token, external: false };
  return null;
}

const TOKEN_RE = /(https?:\/\/[^\s<>"'`]+|(?<=^|\s)\/[A-Za-z0-9][^\s<>"'`]*)/g;
const TRAILING = /[.,;:!?)\]]+$/;

/** Splits one line into text and link parts. */
export function linkify(line: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    let token = m[0];
    const trail = TRAILING.exec(token)?.[0] ?? '';
    if (trail) token = token.slice(0, -trail.length);
    const safe = token ? safeHref(token) : null;
    if (!safe) continue;
    if (start > last) parts.push({ text: line.slice(last, start) });
    parts.push({ text: token, href: safe.href, external: safe.external });
    last = start + token.length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts.length ? parts : [{ text: line }];
}

/** Groups lines into paragraphs and simple lists ("- ", "* ", "1. "). Blank lines separate blocks. */
export function toBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      blocks.push({ type: 'p', lines: [] });
      continue;
    }
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line);
    const number = /^\s{0,3}\d{1,2}[.)]\s+(.*)$/.exec(line);
    const kind = bullet ? 'ul' : number ? 'ol' : null;
    const prev = blocks[blocks.length - 1];
    if (kind) {
      const item = (bullet ?? number)![1];
      if (prev && prev.type === kind) prev.items.push(item);
      else blocks.push({ type: kind, items: [item] });
    } else if (prev && prev.type === 'p' && prev.lines.length > 0) {
      prev.lines.push(line);
    } else if (prev && prev.type === 'p' && prev.lines.length === 0) {
      prev.lines.push(line);
    } else {
      blocks.push({ type: 'p', lines: [line] });
    }
  }
  return blocks.filter((b) => (b.type === 'p' ? b.lines.length > 0 : true));
}

function Line({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.href ? (
          p.external ? (
            <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
              {p.text}
            </a>
          ) : (
            <a key={i} href={p.href}>
              {p.text}
            </a>
          )
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

export function MessageText({ text, className }: { text: string; className?: string }) {
  const blocks = toBlocks(text);
  return (
    <div className={className} data-testid="message-text" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blocks.map((b, i) => {
        if (b.type === 'p') {
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <React.Fragment key={j}>
                  {j > 0 ? <br /> : null}
                  <Line text={l} />
                </React.Fragment>
              ))}
            </p>
          );
        }
        const Tag = b.type;
        return (
          <Tag key={i} style={{ margin: 0, paddingLeft: '1.2em' }}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Line text={it} />
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
