import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PUT } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logActivity: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logActivity } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockLogActivity = logActivity as Mock;

const PROJECT_ID = 'project-1';
const params = Promise.resolve({ id: PROJECT_ID });

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/projects/${PROJECT_ID}/next-step/write`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    text: 'Mike needs to approve the homepage copy.',
    source: 'bast',
    generated_at: '2026-09-04T03:00:00.000Z',
    model: 'sonnet',
    cost_usd: 0.03,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'bot-1', role: 'admin', email: 'oracle@indelible.bot' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Herba rebuild', next_step_source: null });
  mockProjectUpdate.mockResolvedValue({
    next_step_text: 'Mike needs to approve the homepage copy.',
    next_step_owner: null,
    next_step_owner_label: null,
    next_step_source: 'bast',
    next_step_at: new Date('2026-09-04T03:00:00.000Z'),
    email_summary: null,
  });
  mockUserFindUnique.mockResolvedValue({ id: 'user-1' });
});

describe('PUT /api/oracle/projects/[id]/next-step/write', () => {
  it('requires PM or Admin role (H2 security fix)', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await PUT(req(validBody()), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await PUT(req(validBody()), { params });
    expect(res.status).toBe(404);
  });

  it('writes next_step_source=bast when there is no current mike override', async () => {
    const res = await PUT(req(validBody()), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(true);
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          next_step_text: 'Mike needs to approve the homepage copy.',
          next_step_source: 'bast',
          next_step_refresh_requested_at: null,
        }),
      })
    );
  });

  it("skips writing next_step_* when Mike's override is in place, but still writes email_summary", async () => {
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Herba rebuild', next_step_source: 'mike' });
    const res = await PUT(req(validBody({ email_summary: 'Client approved the homepage copy.' })), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(false);

    const call = mockProjectUpdate.mock.calls[0][0];
    expect(call.data.next_step_text).toBeUndefined();
    expect(call.data.next_step_source).toBeUndefined();
    expect(call.data.email_summary).toBe('Client approved the homepage copy.');
    expect(call.data.next_step_refresh_requested_at).toBeNull();
  });

  it('clears next_step_refresh_requested_at even when the override is in place', async () => {
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Herba rebuild', next_step_source: 'mike' });
    await PUT(req(validBody()), { params });
    const call = mockProjectUpdate.mock.calls[0][0];
    expect(call.data.next_step_refresh_requested_at).toBeNull();
  });

  it('HIGH-2: leaves email_summary untouched in the update payload when the key is absent from the body', async () => {
    await PUT(req(validBody()), { params }); // validBody() never sets email_summary
    const call = mockProjectUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('email_summary');
    expect(call.data).not.toHaveProperty('email_summary_at');
  });

  it('HIGH-2: clears email_summary when the key is explicitly sent as null', async () => {
    await PUT(req(validBody({ email_summary: null })), { params });
    const call = mockProjectUpdate.mock.calls[0][0];
    expect(call.data.email_summary).toBeNull();
    expect(call.data.email_summary_at).toBeNull();
  });

  it('HIGH-2: writes email_summary when the key is sent with a string value', async () => {
    await PUT(req(validBody({ email_summary: 'Client confirmed the launch date.' })), { params });
    const call = mockProjectUpdate.mock.calls[0][0];
    expect(call.data.email_summary).toBe('Client confirmed the launch date.');
    expect(call.data.email_summary_at).toBeInstanceOf(Date);
  });

  it('422s with violations when next_step_text fails the writing-standard lint', async () => {
    const res = await PUT(req(validBody({ text: 'Waiting on gate B6 to clear.' })), { params });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations.length).toBeGreaterThan(0);
    expect(mockProjectUpdate).not.toHaveBeenCalled();
  });

  it('422s with violations when email_summary fails the writing-standard lint', async () => {
    const res = await PUT(req(validBody({ email_summary: 'Client replied — approved.' })), { params });
    expect(res.status).toBe(422);
    expect(mockProjectUpdate).not.toHaveBeenCalled();
  });

  it('rejects both owner_id and owner_label together', async () => {
    const res = await PUT(
      req(validBody({ owner_id: '11111111-1111-1111-8111-111111111111', owner_label: 'Andy (client)' })),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it('404s when owner_id does not resolve to a user', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await PUT(req(validBody({ owner_id: '11111111-1111-1111-8111-111111111111' })), { params });
    expect(res.status).toBe(404);
  });

  it('rejects a source other than bast', async () => {
    const res = await PUT(req(validBody({ source: 'graph' })), { params });
    expect(res.status).toBe(400);
  });

  it('logs the write with the model and cost', async () => {
    await PUT(req(validBody()), { params });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          next_step_refresh: expect.objectContaining({
            to: expect.objectContaining({ model: 'sonnet', cost_usd: 0.03 }),
          }),
        }),
      })
    );
  });
});
