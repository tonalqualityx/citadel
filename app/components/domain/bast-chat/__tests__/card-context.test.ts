import { describe, it, expect } from 'vitest';
import { cardFromInput, contextFor } from '../card-context';

const U = '3ecfb7be-1111-4222-8333-444455556666';

describe('card context', () => {
  it('maps item keys to a kind and id', () => {
    expect(cardFromInput({ key: `task:${U}`, title: 'Call Gene', type: 'task' })).toMatchObject({ kind: 'task', id: U });
    expect(cardFromInput({ key: `wait:${U}`, title: 'x' })).toMatchObject({ kind: 'wait', id: U });
    expect(cardFromInput({ key: `crisis:${U}`, title: 'x' })).toMatchObject({ kind: 'email_ask', id: U });
    expect(cardFromInput({ key: `review:${U}`, title: 'x' })).toMatchObject({ kind: 'project', id: U });
    expect(cardFromInput({ key: U, title: 'Herba', tile: 'projects' })).toMatchObject({ kind: 'project', id: U });
  });
  it('uses opened.task_id for a task item whose key is not a task key', () => {
    expect(cardFromInput({ key: 'thread:acct:abc', title: 'x', type: 'task', task_id: U })).toMatchObject({ kind: 'task', id: U });
  });
  it('falls back to none when the id is unclear', () => {
    expect(cardFromInput({ key: 'thread:acct:abc', title: 'x', type: 'owed_reply' })).toMatchObject({ kind: 'none' });
    expect(cardFromInput({ key: 'session:abc', title: 'x' })).toMatchObject({ kind: 'none' });
    expect(cardFromInput(null)).toBeNull();
  });
  it('sends only kind and id, never the title', () => {
    const card = cardFromInput({ key: `task:${U}`, title: 'Secret client title', tile: 'today' });
    const ctx = contextFor(card);
    expect(ctx).toEqual({ screen: 'home', tile: 'today', kind: 'task', id: U });
    expect(JSON.stringify(ctx)).not.toContain('Secret');
    expect(contextFor(null)).toEqual({ screen: 'home', kind: 'none' });
  });
});
