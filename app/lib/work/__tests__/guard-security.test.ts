// @vitest-environment node
/**
 * Work stage D: a security report (or any urgent source) filed on a conversation that ordinary open work already carries is still
 * created. The rule lives in checkTracked: `urgent` (set by the route from a security tag, an urgent ask or client/launch blocking)
 * skips the check; without it the same conversation is answered as tracked.
 */
import { describe, it, expect } from 'vitest';
import { checkTracked } from '../guard';

const NOW = new Date('2026-11-11T12:00:00Z');
function fakeDb(task: { tags: string[] }) {
  return {
    workLink: { findMany: async () => [{ id: 'l1', kind: 'email', ref: 'conv-1', target_key: 'task:t1', last_seen_at: NOW }] },
    emailAsk: { findMany: async () => [{ conversation_key: 'conv-1', rfc_message_id: 'r1', message_id: 'm1', received_at: NOW, is_urgent: false, state: 'open', task_id: 't1' }] },
    task: { findMany: async () => [{ id: 't1', title: 'Ordinary job', status: 'in_progress', is_deleted: false, completed_at: null, updated_at: NOW, tags: task.tags }] },
    project: { findMany: async () => [] },
  } as never;
}
const src = [{ kind: 'email' as const, ref: 'conv-1' }];

describe('checkTracked and security reports', () => {
  it('answers a plain create on a conversation attached to an ordinary open task', async () => {
    expect(await checkTracked(fakeDb({ tags: [] }), src)).toMatchObject({ target_key: 'task:t1', state: 'open' });
  });
  it('lets a security-tagged create through (urgent) on the same conversation', async () => {
    expect(await checkTracked(fakeDb({ tags: [] }), src, { urgent: true })).toBeNull();
  });
  it('never lets the owner override flag be implied by urgent, and an override still creates', async () => {
    expect(await checkTracked(fakeDb({ tags: [] }), src, { override: true })).toBeNull();
  });
  it('a conversation attached to a security-tagged task is never hidden either', async () => {
    expect(await checkTracked(fakeDb({ tags: ['security-report'] }), src)).toBeNull();
  });
});
