/** Adding a blocker to a review step: the pieces it now covers lose their per-piece review stamp (Mike, 2026-11-24). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUpdate = vi.fn();
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      update: (...a: unknown[]) => mockUpdate(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
    },
  },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'pm-1', role: 'pm', email: 'pm@example.test' })),
  requireRole: vi.fn(),
}));
vi.mock('@/lib/services/notifications', () => ({ notifyReleasedAssignees: vi.fn() }));
vi.mock('@/lib/services/activity', () => ({ logUpdate: vi.fn() }));
const mockUnblock = vi.fn(async (..._a: unknown[]) => [] as string[]);
vi.mock('@/lib/services/dependencies', () => ({ unblockEligibleDependents: (...a: unknown[]) => mockUnblock(...a) }));

import { POST as addDependency } from '../route';

const REVIEW = '11111111-1111-4111-8111-111111111111';
const PIECE = '22222222-2222-4222-8222-222222222222';
const SEC = '33333333-3333-4333-8333-333333333333';

function add(id: string, blocker: string) {
  return addDependency(new NextRequest(`http://localhost:3000/api/tasks/${id}/dependencies`, { method: 'POST', body: JSON.stringify({ blocker_id: blocker }) }), {
    params: Promise.resolve({ id }),
  });
}

function arrange(reviewTags: string[]) {
  mockFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (where.id === REVIEW) return { id: REVIEW, status: 'not_started', tags: reviewTags, blocked_by: [] };
    return { id: where.id, status: 'done', tags: [], blocked_by: [] };
  });
  mockFindMany.mockImplementation(async (args: { where: { id: { in: string[] } }; select: Record<string, unknown> }) => {
    const ids = args.where.id.in;
    if (args.select.blocked_by) {
      return ids.map((id) => ({ id, project_id: 'P', tags: id === REVIEW ? reviewTags : [], status: 'done', is_deleted: false, blocked_by: id === REVIEW ? [{ id: PIECE }, { id: SEC }] : [] }));
    }
    return [
      { id: PIECE, title: 'Build page', tags: [], status: 'done', approved: false, needs_review: true },
      { id: SEC, title: 'Security fix', tags: [], status: 'done', approved: false, needs_review: true },
    ].filter((r) => ids.includes(r.id));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe('adding a dependency to a review step', () => {
  it('clears needs_review on covered done stamped pieces, keeps a security one, invents no approval', async () => {
    arrange(['finalize-step']);
    expect((await add(REVIEW, PIECE)).status).toBe(201);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: PIECE }, data: { needs_review: false } });
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: SEC } }));
    expect(mockUnblock).toHaveBeenCalledWith(PIECE);
  });

  it('does nothing extra when the dependent is an ordinary task', async () => {
    arrange([]);
    expect((await add(REVIEW, PIECE)).status).toBe(201);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
