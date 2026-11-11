import { describe, it, expect } from 'vitest';
import { textRefusal, summariesLine } from '../summaries';
import { descriptionHash, readStoredChecklist } from '../../summary-hash';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('textRefusal', () => {
  it('accepts plain text of 60 words and refuses 61', () => {
    expect(textRefusal(words(60), 60)).toBeNull();
    expect(textRefusal(words(61), 60)).toBe('too_long');
  });
  it('refuses empty text', () => {
    expect(textRefusal('   ', 60)).toBe('empty');
  });
  it('refuses an em dash, an en dash, a spaced hyphen and a double hyphen, but not a hyphenated word', () => {
    expect(textRefusal('One — two', 60)).toBe('dash');
    expect(textRefusal('One–two', 60)).toBe('dash');
    expect(textRefusal('One - two', 60)).toBe('dash');
    expect(textRefusal('One--two', 60)).toBe('dash');
    expect(textRefusal('A follow-up call', 60)).toBeNull();
  });
  it('refuses the banned words in any case, but not words that only contain them', () => {
    for (const w of ['priority', 'Priorities', 'OVERDUE']) expect(textRefusal(`This is ${w} now`, 60)).toBe('banned_word');
    expect(textRefusal('Prioritize the call', 60)).toBeNull();
  });
});

describe('summariesLine', () => {
  it('uses the real count and the singular form for one', () => {
    expect(summariesLine(9)).toBe('Wrote short versions of 9 long cards. The full notes stay one click away.');
    expect(summariesLine(1)).toBe('Wrote a short version of 1 long card. The full notes stay one click away.');
  });
});

describe('descriptionHash', () => {
  it('is the sha256 hex of the stored string, and null with no text', () => {
    expect(descriptionHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(descriptionHash('')).toBeNull();
    expect(descriptionHash(null)).toBeNull();
  });
  it('changes with any edit', () => {
    expect(descriptionHash('abc ')).not.toBe(descriptionHash('abc'));
  });
});

describe('readStoredChecklist', () => {
  it('reads a list of strings and nothing else', () => {
    expect(readStoredChecklist([' a ', '', 3, 'b'])).toEqual(['a', 'b']);
    expect(readStoredChecklist(null)).toEqual([]);
    expect(readStoredChecklist({ a: 1 })).toEqual([]);
  });
});
