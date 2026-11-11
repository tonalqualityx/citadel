import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// patchTask (lib/services/task-patch.ts): the core of PATCH /api/tasks/:id. These pin the two things the
// move adds or must keep: with no `expect` the Prisma write is exactly the route's (where, data, include),
// and with `expect` the write is a compare-and-set whose miss is a typed changed_since result with no side
// effects after it.

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    emailAsk: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    arc: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/services/activity', () => ({ logStatusChange: vi.fn() }));
vi.mock('@/lib/services/notifications', () => ({ notifyTaskAssigned: vi.fn() }));
vi.mock('@/lib/services/dependencies', () => ({
  unblockEligibleDependents: vi.fn(),
  reblockDependents: vi.fn(),
  areBlockersSatisfied: vi.fn(async () => true),
  wouldCreateCycle: vi.fn(async () => false),
}));
vi.mock('@/lib/portal/waits', () => ({ onTaskProgress: vi.fn() }));
vi.mock('@/lib/sends/claims', () => ({ clearPreviewClaims: vi.fn() }));
vi.mock('@/lib/tasks/claims', () => ({
  assertClaimHeld: vi.fn(async () => ({ overridden_holder: null, logOverride: vi.fn(async () => undefined) })),
  CLEAR_CLAIM_DATA: { claim_holder: null, claim_token: null, claimed_at: null, lease_until: null },
}));
vi.mock('@/lib/portal/receipts', () => ({
  voidApprovalIfRestaged: vi.fn(async () => ({ voided: false })),
  stampApproval: vi.fn(),
  getApprovalBindingMode: vi.fn(async () => 'off'),
}));
vi.mock('@/lib/bast-chat/task-record', () => ({ recordChatPatch: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import type { AuthPayload } from '@/lib/auth/middleware';
import { logStatusChange } from '@/lib/services/activity';
import { notifyTaskAssigned } from '@/lib/services/notifications';
import { assertClaimHeld } from '@/lib/tasks/claims';
import { recordChatPatch } from '@/lib/bast-chat/task-record';
import { patchTask } from '../task-patch';

const findUnique = prisma.task.findUnique as Mock;
const update = prisma.task.update as Mock;
const userFind = prisma.user.findUnique as Mock;

const ID = 'task-1';
const ADMIN: AuthPayload = { userId: 'admin-1', email: 'a@example.test', role: 'admin', via: 'session' } as AuthPayload;
const CHAT: AuthPayload = { userId: 'owner-1', email: 'o@example.test', role: 'admin', via: 'api_key', lane: 'bast-chat', laneEnforced: true } as AuthPayload;
const UPDATED_AT = new Date('2026-11-10T09:00:00.123Z');

function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: 'A task',
    status: 'not_started',
    project_id: null,
    project: null,
    assignee_id: 'owner-1',
    function_id: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    estimated_minutes: null,
    created_by_id: 'admin-1',
    started_at: null,
    arc_id: null,
    source: 'internal',
    staging_preview_url: null,
    client_approved_at: null,
    tags: [],
    is_deleted: false,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function echo(base: Record<string, unknown>) {
  update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...base, ...data }));
}

// The include objects exactly as the route wrote them before the move (f70355e lines 399 to 419, 718 to 743).
const BLOCK_SELECT = { select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } } };
const STATUS_INCLUDE = {
  project: { select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } } },
  client: { select: { id: true, name: true } },
  charter: { select: { id: true, name: true } },
  arc: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
  reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
  approved_by: { select: { id: true, name: true } },
  function: { select: { id: true, name: true } },
  sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
  created_by: { select: { id: true, name: true } },
  blocked_by: BLOCK_SELECT,
  blocking: BLOCK_SELECT,
};
const GENERAL_INCLUDE = {
  ...STATUS_INCLUDE,
  project_phase: { select: { id: true, name: true, icon: true, sort_order: true } },
  blocked_by: BLOCK_SELECT,
  blocking: BLOCK_SELECT,
  time_entries: { where: { is_deleted: false }, select: { id: true, duration: true } },
};

const p2025 = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.emailAsk.findFirst as Mock).mockResolvedValue(null);
  userFind.mockResolvedValue({ name: 'Admin' });
});

