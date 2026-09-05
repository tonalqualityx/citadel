import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    approvalRequest: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logUpdate: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logUpdate } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.approvalRequest.findUnique as Mock;
const mockUpdate = prisma.approvalRequest.update as Mock;
const mockLogUpdate = vi.mocked(logUpdate);

const AR_ID = 'ar-1';
const params = Promise.resolve({ id: AR_ID });

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/approval-requests/${AR_ID}/reply`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'oracle-svc', role: 'admin', email: 'oracle@indelible.bot' });
  mockUpdate.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: AR_ID, ...args.data }));
});

describe('POST /api/approval-requests/[id]/reply', () => {
  it('404s when the row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await POST(
      req({ message_id: 'm1', received_at: '2026-09-04T12:00:00.000Z', excerpt: 'Looks great!' }),
      { params }
    );
    expect(res.status).toBe(404);
  });

  it("flips 'sent' to 'replied'", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sent', task_id: 'task-1' });
    const res = await POST(
      req({ message_id: 'm1', received_at: '2026-09-04T12:00:00.000Z', excerpt: 'Looks great!' }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'replied', reply_excerpt: 'Looks great!' }) })
    );
    // MEDIUM-4: logs the actual transition.
    expect(mockLogUpdate).toHaveBeenCalledTimes(1);
    expect(mockLogUpdate).toHaveBeenCalledWith(
      'oracle-svc', 'task', 'task-1', 'Approval request',
      { approval_status: { from: 'sent', to: 'replied' } }
    );
  });

  it("refreshes reply_excerpt on an already-'replied' row without changing status, and does not log", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'replied', task_id: 'task-1' });
    await POST(req({ message_id: 'm2', received_at: '2026-09-04T13:00:00.000Z', excerpt: 'One more thing.' }), { params });
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBeUndefined();
    expect(updateArgs.data.reply_excerpt).toBe('One more thing.');
    expect(mockLogUpdate).not.toHaveBeenCalled();
  });

  it('never reopens a terminal status (approved), and does not log', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'approved', task_id: 'task-1' });
    await POST(req({ message_id: 'm3', received_at: '2026-09-04T13:00:00.000Z', excerpt: 'Thanks!' }), { params });
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBeUndefined();
    expect(mockLogUpdate).not.toHaveBeenCalled();
  });

  it('caps the excerpt at 300 chars', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sent' });
    const longExcerpt = 'y'.repeat(1000);
    await POST(req({ message_id: 'm4', received_at: '2026-09-04T13:00:00.000Z', excerpt: longExcerpt }), { params });
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect((updateArgs.data.reply_excerpt as string).length).toBe(300);
  });
});
