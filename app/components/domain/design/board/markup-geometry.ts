import type { Rect } from '@/lib/hooks/use-design-board';

export const MIN_BOX = 0.02;
export const KEY_STEP = 0.01;
export const DEFAULT_BOX: Rect = { x: 0.35, y: 0.35, w: 0.3, h: 0.2 };

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A pointer position as fractions (0 to 1) of the box it is measured against. */
export function pointToFraction(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: round(clamp((clientX - box.left) / box.width, 0, 1)), y: round(clamp((clientY - box.top) / box.height, 0, 1)) };
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x: round(x), y: round(y), w: round(Math.abs(a.x - b.x)), h: round(Math.abs(a.y - b.y)) };
}

export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: round(clamp(r.x + dx, 0, 1 - r.w)), y: round(clamp(r.y + dy, 0, 1 - r.h)) };
}

export function resizeRect(r: Rect, dw: number, dh: number): Rect {
  return { ...r, w: round(clamp(r.w + dw, MIN_BOX, 1 - r.x)), h: round(clamp(r.h + dh, MIN_BOX, 1 - r.y)) };
}

const pct = (n: number) => Math.round(n * 100);

/** The sentence a screen reader hears after a box moves or changes size. */
export function describeRect(r: Rect): string {
  return `Box is ${pct(r.x)} percent from the left and ${pct(r.y)} percent from the top, ${pct(r.w)} percent wide and ${pct(r.h)} percent tall.`;
}

export function isBigEnough(r: Rect): boolean {
  return r.w >= MIN_BOX && r.h >= MIN_BOX;
}
