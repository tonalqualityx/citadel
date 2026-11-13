import { describe, it, expect } from 'vitest';
import { canTransitionTaskStatus, getValidNextTaskStatuses, getTaskStatusLabel } from '../status';

describe('triage transitions', () => {
  it('not_started can be filed into triage', () => {
    expect(canTransitionTaskStatus('not_started', 'triage')).toBe(true);
  });
  it('triage releases to not_started, drops to abandoned or closes as done (owner only, checked in the patch path), nothing else', () => {
    expect([...getValidNextTaskStatuses('triage')].sort()).toEqual(['abandoned', 'done', 'not_started']);
    for (const to of ['in_progress', 'blocked', 'review'] as const) expect(canTransitionTaskStatus('triage', to)).toBe(false);
  });
  it('only not_started leads into triage', () => {
    for (const from of ['in_progress', 'review', 'done', 'blocked', 'abandoned'] as const) expect(canTransitionTaskStatus(from, 'triage')).toBe(false);
  });
  it('has a label', () => {
    expect(getTaskStatusLabel('triage')).toBe('Triage');
  });
});
