import { describe, it, expect } from 'vitest';
import { isPortalTaskAnswered } from './portal-precondition';

describe('isPortalTaskAnswered (the portal_answered sweeper skip condition)', () => {
  it('is false while the task is not started and unstaged: the clock may fire', () => {
    expect(isPortalTaskAnswered({ status: 'not_started' })).toBe(false);
    expect(isPortalTaskAnswered({ status: 'not_started', staging_preview_url: null })).toBe(false);
    expect(isPortalTaskAnswered({ status: 'not_started', staging_preview_url: '' })).toBe(false);
  });
  it('is true once the task has moved', () => {
    for (const status of ['in_progress', 'blocked', 'review', 'done', 'abandoned']) {
      expect(isPortalTaskAnswered({ status })).toBe(true);
    }
  });
  it('is true when the task is staged for the client', () => {
    expect(isPortalTaskAnswered({ status: 'not_started', staging_preview_url: 'https://staging.example.com' })).toBe(true);
  });
  it('is true once staff have replied to the client, even if the task has not moved', () => {
    expect(isPortalTaskAnswered({ status: 'not_started', has_staff_reply: true })).toBe(true);
    expect(isPortalTaskAnswered({ status: 'not_started', has_staff_reply: false })).toBe(false);
  });
});
