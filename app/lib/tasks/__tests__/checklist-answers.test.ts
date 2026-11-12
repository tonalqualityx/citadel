import { describe, it, expect } from 'vitest';
import { answerContent, parseAnswer, latestAnswers, CHAT_ANSWER_PREFIX } from '../checklist-answers';

describe('checklist answers', () => {
  it('round trips, with and without the chat prefix', () => {
    const c = answerContent('Rule: nine or ten trustees', 'Ten.');
    expect(c).toBe('Answer on "Rule: nine or ten trustees": Ten.');
    expect(parseAnswer(c)).toEqual({ text: 'Rule: nine or ten trustees', answer: 'Ten.' });
    expect(parseAnswer(CHAT_ANSWER_PREFIX + c)).toEqual({ text: 'Rule: nine or ten trustees', answer: 'Ten.' });
    expect(parseAnswer('Just a comment')).toBeNull();
  });
  it('matches by stored item id first (survives an edited text), else by text; the latest wins', () => {
    const items = [{ id: 'a', text: 'Edited text' }, { id: 'b', text: 'Second' }];
    const out = latestAnswers(items, [
      { content: 'Answer on "Old text": First try', chat_meta: { checklist: { item_id: 'a' } } },
      { content: 'Answer on "Second": One', chat_meta: null },
      { content: 'Answer on "Second": Two', chat_meta: null },
      { content: 'Answer on "Gone": x', chat_meta: null },
    ]);
    expect(out.get(0)).toBe('First try');
    expect(out.get(1)).toBe('Two');
    expect(out.size).toBe(2);
  });
});
