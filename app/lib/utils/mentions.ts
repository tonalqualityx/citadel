/**
 * Helpers for @-mention support in comments.
 *
 * Mentions are written into the plain-text comment body as `@Display Name` and the set of
 * selected user ids is tracked alongside. These pure helpers handle detecting the active
 * mention being typed, resolving which users a finished comment mentions, and splitting a
 * comment into segments for highlighted rendering.
 */

export interface MentionUser {
  id: string;
  name: string;
}

/**
 * Given the text and the current caret position, return the mention query the user is
 * actively typing (the text after the most recent unclosed `@`), or null if the caret is
 * not inside a mention token.
 *
 * A mention token starts with `@` that is at the start of the text or preceded by
 * whitespace, and runs up to the caret with no whitespace in between. The query may be
 * empty (just `@`), which means "show all users".
 */
export function getActiveMentionQuery(
  text: string,
  caret: number
): { query: string; start: number } | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1) return null;

  // The char before the `@` must be whitespace or the start of the string.
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return null;

  const query = upToCaret.slice(at + 1);
  // An active mention query has no whitespace (typing a space ends the token).
  if (/\s/.test(query)) return null;

  return { query, start: at };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve which of the given users are mentioned in a finished comment body by matching
 * `@Display Name` occurrences. Longer names are matched first so that a user named
 * "Sam" does not shadow "Sam Smith". Returns a de-duplicated list of user ids.
 */
export function findMentionedUserIds(content: string, users: MentionUser[]): string[] {
  // Map `@Name` (longest first) → first user with that name, then run a single
  // non-overlapping pass so a short name can't match inside a longer mention.
  const named = users.filter((u) => u.name);
  const byLongestName = [...named].sort((a, b) => b.name.length - a.name.length);
  const nameToId = new Map<string, string>();
  for (const u of byLongestName) {
    if (!nameToId.has(u.name)) nameToId.set(u.name, u.id);
  }

  const ids = new Set<string>();
  for (const seg of renderMentionSegments(content, byLongestName)) {
    if (!seg.isMention) continue;
    const id = nameToId.get(seg.text.slice(1)); // drop leading '@'
    if (id) ids.add(id);
  }

  return [...ids];
}

export interface MentionSegment {
  text: string;
  isMention: boolean;
}

/**
 * Split a comment body into plain and mention segments for rendering. Any `@Display Name`
 * matching a known user is flagged as a mention so the UI can highlight it.
 */
export function renderMentionSegments(
  content: string,
  users: MentionUser[]
): MentionSegment[] {
  const names = users
    .map((u) => u.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (names.length === 0) return [{ text: content, isMention: false }];

  const pattern = new RegExp(
    `(^|\\s)(@(?:${names.map(escapeRegExp).join('|')}))(?=$|[\\s.,!?:;)])`,
    'g'
  );

  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const leading = match[1];
    const mention = match[2];
    const mentionStart = match.index + leading.length;

    if (mentionStart > lastIndex) {
      segments.push({ text: content.slice(lastIndex, mentionStart), isMention: false });
    }
    segments.push({ text: mention, isMention: true });
    lastIndex = mentionStart + mention.length;
  }

  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex), isMention: false });
  }

  return segments;
}
