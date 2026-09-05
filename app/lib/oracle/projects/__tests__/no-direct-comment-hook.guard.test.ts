import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Oracle Projects Tab Phase 5 carry-over D — HIGH-1 (Phase 4 fixes) fixed a real bug:
// a comment posted straight through `useCreateComment` from inside the Projects tab
// wasn't marked internal, so it would have rendered in a client's portal task-approval
// view. `usePostInternalComment` (lib/hooks/use-post-internal-comment.ts) is the ONLY
// sanctioned way to post a comment from this tab — it hardcodes `is_internal: true`.
// This guard scans every source file under components/domain/oracle/modes/projects/
// for a direct `useCreateComment` reference and fails on any hit, so a future component
// can never quietly reintroduce the HIGH-1 bug by importing the raw hook again.
//
// __tests__ directories are excluded from the scan: BlockerRow.test.tsx legitimately
// mocks `@/lib/hooks/use-comments`'s `useCreateComment` export (to stub out
// usePostInternalComment's own dependency) — that's a test double, not a production
// import, and is outside this guard's concern.

// __dirname here is <repo>/lib/oracle/projects/__tests__ — four levels up is the app root.
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const SCAN_DIR = path.join(REPO_ROOT, 'components', 'domain', 'oracle', 'modes', 'projects');

const DIRECT_HOOK_RE = /\buseCreateComment\b/;

function listSourceFiles(dir: string): string[] {
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

describe('Projects tab — no direct useCreateComment usage (HIGH-1 regression guard)', () => {
  const files = listSourceFiles(SCAN_DIR);

  it('found source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel}: does not import or call useCreateComment directly`, () => {
      const source = fs.readFileSync(file, 'utf-8');
      const hits = source.match(new RegExp(DIRECT_HOOK_RE, 'g')) ?? [];
      expect(hits, `useCreateComment referenced directly in ${rel} — use usePostInternalComment instead`).toEqual([]);
    });
  }
});
