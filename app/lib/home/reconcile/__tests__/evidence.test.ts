import { describe, it, expect } from 'vitest';
import cases from './fixtures/evidence-cases.json';
import { checkQuote, collapse, commitmentHit, doneEvidence, plainQuote, sentences, tenseOf } from '../evidence';

describe('evidence cases fixture', () => {
  it('holds at least 60 cases', () => expect(cases.length).toBeGreaterThanOrEqual(60));
  for (const c of cases) {
    it(`${c.ok ? 'passes' : 'refuses'}: ${c.quote.slice(0, 60)} (${c.reason})`, () => {
      const r = doneEvidence(c.quote, c.new_part, c.quoted_part);
      expect(r.ok).toBe(c.ok);
      expect(r.ok ? 'ok' : (r as { reason: string }).reason).toBe(c.reason);
    });
  }
});

describe('evidence helpers', () => {
  it('collapses whitespace and curly quotes', () => {
    expect(collapse(' a \n b’s ')).toBe("a b's");
  });
  it('splits sentences', () => {
    expect(sentences('One. Two! Three?\nFour')).toEqual(['One.', 'Two!', 'Three?', 'Four']);
  });
  it('shows a dash in his words as a spaced hyphen', () => {
    expect(plainQuote(`fixed it ${'—'} done`)).toBe('fixed it - done');
    expect(plainQuote(`10${'–'}12`)).toBe('10 - 12');
  });
  it('quote checks', () => {
    expect(checkQuote('I did it.', 'Hi. I did it. Bye.').ok).toBe(true);
    expect(checkQuote('I did it.', 'Hi.')).toEqual({ ok: false, reason: 'quote_not_new' });
    expect(checkQuote('x'.repeat(401), 'x'.repeat(401))).toEqual({ ok: false, reason: 'quote_long' });
  });
  it('tense', () => {
    expect(tenseOf('I removed it.')).toBe('done');
    expect(tenseOf("I'll remove it.")).toBe('hedged');
    expect(tenseOf('Thanks')).toBe('none');
  });
  it('commitment patterns come from the owed checks', () => {
    expect(commitmentHit('It is $5')).toBeTruthy();
    expect(commitmentHit('I removed the plugin.')).toBeNull();
  });
});
