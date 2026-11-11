import { describe, it, expect } from 'vitest';
import * as copy from '../copy';
import { OWED, NEEDS_FROM_YOU, NO_SUGGESTION, draftedLine, bastReadLine, suggestedAnswerLine } from '../copy';

function strings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(copy);
  out.push(draftedLine(['A']), draftedLine(['A', 'B']), draftedLine(['A', 'B', 'C', 'D']), bastReadLine('x'), suggestedAnswerLine('x'));
  return out;
}

describe('owed copy', () => {
  it('constants are the plan\'s', () => {
    expect(OWED).toEqual({ perRun: 6, perDay: 40, maxWords: 180, maxChars: 1200, readWords: 40, suggestedWords: 30, freshHours: 2, failCap: 3, shortWords: 40, shortSentences: 2 });
  });
  it('no dash and none of the banned words in any string', () => {
    for (const s of strings()) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/priorit|overdue/i);
    }
  });
  it('the read for each category', () => {
    expect(NEEDS_FROM_YOU.money).toBe('The reply needs a price from you.');
    expect(NEEDS_FROM_YOU.time).toBe('The reply needs a date from you.');
    expect(NEEDS_FROM_YOU.scope).toBe('The reply needs a scope answer from you.');
    expect(NO_SUGGESTION.money).toBe('Suggested answer: none. This needs your price answer.');
    expect(NO_SUGGESTION.time).toBe('Suggested answer: none. This needs your date answer.');
    expect(NO_SUGGESTION.scope).toBe('Suggested answer: none. This needs your scope answer.');
  });
  it('the keeper line', () => {
    expect(draftedLine([])).toBe('');
    expect(draftedLine(['Jessica Everlith'])).toBe('Drafted a reply to Jessica Everlith. It is in your Gmail drafts.');
    expect(draftedLine(['A', 'B'])).toBe('Drafted replies to A and B. They are in your Gmail drafts.');
    expect(draftedLine(['Jessica Everlith', 'B', 'C'])).toBe('Drafted replies to Jessica Everlith and 2 others. They are in your Gmail drafts.');
  });
  it('the card lines', () => {
    expect(bastReadLine('He is stalling.')).toBe("Bast's read: He is stalling.");
    expect(suggestedAnswerLine('Say yes.')).toBe('Suggested answer: Say yes.');
  });
});
