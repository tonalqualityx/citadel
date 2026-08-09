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
} from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockValidateTaskToken = validateTaskToken as Mock;
const mockLogPortalSession = logPortalSession as Mock;
const mockResolveTaskContact = resolveTaskContact as Mock;
const mockListContactSites = listContactSites as Mock;
const mockGetBastUserId = getBastUserId as Mock;
const mockRecordTaskClientApproval = recordTaskClientApproval as Mock;
const mockRecordTaskClientRequestChanges = recordTaskClientRequestChanges as Mock;

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
    expect(data.task.estimated_minutes).toBe(90);
    expect(data.task.comments).toHaveLength(1);
    expect(data.task.comments[0].content).toBe('Ready for your review.');
    expect(data.task.comments[0].author_name).toBe('Bast');
    expect(data.staging_preview_url).toBe('https://staging.example.com/preview');
    expect(data.already_approved).toBe(false);
    expect(mockValidateTaskToken).toHaveBeenCalledWith('valid-token');
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
    expect(mockRecordTaskClientApproval).toHaveBeenCalledWith(mockPortalTask, 'contact-1');
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

  it('returns 404 for an invalid token', async () => {
    mockValidateTaskToken.mockResolvedValue(null);

    const response = await APPROVE(postReq('bad'), makeParams('bad'));
    expect(response.status).toBe(404);
    expect(mockRecordTaskClientApproval).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/tasks/:token/request-changes', () => {
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
      'Jane'
    );
    expect(mockLogPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'changes_requested' })
    );
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
