import { describe, it, expect } from 'vitest';
import { textRefusal, summariesLine, repairText, prepareItem } from '../summaries';
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

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const MINUS = String.fromCharCode(0x2212);

describe('repairText', () => {
  it('repairs a line with an em dash and keeps it', () => {
    const r = repairText(`Send the draft ${EM} then wait`, 25);
    expect(r.text).toBe('Send the draft, then wait');
    expect(r.fixed).toEqual(['dash']);
    expect(textRefusal(r.text!, 25)).toBeNull();
  });
  it('repairs en dash, minus, spaced hyphen and double hyphen without leaving a dash', () => {
    for (const d of [` ${EN} `, EN, ` ${MINUS} `, ' - ', ' -- ', '--']) {
      const r = repairText(`Check the form${d}then publish it`, 25);
      expect(r.text, JSON.stringify(d)).toBe('Check the form, then publish it');
    }
  });
  it('uses a full stop when a full sentence follows the dash', () => {
    expect(repairText(`Call the client about it ${EM} We will send the quote on Friday`, 25).text).toBe('Call the client about it. We will send the quote on Friday');
  });
  it('removes a dangling dash at either end', () => {
    expect(repairText(`Wait for the reply ${EM}`, 25).text).toBe('Wait for the reply');
    expect(repairText(`${EM} Wait for the reply`, 25).text).toBe('Wait for the reply');
  });
  it('leaves a hyphen inside a word and a command flag alone', () => {
    for (const t of ['Fix the sign-in page', 'Update follow-redirects to the new version', 'Run it with --force on staging']) {
      const r = repairText(t, 25);
      expect(r.text).toBe(t);
      expect(r.fixed).toEqual([]);
    }
  });
  it('rewrites a banned word where a plain swap reads right', () => {
    expect(repairText('This is the top priority this week', 25).text).toBe('This is the most important this week');
    expect(repairText('Pay the overdue invoice', 25).text).toBe('Pay the late invoice');
    expect(repairText('Review the priorities', 25).text).toBe('Review the key items');
    expect(repairText('Overdue by three days', 25).text).toBe('Late by three days');
  });
  it('gives up on a banned word it cannot rewrite safely (the caller drops that line)', () => {
    const r = repairText('Set priority to urgent', 25);
    expect(r.text).toBeNull();
    expect(r.refusal).toBe('banned_word');
  });
  it('drops only the sentence with an unrewritable banned word from a summary', () => {
    const r = repairText('The site move is on track. Set priority to urgent. Launch is Friday.', 60, { dropSentences: true });
    expect(r.text).toBe('The site move is on track. Launch is Friday.');
    expect(r.fixed).toEqual(['banned_word']);
  });
  it('trims an over-long text at a sentence boundary, not mid-word', () => {
    const text = `${words(10)}. ${words(10)}. ${words(10)}.`;
    const r = repairText(text, 25);
    expect(r.text).toBe(`${words(10)}. ${words(10)}.`);
    expect(r.fixed).toEqual(['too_long']);
  });
  it('trims a single long sentence at a clause boundary', () => {
    const r = repairText(`${words(8)}, ${words(8)}, ${words(8)}`, 20);
    expect(r.text).toBe(`${words(8)}, ${words(8)}.`);
    expect(r.text!.split(" ").length).toBeLessThanOrEqual(20);
  });
  it('refuses over-long text with no sentence or clause boundary to cut at', () => {
    expect(repairText(words(30), 25)).toMatchObject({ text: null, refusal: 'too_long' });
  });
  it('still refuses empty text', () => {
    expect(repairText('   ', 60)).toMatchObject({ text: null, refusal: 'empty' });
  });
  it('re-checks: whatever it returns passes textRefusal', () => {
    const r = repairText(`Top priority ${EM} the overdue invoice -- now`, 25);
    expect(r.text).not.toBeNull();
    expect(textRefusal(r.text!, 25)).toBeNull();
  });
});

describe('prepareItem', () => {
  it('keeps the other checklist lines when one line cannot be repaired', () => {
    const p = prepareItem('Short version.', ['Send the draft', 'Set priority to urgent', `Get the sign-off ${EM} then publish`, 'Publish the page']);
    expect(p.summary).toBe('Short version.');
    expect(p.checklist).toEqual(['Send the draft', 'Get the sign-off, then publish', 'Publish the page']);
    expect(p.dropped_lines).toBe(1);
    expect(p.fixed).toEqual(['dash']);
  });
  it('does not refuse the card for a bad checklist line', () => {
    const p = prepareItem('Fine summary.', [words(40), 'Ok line']);
    expect(p.refusal).toBeNull();
    expect(p.checklist).toEqual(['Ok line']);
    expect(p.dropped_lines).toBe(1);
  });
  it('refuses the card when the summary is empty', () => {
    expect(prepareItem('  ', ['One', 'Two'])).toMatchObject({ summary: null, refusal: 'empty' });
  });
  it('keeps the first 8 lines and counts the rest as dropped', () => {
    const p = prepareItem('Fine.', Array.from({ length: 10 }, (_, i) => `Step ${i}`));
    expect(p.checklist).toHaveLength(8);
    expect(p.dropped_lines).toBe(2);
  });
  it('leaves a clean card untouched', () => {
    const p = prepareItem('Move the site. Check sign-in.', ['Check the sign-in page', 'Send the report']);
    expect(p).toMatchObject({ summary: 'Move the site. Check sign-in.', fixed: [], dropped_lines: 0 });
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
