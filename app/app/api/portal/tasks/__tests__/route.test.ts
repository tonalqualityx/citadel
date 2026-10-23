import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/errors';

vi.mock('@/lib/services/portal', () => ({
  validateTaskToken: vi.fn(),
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '192.168.1.1'),
  resolveTaskContact: vi.fn(),
  listContactSites: vi.fn(),
  getBastUserId: vi.fn(),
  recordTaskClientApproval: vi.fn(),
  recordTaskClientRequestChanges: vi.fn(),
  recordUnattributedSendBack: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { update: vi.fn(), create: vi.fn() },
    comment: { create: vi.fn() },
    site: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

import { GET } from '../[token]/route';
import { POST as APPROVE } from '../[token]/approve/route';
import { POST as REQUEST_CHANGES } from '../[token]/request-changes/route';
import { POST as NEW_TASK } from '../[token]/new-task/route';
import {
  validateTaskToken,
  logPortalSession,
  resolveTaskContact,
  listContactSites,
  getBastUserId,
  recordTaskClientApproval,
  recordTaskClientRequestChanges,
  recordUnattributedSendBack,
} from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';
// The view-as guard has its own tests (lib/portal/__tests__/view-as*.test.ts); here it is a pass-through.
vi.mock('@/lib/portal/view-as-guard', () => ({ refuseIfViewAs: vi.fn(async () => null) }));

const mockValidateTaskToken = validateTaskToken as Mock;
const mockLogPortalSession = logPortalSession as Mock;
const mockResolveTaskContact = resolveTaskContact as Mock;
const mockListContactSites = listContactSites as Mock;
const mockGetBastUserId = getBastUserId as Mock;
const mockRecordTaskClientApproval = recordTaskClientApproval as Mock;
const mockRecordTaskClientRequestChanges = recordTaskClientRequestChanges as Mock;
const mockRecordUnattributedSendBack = recordUnattributedSendBack as Mock;

const mockPortalTask = {
  id: 'task-123',
  title: 'Homepage refresh',
  description: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Updated hero copy.' }] },
  ],
  status: 'review',
  estimated_minutes: 90,
  staging_preview_url: 'https://staging.example.com/preview',
  staging_deployed_at: new Date('2026-06-21T10:00:00Z'),
  client_approved_at: null,
  is_deleted: false,
  portal_token: 'valid-token-123',
  portal_token_expires_at: new Date(Date.now() + 86400000),
  client_id: 'client-1',
  site: { id: 'site-1', name: 'Acme', auto_deploy: true, client_id: 'client-1' },
  requested_by_contact: { id: 'contact-1', name: 'Jane', email: 'jane@acme.com', client_id: 'client-1' },
  comments: [
    {
      id: 'c1',
      content: 'Ready for your review.',
      is_internal: false,
      created_at: new Date('2026-06-21T11:00:00Z'),
      user: { id: 'u1', name: 'Bast' },
    },
  ],
};

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), options as any);
}

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function postReq(token: string, body?: unknown): NextRequest {
  return makeRequest(`http://localhost/api/portal/tasks/${token}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveTaskContact.mockResolvedValue({
    id: 'contact-1',
    name: 'Jane',
    email: 'jane@acme.com',
    client_id: 'client-1',
  });
  mockListContactSites.mockResolvedValue([{ id: 'site-1', name: 'Acme' }]);
  mockGetBastUserId.mockResolvedValue('bast-user');
});

describe('GET /api/portal/tasks/:token', () => {
  it('returns the client-projected task and preview for a valid token', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task.id).toBe('task-123');
    expect(data.task.title).toBe('Homepage refresh');
    expect(data.task.status).toBe('review');
    expect(data.task).not.toHaveProperty('estimated_minutes');
    expect(data.task.comments).toHaveLength(1);
    expect(data.task.comments[0].content).toBe('Ready for your review.');
    expect(data.task.comments[0].author_name).toBe('Bast');
    expect(data.staging_preview_url).toBe('https://staging.example.com/preview');
    expect(data.already_approved).toBe(false);
    expect(mockValidateTaskToken).toHaveBeenCalledWith('valid-token');
  });

  it('can_request_changes is true only when the link has its own contact', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    const own = await (await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'))).json();
    expect(own.can_request_changes).toBe(true);

    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, requested_by_contact: null });
    const none = await (await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'))).json();
    expect(none.can_request_changes).toBe(false);

    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, requested_by_contact: { ...mockPortalTask.requested_by_contact, is_deleted: true } });
    const gone = await (await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'))).json();
    expect(gone.can_request_changes).toBe(false);
  });

  it('includes the resolved contact and available sites for the new-task form', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.contact).toEqual({ id: 'contact-1', name: 'Jane' });
    expect(data.available_sites).toEqual([{ id: 'site-1', name: 'Acme' }]);
  });

  it('returns null contact and no sites when none resolves', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    mockResolveTaskContact.mockResolvedValue(null);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.contact).toBeNull();
    expect(data.available_sites).toEqual([]);
    expect(mockListContactSites).not.toHaveBeenCalled();
  });

  it('does not leak internal task fields through the projection', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.task.is_deleted).toBeUndefined();
    expect(data.task.portal_token).toBeUndefined();
  });

  it('reports already_approved when the task has a client approval timestamp', async () => {
    mockValidateTaskToken.mockResolvedValue({
      ...mockPortalTask,
      client_approved_at: new Date('2026-06-20T09:00:00Z'),
    });

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.already_approved).toBe(true);
  });

  it('returns 404 for an invalid/expired token', async () => {
    mockValidateTaskToken.mockResolvedValue(null);

    const response = await GET(makeRequest('http://localhost/api/portal/tasks/bad-token'), makeParams('bad-token'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Approval link not found or has expired');
  });

  it('logs a task_approval view session on success', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    await GET(makeRequest('http://localhost/api/portal/tasks/valid-token'), makeParams('valid-token'));

    expect(mockLogPortalSession).toHaveBeenCalledWith({
      tokenType: 'task_approval',
      entityId: 'task-123',
      ipAddress: '192.168.1.1',
      userAgent: null,
      action: 'view',
    });
  });
});

// APPROVE/REQUEST_CHANGES mutation logic now lives in the shared
// recordTaskClientApproval()/recordTaskClientRequestChanges() (lib/services/portal.ts), reused
// by both the token flow (these routes) and the session flow (app/api/portal/tasks/[id]/*). These
// two describe blocks assert the ROUTE wires token validation + the shared function correctly;
// the shared function's own mutation behavior (prisma calls, idempotency, promotion-pending) is
// unit-tested directly in lib/services/__tests__/portal.test.ts.
describe('POST /api/portal/tasks/:token/approve', () => {
  it('resolves the contact and delegates to the shared approval function', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    mockRecordTaskClientApproval.mockResolvedValue({
      already_approved: false,
      approved_at: new Date('2026-06-22T12:00:00Z'),
      promotion_pending: false,
    });

    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Approved');
    expect(data.promotion_pending).toBe(false);
    expect(mockRecordTaskClientApproval).toHaveBeenCalledWith(mockPortalTask, 'contact-1', 'approval_link', null);
    expect(mockLogPortalSession).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept' }));
  });

  it('is idempotent when already approved', async () => {
    mockValidateTaskToken.mockResolvedValue({
      ...mockPortalTask,
      client_approved_at: new Date('2026-06-20T09:00:00Z'),
    });
    mockRecordTaskClientApproval.mockResolvedValue({
      already_approved: true,
      approved_at: new Date('2026-06-20T09:00:00Z'),
      promotion_pending: false,
    });

    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.already_approved).toBe(true);
    expect(data.message).toBe('Already approved');
  });

  it('surfaces promotion_pending from the shared function for staged client sites', async () => {
    mockValidateTaskToken.mockResolvedValue({
      ...mockPortalTask,
      site: { id: 'site-1', name: 'Acme', auto_deploy: false, client_id: 'client-1' },
    });
    mockRecordTaskClientApproval.mockResolvedValue({
      already_approved: false,
      approved_at: new Date('2026-06-22T12:00:00Z'),
      promotion_pending: true,
    });

    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    const data = await response.json();

    expect(data.promotion_pending).toBe(true);
    expect(mockLogPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ promotion_pending: true }) })
    );
  });

  it('returns 404 and records nothing for a task that is no longer staged (sent back for changes)', async () => {
    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, status: 'not_started' });

    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientApproval).not.toHaveBeenCalled();
  });

  it('returns 404 for already-published work with no client approval timestamp', async () => {
    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, approved: true });

    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientApproval).not.toHaveBeenCalled();
  });

  it('returns 404 for an invalid token', async () => {
    mockValidateTaskToken.mockResolvedValue(null);

    const response = await APPROVE(postReq('bad'), makeParams('bad'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientApproval).not.toHaveBeenCalled();
  });
});

describe('deleted requester revokes the token (no primary-contact fallback)', () => {
  const deletedTask = {
    ...mockPortalTask,
    requested_by_contact: { ...mockPortalTask.requested_by_contact, is_deleted: true },
  };

  it('approve returns 404 and records nothing', async () => {
    mockValidateTaskToken.mockResolvedValue(deletedTask);
    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientApproval).not.toHaveBeenCalled();
  });

  it('request-changes returns 404 and records nothing', async () => {
    mockValidateTaskToken.mockResolvedValue(deletedTask);
    const response = await REQUEST_CHANGES(postReq('valid-token', { note: 'x' }), makeParams('valid-token'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientRequestChanges).not.toHaveBeenCalled();
  });

  it('new-task returns 400 and files nothing (resolveTaskContact yields null for a deleted requester)', async () => {
    mockValidateTaskToken.mockResolvedValue(deletedTask);
    mockResolveTaskContact.mockResolvedValue(null);
    const response = await NEW_TASK(
      postReq('valid-token', { title: 'X', site_id: '11111111-1111-4111-8111-111111111111' }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(400);
    expect((prisma.task.create as Mock)).not.toHaveBeenCalled();
  });
});

describe('no role gate on the token routes (Mike ruling overrides spec decision 11)', () => {
  it('a viewer-role requester can still approve', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    mockResolveTaskContact.mockResolvedValue({ id: 'contact-1', name: 'Jane', email: 'j@a.com', client_id: 'client-1', portal_role: 'viewer' });
    mockRecordTaskClientApproval.mockResolvedValue({ already_approved: false, approved_at: new Date(), promotion_pending: false });
    const response = await APPROVE(postReq('valid-token'), makeParams('valid-token'));
    expect(response.status).toBe(200);
    expect(mockRecordTaskClientApproval).toHaveBeenCalled();
  });

  it('a viewer-role requester can still request changes', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    mockResolveTaskContact.mockResolvedValue({ id: 'contact-1', name: 'Jane', email: 'j@a.com', client_id: 'client-1', portal_role: 'viewer' });
    const response = await REQUEST_CHANGES(postReq('valid-token', { note: 'x' }), makeParams('valid-token'));
    expect(response.status).toBe(200);
    expect(mockRecordTaskClientRequestChanges).toHaveBeenCalled();
  });
});

describe('POST /api/portal/tasks/:token/request-changes', () => {
  it('a link with no contact never writes under the primary contact: the note is saved for staff instead of lost', async () => {
    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, requested_by_contact: null });
    mockResolveTaskContact.mockResolvedValue({ id: 'primary', name: 'Pat Primary', email: 'p@a.com', client_id: 'client-1' });
    const response = await REQUEST_CHANGES(postReq('valid-token', { note: 'Please fix the logo' }), makeParams('valid-token'));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('not_started');
    expect(mockRecordTaskClientRequestChanges).not.toHaveBeenCalled();
    expect(mockRecordUnattributedSendBack).toHaveBeenCalledWith(expect.objectContaining({ id: mockPortalTask.id }), 'Please fix the logo');
    expect(mockLogPortalSession).toHaveBeenCalledWith(expect.objectContaining({ action: 'changes_requested', metadata: { contact_id: null, unattributed: true } }));
  });

  it('resolves the contact and delegates to the shared request-changes function', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    mockRecordTaskClientRequestChanges.mockResolvedValue(undefined);

    const response = await REQUEST_CHANGES(
      postReq('valid-token', { note: 'The logo is too small' }),
      makeParams('valid-token')
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('not_started');
    expect(mockRecordTaskClientRequestChanges).toHaveBeenCalledWith(
      mockPortalTask,
      'The logo is too small',
      'Jane',
      'contact-1'
    );
    expect(mockLogPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'changes_requested' })
    );
  });

  it('returns 404 and records nothing for a task that is no longer staged', async () => {
    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, status: 'not_started' });

    const response = await REQUEST_CHANGES(
      postReq('valid-token', { note: 'again' }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientRequestChanges).not.toHaveBeenCalled();
  });

  it('returns 404 for already-published work (approved: true)', async () => {
    mockValidateTaskToken.mockResolvedValue({ ...mockPortalTask, approved: true });

    const response = await REQUEST_CHANGES(
      postReq('valid-token', { note: 'x' }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientRequestChanges).not.toHaveBeenCalled();
  });

  it('rejects an empty note before calling the shared function', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);

    const response = await REQUEST_CHANGES(
      postReq('valid-token', { note: '' }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(400);
    expect(mockRecordTaskClientRequestChanges).not.toHaveBeenCalled();
  });

  it('propagates the 400 the shared function throws when already approved', async () => {
    mockValidateTaskToken.mockResolvedValue({
      ...mockPortalTask,
      client_approved_at: new Date('2026-06-20T09:00:00Z'),
    });
    mockRecordTaskClientRequestChanges.mockRejectedValue(
      new ApiError('This work has already been approved', 400)
    );

    const response = await REQUEST_CHANGES(
      postReq('valid-token', { note: 'too late' }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 for an invalid token', async () => {
    mockValidateTaskToken.mockResolvedValue(null);

    const response = await REQUEST_CHANGES(postReq('bad', { note: 'x' }), makeParams('bad'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientRequestChanges).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/tasks/:token/new-task', () => {
  const SITE_ID = '11111111-1111-4111-8111-111111111111';

  it('creates a not_started task routed to Bast with client provenance', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    (prisma.site.findFirst as Mock).mockResolvedValue({ id: SITE_ID, client_id: 'client-1' });
    (prisma.task.create as Mock).mockResolvedValue({ id: 'new-task', title: 'Add a blog', status: 'not_started' });

    const response = await NEW_TASK(
      postReq('valid-token', { title: 'Add a blog', description: 'Please add a blog section', site_id: SITE_ID }),
      makeParams('valid-token')
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.task.id).toBe('new-task');
    expect((prisma.task.create as Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'not_started',
          source: 'portal',
          requested_by_contact_id: 'contact-1',
          assignee_id: 'bast-user',
          site_id: SITE_ID,
          client_id: 'client-1',
        }),
      })
    );
  });

  it('rejects a site outside the contact\'s client', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    (prisma.site.findFirst as Mock).mockResolvedValue(null);

    const response = await NEW_TASK(
      postReq('valid-token', { title: 'X', site_id: '22222222-2222-4222-8222-222222222222' }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(400);
    expect((prisma.task.create as Mock)).not.toHaveBeenCalled();
  });

  it('rejects when no contact resolves', async () => {
    mockValidateTaskToken.mockResolvedValue(mockPortalTask);
    mockResolveTaskContact.mockResolvedValue(null);

    const response = await NEW_TASK(
      postReq('valid-token', { title: 'X', site_id: SITE_ID }),
      makeParams('valid-token')
    );
    expect(response.status).toBe(400);
  });

  it('returns 404 for an invalid token', async () => {
    mockValidateTaskToken.mockResolvedValue(null);

    const response = await NEW_TASK(postReq('bad', { title: 'X', site_id: SITE_ID }), makeParams('bad'));
    expect(response.status).toBe(404);
  });
});
