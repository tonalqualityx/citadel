import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Recomputes the WCAG 2.x contrast pairs of the redesign spec (section 8.1) from the token file,
// so a token edit that breaks a pair fails here. Also guards the Tailwind registration: a --p-*
// color without a --color-p-* line is the bug that made the portal's buttons invisible.
const APP = path.resolve(__dirname, '..', '..', '..');
const TOKENS = readFileSync(path.join(APP, 'app/(portal)/portal-tokens.css'), 'utf8');
const GLOBALS = readFileSync(path.join(APP, 'app/globals.css'), 'utf8');

function block(src: string, open: string): string {
  const i = src.indexOf(open);
  if (i < 0) throw new Error(`no block ${open}`);
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(src.indexOf('{', i) + 1, j);
  }
  throw new Error('unbalanced');
}
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--p-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = decls(block(TOKENS, '[data-portal] {'));
const dark = decls(block(TOKENS, '[data-portal][data-theme="dark"] {'));
const darkMedia = decls(block(block(TOKENS, '@media (prefers-color-scheme: dark)'), '[data-portal]:not('));

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = 4.5;
const UI = 3;
// [foreground token, background token, floor]
const PAIRS: Array<[string, string, number]> = [
  ['ink', 'bg', TEXT], ['ink', 'surface', TEXT], ['ink-2', 'surface', TEXT], ['ink-3', 'bg', TEXT], ['ink-3', 'surface', TEXT],
  ['ink-3', 'sunk', TEXT], ['ink', 'tint', TEXT], ['ink-2', 'callout-bg', TEXT], ['link', 'callout-bg', TEXT], ['head', 'bg', TEXT],
  ['head', 'surface', TEXT], ['head', 'tint', TEXT], ['on-primary', 'primary', TEXT], ['link', 'surface', TEXT], ['link', 'bg', TEXT],
  ['nav-ink', 'nav-bg', TEXT], ['nav-ink-2', 'nav-bg', TEXT],
  ['chip-attention-fg', 'chip-attention-bg', TEXT], ['chip-moving-fg', 'chip-moving-bg', TEXT], ['chip-done-fg', 'chip-done-bg', TEXT],
  ['chip-quiet-fg', 'chip-quiet-bg', TEXT], ['chip-urgent-fg', 'chip-urgent-bg', TEXT], ['chip-quote-fg', 'chip-quote-bg', TEXT],
  ['count-ink', 'attention-rail', TEXT],
  ['line-strong', 'surface', UI], ['line-strong', 'bg', UI], ['focus', 'surface', UI], ['focus', 'bg', UI], ['focus', 'callout-bg', UI],
  ['nav-focus', 'nav-bg', UI], ['kind-project', 'surface', UI], ['kind-retainer', 'surface', UI], ['kind-request', 'surface', UI],
  ['kind-history', 'surface', UI], ['attention-rail', 'callout-bg', UI], ['urgent-rail', 'surface', UI], ['done-icon', 'surface', UI],
];

describe('portal tokens', () => {
  const darkFull = { ...light, ...dark };
  for (const [name, set] of [['light', light], ['dark', darkFull]] as const) {
    describe(name, () => {
      for (const [fg, bg, floor] of PAIRS) {
        it(`--p-${fg} on --p-${bg} is at least ${floor}:1`, () => {
          expect(set[`--p-${fg}`], `--p-${fg} defined`).toMatch(/^#/);
          expect(set[`--p-${bg}`], `--p-${bg} defined`).toMatch(/^#/);
          expect(ratio(set[`--p-${fg}`], set[`--p-${bg}`])).toBeGreaterThanOrEqual(floor);
        });
      }
    });
  }

  it('the media-query dark block is identical to the explicit dark block', () => {
    expect(darkMedia).toEqual(dark);
    expect(Object.keys(dark).length).toBeGreaterThan(30);
  });

  it('every --p-* color has a --color-p-* registration in globals.css', () => {
    const colors = Object.entries(light).filter(([, v]) => /^(#|rgba?\()/.test(v)).map(([k]) => k);
    expect(colors.length).toBeGreaterThan(40);
    for (const name of colors) expect(GLOBALS, name).toContain(`--color-p-${name.slice(4)}: var(${name});`);
  });

  it('every dark override overrides a token that exists in the light set', () => {
    for (const k of Object.keys(dark)) expect(light[k], k).toBeDefined();
  });
});
