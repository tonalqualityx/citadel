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
    clientContact: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

import { POST as APPROVE } from '../[id]/approve/route';
import { POST as REQUEST_CHANGES } from '../[id]/request-changes/route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { recordTaskClientApproval, recordTaskClientRequestChanges, logPortalSession } from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';
import { clientVisibleTaskWhere, stagedTaskWhere } from '@/lib/portal/visibility';
import { taskAccessWhere } from '@/lib/portal/access';

// A task a contact requested and that is staged for approval — the only kind a session may act on.
const STAGED = {
  requested_by_contact_id: 'contact-9',
  staging_preview_url: 'https://staging.example.com/p',
  status: 'review',
};
// Internal work: no requesting contact, nothing staged.
const PUBLISHED = { ...STAGED, status: 'done', approved: true };
const INTERNAL = { requested_by_contact_id: null, staging_preview_url: null, status: 'in_progress' };

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
  // A3: the signed-in contact is an owner of their own client unless a test overrides it.
  (prisma.clientContact.findFirst as Mock).mockResolvedValue({ client_id: 'client-acme', portal_role: 'owner', is_deleted: false });
});

const OWNER_ACCESS = { contactId: 'contact-1', clientId: 'client-acme', role: 'owner' as const };

describe('POST /api/portal/tasks/mine/:id/approve', () => {
  it('returns 401 without a session, before any task lookup', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await APPROVE(postReq('task-1'), makeParams('task-1'));
    expect(res.status).toBe(401);
    expect(mockTaskFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the session client (client_id OR site.client_id)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null, site: { auto_deploy: true }, ...STAGED });
    mockRecordApproval.mockResolvedValue({ already_approved: false, approved_at: new Date(), promotion_pending: false });

    await APPROVE(postReq('task-1'), makeParams('task-1'));

    const where = mockTaskFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe('task-1');
    expect(where.OR).toEqual([{ client_id: 'client-acme' }, { site: { client_id: 'client-acme' } }]);
  });

  it('requires the visibility rule AND staged in the lookup (Leak 2)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null, site: null, ...STAGED });
    mockRecordApproval.mockResolvedValue({ already_approved: false, approved_at: new Date(), promotion_pending: false });

    await APPROVE(postReq('task-1'), makeParams('task-1'));

    expect(mockTaskFindFirst.mock.calls[0][0].where.AND).toEqual([clientVisibleTaskWhere(), stagedTaskWhere(), taskAccessWhere(OWNER_ACCESS)]);
  });

  it('returns 404 and never approves an unstaged internal task, even if the lookup returns it (Leak 2)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-int', client_approved_at: null, site: null, ...INTERNAL });

    const res = await APPROVE(postReq('task-int'), makeParams('task-int'));
    expect(res.status).toBe(404);
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it('returns 404 for already-published work (approved: true) even with a staging url', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-pub', client_approved_at: null, site: null, ...PUBLISHED });

    const res = await APPROVE(postReq('task-pub'), makeParams('task-pub'));
    expect(res.status).toBe(404);
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it('returns 404 on approve for a published, client-approved task with no requester', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({
      id: 'task-hist', client_approved_at: new Date(), site: null,
      requested_by_contact_id: null, staging_preview_url: 'https://s.example', status: 'done', approved: true,
    });

    const res = await APPROVE(postReq('task-hist'), makeParams('task-hist'));
    expect(res.status).toBe(404);
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it('returns 404 for a contact-requested task that is not staged yet', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({
      id: 'task-2', client_approved_at: null, site: null,
      requested_by_contact_id: 'contact-9', staging_preview_url: null, status: 'not_started',
    });

    const res = await APPROVE(postReq('task-2'), makeParams('task-2'));
    expect(res.status).toBe(404);
    expect(mockRecordApproval).not.toHaveBeenCalled();
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
    const task = { id: 'task-1', client_approved_at: null, site: { auto_deploy: true }, ...STAGED };
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
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: new Date(), site: null, ...STAGED });
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

describe('project scope, no role gate on the session routes (Mike ruling overrides spec decision 11)', () => {
  const roleOf = (portal_role: string) =>
    (prisma.clientContact.findFirst as Mock).mockResolvedValue({ client_id: 'client-acme', portal_role, is_deleted: false });

  it('a member in a hidden project gets 404: the lookup carries the project scope and finds nothing', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    roleOf('member');
    mockTaskFindFirst.mockResolvedValue(null); // the DB applies the where; a hidden-project task is not found
    const a = await APPROVE(postReq('task-hidden'), makeParams('task-hidden'));
    const r = await REQUEST_CHANGES(postReq('task-hidden', { note: 'x' }), makeParams('task-hidden'));
    expect(a.status).toBe(404);
    expect(r.status).toBe(404);
    const memberAccess = { contactId: 'contact-1', clientId: 'client-acme', role: 'member' as const };
    for (const call of mockTaskFindFirst.mock.calls) {
      expect(call[0].where.AND).toContainEqual(taskAccessWhere(memberAccess));
    }
    expect(JSON.stringify(taskAccessWhere(memberAccess))).toContain('"not":"hidden"');
    expect(mockRecordApproval).not.toHaveBeenCalled();
    expect(mockRecordRequestChanges).not.toHaveBeenCalled();
  });

  it('a viewer on a visible staged task still succeeds (ruling: any portal user may approve)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    roleOf('viewer');
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null, site: null, ...STAGED });
    mockRecordApproval.mockResolvedValue({ already_approved: false, approved_at: new Date(), promotion_pending: false });
    const res = await APPROVE(postReq('task-1'), makeParams('task-1'));
    expect(res.status).toBe(200);
    expect(mockRecordApproval).toHaveBeenCalled();
  });

  it('a deleted contact matches nothing (revoked scope), so the lookup is closed', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    (prisma.clientContact.findFirst as Mock).mockResolvedValue(null);
    mockTaskFindFirst.mockResolvedValue(null);
    const res = await APPROVE(postReq('task-1'), makeParams('task-1'));
    expect(res.status).toBe(404);
    expect(mockTaskFindFirst.mock.calls[0][0].where.AND).toContainEqual({ id: { in: [] } });
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

  it('returns 404 and records nothing for an unstaged internal task (Leak 2)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-int', client_approved_at: null, ...INTERNAL });

    const res = await REQUEST_CHANGES(postReq('task-int', { note: 'x' }), makeParams('task-int'));
    expect(res.status).toBe(404);
    expect(mockTaskFindFirst.mock.calls[0][0].where.AND).toEqual([clientVisibleTaskWhere(), stagedTaskWhere(), taskAccessWhere(OWNER_ACCESS)]);
    expect(mockRecordRequestChanges).not.toHaveBeenCalled();
  });

  it('rejects an empty note before touching the DB', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null, ...STAGED });

    const res = await REQUEST_CHANGES(postReq('task-1', { note: '' }), makeParams('task-1'));
    expect(res.status).toBe(400);
    expect(mockRecordRequestChanges).not.toHaveBeenCalled();
  });

  it('resolves the acting contact from the session (not a guess) and delegates to the shared function', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: null, ...STAGED });
    mockContactFindUnique.mockResolvedValue({ name: 'Jane' });
    mockRecordRequestChanges.mockResolvedValue(undefined);

    const res = await REQUEST_CHANGES(postReq('task-1', { note: 'too small' }), makeParams('task-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('not_started');
    expect(mockContactFindUnique).toHaveBeenCalledWith({ where: { id: 'contact-1' }, select: { name: true } });
    expect(mockRecordRequestChanges).toHaveBeenCalledWith(
      { id: 'task-1', client_approved_at: null, ...STAGED },
      'too small',
      'Jane',
      'contact-1'
    );
  });

  it('propagates a 400 from the shared function (already approved)', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockTaskFindFirst.mockResolvedValue({ id: 'task-1', client_approved_at: new Date(), ...STAGED });
    mockContactFindUnique.mockResolvedValue({ name: 'Jane' });
    mockRecordRequestChanges.mockRejectedValue(new ApiError('This work has already been approved', 400));

    const res = await REQUEST_CHANGES(postReq('task-1', { note: 'too late' }), makeParams('task-1'));
    expect(res.status).toBe(400);
  });
});
