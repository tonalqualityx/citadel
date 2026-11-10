import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const BAST = 'ca5335e7-0000-4000-8000-000000000002';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    bastChatSettings: { findUnique: vi.fn() },
    task: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    project: { findUnique: vi.fn() },
    arc: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    function: { findUnique: vi.fn() },
    sop: { findUnique: vi.fn() },
    charter: { findUnique: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/api/formatters', () => ({ formatTaskResponse: vi.fn((t) => t) }));
vi.mock('@/lib/services/activity', () => ({ logCreate: vi.fn(), logUpdate: vi.fn() }));
vi.mock('@/lib/services/notifications', () => ({ notifyTaskAssigned: vi.fn() }));

import { POST } from '../route';
import { PATCH } from '../[id]/route';
import { requireAuth } from '@/lib/auth/middleware';
import type { AuthPayload } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const authMock = vi.mocked(requireAuth);
const db = vi.mocked(prisma, true);

const as = <T>(o: object) => o as T;
const chat = as<AuthPayload>({ userId: BAST, role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true });
const req = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/tasks', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) };

beforeEach(() => {
  vi.clearAllMocks();
  db.bastChatSettings.findUnique.mockResolvedValue(as<never>({ owner_user_id: OWNER }));
});

describe('POST /api/tasks as the chat lane', () => {
  it('refuses a forbidden field with 403 and writes nothing', async () => {
    authMock.mockResolvedValue(chat);
    const res = await POST(req('POST', { title: 't', assignee_id: OWNER, tags: ['from-chat'], client_approved_at: '2026-11-10T00:00:00.000Z' }));
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.code).toBe('chat_field_refused');
    expect(j.error).toContain('client_approved_at');
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it('refuses assigning to Bast', async () => {
    authMock.mockResolvedValue(chat);
    const res = await POST(req('POST', { title: 't', assignee_id: BAST, tags: ['from-chat'] }));
    expect(res.status).toBe(403);
    expect(db.task.create).not.toHaveBeenCalled();
  });

  it('refuses a chat key that is not enforced', async () => {
    authMock.mockResolvedValue({ ...chat, laneEnforced: false });
    const res = await POST(req('POST', { title: 't', assignee_id: OWNER, tags: ['from-chat'] }));
    expect(res.status).toBe(403);
    expect(db.task.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tasks/:id as the chat lane', () => {
  it('refuses client_approved_at and a task that is not the owner\'s, with no write', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(as<never>({ id: 'x', status: 'review', assignee_id: OWNER, is_deleted: false, project: null }));
    const r1 = await PATCH(req('PATCH', { client_approved_at: '2026-11-10T00:00:00.000Z' }), ctx);
    expect(r1.status).toBe(403);
    expect((await r1.json()).error).toContain('client_approved_at');

    db.task.findUnique.mockResolvedValue(as<never>({ id: 'x', status: 'review', assignee_id: BAST, is_deleted: false, project: null }));
    const r2 = await PATCH(req('PATCH', { title: 'x' }), ctx);
    expect(r2.status).toBe(403);
    expect((await r2.json()).code).toBe('chat_not_owner_task');
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('refuses assigning to Bast before any write', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(as<never>({ id: 'x', status: 'not_started', assignee_id: OWNER, is_deleted: false, project: null }));
    const res = await PATCH(req('PATCH', { assignee_id: BAST }), ctx);
    expect(res.status).toBe(403);
    expect(db.task.update).not.toHaveBeenCalled();
  });
});

describe('other callers are not filtered', () => {
  it('does not read chat settings for a non-chat POST and PATCH', async () => {
    authMock.mockResolvedValue(as<AuthPayload>({ userId: 'u', role: 'admin', via: 'session' }));
    db.task.create.mockResolvedValue(as<never>({ id: 'n', title: 't' }));
    await POST(req('POST', { title: 't', client_approved_at: '2026-11-10T00:00:00.000Z', tags: ['x'] }));
    expect(db.bastChatSettings.findUnique).not.toHaveBeenCalled();
    db.task.findUnique.mockResolvedValue(as<never>({ id: 'x', status: 'not_started', assignee_id: BAST, is_deleted: false, project: null }));
    await PATCH(req('PATCH', { assignee_id: BAST }), ctx);
    expect(db.bastChatSettings.findUnique).not.toHaveBeenCalled();
  });
});