describe('patchTask without expect: the write is exactly the route\'s', () => {
  it('status-only body: where { id }, the transition data, the status include', async () => {
    const ex = existing();
    echo(ex);
    const r = await patchTask({ actor: ADMIN, id: ID, body: { status: 'in_progress' }, existing: ex });
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: ID });
    expect(Object.keys(call.where)).toEqual(['id']);
    expect(call.data).toEqual({ status: 'in_progress', started_at: expect.any(Date), is_focus: true });
    expect(call.include).toEqual(STATUS_INCLUDE);
    expect(Object.keys(call)).toEqual(['where', 'data', 'include']);
    expect(logStatusChange).toHaveBeenCalledWith('admin-1', 'task', ID, 'A task', 'not_started', 'in_progress');
  });

  it('general body: where { id }, the built data, the general include', async () => {
    const ex = existing();
    echo(ex);
    const r = await patchTask({
      actor: ADMIN,
      id: ID,
      body: { title: 'New', due_date: '2026-12-01T00:00:00.000Z', tags: ['x'], assignee_id: '550e8400-e29b-41d4-a716-446655440001' },
      existing: ex,
    });
    expect(r.ok).toBe(true);
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: ID });
    expect(call.data).toEqual({
      estimated_minutes: null,
      title: 'New',
      assignee_id: '550e8400-e29b-41d4-a716-446655440001',
      due_date: new Date('2026-12-01T00:00:00.000Z'),
      tags: ['x'],
    });
    expect(Object.keys(call.data)).toEqual(['estimated_minutes', 'title', 'assignee_id', 'due_date', 'tags']);
    expect(call.include).toEqual(GENERAL_INCLUDE);
    expect(Object.keys(call)).toEqual(['where', 'data', 'include']);
    // A new assignee other than the updater is notified, as before.
    expect(notifyTaskAssigned).toHaveBeenCalledWith(ID, '550e8400-e29b-41d4-a716-446655440001', 'Admin');
  });

  it('chat lane: the compare-and-set where of taskWriteWhere, unchanged', async () => {
    const ex = existing();
    echo(ex);
    await patchTask({ actor: CHAT, id: ID, body: { title: 'New' }, existing: ex, chatConversation: 'conv-1' });
    expect(update.mock.calls[0][0].where).toEqual({ id: ID, assignee_id: 'owner-1', updated_at: UPDATED_AT });
    expect(recordChatPatch).toHaveBeenCalledWith(CHAT, ex, expect.objectContaining({ title: 'New' }), 'conv-1');
  });

  it('a missed write is thrown as before: P2025 for any caller, a 409 changed_since ApiError for the chat lane', async () => {
    update.mockRejectedValue(p2025());
    await expect(patchTask({ actor: ADMIN, id: ID, body: { title: 'New' }, existing: existing() })).rejects.toMatchObject({ code: 'P2025' });
    await expect(patchTask({ actor: CHAT, id: ID, body: { title: 'New' }, existing: existing(), chatConversation: 'c' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'changed_since' });
  });

  it('with no existing task given, it reads the task with the route\'s access check (404 when missing)', async () => {
    const ex = existing();
    findUnique.mockResolvedValueOnce(ex);
    echo(ex);
    const r = await patchTask({ actor: ADMIN, id: ID, body: { title: 'New' } });
    expect(r.ok).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: ID, is_deleted: false }, include: { project: { select: { id: true, status: true } } } });
    findUnique.mockResolvedValueOnce(null);
    await expect(patchTask({ actor: ADMIN, id: ID, body: { title: 'New' } })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('passes the claim token through to the claim rule', async () => {
    const ex = existing();
    echo(ex);
    await patchTask({ actor: ADMIN, id: ID, body: { status: 'done' }, existing: ex, claimToken: 'tok' });
    expect(assertClaimHeld).toHaveBeenCalledWith(ID, 'tok', { action: 'move to done', caller: { userId: 'admin-1', role: 'admin', via: 'session' } });
  });
});

