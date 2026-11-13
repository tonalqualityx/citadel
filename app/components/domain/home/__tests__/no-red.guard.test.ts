import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Never red for attention: the home screen's own source (components and tokens) carries no red,
// no error or danger token, no destructive button, and none of the words the owner banned.
const DIR = path.resolve(__dirname, '..');
const OVERDUE_BY_OTHERS_FILES = ['OverdueOthers.tsx', 'HomeScreen.tsx', 'home-screen-logic.ts'];
const FILES = readdirSync(DIR).filter((f) => /\.(tsx?|css)$/.test(f));

function strip(src: string, file: string): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!file.endsWith('.css')) s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return s;
}

function isRedHex(hex: string): boolean {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min || max - min < 40) return false;
  const d = max - min;
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const sat = d / max;
  return (hue <= 15 || hue >= 340) && sat > 0.4;
}

describe('no red on the home screen', () => {
  it('finds the source files', () => {
    expect(FILES).toEqual(expect.arrayContaining(['HomeScreen.tsx', 'ItemCard.tsx', 'TileStrip.tsx', 'home-tokens.css']));
  });
  describe.each(FILES)('%s', (file) => {
    const src = strip(readFileSync(path.join(DIR, file), 'utf8'), file);
    it('has no red color word, token or class', () => {
      expect(src).not.toMatch(/\bred\b|\bcrimson\b|\bscarlet\b|text-red|bg-red|border-red|var\(--(error|danger|destructive)|--error\b|\bdanger\b|destructive/i);
    });
    it('has no red hex or rgb value', () => {
      for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) expect(isRedHex(m[0]), m[0]).toBe(false);
      for (const m of src.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
        const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        expect(isRedHex(hex), m[0]).toBe(false);
      }
    });
    it('never shows overdue or a priority label', () => {
      // The owner asked for one place that says it (2026-11-13): the "Overdue by others" tab, a list he looks at. Its component, tile and label may use
      // the word; every other file still may not, and nothing here may show a priority label.
      const text = OVERDUE_BY_OTHERS_FILES.includes(file) ? src.replace(/[\w-]*overdue[\w-]*/gi, '') : src;
      expect(text).not.toMatch(/overdue|past due|priority|P[0-4]\b(?!x)/i);
    });
  });
  it('the guard itself flags red', () => {
    expect(isRedHex('#C8372B')).toBe(true);
    expect(isRedHex('#ff0000')).toBe(true);
    expect(isRedHex('#C4A24D')).toBe(false);
    expect(isRedHex('#8A6D1C')).toBe(false);
  });
});
