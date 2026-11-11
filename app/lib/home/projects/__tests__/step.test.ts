import { describe, it, expect } from 'vitest';
import { STEP_IF_IGNORED, STEP_STILL_LINE, dedupeSteps, quietWords, stepComparable, stepReason, stepTitle, stepVisibility, stepWhyNow } from '../step';

const TZ = 'America/New_York';
const d = (iso: string) => new Date(iso);
const step = (over: Partial<{ text: string; step_at: Date | null }> = {}) => ({ text: 'Mike, email Jack to accept the pages.', step_at: d('2026-11-10T08:00:00Z'), ...over });

describe('step core: words', () => {
  it('drops the leading "Mike, " and capitalizes', () => {
    expect(stepTitle('Mike, email Jack to accept the seven pages on the review site.')).toBe('Email Jack to accept the seven pages on the review site.');
    expect(stepTitle('mike: call Gene')).toBe('Call Gene');
    expect(stepTitle('Email Jack.')).toBe('Email Jack.');
  });
  it('the second line and the footer use the plan wording', () => {
    const now = d('2026-11-10T15:00:00Z');
    expect(stepWhyNow('Jack Gaughan Artist Site', d('2026-10-20T15:00:00Z'), now, TZ, false)).toBe('Jack Gaughan Artist Site · quiet 21 days');
    expect(stepWhyNow('Jack', d('2026-11-09T15:00:00Z'), now, TZ, false)).toBe('Jack · quiet 1 day');
    expect(quietWords(d('2026-11-10T09:00:00Z'), now, TZ)).toBe('moved today');
    expect(stepWhyNow('Jack', d('2026-11-09T15:00:00Z'), now, TZ, true)).toContain(STEP_STILL_LINE);
    expect(STEP_STILL_LINE).toBe('Bast still reads this as the next step.');
    expect(stepReason('Jack Gaughan Artist Site')).toBe('The next step on Jack Gaughan Artist Site is yours.');
    expect(STEP_IF_IGNORED).toBe('Stays here. Bast reads the project again tonight and rewrites this step.');
  });
  it('no dash, and none of the words kept off his screen', () => {
    const all = [STEP_STILL_LINE, STEP_IF_IGNORED, stepReason('X'), stepWhyNow('X', d('2026-10-01T00:00:00Z'), d('2026-11-10T00:00:00Z'), TZ, true)].join(' ');
    expect(all).not.toMatch(/[–—]|priorit|overdue/i);
  });
  it('compares text without caring about case or spacing', () => {
    expect(stepComparable('  Email   Jack ')).toBe(stepComparable('email jack'));
  });
});

describe('step core: the hide rule', () => {
  const doneAt = d('2026-11-10T14:00:00Z'); // Tuesday 9:00 New York
  const st = { step_done_at: doneAt, step_done_text: 'Mike, email Jack to accept the pages.' };
  it('shows a step he never marked', () => {
    expect(stepVisibility(step(), undefined, doneAt)).toBe('show');
    expect(stepVisibility(step(), { step_done_at: null, step_done_text: null }, doneAt)).toBe('show');
  });
  it('hides it for two business days when Bast has not rewritten it', () => {
    expect(stepVisibility(step(), st, d('2026-11-10T15:00:00Z'))).toBe('hidden');
    expect(stepVisibility(step(), st, d('2026-11-11T20:00:00Z'))).toBe('hidden');
    // The repo's wait clock: a day counts once it has ended at 5 pm, so the second business day completes Thursday 5 pm.
    expect(stepVisibility(step(), st, d('2026-11-12T20:00:00Z'))).toBe('hidden');
    expect(stepVisibility(step(), st, d('2026-11-12T22:30:00Z'))).toBe('still');
  });
  it('the weekend does not count as business days', () => {
    // Done Friday 9:00; Sunday evening is still inside the two business days.
    const fri = { step_done_at: d('2026-11-13T14:00:00Z'), step_done_text: st.step_done_text };
    expect(stepVisibility(step({ step_at: d('2026-11-13T08:00:00Z') }), fri, d('2026-11-15T23:00:00Z'))).toBe('hidden');
    expect(stepVisibility(step({ step_at: d('2026-11-13T08:00:00Z') }), fri, d('2026-11-17T20:00:00Z'))).toBe('hidden');
    expect(stepVisibility(step({ step_at: d('2026-11-13T08:00:00Z') }), fri, d('2026-11-17T22:30:00Z'))).toBe('still');
  });
  it('a rewrite after the tap brings it back at once: the same text reads "still", new text reads plainly', () => {
    const rewritten = d('2026-11-10T14:30:00Z');
    expect(stepVisibility(step({ step_at: rewritten }), st, d('2026-11-10T15:00:00Z'))).toBe('still');
    expect(stepVisibility(step({ step_at: rewritten, text: 'Mike, book the launch call.' }), st, d('2026-11-10T15:00:00Z'))).toBe('show');
  });
  it('a rewrite from before the tap does not count', () => {
    expect(stepVisibility(step({ step_at: d('2026-11-10T13:59:00Z') }), st, d('2026-11-10T15:00:00Z'))).toBe('hidden');
    expect(stepVisibility(step({ step_at: null }), st, d('2026-11-10T15:00:00Z'))).toBe('hidden');
  });
});

describe('step core: one row per project', () => {
  it('drops projects that already have an item in view, and duplicates', () => {
    const a = { project_id: 'a' };
    const b = { project_id: 'b' };
    expect(dedupeSteps([a, b, { project_id: 'a' }], new Set(['b']))).toEqual([a]);
    expect(dedupeSteps([], new Set())).toEqual([]);
  });
});
