import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Dash-law guard for the home screen: reads every source file under lib/home and
// components/domain/home, strips code comments (the same method as
// lib/oracle/projects/__tests__/dash-law-guard.test.ts), and fails on an em dash, an en dash or
// their HTML entities in any string or JSX text. Tests and fixtures are not scanned (they
// carry dashes on purpose, to prove they are swapped out). A folder that does not exist yet is
// skipped, so this guard runs the same before and after the components land.

// __dirname is <app>/lib/home/__tests__; three levels up is the app root.
const APP_ROOT = path.resolve(__dirname, '../../../');
const SCAN_DIRS = [path.join(APP_ROOT, 'lib', 'home'), path.join(APP_ROOT, 'lib', 'work'), path.join(APP_ROOT, 'components', 'domain', 'home')];

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strips block and line comments. Not a tokenizer: a "//" inside a string only makes the guard stricter. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const DASH_CHAR_RE = /\u{2014}|\u{2013}|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;/u;

describe('home screen dash-law guard (comments stripped)', () => {
  const files = SCAN_DIRS.flatMap(listSourceFiles);

  it('found the home source files to scan', () => {
    const lib = files.filter((f) => f.includes(`${path.sep}lib${path.sep}home${path.sep}`));
    const names = lib.map((f) => path.basename(f));
    for (const n of ['copy.ts', 'select.ts', 'today.ts', 'score.ts', 'actions-for.ts', 'rules.ts', 'types.ts']) {
      expect(names).toContain(n);
    }
  });

  for (const file of files) {
    const rel = path.relative(APP_ROOT, file);
    it(`${rel}: no em or en dash outside comments`, () => {
      const stripped = stripComments(fs.readFileSync(file, 'utf-8'));
      const hits = stripped.match(new RegExp(DASH_CHAR_RE, 'gu')) ?? [];
      expect(hits, `em or en dash (or entity) in ${rel}`).toEqual([]);
    });
  }

  it('the guard itself catches a dash in a string', () => {
    const bad = `const x = 'a ${'—'} b';`;
    expect(stripComments(bad)).toMatch(DASH_CHAR_RE);
    const inComment = `// a ${'—'} b\nconst x = 'ok';`;
    expect(stripComments(inComment)).not.toMatch(DASH_CHAR_RE);
  });
});
