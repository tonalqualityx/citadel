import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Recomputes WCAG contrast for the home screen's tokens in every theme, by parsing home-tokens.css
// for the scoped overrides and app/globals.css for the page surfaces they sit on.
const APP = path.resolve(__dirname, '..', '..', '..', '..');
const TOKENS = readFileSync(path.join(APP, 'components/domain/home/home-tokens.css'), 'utf8');
const GLOBALS = readFileSync(path.join(APP, 'app/globals.css'), 'utf8');

function block(src: string, open: string, from = 0): string {
  const i = src.indexOf(open, from);
  if (i < 0) throw new Error(`no block ${open}`);
  const start = src.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(start + 1, j);
  }
  throw new Error('unbalanced');
}
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const base = decls(block(GLOBALS, '  :root {'));
const pageThemes: Record<string, Record<string, string>> = {
  light: { ...base, ...decls(block(GLOBALS, '.theme-light {')) },
  dim: decls(block(GLOBALS, '.theme-dim {')),
  dark: decls(block(GLOBALS, '.theme-dark {')),
  system: decls(block(block(GLOBALS, '@media (prefers-color-scheme: dark)'), ':root:not(.theme-light):not(.theme-dim):not(.theme-dark) {')),
};
const homeBlocks: Record<string, Record<string, string>> = {
  light: decls(block(TOKENS, '[data-home] {')),
  dim: decls(block(TOKENS, '.theme-dim [data-home] {')),
  dark: decls(block(TOKENS, '.theme-dark [data-home] {')),
  system: decls(block(block(TOKENS, '@media (prefers-color-scheme: dark)'), ':root:not(.theme-light):not(.theme-dim):not(.theme-dark) [data-home] {')),
};

const TEXT = 4.5;
const UI = 3;
// [foreground, background, floor]
const PAIRS: Array<[string, string, number]> = [
  ['--text-primary', '--bg-elevated', TEXT],
  ['--text-primary', '--bg-primary', TEXT],
  ['--text-secondary', '--bg-elevated', TEXT],
  ['--text-secondary', '--bg-primary', TEXT],
  ['--text-muted', '--bg-elevated', TEXT],
  ['--text-muted', '--bg-primary', TEXT],
  ['--accent-text', '--bg-elevated', TEXT],
  ['--accent-text', '--bg-primary', TEXT],
  ['--accent-text', '--accent-subtle', TEXT],
  ['--text-primary', '--accent-subtle', TEXT],
  ['--accent-ink', '--accent-text', TEXT], // the filled button
  ['--warning', '--warning-subtle', TEXT], // hot tile number, date pill
  ['--warning', '--bg-elevated', TEXT],
  ['--success', '--bg-elevated', UI], // done box fill, not text
  ['--warning-line', '--bg-elevated', UI], // the gold rule on the row edge
  ['--accent', '--bg-elevated', UI], // selected rule and focus ring
];

describe.each(Object.keys(homeBlocks))('home tokens, %s theme', (theme) => {
  const tokens = { ...pageThemes[theme], ...homeBlocks[theme] };
  it('defines the scoped tokens', () => {
    for (const k of ['--accent-text', '--accent-ink', '--warning-line', '--text-muted', '--warning', '--success']) {
      expect(homeBlocks[theme][k], k).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
  it.each(PAIRS)('%s on %s reaches the floor', (fg, bg, floor) => {
    const a = tokens[fg];
    const b = tokens[bg];
    expect(a, fg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(b, bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(ratio(a, b), `${fg} on ${bg}: ${a} / ${b}`).toBeGreaterThanOrEqual(floor);
  });
});

describe('scope', () => {
  it('every rule is under [data-home] so no other screen changes', () => {
    const css = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
    for (const s of selectors) expect(s, s).toContain('[data-home]');
  });
});
