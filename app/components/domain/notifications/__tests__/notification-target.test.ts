import { describe, it, expect } from 'vitest';
import { notificationTarget } from '../notification-target';

const T = '14d1ef50-0000-4000-8000-000000000000';

describe('notificationTarget', () => {
  it('opens the task for a system_alert portal request with a task entity', () => {
    expect(notificationTarget({ type: 'system_alert', message: null, entity_type: 'task', entity_id: T })).toBe(`/tasks/${T}`);
  });
  it('opens the task for portal_chat_handoff and the no_access alert (task entity)', () => {
    expect(notificationTarget({ type: 'portal_chat_handoff', message: 'x', entity_type: 'task', entity_id: T })).toBe(`/tasks/${T}`);
  });
  it('falls back to the task link in the message when the entity is missing', () => {
    expect(notificationTarget({ type: 'system_alert', message: `Open the task: https://citadel.becomeindelible.com/tasks/${T}`, entity_type: null, entity_id: null })).toBe(`/tasks/${T}`);
  });
  it('falls back when the entity type is unknown', () => {
    expect(notificationTarget({ message: `see /tasks/${T}`, entity_type: 'widget', entity_id: T })).toBe(`/tasks/${T}`);
  });
  it('returns null when there is nothing to open', () => {
    expect(notificationTarget({ message: 'hello', entity_type: null, entity_id: null })).toBeNull();
  });
  it('still routes projects, sops and recipes', () => {
    expect(notificationTarget({ entity_type: 'project', entity_id: 'p1', message: null })).toBe('/projects/p1');
    expect(notificationTarget({ entity_type: 'sop', entity_id: 's1', message: null })).toBe('/grimoire/runes/s1');
  });
});
