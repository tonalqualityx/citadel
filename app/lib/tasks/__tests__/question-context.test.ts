import { describe, it, expect } from 'vitest';
import { answerWords, citationLine, contextProblems, questionAnswerSchema, questionContextSchema, questionPatchSchema } from '../question-context';

const good = {
  question: 'Should the Grok blog move to the new template this week?',
  what_it_is: 'The Grok blog still uses the old template and the new one is ready.',
  sources: [{ who: 'Mike', said: 'Move the blog when the template is ready', at: '2026-11-09' }],
  checked: 'Both templates render the same posts and the archive links still work.',
  unknown: 'Whether the client has scheduled a post for this week.',
  options: [
    { id: 'now', label: 'Move it now', consequence: 'Posts get the new look today; a scheduled post could render oddly.' },
    { id: 'later', label: 'Wait a week', consequence: 'Nothing changes this week; the work stays parked.' },
  ],
  recommended_option_id: 'now',
  recommend_why: 'The template is tested and nothing is scheduled that we know of.',
  if_nobody: 'The card is released and the blog moves with the recommendation.',
  if_nobody_action: 'go_with_recommendation' as const,
};

describe('question Context checks', () => {
  it('accepts a complete question, with and without options', () => {
    expect(contextProblems(good)).toEqual([]);
    const free = { ...good, options: undefined, recommended_option_id: undefined, recommend_why: undefined, if_nobody_action: 'wait' as const };
    expect(contextProblems(free)).toEqual([]);
  });

  it.each(['what_it_is', 'sources', 'checked', 'unknown', 'if_nobody', 'if_nobody_action', 'question'])('refuses a question missing %s', (key) => {
    const bad: Record<string, unknown> = { ...good };
    delete bad[key];
    expect(questionContextSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses thin or placeholder parts', () => {
    expect(contextProblems({ ...good, checked: 'n/a' }).join(' ')).toMatch(/What was checked/);
    expect(contextProblems({ ...good, unknown: 'unknown' }).join(' ')).toMatch(/What is unknown/);
    expect(contextProblems({ ...good, what_it_is: 'short' }).join(' ')).toMatch(/real sentence/);
    expect(contextProblems({ ...good, sources: [] }).join(' ')).toMatch(/Sources/);
    expect(contextProblems({ ...good, sources: [{ who: 'x', said: 'y' }] }).length).toBeGreaterThan(0);
  });

  it('holds the question to one line, 200 characters, ending in a question mark', () => {
    expect(contextProblems({ ...good, question: 'Is this fine' }).join(' ')).toMatch(/question mark/);
    expect(contextProblems({ ...good, question: 'Is it\nfine?' }).join(' ')).toMatch(/one line/);
    expect(contextProblems({ ...good, question: `${'a'.repeat(200)}?` }).join(' ')).toMatch(/200/);
  });

  it('options need two to four, each with a consequence, a recommendation among them and why', () => {
    expect(contextProblems({ ...good, options: [good.options[0]] }).join(' ')).toMatch(/two to four/);
    expect(contextProblems({ ...good, options: [...good.options, ...good.options] }).join(' ')).toMatch(/different/);
    expect(contextProblems({ ...good, options: good.options.map((o) => ({ ...o, consequence: '' })) }).length).toBeGreaterThan(0);
    expect(contextProblems({ ...good, recommended_option_id: undefined }).join(' ')).toMatch(/which one you recommend/);
    expect(contextProblems({ ...good, recommended_option_id: 'nope' }).join(' ')).toMatch(/one of the options/);
    expect(contextProblems({ ...good, recommend_why: '' }).join(' ')).toMatch(/why you recommend/);
  });

  it('going with the recommendation needs a recommended option', () => {
    const free = { ...good, options: undefined, recommended_option_id: undefined, recommend_why: undefined };
    expect(contextProblems({ ...free, if_nobody_action: 'go_with_recommendation' }).join(' ')).toMatch(/needs a recommended option/);
    expect(contextProblems({ ...free, if_nobody_action: 'wait' })).toEqual([]);
  });

  it('refuses a field it does not know', () => {
    expect(questionContextSchema.safeParse({ ...good, state: 'answered' }).success).toBe(false);
  });
});

describe('answers and citations', () => {
  it('an answer needs an option or words', () => {
    expect(questionAnswerSchema.safeParse({}).success).toBe(false);
    expect(questionAnswerSchema.safeParse({ text: '   ', version: 'v' }).success).toBe(false);
    expect(questionAnswerSchema.safeParse({ option_id: 'now', version: 'v' }).success).toBe(true);
    expect(questionAnswerSchema.safeParse({ option_id: 'now' }).success).toBe(false); // the version he read is required;
    expect(questionAnswerSchema.safeParse({ text: 'Do it Friday', version: 'v' }).success).toBe(true);
  });
  it('answerWords keeps his words: the label, the text, or both', () => {
    const o = { id: 'now', label: 'Move it now', consequence: 'x' };
    expect(answerWords(o, '')).toBe('Move it now');
    expect(answerWords(null, ' Friday works ')).toBe('Friday works');
    expect(answerWords(o, 'but after lunch')).toBe('Move it now: but after lunch');
  });
  it('the citation is his exact words and the date, only for an answered question', () => {
    const base = { question: 'Move the blog?', answer_text: 'Yes, Friday', answered_at: new Date('2026-11-12T17:00:00Z') };
    expect(citationLine({ ...base, state: 'answered' })).toBe('Mike, 2026-11-12, on "Move the blog?": "Yes, Friday"');
    expect(citationLine({ ...base, state: 'defaulted' })).toBeNull();
    expect(citationLine({ ...base, state: 'open' })).toBeNull();
    expect(citationLine({ ...base, state: 'answered', answer_text: null })).toBeNull();
  });
  it('a patch must say something', () => {
    expect(questionPatchSchema.safeParse({}).success).toBe(false);
    expect(questionPatchSchema.safeParse({ withdraw: true }).success).toBe(true);
  });
});
