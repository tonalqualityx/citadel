/**
 * Designer Portal v2: the container preview tokens the parent may post to the preview overlay as
 * `dp:preview-token {name, value}` (SPEC 4.2 "Container width on the outline", 4.8a).
 *
 * Pure, no React, no DOM. The names, the value grammar and the ranges here are mirrored literally in the
 * overlay (Wright `scaffold/assets/js/design-overlay.js`, `TOKEN_NAMES` and `TOKEN_RANGES`); a test compares them
 * when the overlay file is present. The regex is the whole grammar: one to four digits and "px".
 */

export const PREVIEW_TOKEN_NAMES = [
  '--maxw',
  '--maxw-wide',
  '--gutter-phone',
  '--gutter-tablet',
  '--gutter-desktop',
  'container-method',
] as const;
export type PreviewTokenName = (typeof PREVIEW_TOKEN_NAMES)[number];

export const CONTAINER_METHODS = ['max_width', 'padding_cap'] as const;
export type ContainerMethod = (typeof CONTAINER_METHODS)[number];

export const PX_VALUE_RE = /^\d{1,4}px$/;

/** Inclusive px ranges for the pixel tokens. `container-method` takes a method name instead. */
export const PREVIEW_TOKEN_RANGES = {
  '--maxw': [320, 2400],
  '--maxw-wide': [320, 2400],
  '--gutter-phone': [0, 200],
  '--gutter-tablet': [0, 200],
  '--gutter-desktop': [0, 200],
} as const satisfies Record<Exclude<PreviewTokenName, 'container-method'>, readonly [number, number]>;

export const CAP_RANGE = PREVIEW_TOKEN_RANGES['--maxw'];
export const GUTTER_RANGE = PREVIEW_TOKEN_RANGES['--gutter-phone'];

export type PreviewTokenValue = string | null;

/** True when `value` is allowed for `name`. `null` (remove the override) is allowed for every name. */
export function isPreviewTokenValid(name: unknown, value: unknown): boolean {
  if (typeof name !== 'string' || !(PREVIEW_TOKEN_NAMES as readonly string[]).includes(name)) return false;
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  if (name === 'container-method') return (CONTAINER_METHODS as readonly string[]).includes(value);
  if (!PX_VALUE_RE.test(value)) return false;
  const [lo, hi] = PREVIEW_TOKEN_RANGES[name as keyof typeof PREVIEW_TOKEN_RANGES];
  const n = parseInt(value, 10);
  return n >= lo && n <= hi;
}

export const px = (n: number): string => `${n}px`;

/** A whole number inside [lo, hi]. */
export function inRange(n: number, range: readonly [number, number]): boolean {
  return Number.isInteger(n) && n >= range[0] && n <= range[1];
}
