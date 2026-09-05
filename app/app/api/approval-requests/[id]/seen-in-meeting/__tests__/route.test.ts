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
  return new NextRequest(`http://localhost:3000/api/approval-requests/${AR_ID}/seen-in-meeting`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'oracle-svc', role: 'admin', email: 'oracle@indelible.bot' });
  mockUpdate.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: AR_ID, ...args.data }));
});

describe('POST /api/approval-requests/[id]/seen-in-meeting', () => {
  it('404s when the row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await POST(req({ excerpt: 'Mike approved it verbally.', at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(404);
  });

  it("flips 'sent' to 'replied' and stamps replied_at/reply_excerpt", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sent', task_id: 'task-1' });
    const res = await POST(req({ excerpt: 'Client said it looks great.', at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'replied',
          reply_excerpt: 'Client said it looks great.',
        }),
      })
    );
    // MEDIUM-4: logs the actual transition.
    expect(mockLogUpdate).toHaveBeenCalledTimes(1);
    expect(mockLogUpdate).toHaveBeenCalledWith(
      'oracle-svc', 'task', 'task-1', 'Approval request',
      { approval_status: { from: 'sent', to: 'replied' } }
    );
  });

  it('never downgrades a row already past sent (e.g. approved) — only seen_in_meeting_at moves, and does not log', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'approved', task_id: 'task-1' });
    await POST(req({ excerpt: 'Mentioned again in standup.', at: '2026-09-04T12:00:00.000Z' }), { params });
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBeUndefined();
    expect(updateArgs.data.seen_in_meeting_at).toBeInstanceOf(Date);
    expect(mockLogUpdate).not.toHaveBeenCalled();
  });

  it('accepts meeting_id without persisting it (not a stored column in this phase)', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sent' });
    const res = await POST(
      req({ meeting_id: '44444444-4444-4444-8444-444444444444', excerpt: 'Approved.', at: '2026-09-04T12:00:00.000Z' }),
      { params }
    );
    expect(res.status).toBe(200);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.meeting_id).toBeUndefined();
  });
});
