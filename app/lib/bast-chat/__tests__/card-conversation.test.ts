import { describe, it, expect } from 'vitest';
import { assertCardConversationOp, CARD_ONLY_TEXT } from '../card-conversation';

const T = '7aa4a01a-1111-4222-8333-944445555666';
const O = '7aa4a01a-1111-4222-8333-944445550000';

describe('assertCardConversationOp', () => {
  it('lets a card conversation release or drop its own card, in any letter case', () => {
    expect(() => assertCardConversationOp(T, 'home', { action: 'triage_release', task_ids: [T.toUpperCase()] })).not.toThrow();
    expect(() => assertCardConversationOp(T, 'home', { action: 'triage_drop', task_ids: [T] })).not.toThrow();
  });
  it('refuses another card, several cards, no ids and a whole plan with the plain sentence', () => {
    for (const input of [
      { action: 'triage_release', task_ids: [O] },
      { action: 'triage_drop', task_ids: [T, O] },
      { action: 'triage_release', task_ids: [] },
      { action: 'triage_release' },
      { action: 'triage_release_plan', group_key: 'none' },
    ]) {
      expect(() => assertCardConversationOp(T, 'home', input)).toThrow(CARD_ONLY_TEXT);
    }
  });
  it('leaves every other home action, other ops and the general chat alone', () => {
    expect(() => assertCardConversationOp(T, 'home', { action: 'not_now', item_key: 'task:x' })).not.toThrow();
    expect(() => assertCardConversationOp(T, 'comment', { task_id: O, text: 'x' })).not.toThrow();
    expect(() => assertCardConversationOp(null, 'home', { action: 'triage_release', task_ids: [O, T] })).not.toThrow();
    expect(() => assertCardConversationOp(undefined, 'home', { action: 'triage_release_plan', group_key: 'g' })).not.toThrow();
  });
  it('the refusal is plain: no dash', () => {
    expect(CARD_ONLY_TEXT).not.toMatch(/[–—]/);
  });
});
