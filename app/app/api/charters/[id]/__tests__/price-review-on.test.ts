import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { charter: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/api/formatters', () => ({ formatCharterResponse: vi.fn((c) => c) }));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const findUnique = prisma.charter.findUnique as Mock;
const update = prisma.charter.update as Mock;

const patch = (body: object) =>
  PATCH(
    new NextRequest('http://localhost/api/charters/c1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    { params: Promise.resolve({ id: 'c1' }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'admin', email: 'a@example.com' });
  (requireRole as Mock).mockImplementation(() => {});
  update.mockResolvedValue({ id: 'c1' });
  findUnique.mockResolvedValue({ price_review_on: null });
});

describe('PATCH /api/charters/:id price_review_on', () => {
  it('is staff only', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await patch({ price_review_on: '2027-03-01' })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await patch({ price_review_on: '2027-03-01' })).status).toBe(401);
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
  });

  it('sets a real date as a date-only value and clears the old done stamp', async () => {
    const res = await patch({ price_review_on: '2027-03-01' });
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.price_review_on).toEqual(new Date('2027-03-01T00:00:00.000Z'));
    expect(data.price_review_done_at).toBeNull();
  });

  it('leaves the done stamp alone when the date does not change', async () => {
    findUnique.mockResolvedValue({ price_review_on: new Date('2027-03-01T00:00:00.000Z') });
    await patch({ price_review_on: '2027-03-01' });
    expect('price_review_done_at' in update.mock.calls[0][0].data).toBe(false);
  });

  it('clears the date with null and keeps the done stamp', async () => {
    findUnique.mockResolvedValue({ price_review_on: new Date('2027-03-01T00:00:00.000Z') });
    const res = await patch({ price_review_on: null });
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.price_review_on).toBeNull();
    expect('price_review_done_at' in data).toBe(false);
  });

  it('rejects anything that is not a real calendar date', async () => {
    for (const bad of ['2027-02-30', '2027-13-01', 'tomorrow', '03/01/2027', '2027-3-1', '2027-03-01T00:00:00Z', '', 20270301, true]) {
      const res = await patch({ price_review_on: bad });
      expect(res.status, String(bad)).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('404s when the charter does not exist', async () => {
    findUnique.mockResolvedValue(null);
    expect((await patch({ price_review_on: '2027-03-01' })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not touch the review fields when the body does not name them', async () => {
    await patch({ name: 'Renamed' });
    expect(findUnique).not.toHaveBeenCalled();
    const data = update.mock.calls[0][0].data;
    expect('price_review_on' in data).toBe(false);
    expect('price_review_done_at' in data).toBe(false);
  });

  it('never accepts the done stamp from the caller', async () => {
    await patch({ price_review_done_at: '2027-01-01T00:00:00Z' });
    expect('price_review_done_at' in update.mock.calls[0][0].data).toBe(false);
  });
});
