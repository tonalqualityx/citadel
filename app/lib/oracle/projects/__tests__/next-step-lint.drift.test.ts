import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lintNextStepText } from '../next-step-lint';

// Oracle Projects Tab Phase 3 — MEDIUM-3. next-step-lint.ts is a straight TypeScript
// port of the four grep patterns in ~/.claude/skills/writing-standard/comment-gate.sh
// (see next-step-lint.ts's own module doc comment: "a straight port of the four grep
// patterns"). A hand port can silently drift the moment either side is edited without
// the other — this test runs a fixed set of sample lines through BOTH the TS lint and
// the REAL shell script (as a subprocess, not a re-implementation) and asserts they
// reach the identical pass/fail verdict on every one.
//
// The shell script is a machine-local skill file, not checked into this repo, so a CI
// runner or a fresh checkout without it present has nothing to compare against. That is
// a "can't check" state, not a drift failure — the suite skips with a clear reason
// rather than failing red, mirroring gate-constants.drift.test.ts's own pattern.
const GATE_SCRIPT = path.join(os.homedir(), '.claude', 'skills', 'writing-standard', 'comment-gate.sh');
const gateScriptExists = fs.existsSync(GATE_SCRIPT);

function shellGatePasses(text: string): boolean {
  try {
    execFileSync(GATE_SCRIPT, ['-'], { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
    return true; // exit 0
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false; // exit 1: violations found — a real lint fail
    throw err; // exit 2 (usage error) or a spawn failure is a real problem, not a verdict
  }
}

function tsGatePasses(text: string): boolean {
  return lintNextStepText(text).length === 0;
}

// The 12 sample lines used to prove the TS port and the shell script agree: two clean
// lines, then one example of each of the four grep rule categories (gate/pipeline
// codes, worker-internal vocabulary, process narration, the dash law), with the dash
// law given four variants since comment-gate.sh's own pattern branches four ways
// (em dash, en dash, HTML entity, spaced double-hyphen).
const SAMPLES: Array<{ label: string; text: string }> = [
  { label: 'clean line 1', text: 'Mike needs to approve the homepage copy before Friday.' },
  { label: 'clean line 2', text: 'Andy needs to send the signed contract back.' },
  { label: 'gate code (B3 gate / W2)', text: 'B3 gate passed, moving to W2.' },
  { label: 'process narration (Ran W3 / census)', text: 'Ran W3 and the census came back negative.' },
  {
    label: 'worker vocabulary (the Stone / fingerprint / spawn tick)',
    text: 'The Stone reconciled the fingerprint after the spawn tick.',
  },
  { label: 'em dash', text: 'Mike needs to sign off — the copy is ready.' },
  { label: 'spaced double-hyphen', text: 'Mike needs to sign off -- the copy is ready.' },
  {
    label: 'worker vocabulary (ledger row / cockpit / pass N)',
    text: 'The ledger row confirms the cockpit picked up pass 2.',
  },
  { label: 'gate code (step A / phase B1)', text: 'Blocked on step A until phase B1 clears.' },
  {
    label: 'process narration (probes came back negative / re-derived)',
    text: 'Probes came back negative, so the answer was re-derived.',
  },
  { label: 'en dash', text: 'Due 9–12 this week.' },
  { label: 'dash HTML entity', text: 'Mike needs to sign off &mdash; ready.' },
];

describe.skipIf(!gateScriptExists)('next-step-lint.ts drift check against comment-gate.sh', () => {
  for (const { label, text } of SAMPLES) {
    it(`agrees with comment-gate.sh on: ${label}`, () => {
      expect(tsGatePasses(text)).toBe(shellGatePasses(text));
    });
  }
});

if (!gateScriptExists) {
  describe('next-step-lint.ts drift check', () => {
    it.skip(
      `SKIPPED: ${GATE_SCRIPT} not found on this machine (expected in CI / a fresh checkout) — cannot verify drift here`,
      () => {}
    );
  });
}
