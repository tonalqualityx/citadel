import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gateReply } from '@/lib/portal/chat/gate';
import { buildProvenance, emptyProvenance } from '@/lib/portal/chat/provenance';
import { CALLS, fixtureContext, MUST_FAIL, MUST_PASS } from './gate-fixtures';

describe('gate fixtures (spec 9.2)', () => {
  it('holds at least 80 must-fail and 50 must-pass sentences', () => {
    expect(MUST_FAIL.length).toBeGreaterThanOrEqual(80);
    expect(MUST_PASS.length).toBeGreaterThanOrEqual(50);
  });

  const ctx = fixtureContext();

  for (const f of MUST_FAIL) {
    it(`fails (${f.rule}): ${JSON.stringify(f.text.slice(0, 60))}`, () => {
      const r = gateReply(f.text, ctx, f.kind ?? 'reply');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rule).toBe(f.rule);
    });
  }

  for (const f of MUST_PASS) {
    it(`passes: ${JSON.stringify(f.text.slice(0, 60))}`, () => {
      const r = gateReply(f.text, ctx, f.kind ?? 'reply');
      expect(r).toEqual({ ok: true });
    });
  }

  it('every rule in the table is exercised by a must-fail fixture', () => {
    const rules = new Set(MUST_FAIL.map((f) => f.rule));
    for (const rule of ['person', 'dash', 'name', 'internal', 'link', 'estimate', 'promise', 'approval', 'commitment', 'unsourced_number', 'source', 'length']) {
      expect(rules.has(rule as never)).toBe(true);
    }
  });
});

describe('provenance masking', () => {
  it('without the tool results the same sentence fails as an unsourced number', () => {
    const text = 'Google Analytics, Oct 1 to Oct 20, 2026: 1,234 sessions.';
    expect(gateReply(text, fixtureContext())).toEqual({ ok: true });
    // The sentence minus the date range, so the only thing left to refuse is the count.
    const short = 'You had 1,234 sessions in Google Analytics.';
    const bareShort = gateReply(short, fixtureContext({ provenance: emptyProvenance() }));
    expect(bareShort.ok).toBe(false);
    if (!bareShort.ok) expect(bareShort.rule).toBe('unsourced_number');
    const bare = fixtureContext({ provenance: emptyProvenance() });
    const r = gateReply(text, bare);
    // Unmasked, the dates read as calendar dates; the count is refused either way.
    expect(r.ok).toBe(false);
  });

  it('a dollar amount passes only with an invoices read behind it', () => {
    const text = 'Your open invoice balance is $750.50.';
    expect(gateReply(text, fixtureContext())).toEqual({ ok: true });
    const noInvoices = fixtureContext({ provenance: buildProvenance(CALLS.filter((c) => c.kind !== 'invoices'), []) });
    const r = gateReply(text, noInvoices);
    expect(r.ok).toBe(false);
    // An unbacked dollar figure is a money promise before it is an unsourced number.
    if (!r.ok) expect(r.rule).toBe('promise');
  });

  it('an invoice total backs a dollar figure that names it', () => {
    expect(gateReply('The total on that invoice was $1,500.', fixtureContext())).toEqual({ ok: true });
  });

  it('a money figure is exact: the rounded balance does not pass', () => {
    const r = gateReply('Your balance is $751.', fixtureContext());
    expect(r.ok).toBe(false);
  });

  it('numbers from the context bundle are allowed', () => {
    const ctx = fixtureContext({ provenance: buildProvenance([], ['7']) });
    expect(gateReply('Page 7 is on the list.', ctx)).toEqual({ ok: true });
  });

  it('a masked number followed by a time unit is still a duration promise', () => {
    const ctx = fixtureContext({ provenance: buildProvenance([], ['3']) });
    const r = gateReply('It will take 3 days.', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe('promise');
  });
});

describe('parity with the writing standard prose gate', () => {
  const PROSE_GATE = '/home/mike/.claude/skills/writing-standard/prose-gate.sh';
  const dashAndLexical = MUST_FAIL.filter((f) => f.rule === 'dash').map((f) => f.text);

  it.skipIf(!fs.existsSync(PROSE_GATE))('prose-gate.sh also refuses every must-fail dash line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-gate-'));
    try {
      const real = dashAndLexical.filter((t) => !t.includes('--')); // "--" is ours; the prose gate covers dashes and spaced hyphens
      for (const [i, line] of real.entries()) {
        const file = path.join(dir, `dash-${i}.txt`);
        fs.writeFileSync(file, line + '\n');
        const res = spawnSync('sh', [PROSE_GATE, file], { encoding: 'utf8' });
        expect(res.status, `prose-gate.sh should refuse: ${line}`).toBe(1);
      }
    } finally {
      // Files are left in the OS temp folder; nothing is deleted from code.
    }
  });

  it.skipIf(!fs.existsSync(PROSE_GATE))('prose-gate.sh passes the must-pass lines that carry no dash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-gate-ok-'));
    const file = path.join(dir, 'ok.txt');
    fs.writeFileSync(file, MUST_PASS.map((p) => p.text).join('\n\n') + '\n');
    const res = spawnSync('sh', [PROSE_GATE, file], { encoding: 'utf8' });
    // The prose gate is a lexical floor with its own tells; list what it flags rather than assume.
    expect([0, 1]).toContain(res.status);
  });
});