describe('patchTask with expect: compare-and-set', () => {
  it('hit: the expect fields join the where and the write goes through', async () => {
    const ex = existing();
    echo(ex);
    const r = await patchTask({
      actor: ADMIN,
      id: ID,
      body: { status: 'in_progress' },
      existing: ex,
      expect: { assignee_id: 'owner-1', updated_at: UPDATED_AT.toISOString(), status: 'not_started', title: 'A task' },
    });
    expect(r.ok).toBe(true);
    expect(update.mock.calls[0][0].where).toEqual({ id: ID, assignee_id: 'owner-1', updated_at: UPDATED_AT, status: 'not_started', title: 'A task' });
    expect(logStatusChange).toHaveBeenCalledTimes(1);
    if (r.ok) expect(r.task.status).toBe('in_progress');
  });

  it('hit with only some fields: only those join the where (an expected null assignee is kept)', async () => {
    const ex = existing({ assignee_id: null });
    echo(ex);
    const r = await patchTask({ actor: ADMIN, id: ID, body: { title: 'New' }, existing: ex, expect: { assignee_id: null } });
    expect(r.ok).toBe(true);
    expect(update.mock.calls[0][0].where).toEqual({ id: ID, assignee_id: null });
  });

  it('miss before the write: changed_since with the fields that moved, nothing written, no side effect', async () => {
    const ex = existing({ assignee_id: 'someone-else', updated_at: new Date('2026-11-10T09:05:00.000Z') });
    const r = await patchTask({
      actor: ADMIN,
      id: ID,
      body: { status: 'done' },
      existing: ex,
      expect: { assignee_id: 'owner-1', updated_at: UPDATED_AT, status: 'not_started', title: 'A task' },
    });
    expect(r).toEqual({ ok: false, reason: 'changed_since', fields: ['assignee_id', 'updated_at'] });
    expect(update).not.toHaveBeenCalled();
    expect(assertClaimHeld).not.toHaveBeenCalled();
    expect(logStatusChange).not.toHaveBeenCalled();
  });

  it('miss at the write (changed between the read and the write): changed_since with no fields, no side effect after', async () => {
    const ex = existing();
    update.mockRejectedValue(p2025());
    const r = await patchTask({ actor: ADMIN, id: ID, body: { status: 'done' }, existing: ex, expect: { updated_at: UPDATED_AT } });
    expect(r).toEqual({ ok: false, reason: 'changed_since', fields: [] });
    expect(logStatusChange).not.toHaveBeenCalled();
    expect(recordChatPatch).not.toHaveBeenCalled();

    const r2 = await patchTask({ actor: ADMIN, id: ID, body: { title: 'x', assignee_id: '550e8400-e29b-41d4-a716-446655440001' }, existing: ex, expect: { updated_at: UPDATED_AT } });
    expect(r2).toEqual({ ok: false, reason: 'changed_since', fields: [] });
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
  });

  it('any other write error is still thrown with expect given', async () => {
    update.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));
    await expect(patchTask({ actor: ADMIN, id: ID, body: { title: 'x' }, existing: existing(), expect: { updated_at: UPDATED_AT } }))
      .rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('patchTask hard due date (home screen Slice 2)', () => {
  it('sets hard_due_at and source and does not touch due_date', async () => {
    const ex = existing();
    echo(ex);
    const r = await patchTask({ actor: ADMIN, id: ID, body: { hard_due_at: '2026-11-20T00:00:00.000Z', hard_due_source: 'domain renews' }, existing: ex });
    expect(r.ok).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(data.hard_due_at).toEqual(new Date('2026-11-20T00:00:00.000Z'));
    expect(data.hard_due_source).toBe('domain renews');
    expect('due_date' in data).toBe(false);
  });

  it('null clears the date and its source', async () => {
    const ex = existing();
    echo(ex);
    await patchTask({ actor: ADMIN, id: ID, body: { hard_due_at: null }, existing: ex });
    const data = update.mock.calls[0][0].data;
    expect(data.hard_due_at).toBeNull();
    expect(data.hard_due_source).toBeNull();
    expect('due_date' in data).toBe(false);
  });

  it('a date without a source is rejected and writes nothing', async () => {
    const ex = existing();
    echo(ex);
    await expect(patchTask({ actor: ADMIN, id: ID, body: { hard_due_at: '2026-11-20T00:00:00.000Z' }, existing: ex })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('a body without the new fields has no hard date keys in the write', async () => {
    const ex = existing();
    echo(ex);
    await patchTask({ actor: ADMIN, id: ID, body: { title: 'New title' }, existing: ex });
    const data = update.mock.calls[0][0].data;
    expect('hard_due_at' in data).toBe(false);
    expect('hard_due_source' in data).toBe(false);
  });
});
