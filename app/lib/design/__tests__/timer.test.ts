import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { ownsTimer } from '../timer';
import { designerMayCall } from '@/lib/auth/designer-routes';

const session = { designer_id: 'u-owner' };

describe('timer ownership', () => {
  it('the opening designer or admin owns the timer', () => {
    expect(ownsTimer(session, { userId: 'u-owner', role: 'designer' })).toBe(true);
    expect(ownsTimer(session, { userId: 'u-owner', role: 'admin' })).toBe(true);
  });
  it('a viewing pm, another admin, another designer, or nobody gets none', () => {
    expect(ownsTimer(session, { userId: 'u-pm', role: 'pm' })).toBe(false);
    expect(ownsTimer(session, { userId: 'u-admin', role: 'admin' })).toBe(false);
    expect(ownsTimer(session, { userId: 'u-other', role: 'designer' })).toBe(false);
    expect(ownsTimer(session, { userId: 'u-owner', role: 'pm' })).toBe(false);
    expect(ownsTimer(session, undefined)).toBe(false);
  });
});

describe('designer allowlist keeps time tracking out', () => {
  it.each([
    ['GET', '/api/time-entries'],
    ['POST', '/api/time-entries'],
    ['GET', '/api/time-entries/active'],
    ['POST', '/api/time-entries/start'],
    ['POST', '/api/time-entries/2b3c4d5e-0000-4000-8000-000000000000/stop'],
    ['PATCH', '/api/time-entries/2b3c4d5e-0000-4000-8000-000000000000/stop'],
  ])('%s %s is denied', (method, path) => {
    expect(designerMayCall(method, path)).toBe(false);
  });
});
