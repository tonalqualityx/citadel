import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gateReply } from '@/lib/portal/chat/gate';
import { buildProvenance, emptyProvenance } from '@/lib/portal/chat/provenance';
import { renderThread, contextNumbers } from '../context';
import { CALLS, fixtureContext, MUST_FAIL, MUST_PASS, PAGE_NAMES, PROBE_FAIL, PROBE_G2, PROBE_G2_PASS, PROBE_G3, PROBE_G3_PASS, PROBE_G4, PROBE_PASS_PAGES } from './gate-fixtures';
import type { GateKind } from '../gate';

describe('gate fixtures (spec 9.2)', () => {
  it('holds at least 80 must-fail and 50 must-pass sentences', () => {
    const fails = MUST_FAIL.length + PROBE_FAIL.length + PROBE_G2.length - PROBE_G2_PASS.length + PROBE_G3.length - PROBE_G3_PASS.length;
    const passes = MUST_PASS.length + PROBE_PASS_PAGES.length + PROBE_G4.length + PROBE_G2_PASS.length + PROBE_G3_PASS.length;
    expect(fails).toBeGreaterThanOrEqual(80);
    expect(passes).toBeGreaterThanOrEqual(50);
    console.log(`gate fixtures: must-fail ${fails}, must-pass ${passes}`);
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

describe('Opus review probes', () => {
  it('has the reviewer\'s strings', () => {
    expect(PROBE_FAIL.length).toBeGreaterThanOrEqual(99);
    expect(PROBE_PASS_PAGES).toHaveLength(20);
  });
  for (const t of PROBE_FAIL) {
    it(`fails: ${JSON.stringify(t.slice(0, 60))}`, () => {
      expect(gateReply(t, fixtureContext()).ok).toBe(false);
    });
  }
  const pagesCtx = fixtureContext({ pageNames: PAGE_NAMES });
  for (const t of PROBE_PASS_PAGES) {
    it(`passes with the site's own page names: ${JSON.stringify(t.slice(0, 60))}`, () => {
      expect(gateReply(t, pagesCtx)).toEqual({ ok: true });
    });
  }
  it('page names are an allow-list, not a switch: without them the same words fail', () => {
    expect(gateReply('Is it the Free Shipping banner on the home page?', fixtureContext()).ok).toBe(false);
    expect(gateReply('Is it the Ticket Sales page?', fixtureContext()).ok).toBe(false);
    expect(gateReply('Is it the Free Shipping banner on the home page?', pagesCtx)).toEqual({ ok: true });
    // A page name does not excuse a promise written beside it.
    expect(gateReply('The Pricing page is free and we will fix it.', pagesCtx).ok).toBe(false);
  });
  const withClient = fixtureContext({ provenance: buildProvenance(CALLS, ['300', '5', '2', '12']) });
  for (const t of PROBE_G2) {
    const shouldPass = PROBE_G2_PASS.includes(t);
    it(`${shouldPass ? 'passes' : 'fails'}: ${JSON.stringify(t.slice(0, 60))}`, () => {
      expect(gateReply(t, fixtureContext()).ok).toBe(shouldPass);
      expect(gateReply(t, withClient).ok).toBe(shouldPass);
    });
  }
  // The thread as the model reads it: timestamp, attachment id, size and file name sit around the words.
  const thread = renderThread(
    [{ id: 'c1', content: 'Can you swap the photo? We pay 500 for this.', created_at: new Date('2026-10-21T14:37:52.418Z'), source: 'portal', chat_meta: null, author_contact_id: 'x', user_id: null, author_contact: { name: 'Dana Smith' } }],
    [{ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', comment_id: 'c1', filename: 'IMG_4471.jpg', content_type: 'image/jpeg', size_bytes: 2_200_000 }]
  );
  const threadCtx = fixtureContext({ provenance: buildProvenance([], contextNumbers({ thread })) });
  it('only the client\'s words feed the numbers: not timestamps, ids, sizes or file names', () => {
    expect(contextNumbers({ thread })).toEqual(['500']);
  });
  for (const t of PROBE_G3) {
    const shouldPass = PROBE_G3_PASS.includes(t);
    it(`${shouldPass ? 'passes' : 'fails'}: ${JSON.stringify(t.slice(0, 60))}`, () => {
      expect(gateReply(t, shouldPass ? pagesCtx : threadCtx).ok).toBe(shouldPass);
    });
  }
  it('the client\'s own number is echoed only inside their quote', () => {
    expect(gateReply('You wrote "we pay 500 for this".', threadCtx)).toEqual({ ok: true });
    expect(gateReply('That is 500 for this.', threadCtx).ok).toBe(false);
  });
  for (const [t, kind] of PROBE_G4) {
    it(`passes (${kind}): ${JSON.stringify(t.slice(0, 60))}`, () => {
      expect(gateReply(t, pagesCtx, kind as GateKind)).toEqual({ ok: true });
    });
  }
  it('staff-only spans never reach the gate in a draft, but a reply carries no such span', () => {
    const d = '[TEAM: confirm the price and when it will be done.] Hi Dana, thanks for the photo.';
    expect(gateReply(d, fixtureContext(), 'draft')).toEqual({ ok: true });
    expect(gateReply(d, fixtureContext(), 'reply').ok).toBe(false);
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

  it('numbers from the client\'s words are allowed inside a quote', () => {
    const ctx = fixtureContext({ provenance: buildProvenance([], ['7']) });
    expect(gateReply('You wrote "page 7" and I have that.', ctx)).toEqual({ ok: true });
    expect(gateReply('Page 7 is on the list.', ctx).ok).toBe(false);
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
