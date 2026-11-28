import { describe, it, expect } from 'vitest';
import { hasWhy, whyOf } from '../triage-why';

const blk = (type: string, ...texts: [string, boolean?][]) => ({
  id: Math.random().toString(36).slice(2),
  type,
  props: {},
  content: texts.map(([text, bold]) => ({ type: 'text', text, styles: bold ? { bold: true } : {} })),
  children: [],
});
const card = (...blocks: object[]) => JSON.stringify(blocks);

describe('whyOf: the why a card carries', () => {
  it('reads the create-task.py shape: a bold "Why it matters: " run, then the text', () => {
    const d = card(blk('paragraph', ["What's wanted: ", true], ['A report page for Mike.']), blk('paragraph', ['Why it matters: ', true], ['So he can decide in a minute from his phone.']));
    expect(whyOf(d)).toBe('So he can decide in a minute from his phone.');
    expect(hasWhy(d)).toBe(true);
  });
  it('a card filed with one sentence has no why', () => {
    expect(hasWhy(card(blk('paragraph', ['Murderbot: a session that does direct work.'])))).toBe(false);
    expect(hasWhy(card(blk('paragraph', ["What's wanted: ", true], ['A thing.']), blk('paragraph', ['Context: ', true], ['Why we got here is a long story.'])))).toBe(false);
  });
  it('an empty or placeholder why is no why', () => {
    expect(hasWhy(card(blk('paragraph', ['Why it matters: ', true])))).toBe(false);
    expect(hasWhy(card(blk('paragraph', ['Why it matters: TBD'])))).toBe(false);
    expect(hasWhy(card(blk('paragraph', ['Why: so leads']), blk('paragraph', ['Done when:'])))).toBe(false);
  });
  it('a label alone on its line takes the paragraph below it, but never a later labelled line', () => {
    expect(whyOf(card(blk('heading', ['Why it matters']), blk('paragraph', ['x'])))).toBeNull();
    expect(whyOf(card(blk('paragraph', ['Why it matters:']), blk('paragraph', ['The client loses leads every week the form is down.'])))).toBe('The client loses leads every week the form is down.');
    expect(whyOf(card(blk('paragraph', ['Why it matters:']), blk('paragraph', ['Done when:']), blk('bulletListItem', ['It works for everyone here'])))).toBeNull();
  });
  it('other why labels count: "Why:" and "Why it is needed:"', () => {
    expect(hasWhy(card(blk('paragraph', ['Why: Mike decides faster when the options sit side by side.'])))).toBe(true);
    expect(hasWhy(card(blk('paragraph', ["Why it's needed: Invoices sat unpaid for months unseen."])))).toBe(true);
  });
  it('plain text and markdown descriptions', () => {
    expect(hasWhy("What's wanted: X\nWhy it matters: It lets Dox plan without asking twice.\nDone when:\n- Z")).toBe(true);
    expect(hasWhy('**Why it matters:** It lets Dox plan without asking twice.')).toBe(true);
    expect(hasWhy('Just an idea, one sentence.')).toBe(false);
  });
  it('nothing at all has no why', () => {
    expect(hasWhy(null)).toBe(false);
    expect(hasWhy(undefined)).toBe(false);
    expect(hasWhy('')).toBe(false);
  });
});
