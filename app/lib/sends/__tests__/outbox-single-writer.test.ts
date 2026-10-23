// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'e2e', 'prisma']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe('the outbox has one writer', () => {
  const hits = ['app', 'lib', 'scripts']
    .filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => /emailOutbox\.(create|createMany|upsert)\b/.test(fs.readFileSync(f, 'utf8')));

  it('emailOutbox.create appears only in lib/sends/outbox.ts', () => {
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual(['lib/sends/outbox.ts']);
  });

  it('and only inside queueInOutbox', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/sends/outbox.ts'), 'utf8');
    const fnStart = src.indexOf('export async function queueInOutbox');
    const fnEnd = src.indexOf('\n}\n', fnStart);
    const idx = src.search(/emailOutbox\.create\b/);
    expect(fnStart).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(fnStart);
    expect(idx).toBeLessThan(fnEnd);
    expect(src.match(/emailOutbox\.create\b/g)).toHaveLength(1);
  });

  it('queueInOutbox requires a govern block', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/sends/outbox.ts'), 'utf8');
    expect(src).toMatch(/govern: Govern\)/);
  });
});
