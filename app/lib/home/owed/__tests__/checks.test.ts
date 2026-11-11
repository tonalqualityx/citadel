import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkDraftBody, checkRead, checkSuggested, OWED_CHECK } from '../checks';

interface Case {
  text: string;
  ok: boolean;
  category: 'money' | 'time' | 'scope' | 'shape' | null;
  machine_only?: boolean;
}
const CASES: Case[] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'commitment-cases.json'), 'utf-8'));

describe('commitment-cases.json', () => {
  it('holds at least 60 cases with the plan\'s named passes and refusals', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
    const texts = CASES.map((c) => c.text);
    for (const t of ['Thanks, got this. I\'ll get back to you.', 'Happy to look at it.', 'I can do it by Friday.', 'That would be $1,500.', 'We\'ll include the blog.', 'Turnaround is about a week.']) {
      expect(texts).toContain(t);
    }
    expect(CASES.some((c) => !c.ok && /[–—]/.test(c.text))).toBe(true);
    expect(CASES.some((c) => c.machine_only && /https?:\/\//.test(c.text))).toBe(true);
    for (const cat of ['money', 'time', 'scope', 'shape']) expect(CASES.filter((c) => c.category === cat).length).toBeGreaterThanOrEqual(5);
  });

  it('every case is shaped the same way (ok and category agree)', () => {
    for (const c of CASES) {
      expect(typeof c.text).toBe('string');
      expect(c.ok ? c.category === null : c.category !== null).toBe(true);
    }
  });
});

describe('checkDraftBody against the shared cases', () => {
  for (const [i, c] of CASES.entries()) {
    if (c.machine_only) continue;
    it(`case ${i}: ${JSON.stringify(c.text.slice(0, 50))} is ${c.ok ? 'ok' : `refused as ${c.category}`}`, () => {
      const r = checkDraftBody(c.text);
      expect(r.ok).toBe(c.ok);
      if (!r.ok) expect(r.category).toBe(c.category);
    });
  }
});

describe('checkDraftBody details', () => {
  it('names the match', () => {
    expect(checkDraftBody('That would be $1,500.')).toEqual({ ok: false, category: 'money', match: '$' });
  });
  it('a curly apostrophe is read as a straight one', () => {
    expect(checkDraftBody('We’ll include the blog.').ok).toBe(false);
  });
  it('"may" the verb is not a month, "May" the month is', () => {
    expect(checkDraftBody('I may call.').ok).toBe(true);
    expect(checkDraftBody('See you in May.').ok).toBe(false);
  });
  it('the pattern lists are named constants', () => {
    expect(OWED_CHECK.money.length).toBeGreaterThan(3);
    expect(OWED_CHECK.time.length).toBeGreaterThan(3);
    expect(OWED_CHECK.scope.length).toBe(2);
  });
});

describe('checkRead and checkSuggested', () => {
  it('a read may name what is missing but must be plain and short', () => {
    expect(checkRead('The reply needs a price from you.').ok).toBe(true);
    expect(checkRead('He is asking you to pick a path and you have not.').ok).toBe(true);
    expect(checkRead('Words '.repeat(41)).ok).toBe(false);
    expect(checkRead('A — dash').ok).toBe(false);
    expect(checkRead('This is a top priority').ok).toBe(false);
    expect(checkRead('It is overdue').ok).toBe(false);
    expect(checkRead('').ok).toBe(false);
  });
  it('a suggested answer is free of commitments and at most 30 words', () => {
    expect(checkSuggested('Tell her the page looks right and ask which version she wants.').ok).toBe(true);
    expect(checkSuggested('Say it will be done by Friday.')).toMatchObject({ ok: false, category: 'time' });
    expect(checkSuggested('Quote her $500.')).toMatchObject({ ok: false, category: 'money' });
    expect(checkSuggested('Say we will build it.')).toMatchObject({ ok: false, category: 'scope' });
    expect(checkSuggested('word '.repeat(31))).toMatchObject({ ok: false, category: 'shape' });
    expect(checkSuggested('Fine – go').ok).toBe(false);
  });
});
