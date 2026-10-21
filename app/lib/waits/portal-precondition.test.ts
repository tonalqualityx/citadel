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
});
