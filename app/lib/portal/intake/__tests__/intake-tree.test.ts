import { describe, it, expect } from 'vitest';
import {
  ANSWER_MAX,
  INTAKE_TYPES,
  OPENING_CHOICES,
  allIntakeStrings,
  isUrgentChoice,
  maxClarifyingQuestions,
  questionsFor,
  validateAnswers,
} from '../tree';

// The MVP promise list (spec 2.2): money, dates, durations, "included", "free", "guarantee",
// "will be done", "by {day}". Any hit in a client-facing string fails the build.
const PROMISES: Array<[string, RegExp]> = [
  ['money', /[$€£]\s?\d|\b\d[\d,.]*\s?(dollars?|usd)\b|\bprice\b|\bcost\b|\bquote of\b/i],
  ['calendar date', /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i],
  ['duration', /\b(within|in|about|around|under)?\s*\d+\s*(minutes?|hours?|days?|weeks?|months?|business days?)\b/i],
  ['same-day or next-day', /\b(same day|next day|tomorrow|right away|immediately|asap)\b/i],
  ['included', /\bincluded\b|\bincludes\b/i],
  ['free', /\bfree\b|\bno charge\b|\bat no cost\b/i],
  ['guarantee', /\bguarantee/i],
  ['will be done', /\bwill be (done|finished|ready|completed|fixed)\b/i],
  ['by a day', /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|end of|the end|noon|tonight|next)\b/i],
];

describe('the question tree', () => {
  it('asks at most three clarifying questions for any type and path', () => {
    expect(maxClarifyingQuestions()).toBeLessThanOrEqual(3);
    for (const t of INTAKE_TYPES) {
      expect(questionsFor(t, 'site_down').length).toBeLessThanOrEqual(3);
      expect(questionsFor(t, 'page_link').length).toBeLessThanOrEqual(3);
    }
  });

  it('has six opening choices, one per type, in the spec order', () => {
    expect(OPENING_CHOICES.map((c) => c.key)).toEqual([...INTAKE_TYPES]);
  });

  it('requires Q1 everywhere and offers a skippable Q3 wherever a Q3 exists', () => {
    for (const t of INTAKE_TYPES) {
      const qs = questionsFor(t, 'page_link');
      expect(qs[0].required).toBe(true);
      const q3 = qs.find((q) => q.key === 'q3');
      if (q3) expect(q3.required).toBe(false);
    }
  });

  it('shortens the broken path to two questions for the two urgent choices', () => {
    expect(questionsFor('broken', 'site_down').map((q) => q.key)).toEqual(['q1', 'q2']);
    expect(questionsFor('broken', 'form_checkout').map((q) => q.key)).toEqual(['q1', 'q2']);
    expect(questionsFor('broken', 'page_link').map((q) => q.key)).toEqual(['q1', 'q2', 'q3']);
    expect(questionsFor('broken', 'something_else').map((q) => q.key)).toEqual(['q1', 'q2', 'q3']);
    expect(isUrgentChoice('broken', 'site_down')).toBe(true);
    expect(isUrgentChoice('broken', 'page_link')).toBe(false);
    expect(isUrgentChoice('site_change', 'site_down')).toBe(false);
  });

  it('keeps every urgent broken Q2 optional and every other broken Q2 required', () => {
    expect(questionsFor('broken', 'site_down')[1].required).toBe(false);
    expect(questionsFor('broken', 'page_link')[1].required).toBe(true);
  });
});

describe('copy rules', () => {
  const strings = allIntakeStrings();

  it('covers a real number of strings', () => {
    expect(strings.length).toBeGreaterThan(60);
  });

  it('has no em dashes or en dashes anywhere', () => {
    for (const s of strings) expect(s, s).not.toMatch(/[—–]/);
  });

  it('promises no money, date, duration, "free", "included" or "guarantee"', () => {
    for (const s of strings) {
      for (const [name, re] of PROMISES) expect(s, `${name}: ${s}`).not.toMatch(re);
    }
  });

  it('never names staff or tooling', () => {
    for (const s of strings) expect(s, s).not.toMatch(/\bbast\b|\bcitadel\b|\bclaude\b|\bai\b/i);
  });

  it('the scan itself catches what it should', () => {
    const bad = ['It costs $50.', 'Done in 3 days', 'It is free', 'We guarantee it', 'by Friday', 'This is included'];
    for (const b of bad) expect(PROMISES.some(([, re]) => re.test(b)), b).toBe(true);
  });
});

describe('validateAnswers', () => {
  it('rebuilds prompts and verbatim text from the tree, not from the browser', () => {
    const r = validateAnswers('site_change', [
      { key: 'q1', value: '  Change the hours  ' },
      { key: 'q2', value: '/contact' },
      { key: 'q3', value: 'yes_link', detail: 'https://example.com/file' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).toEqual([
      { key: 'q1', prompt: 'What should change? Tell us in your own words.', value: 'Change the hours' },
      { key: 'q2', prompt: 'Which page is it on? Paste the link or name the page.', value: '/contact' },
      { key: 'q3', prompt: 'Do you have new text, photos or files?', value: 'Yes, here is a link: https://example.com/file' },
    ]);
    expect(r.urgent).toBe(false);
  });

  it('fails a missing required answer, an unknown key, a repeated key and over-long text', () => {
    expect(validateAnswers('site_change', [{ key: 'q1', value: 'x' }]).ok).toBe(false);
    expect(validateAnswers('site_change', [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'y' }, { key: 'q9', value: 'z' }]).ok).toBe(false);
    expect(validateAnswers('other', [{ key: 'q1', value: 'a' }, { key: 'q1', value: 'b' }]).ok).toBe(false);
    expect(
      validateAnswers('site_change', [{ key: 'q1', value: 'x'.repeat(ANSWER_MAX + 1) }, { key: 'q2', value: 'y' }]).ok
    ).toBe(false);
  });

  it('lets an optional Q3 be skipped', () => {
    const r = validateAnswers('site_change', [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'y' }, { key: 'q3', value: '' }]);
    expect(r.ok && r.answers.map((a) => a.key)).toEqual(['q1', 'q2']);
  });

  it('rejects an unknown choice and requires a follow-up detail where the tree asks', () => {
    expect(validateAnswers('other', [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'nope' }]).ok).toBe(false);
    expect(validateAnswers('other', [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'yes_urgent' }]).ok).toBe(false);
    const ok = validateAnswers('other', [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'yes_urgent', detail: 'A launch' }]);
    expect(ok.ok && ok.answers[1].value).toBe('Yes: A launch');
  });

  it('refuses extra text on a choice that takes none', () => {
    expect(validateAnswers('other', [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'not_really', detail: 'hi' }]).ok).toBe(false);
  });

  it('marks the two urgent broken choices urgent and drops a stray Q3', () => {
    const r = validateAnswers('broken', [{ key: 'q1', value: 'site_down' }, { key: 'q2', value: '' }]);
    expect(r.ok && r.urgent).toBe(true);
    const stray = validateAnswers('broken', [{ key: 'q1', value: 'site_down' }, { key: 'q3', value: 'today' }]);
    expect(stray.ok).toBe(false);
  });
});
