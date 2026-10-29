/**
 * True-width preview. The frame always lays out at the selected width (390/768/1280). When the pane is narrower, the
 * frame is scaled visually with a CSS transform instead of being squeezed, so the page never reflows to a smaller
 * layout width. "Fit" (selected = null) lays out at the pane width at scale 1.
 */
export interface ViewportScale {
  /** The width the page lays out at, in CSS px (what window.innerWidth reports inside the frame). */
  layoutWidth: number;
  /** 0 < scale <= 1. */
  scale: number;
  /** Whole percent, for the "Scaled to NN%" badge. */
  percent: number;
  scaled: boolean;
}

export function computeViewportScale(containerWidth: number, selectedWidth: number | null): ViewportScale {
  // Not measured yet (first paint, jsdom): do not scale.
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { layoutWidth: selectedWidth ?? 0, scale: 1, percent: 100, scaled: false };
  }
  if (selectedWidth == null) return { layoutWidth: Math.floor(containerWidth), scale: 1, percent: 100, scaled: false };
  const scale = Math.min(1, containerWidth / selectedWidth);
  return { layoutWidth: selectedWidth, scale, percent: Math.round(scale * 100), scaled: scale < 1 };
}
