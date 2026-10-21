import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
vi.mock('@/lib/db/prisma', () => ({ prisma: { clientContact: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } } }));

import { resolveTaskContact } from '@/lib/services/portal';

beforeEach(() => vi.clearAllMocks());

describe('resolveTaskContact', () => {
  it('returns a live requester', async () => {
    const requester = { id: 'k1', name: 'Jane', email: 'j@a.com', client_id: 'c1', is_deleted: false };
    expect(await resolveTaskContact({ requested_by_contact: requester, client_id: 'c1' })).toBe(requester);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('does not resolve a deleted requester; falls back to the non-deleted primary contact', async () => {
    const primary = { id: 'k2', name: 'Pat', email: 'p@a.com', client_id: 'c1' };
    mockFindFirst.mockResolvedValue(primary);
    const deleted = { id: 'k1', name: 'Jane', email: 'j@a.com', client_id: 'c1', is_deleted: true };
    expect(await resolveTaskContact({ requested_by_contact: deleted, client_id: 'c1' })).toBe(primary);
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({ client_id: 'c1', is_primary: true, is_deleted: false });
  });

  it('returns null for a deleted requester when there is no client to fall back on', async () => {
    const deleted = { id: 'k1', name: 'Jane', email: 'j@a.com', client_id: 'c1', is_deleted: true };
    expect(await resolveTaskContact({ requested_by_contact: deleted })).toBeNull();
  });
});
