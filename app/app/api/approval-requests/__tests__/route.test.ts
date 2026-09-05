import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST, GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    clientContact: { findUnique: vi.fn() },
    approvalRequest: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockContactFindUnique = prisma.clientContact.findUnique as Mock;
const mockApprovalRequestCreate = prisma.approvalRequest.create as Mock;
const mockApprovalRequestFindMany = prisma.approvalRequest.findMany as Mock;

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/approval-requests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function getReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/approval-requests${qs}`);
}

const createdRow = {
  id: 'ar-1',
  task_id: '11111111-1111-1111-8111-111111111111',
  task: { id: '11111111-1111-1111-8111-111111111111', title: 'Homepage copy' },
  project_id: '33333333-3333-3333-8333-333333333333',
  contact_id: null,
  contact: null,
  status: 'draft',
  subject: 'Ready for your approval: Homepage copy',
  body: 'Hi,\n\nHomepage copy is ready for your review.\n\nLet me know if this works, or if you would like changes.\n\nMike',
  to_email: null,
  draft_source: 'graph',
  message_id: null,
  thread_id: null,
  sent_at: null,
  replied_at: null,
  reply_excerpt: null,
  chase_after_days: 3,
  seen_in_meeting_at: null,
  queued_at: null,
  queued_by_id: null,
  cancelled_at: null,
  approved_at: null,
  changes_requested_at: null,
  send_error: null,
  send_error_count: 0,
  created_by_id: 'mike-1',
  created_at: new Date('2026-09-04T00:00:00.000Z'),
  updated_at: new Date('2026-09-04T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockTaskFindUnique.mockResolvedValue({
    id: '11111111-1111-1111-8111-111111111111',
    title: 'Homepage copy',
    project_id: '33333333-3333-3333-8333-333333333333',
    staging_preview_url: null,
  });
  mockProjectFindUnique.mockResolvedValue({ client_id: 'client-1' });
  mockContactFindUnique.mockResolvedValue({ id: '22222222-2222-2222-8222-222222222222', client_id: 'client-1', is_deleted: false });
  mockApprovalRequestCreate.mockResolvedValue(createdRow);
  mockApprovalRequestFindMany.mockResolvedValue([]);
});

describe('POST /api/approval-requests', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111' }));
    expect(res.status).toBe(403);
  });

  it('404s when the task does not exist', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111' }));
    expect(res.status).toBe(404);
  });

  it('400s when the task has no project', async () => {
    mockTaskFindUnique.mockResolvedValue({ id: '11111111-1111-1111-8111-111111111111', title: 'x', project_id: null, staging_preview_url: null });
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111' }));
    expect(res.status).toBe(400);
  });

  it('builds a server-side draft (subject/body omitted) with draft_source graph', async () => {
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111' }));
    expect(res.status).toBe(201);
    expect(mockApprovalRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          task_id: '11111111-1111-1111-8111-111111111111',
          project_id: '33333333-3333-3333-8333-333333333333',
          draft_source: 'graph',
          subject: expect.stringContaining('Homepage copy'),
        }),
      })
    );
  });

  it('embeds the deliverable link in the template body when staging_preview_url is present', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: '11111111-1111-1111-8111-111111111111',
      title: 'Homepage copy',
      project_id: '33333333-3333-3333-8333-333333333333',
      staging_preview_url: 'https://staging.example.com/preview',
    });
    await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111' }));
    const call = mockApprovalRequestCreate.mock.calls[0][0];
    expect(call.data.body).toContain('https://staging.example.com/preview');
  });

  it('honors a caller-supplied subject/body with no draft_source', async () => {
    await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111', subject: 'Check this out', body: 'Please take a look.' }));
    expect(mockApprovalRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: 'Check this out', body: 'Please take a look.', draft_source: null }),
      })
    );
  });

  it('422s when the supplied body fails the dash-law lint', async () => {
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111', subject: 'Check this out', body: 'Please review — thanks.' }));
    expect(res.status).toBe(422);
    expect(mockApprovalRequestCreate).not.toHaveBeenCalled();
  });

  it('404s when contact_id is not a contact on the task\'s client', async () => {
    mockContactFindUnique.mockResolvedValue({ id: '22222222-2222-2222-8222-222222222222', client_id: 'OTHER-CLIENT', is_deleted: false });
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111', contact_id: '22222222-2222-2222-8222-222222222222' }));
    expect(res.status).toBe(404);
  });

  it('accepts a valid contact_id on the task\'s client', async () => {
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111', contact_id: '22222222-2222-2222-8222-222222222222' }));
    expect(res.status).toBe(201);
    expect(mockApprovalRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contact_id: '22222222-2222-2222-8222-222222222222' }) })
    );
  });

  // Spec polish (2026-09-04) — 'chase' rows, queued off an overdue client_approval
  // blocker's chase_draft/chase_target (BlockerRow.tsx's "Queue chase from my Gmail").
  it('defaults kind to "approval" when omitted', async () => {
    await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111' }));
    expect(mockApprovalRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'approval' }) })
    );
  });

  it('accepts kind: "chase"', async () => {
    const res = await POST(
      postReq({
        task_id: '11111111-1111-1111-8111-111111111111',
        subject: 'Following up: Homepage copy',
        body: 'Checking in on this.',
        kind: 'chase',
      })
    );
    expect(res.status).toBe(201);
    expect(mockApprovalRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'chase' }) })
    );
  });

  it('400s on an invalid kind value', async () => {
    const res = await POST(postReq({ task_id: '11111111-1111-1111-8111-111111111111', kind: 'bogus' }));
    expect(res.status).toBe(400);
    expect(mockApprovalRequestCreate).not.toHaveBeenCalled();
  });
});

describe('GET /api/approval-requests', () => {
  it('requires PM or Admin role (H2 security fix)', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  it('400s on an invalid status', async () => {
    const res = await GET(getReq('?status=bogus'));
    expect(res.status).toBe(400);
  });

  it('filters by status', async () => {
    await GET(getReq('?status=queued'));
    expect(mockApprovalRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'queued' } })
    );
  });

  it('filters by task_id', async () => {
    await GET(getReq('?task_id=11111111-1111-1111-8111-111111111111'));
    expect(mockApprovalRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { task_id: '11111111-1111-1111-8111-111111111111' } })
    );
  });

  it('filters by thread_id', async () => {
    await GET(getReq('?thread_id=thread-abc'));
    expect(mockApprovalRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { thread_id: 'thread-abc' } })
    );
  });

  it('returns an empty list with no filters', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.requests).toEqual([]);
  });
});
