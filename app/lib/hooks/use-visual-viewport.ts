'use client';

import { useEffect, useState } from 'react';

/** The part of the screen that is actually visible: shorter than the window while the on-screen keyboard is up. */
export interface VisualViewportBox {
  height: number;
  offsetTop: number;
}

export interface SheetBox {
  /** CSS height of the full-screen sheet. 100dvh when the visual viewport is unknown. */
  height: string;
  /** CSS transform that keeps the sheet's top on the visible area's top (iOS scrolls the layout viewport under the keyboard). */
  transform: string;
  /** True while the keyboard (or anything else) has taken a real part of the window. */
  keyboardOpen: boolean;
}

/** More than this much missing window height counts as the keyboard being up (browser chrome moves by far less). */
export const KEYBOARD_MIN_PX = 100;

/**
 * Pure layout math for the full-screen chat: the sheet's box is the visual viewport's box, so its bottom edge, and the
 * composer pinned to it, is never below the visible area. Without a visual viewport it is the dynamic viewport height.
 */
export function computeSheetBox(vv: VisualViewportBox | null, windowHeight: number, baselineHeight = 0): SheetBox {
  if (!vv) return { height: '100dvh', transform: 'none', keyboardOpen: false };
  const full = Math.max(windowHeight, baselineHeight);
  return {
    height: `${Math.max(0, Math.round(vv.height))}px`,
    transform: vv.offsetTop ? `translateY(${Math.round(vv.offsetTop)}px)` : 'none',
    keyboardOpen: full - vv.height > KEYBOARD_MIN_PX,
  };
}

/**
 * Follows window.visualViewport (height and offsetTop) while `active`, one update per animation frame.
 * Also undoes the offset iOS can leave behind when a field loses focus. Returns null where the API does not exist.
 */
export function useVisualViewport(active: boolean): { box: VisualViewportBox | null; baseline: number } {
  const [state, setState] = useState<{ box: VisualViewportBox | null; baseline: number }>({ box: null, baseline: 0 });

  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.visualViewport) {
      return;
    }
    const vv = window.visualViewport;
    let frame = 0;
    let baseline = 0;
    const read = () => {
      frame = 0;
      baseline = Math.max(baseline, vv.height);
      setState((prev) =>
        prev.box && prev.box.height === vv.height && prev.box.offsetTop === vv.offsetTop && prev.baseline === baseline
          ? prev
          : { box: { height: vv.height, offsetTop: vv.offsetTop }, baseline },
      );
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };
    read();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    // iOS focus scrolls the layout viewport to bring the field into view and can leave it there after blur.
    let reset: ReturnType<typeof setTimeout> | undefined;
    const onFocusOut = () => {
      if (reset) clearTimeout(reset);
      reset = setTimeout(() => {
        if (vv.offsetTop !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
        schedule();
      }, 60);
    };
    document.addEventListener('focusout', onFocusOut);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      document.removeEventListener('focusout', onFocusOut);
      if (frame) window.cancelAnimationFrame(frame);
      if (reset) clearTimeout(reset);
    };
  }, [active]);

  return state;
}
