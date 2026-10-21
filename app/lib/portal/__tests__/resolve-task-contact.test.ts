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

  it('a deleted requester resolves to null and never falls back to the primary contact', async () => {
    mockFindFirst.mockResolvedValue({ id: 'k2', name: 'Pat', email: 'p@a.com', client_id: 'c1' });
    const deleted = { id: 'k1', name: 'Jane', email: 'j@a.com', client_id: 'c1', is_deleted: true };
    expect(await resolveTaskContact({ requested_by_contact: deleted, client_id: 'c1' })).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('a task with no requester still resolves the primary contact', async () => {
    const primary = { id: 'k2', name: 'Pat', email: 'p@a.com', client_id: 'c1' };
    mockFindFirst.mockResolvedValue(primary);
    expect(await resolveTaskContact({ requested_by_contact: null, client_id: 'c1' })).toBe(primary);
  });

  it('returns null for a deleted requester when there is no client to fall back on', async () => {
    const deleted = { id: 'k1', name: 'Jane', email: 'j@a.com', client_id: 'c1', is_deleted: true };
    expect(await resolveTaskContact({ requested_by_contact: deleted })).toBeNull();
  });
});
