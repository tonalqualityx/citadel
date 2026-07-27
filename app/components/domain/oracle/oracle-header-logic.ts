// Clarity Phase 3 (Seeing Stone Reckoning, spec Q19) — the header Catch bar's prefix
// parsing. Pure, dependency-free (no React, no fetch) per the repo's logic/dumb-component
// convention — trivially unit-testable, and the same parse feeds both the live component
// and its tests without mounting anything.

export const MIKE_USER_ID = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';

export type CatchKind = 'task' | 'idea';

export interface CatchInput {
  kind: CatchKind;
  text: string;
}

const TASK_PREFIX_RE = /^task:\s*/i;
const IDEA_PREFIX_RE = /^idea:\s*/i;

/**
 * "task: call the bookkeeper" -> a task titled "call the bookkeeper". "idea: …" (or no
 * recognized prefix at all — the bar defaults to ideas, its original single purpose)
 * files to the ideas bank instead. Returns null for blank/whitespace-only input, or for a
 * bare prefix with nothing after it (never files an empty title/idea).
 */
export function parseCatchInput(raw: string): CatchInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (TASK_PREFIX_RE.test(trimmed)) {
    const text = trimmed.replace(TASK_PREFIX_RE, '').trim();
    return text ? { kind: 'task', text } : null;
  }

  const text = trimmed.replace(IDEA_PREFIX_RE, '').trim();
  return text ? { kind: 'idea', text } : null;
}
