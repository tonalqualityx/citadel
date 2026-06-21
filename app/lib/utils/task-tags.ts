import type { BadgeProps } from '@/components/ui/badge';

export type BadgeVariant = NonNullable<BadgeProps['variant']>;

export interface ParsedTag {
  /** Original raw tag string, e.g. "stack:eleventy". */
  raw: string;
  /** Classification namespace if the tag is namespaced (e.g. "stack", "kind"), else null. */
  namespace: string | null;
  /** The value portion (the part after the namespace), prettified-source string. */
  value: string;
  /** Human-legible label for the value, e.g. "Awaiting Clarification", "Eleventy". */
  label: string;
  /** Badge variant chosen by namespace / triage state. */
  variant: BadgeVariant;
}

// Triage-state tags (non-namespaced) that signal something needs attention / is in flight.
const WARNING_TAGS = new Set([
  'needs-mike',
  'needs-info',
  'escalated',
  'gate-failed',
  'ci-failure',
  'awaiting-clarification',
  'awaiting-client-approval',
  'possible-duplicate',
  'staged',
]);

// Triage-state tags that signal a positive / ready state.
const SUCCESS_TAGS = new Set(['bast-doable']);

// Triage-state tags surfaced as informational/special.
const PURPLE_TAGS = new Set(['new-sop-candidate']);

/** Title-case a hyphen/underscore/space separated token, e.g. "awaiting-clarification" → "Awaiting Clarification". */
function prettify(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function variantForNamespace(namespace: string): BadgeVariant {
  switch (namespace) {
    case 'stack':
      return 'info';
    case 'kind':
      return 'purple';
    default:
      return 'default';
  }
}

function variantForBareTag(tag: string): BadgeVariant {
  if (WARNING_TAGS.has(tag)) return 'warning';
  if (SUCCESS_TAGS.has(tag)) return 'success';
  if (PURPLE_TAGS.has(tag)) return 'purple';
  return 'default';
}

/**
 * Parse a single tag into display metadata. Namespaced tags ("namespace:value") are split so the
 * namespace can be shown as a muted prefix and colored consistently; bare triage-state tags get a
 * variant by meaning. Color carries the namespace so labels stay short and legible.
 */
export function parseTag(rawTag: string): ParsedTag {
  const raw = rawTag.trim();
  const colonIndex = raw.indexOf(':');

  if (colonIndex > 0) {
    const namespace = raw.slice(0, colonIndex).toLowerCase();
    const value = raw.slice(colonIndex + 1);
    return {
      raw,
      namespace,
      value,
      label: prettify(value) || value,
      variant: variantForNamespace(namespace),
    };
  }

  return {
    raw,
    namespace: null,
    value: raw,
    label: prettify(raw) || raw,
    variant: variantForBareTag(raw.toLowerCase()),
  };
}

/** Parse a list of tags, skipping any empty/whitespace-only entries. */
export function parseTags(tags: string[] | null | undefined): ParsedTag[] {
  if (!tags || tags.length === 0) return [];
  return tags.filter((t) => t && t.trim().length > 0).map(parseTag);
}
