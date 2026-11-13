import { describe, it, expect } from 'vitest';
import { computeSheetBox } from '@/lib/hooks/use-visual-viewport';

describe('computeSheetBox', () => {
  it('uses 100dvh and no transform when there is no visual viewport', () => {
    expect(computeSheetBox(null, 800)).toEqual({ height: '100dvh', transform: 'none', keyboardOpen: false });
  });
  it('is the visual viewport box: bottom edge = offsetTop + height for every keyboard height', () => {
    for (const kb of [0, 216, 291, 336, 420]) {
      for (const off of [0, 24, 120]) {
        const vv = { height: 844 - kb, offsetTop: off };
        const box = computeSheetBox(vv, 844);
        const top = box.transform === 'none' ? 0 : parseFloat(box.transform.replace(/[^0-9.]/g, ''));
        expect(top).toBe(off);
        expect(top + parseFloat(box.height)).toBe(off + vv.height);
        expect(off + vv.height).toBeLessThanOrEqual(off + 844 - kb);
      }
    }
  });
  it('reports the keyboard only for a real loss of height, not browser chrome', () => {
    expect(computeSheetBox({ height: 800, offsetTop: 0 }, 844).keyboardOpen).toBe(false);
    expect(computeSheetBox({ height: 540, offsetTop: 0 }, 844).keyboardOpen).toBe(true);
    // Android resizes the window too: the remembered full height still reveals the keyboard
    expect(computeSheetBox({ height: 480, offsetTop: 0 }, 480, 844).keyboardOpen).toBe(true);
  });
});
