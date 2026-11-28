/** Removing a task's last blocker releases it, and the assignment notice it held goes out (task 5ad27fc9). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUpdate = vi.fn();
const mockFindUnique = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: { task: { update: (...a: unknown[]) => mockUpdate(...a), findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'pm-1', role: 'pm', email: 'pm@example.test' })),
  requireRole: vi.fn(),
}));
const mockNotifyReleased = vi.fn();
vi.mock('@/lib/services/notifications', () => ({ notifyReleasedAssignees: (...a: unknown[]) => mockNotifyReleased(...a) }));

import { DELETE } from '../route';

const ID = '11111111-1111-4111-8111-111111111111';
const BLOCKER = '22222222-2222-4222-8222-222222222222';

function del() {
  return DELETE(new NextRequest(`http://localhost:3000/api/tasks/${ID}/dependencies?blocker_id=${BLOCKER}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id: ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe('DELETE /api/tasks/:id/dependencies', () => {
  it('removing the last blocker releases the task and sends its held assignment notice', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, status: 'blocked', blocked_by: [], blocked_by_questions: [] });
    const res = await del();
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenLastCalledWith({ where: { id: ID }, data: { status: 'not_started' } });
    expect(mockNotifyReleased).toHaveBeenCalledWith([ID]);
  });

  it('a task still held by another blocker or an open question is not released and sends nothing', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, status: 'blocked', blocked_by: [{ id: 'other' }], blocked_by_questions: [] });
    await del();
    mockFindUnique.mockResolvedValue({ id: ID, status: 'blocked', blocked_by: [], blocked_by_questions: [{ id: 'q' }] });
    await del();
    expect(mockNotifyReleased).not.toHaveBeenCalled();
  });

  it('a failed notice never fails the call', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, status: 'blocked', blocked_by: [], blocked_by_questions: [] });
    mockNotifyReleased.mockRejectedValueOnce(new Error('slack down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await del();
    expect(res.status).toBe(200);
    err.mockRestore();
  });
});
