import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError, ApiError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/services/portal', () => ({
  recordTaskClientApproval: vi.fn(),
  recordTaskClientRequestChanges: vi.fn(),
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '192.168.1.1'),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn() },
    clientContact: { findUnique: vi.fn() },
  },
}));

import { POST as APPROVE } from '../[id]/approve/route';
import { POST as REQUEST_CHANGES } from '../[id]/request-changes/route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { recordTaskClientApproval, recordTaskClientRequestChanges, logPortalSession } from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockRecordApproval = recordTaskClientApproval as Mock;
const mockRecordRequestChanges = recordTaskClientRequestChanges as Mock;
const mockLogPortalSession = logPortalSession as Mock;
const mockTaskFindFirst = prisma.task.findFirst as Mock;
const mockContactFindUnique = prisma.clientContact.findUnique as Mock;

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(id: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/portal/tasks/mine/${id}/x`), {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/portal/tasks/mine/:id/approve', () => {
  it('returns 401 without a session, before any task lookup', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await APPROVE(postReq('task-1'), makeParams('task-1'));
    expect(res.status).toBe(401);
    expect(mockTaskFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the session client (client_id OR site.client_id)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null, site: { auto_deploy: true } });
    mockRecordApproval.mockResolvedValue({ already_approved: false, approved_at: new Date(), promotion_pending: false });

    await APPROVE(postReq('task-1'), makeParams('task-1'));

    const where = mockTaskFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe('task-1');
    expect(where.OR).toEqual([{ client_id: 'client-acme' }, { site: { client_id: 'client-acme' } }]);
  });

  it('returns 404 (not 403) when the task does not belong to this client — no existence leak', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue(null);

    const res = await APPROVE(postReq('task-other-client'), makeParams('task-other-client'));
    expect(res.status).toBe(404);
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it('delegates to the shared approval function with the session contact id', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    const task = { id: 'task-1', client_approved_at: null, site: { auto_deploy: true } };
    mockTaskFindFirst.mockResolvedValue(task);
    mockRecordApproval.mockResolvedValue({
      already_approved: false,
      approved_at: new Date('2026-06-22T12:00:00Z'),
      promotion_pending: false,
    });

    const res = await APPROVE(postReq('task-1'), makeParams('task-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('Approved');
    expect(mockRecordApproval).toHaveBeenCalledWith(task, 'contact-1');
    expect(mockLogPortalSession).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept' }));
  });

  it('is idempotent when already approved', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: new Date(), site: null });
    mockRecordApproval.mockResolvedValue({
      already_approved: true,
      approved_at: new Date('2026-06-20T09:00:00Z'),
      promotion_pending: false,
    });

    const res = await APPROVE(postReq('task-1'), makeParams('task-1'));
    const body = await res.json();

    expect(body.already_approved).toBe(true);
  });
});

describe('POST /api/portal/tasks/mine/:id/request-changes', () => {
  it('returns 401 without a session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await REQUEST_CHANGES(postReq('task-1', { note: 'x' }), makeParams('task-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for a task outside the session client', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue(null);

    const res = await REQUEST_CHANGES(postReq('task-1', { note: 'x' }), makeParams('task-1'));
    expect(res.status).toBe(404);
    expect(mockRecordRequestChanges).not.toHaveBeenCalled();
  });

  it('rejects an empty note before touching the DB', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null });

    const res = await REQUEST_CHANGES(postReq('task-1', { note: '' }), makeParams('task-1'));
    expect(res.status).toBe(400);
    expect(mockRecordRequestChanges).not.toHaveBeenCalled();
  });

  it('resolves the acting contact from the session (not a guess) and delegates to the shared function', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null });
    mockContactFindUnique.mockResolvedValue({ name: 'Jane' });
    mockRecordRequestChanges.mockResolvedValue(undefined);

    const res = await REQUEST_CHANGES(postReq('task-1', { note: 'too small' }), makeParams('task-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('not_started');
    expect(mockContactFindUnique).toHaveBeenCalledWith({ where: { id: 'contact-1' }, select: { name: true } });
    expect(mockRecordRequestChanges).toHaveBeenCalledWith(
      { id: 'task-1', client_approved_at: null },
      'too small',
      'Jane'
    );
  });

  it('propagates a 400 from the shared function (already approved)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: new Date() });
    mockContactFindUnique.mockResolvedValue({ name: 'Jane' });
    mockRecordRequestChanges.mockRejectedValue(new ApiError('This work has already been approved', 400));

    const res = await REQUEST_CHANGES(postReq('task-1', { note: 'too late' }), makeParams('task-1'));
    expect(res.status).toBe(400);
  });
});
