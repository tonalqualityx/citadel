/**
 * The split view's chat column width: normal, wide, or dragged. Pure math, so the bounds are tested without a browser.
 * Only the split uses it; the full-screen sheets ignore it.
 */

export const BAST_CHAT_WIDTH_KEY = 'citadel-bast-chat-width';
/** The normal column, as CSS: it follows the window (this is the width the split always had). */
export const NORMAL_WIDTH_CSS = 'clamp(360px, 34vw, 480px)';
export const MIN_CHAT_PX = 360;
/** The page column never gets narrower than this while the chat is open. */
export const MIN_PAGE_PX = 360;
/** Nothing is wider than this, however big the window. */
export const MAX_CHAT_PX = 960;
/** One arrow key press on the divider; Shift makes it the big step. */
export const KEY_STEP_PX = 24;
export const KEY_STEP_BIG_PX = 96;

export type WidthPref = { kind: 'normal' } | { kind: 'wide' } | { kind: 'custom'; px: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** What the normal width is at this window width (the same clamp as NORMAL_WIDTH_CSS). */
export function normalPx(vw: number): number {
  return clamp(vw * 0.34, 360, 480);
}
/** About twice normal: clamp(640px, 60vw, 960px). */
export function widePx(vw: number): number {
  return clamp(vw * 0.6, 640, MAX_CHAT_PX);
}
/** The widest the chat may be: what leaves the page column MIN_PAGE_PX (after the sidebar), and never past MAX_CHAT_PX. */
export function maxPx(vw: number, reservedLeft: number): number {
  return Math.min(MAX_CHAT_PX, vw - reservedLeft - MIN_PAGE_PX);
}

export interface ResolvedWidth {
  px: number;
  /** CSS for the grid column. */
  css: string;
  min: number;
  max: number;
  /** The window has room for the wide width: otherwise the toggle is off. */
  canWiden: boolean;
  /** Wider than normal right now (the toggle shows "narrower"). */
  wide: boolean;
}

export function resolveWidth(pref: WidthPref, vw: number, reservedLeft: number): ResolvedWidth {
  const max = Math.max(MIN_CHAT_PX, maxPx(vw, reservedLeft));
  const normal = normalPx(vw);
  const canWiden = maxPx(vw, reservedLeft) >= 640;
  if (pref.kind === 'normal' || (pref.kind === 'wide' && !canWiden)) {
    return { px: normal, css: NORMAL_WIDTH_CSS, min: MIN_CHAT_PX, max, canWiden, wide: false };
  }
  const px = pref.kind === 'wide' ? Math.min(widePx(vw), max) : clamp(pref.px, MIN_CHAT_PX, max);
  return { px, css: `${Math.round(px)}px`, min: MIN_CHAT_PX, max, canWiden, wide: px > normal + 8 };
}

/** Dragging the divider: the chat is as wide as it was plus how far the pointer moved left. */
export function dragWidth(startPx: number, startX: number, x: number, vw: number, reservedLeft: number): number {
  return clamp(startPx + (startX - x), MIN_CHAT_PX, Math.max(MIN_CHAT_PX, maxPx(vw, reservedLeft)));
}

export function parseWidthPref(raw: string | null): WidthPref {
  if (raw === 'wide') return { kind: 'wide' };
  if (raw && /^\d{3,4}$/.test(raw)) return { kind: 'custom', px: Number(raw) };
  return { kind: 'normal' };
}
export function serializeWidthPref(p: WidthPref): string {
  return p.kind === 'custom' ? String(Math.round(p.px)) : p.kind;
}
