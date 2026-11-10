import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  PREVIEW_TOKEN_NAMES,
  PREVIEW_TOKEN_RANGES,
  CONTAINER_METHODS,
  isPreviewTokenValid,
  inRange,
} from '../preview-tokens';

const OVERLAY = process.env.WRIGHT_OVERLAY_PATH ?? '/home/mike/Documents/worktrees/wright-portal-v2-wt/scaffold/assets/js/design-overlay.js';
const present = fs.existsSync(OVERLAY);

describe('preview token grammar', () => {
  it('accepts values inside the ranges and null for any allowed name', () => {
    for (const [n, v] of [['--maxw', '320px'], ['--maxw', '2400px'], ['--maxw-wide', '1440px'], ['--gutter-phone', '0px'], ['--gutter-desktop', '200px'], ['container-method', 'max_width'], ['container-method', 'padding_cap'], ['--maxw', null], ['container-method', null]] as const) {
      expect(isPreviewTokenValid(n, v), `${n} ${v}`).toBe(true);
    }
  });
  it('refuses everything else', () => {
    for (const [n, v] of [['--color-ink', '1px'], ['--maxw', '100%'], ['--maxw', '1px'], ['--maxw', '2401px'], ['--gutter-phone', '201px'], ['--maxw', '1200px;'], ['--maxw', 'calc(1px)'], ['--maxw', 'var(--a)'], ['--maxw', 5], ['container-method', 'px'], ['--maxw', undefined], [3, '1px']] as const) {
      expect(isPreviewTokenValid(n, v), `${String(n)} ${String(v)}`).toBe(false);
    }
  });
  it('inRange needs a whole number inside the range', () => {
    expect(inRange(320, [320, 2400])).toBe(true);
    expect(inRange(319, [320, 2400])).toBe(false);
    expect(inRange(1200.5, [320, 2400])).toBe(false);
    expect(inRange(NaN, [320, 2400])).toBe(false);
  });
});

describe('overlay mirror', () => {
  it.skipIf(!present)('lists the same names, ranges and methods as the overlay file', () => {
    const src = fs.readFileSync(OVERLAY, 'utf8');
    const names = /var TOKEN_NAMES = (\[[^\]]*\]);/.exec(src);
    const ranges = /var TOKEN_RANGES = (\{[^}]*\});/.exec(src);
    const methods = /var TOKEN_METHODS = (\[[^\]]*\]);/.exec(src);
    expect(names && ranges && methods).toBeTruthy();
    expect(JSON.parse(names![1])).toEqual([...PREVIEW_TOKEN_NAMES]);
    expect(JSON.parse(ranges![1])).toEqual(JSON.parse(JSON.stringify(PREVIEW_TOKEN_RANGES)));
    expect(JSON.parse(methods![1])).toEqual([...CONTAINER_METHODS]);
  });
  if (!present) it('overlay file not present here (CI): mirror check skipped', () => expect(present).toBe(false));
});
