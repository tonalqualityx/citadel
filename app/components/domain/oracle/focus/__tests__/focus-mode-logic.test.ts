import { describe, it, expect } from 'vitest';
import {
  elapsedMinutes,
  elapsedSeconds,
  remainingSeconds,
  isTimeUp,
  formatClock,
  isValidParkNote,
  formatParkNoteText,
  FOCUS_DURATION_PRESETS_MINUTES,
  FOCUS_NOTES_BLOCK_ID,
  extractWorkingNotes,
  upsertWorkingNotesBlock,
} from '../focus-mode-logic';

const START = new Date('2026-07-27T09:00:00.000Z').getTime();

describe('elapsedMinutes / elapsedSeconds', () => {
  it('computes whole elapsed minutes', () => {
    expect(elapsedMinutes(START, START + 5 * 60_000)).toBe(5);
  });

  it('clamps to 0 rather than going negative', () => {
    expect(elapsedMinutes(START, START - 60_000)).toBe(0);
    expect(elapsedSeconds(START, START - 1000)).toBe(0);
  });
});

describe('remainingSeconds / isTimeUp', () => {
  it('counts down for a fixed duration', () => {
    const choice = { kind: 'fixed' as const, minutes: 25 };
    expect(remainingSeconds(choice, START, START + 60_000)).toBe(25 * 60 - 60);
  });

  it('never goes negative once past the declared duration', () => {
    const choice = { kind: 'fixed' as const, minutes: 25 };
    expect(remainingSeconds(choice, START, START + 26 * 60_000)).toBe(0);
    expect(isTimeUp(choice, START, START + 26 * 60_000)).toBe(true);
  });

  it('is not time-up before the duration elapses', () => {
    const choice = { kind: 'fixed' as const, minutes: 25 };
    expect(isTimeUp(choice, START, START + 60_000)).toBe(false);
  });

  it('open-ended has no remaining time and is never "time up"', () => {
    const choice = { kind: 'open-ended' as const };
    expect(remainingSeconds(choice, START, START + 999_000)).toBeNull();
    expect(isTimeUp(choice, START, START + 999_000)).toBe(false);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
  });

  it('never renders negative', () => {
    expect(formatClock(-30)).toBe('0:00');
  });
});

describe('isValidParkNote', () => {
  it('rejects both fields empty', () => {
    expect(isValidParkNote({ whereLeftOff: '', nextStep: '  ' })).toBe(false);
  });

  it('accepts either field non-empty', () => {
    expect(isValidParkNote({ whereLeftOff: 'halfway through the form', nextStep: '' })).toBe(true);
    expect(isValidParkNote({ whereLeftOff: '', nextStep: 'send the email' })).toBe(true);
  });
});

describe('formatParkNoteText', () => {
  it('includes both fields when present', () => {
    const text = formatParkNoteText({ whereLeftOff: 'halfway', nextStep: 'finish it' }, START);
    expect(text).toContain('Where I left off: halfway');
    expect(text).toContain('Next step: finish it');
  });

  it('omits an empty field entirely rather than rendering a blank label', () => {
    const text = formatParkNoteText({ whereLeftOff: 'halfway', nextStep: '' }, START);
    expect(text).toContain('Where I left off: halfway');
    expect(text).not.toContain('Next step:');
  });
});

describe('FOCUS_DURATION_PRESETS_MINUTES', () => {
  it('is 25/45/90 per spec', () => {
    expect(FOCUS_DURATION_PRESETS_MINUTES).toEqual([25, 45, 90]);
  });
});

// Clarity Phase 7 (repair, 2026-07-27) — Focus Mode's always-present "Working notes"
// textarea shares ONE home with Park: a dedicated, stable-id paragraph inside a task's
// BlockNote description (never a fresh paragraph per keystroke — see upsertWorkingNotesBlock).
describe('extractWorkingNotes / upsertWorkingNotesBlock', () => {
  it('extractWorkingNotes returns "" for a null/non-array description', () => {
    expect(extractWorkingNotes(null)).toBe('');
    expect(extractWorkingNotes(undefined)).toBe('');
    expect(extractWorkingNotes('plain string, not blocknote')).toBe('');
  });

  it('extractWorkingNotes returns "" when the description has no notes block yet', () => {
    const description = [{ id: 'other-block', type: 'paragraph', content: [{ type: 'text', text: 'Real description' }] }];
    expect(extractWorkingNotes(description)).toBe('');
  });

  it('upsertWorkingNotesBlock creates the dedicated block on first save, after existing content', () => {
    const description = [{ id: 'real-1', type: 'paragraph', content: [{ type: 'text', text: 'Real description' }] }];
    const updated = upsertWorkingNotesBlock(description, 'my first note') as Array<{ id: string }>;

    expect(updated).toHaveLength(2);
    expect(updated[0].id).toBe('real-1'); // existing content untouched, in place
    expect(updated[1].id).toBe(FOCUS_NOTES_BLOCK_ID);
    expect(extractWorkingNotes(updated)).toBe('my first note');
  });

  it('upsertWorkingNotesBlock creates a block from a null description (brand-new pick)', () => {
    const updated = upsertWorkingNotesBlock(null, 'first note ever');
    expect(extractWorkingNotes(updated)).toBe('first note ever');
  });

  it('upsertWorkingNotesBlock UPDATES the same block in place on a second save — never a second paragraph', () => {
    const description = [{ id: 'real-1', type: 'paragraph', content: [{ type: 'text', text: 'Real description' }] }];
    const afterFirstSave = upsertWorkingNotesBlock(description, 'draft one');
    const afterSecondSave = upsertWorkingNotesBlock(afterFirstSave, 'draft one, revised') as Array<{ id: string }>;

    expect(afterSecondSave).toHaveLength(2); // still just the real block + ONE notes block
    expect(extractWorkingNotes(afterSecondSave)).toBe('draft one, revised');
  });

  it('leaves every other block untouched, in its original position', () => {
    const description = [
      { id: 'a', type: 'heading', content: [{ type: 'text', text: 'Title' }] },
      { id: FOCUS_NOTES_BLOCK_ID, type: 'paragraph', content: [{ type: 'text', text: 'old notes' }] },
      { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'trailing content' }] },
    ];
    const updated = upsertWorkingNotesBlock(description, 'new notes') as Array<{ id: string }>;

    expect(updated.map((b) => b.id)).toEqual(['a', FOCUS_NOTES_BLOCK_ID, 'b']);
    expect(extractWorkingNotes(updated)).toBe('new notes');
  });
});
