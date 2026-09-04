import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Oracle Projects Tab — dash-law regression guard, prose-gate.sh-style. Reads every
// source file under the Projects tab's components and pure-logic modules, strips code
// comments (// line comments and /* block comments */) so the check targets the same
// surface prose-gate.sh targets on a content file, reader-facing text (JSX text nodes,
// template literals, string props), NOT this codebase's own engineering commentary —
// which uses em dashes throughout, by long-standing convention, and is not something a
// client or Mike reads as a sentence on the Projects tab. blockers.copy.test.ts is the
// companion guard for the actual persisted/rendered blocker copy; this one catches a
// dash reintroduced anywhere else in the tab's JSX/string literals (a label, a title, a
// toast message, an aria-label).
//
// Skips (does not fail) when prose-gate.sh isn't present on this machine — it's a
// machine-local skill file, not checked into this repo — same skipIf convention as
// gate-constants.drift.test.ts.
const PROSE_GATE_PATH = path.join(os.homedir(), '.claude', 'skills', 'writing-standard', 'prose-gate.sh');
const proseGateExists = fs.existsSync(PROSE_GATE_PATH);

// __dirname here is <repo>/lib/oracle/projects/__tests__ — four levels up is the app root.
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const SCAN_DIRS = [
  path.join(REPO_ROOT, 'components', 'domain', 'oracle', 'modes', 'projects'),
  path.join(REPO_ROOT, 'lib', 'oracle', 'projects'),
];

// next-step-lint.ts is the dash-law DETECTOR itself — its own regex pattern legitimately
// contains literal em/en dash characters as match targets, not as reader-facing prose.
// Scanning it here would be testing the test, not the tab's copy.
const EXCLUDE_BASENAMES = new Set(['next-step-lint.ts']);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !EXCLUDE_BASENAMES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strips // line comments and /* block comments *\/ from source text. Not a full
 * tokenizer (a `//` or `/*` inside a string literal will still be treated as a comment
 * start), but the Projects tab's source has no such strings today, and a false-negative
 * here (a comment wrongly treated as code) only makes the guard STRICTER, never looser. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

// JS regex unicode escapes are \u{...} with the u flag (the \x{...} PCRE syntax
// prose-gate.sh's own grep -P uses is not valid here).
const DASH_CHAR_RE = /\u{2014}|\u{2013}|&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;/u;
// prose-gate.sh's OTHER dash-law rule, "spaced hyphen doing an em dash's job"
// ([a-zA-Z,"')] - [a-zA-Z("']), is deliberately NOT ported here: that pattern is tuned
// for prose files, where a lone " - " is rare and usually a dash standing in a hat. Real
// TypeScript source is full of legitimate " - " subtraction (`bQuiet - aQuiet`, `end -
// start`), so applying that rule to code produces constant false positives, not a
// working guard. The unicode dash-CHARACTER check below has no such collision — normal
// code arithmetic never contains an actual em/en dash character — so it stays the
// guard's full scope.

describe.skipIf(!proseGateExists)('Projects tab dash-law guard (prose-gate.sh dash-character pattern, code stripped of comments)', () => {
  const files = proseGateExists ? SCAN_DIRS.flatMap(listSourceFiles) : [];

  it('found source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel}: no em/en dash or dash entity outside comments`, () => {
      const stripped = stripComments(fs.readFileSync(file, 'utf-8'));
      const dashHits = stripped.match(new RegExp(DASH_CHAR_RE, 'gu')) ?? [];
      expect(dashHits, `em/en dash or entity in ${rel}`).toEqual([]);
    });
  }
});

if (!proseGateExists) {
  describe('Projects tab dash-law guard', () => {
    it.skip(`SKIPPED: ${PROSE_GATE_PATH} not found on this machine (expected in CI / a fresh checkout) — cannot load the reference patterns here`, () => {});
  });
}
