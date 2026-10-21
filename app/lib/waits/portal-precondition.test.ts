import { describe, it, expect } from 'vitest';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { isPortalTaskAnswered, isPortalTaskUntouched } from './portal-precondition';

describe('isPortalTaskAnswered (portal_answered, the first-response skip)', () => {
  it('is false while the task is not started and unstaged: the clock may fire', () => {
    expect(isPortalTaskAnswered({ status: 'not_started' })).toBe(false);
    expect(isPortalTaskAnswered({ status: 'not_started', staging_preview_url: null })).toBe(false);
    expect(isPortalTaskAnswered({ status: 'not_started', staging_preview_url: '' })).toBe(false);
  });
  it('is true once a person has moved the task to in_progress, review or done', () => {
    for (const status of ['in_progress', 'review', 'done']) expect(isPortalTaskAnswered({ status })).toBe(true);
  });
  it('blocked and abandoned do NOT count as an answer', () => {
    expect(isPortalTaskAnswered({ status: 'blocked' })).toBe(false);
    expect(isPortalTaskAnswered({ status: 'abandoned' })).toBe(false);
  });
  it('is true when the task is staged for the client, even if still not started', () => {
    expect(isPortalTaskAnswered({ status: 'not_started', staging_preview_url: 'https://staging.example.com' })).toBe(true);
    expect(isPortalTaskAnswered({ status: 'blocked', staging_preview_url: 'https://staging.example.com' })).toBe(true);
  });
});

describe('isPortalTaskUntouched (portal_untouched, the emergency skip)', () => {
  it('is true for a not-started task that is unassigned or still with Bast', () => {
    expect(isPortalTaskUntouched({ status: 'not_started' })).toBe(true);
    expect(isPortalTaskUntouched({ status: 'not_started', assignee_id: null })).toBe(true);
    expect(isPortalTaskUntouched({ status: 'not_started', assignee_id: BAST_USER_ID })).toBe(true);
  });
  it('is false once a person is assigned', () => {
    expect(isPortalTaskUntouched({ status: 'not_started', assignee_id: 'sabeen-id' })).toBe(false);
  });
  it('is false once the status moved or the task is staged', () => {
    expect(isPortalTaskUntouched({ status: 'in_progress', assignee_id: BAST_USER_ID })).toBe(false);
    expect(isPortalTaskUntouched({ status: 'not_started', staging_preview_url: 'https://s.example.com' })).toBe(false);
  });
  it('a blocked task is still untouched (a dependency is not a person)', () => {
    expect(isPortalTaskUntouched({ status: 'blocked', assignee_id: BAST_USER_ID })).toBe(true);
  });
});
