import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/services/portal', () => ({
  ensureTaskPortalToken: vi.fn(),
  resolveTaskContact: vi.fn(),
}));

vi.mock('@/lib/services/email', () => ({
  sendTaskApprovalRequestEmail: vi.fn(),
}));

import { POST } from '../route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { ensureTaskPortalToken, resolveTaskContact } from '@/lib/services/portal';
import { sendTaskApprovalRequestEmail } from '@/lib/services/email';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockRequireRole = requireRole as Mock;
const mockFindUnique = prisma.task.findUnique as Mock;
const mockEnsureToken = ensureTaskPortalToken as Mock;
const mockResolveContact = resolveTaskContact as Mock;
const mockSendEmail = sendTaskApprovalRequestEmail as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/tasks/task-1/notify-requestor'), { method: 'POST' } as any);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const taskRow = {
  id: 'task-1',
  is_deleted: false,
  title: 'Homepage hero update',
  staging_preview_url: 'https://staging.acme.com/preview',
  client_id: 'client-1',
  requested_by_contact: { id: 'c1', name: 'Jane', email: 'jane@acme.com', client_id: 'client-1' },
  site: { client_id: 'client-1' },
};

describe('POST /api/tasks/:id/notify-requestor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@test.com' });
    mockRequireRole.mockReturnValue(undefined);
  });

  it('emails the requestor with both links and returns them', async () => {
    mockFindUnique.mockResolvedValue(taskRow);
    mockResolveContact.mockResolvedValue(taskRow.requested_by_contact);
    mockEnsureToken.mockResolvedValue({
      token: 'tok',
      expiresAt: new Date('2026-08-20T00:00:00Z'),
      url: 'https://citadel.becomeindelible.com/portal/task-approval/tok',
    });

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sent).toBe(true);
    expect(data.to).toBe('jane@acme.com');
    expect(data.approval_url).toContain('/portal/task-approval/tok');
    expect(data.staging_url).toBe('https://staging.acme.com/preview');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@acme.com',
        approvalUrl: 'https://citadel.becomeindelible.com/portal/task-approval/tok',
        taskTitle: 'Homepage hero update',
        contactName: 'Jane',
        stagingUrl: 'https://staging.acme.com/preview',
      })
    );
  });

  it('returns 404 when the task is missing or deleted', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Task not found');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 422 when no requestor contact email can be resolved', async () => {
    mockFindUnique.mockResolvedValue({ ...taskRow, requested_by_contact: null });
    mockResolveContact.mockResolvedValue(null);

    const response = await POST(makeRequest(), makeParams('task-1'));
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toContain('No requestor contact email');
    expect(mockEnsureToken).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
