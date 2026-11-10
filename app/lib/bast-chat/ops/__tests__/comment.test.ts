/* eslint-disable @typescript-eslint/no-explicit-any */
// Op `comment`: internal, Bast-authored, never client-visible; a comment on a task Bast holds needs a tap.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any, notify: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({ actor_lane: 'bast-chat' })) }));
vi.mock('@/lib/services/notifications', () => ({ createNotification: h.notify }));

import { getRunnableOp } from '..';
import { BAST_USER_ID, SABEEN_USER_ID, MIKE_USER_ID } from '../../gate-mirror';

const TASK = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const COMMENT = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b';
const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-10T15:00:00Z');
const UPDATED = new Date('2026-11-10T14:00:00Z');
const op = getRunnableOp('comment')!;
const ctx = () => ({ db: h.db, ownerId: OWNER, now: NOW });

function task(over: object = {}) {
  return { id: TASK, title: 'Menu proof', status: 'not_started', assignee_id: MIKE_USER_ID, tags: [], description: null, requirements: null, notes: null, site_id: null, project_id: null, client_id: null, sop_id: null, arc_id: null, needs_review: false, approved: false, client_approved_at: null, lease_until: null, client_visible: false, requested_by_contact_id: null, staging_preview_url: null, is_deleted: false, updated_at: UPDATED, priority: 3, is_focus: false, due_date: null, promised_to: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', project: null, blocked_by: [], blocking: [], ...over };
}

let comments: any[];
beforeEach(() => {
  vi.clearAllMocks();
  comments = [];
  h.db = {
    task: { findUnique: vi.fn(async () => task()) },
    comment: {
      findFirst: vi.fn(async ({ where }: any) => [...comments].filter((c) => !c.is_deleted && (!where.id?.not || c.id !== where.id.not)).at(-1) ?? null),
      create: vi.fn(async ({ data }: any) => { const c = { id: COMMENT, is_deleted: false, ...data }; comments.push(c); return { id: COMMENT }; }),
      findUnique: vi.fn(async ({ where }: any) => comments.find((c) => c.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const c = comments.find((x) => x.id === where.id && x.is_deleted === where.is_deleted); if (!c) return { count: 0 }; Object.assign(c, data); return { count: 1 }; }),
    },
  };
});

describe('comment op', () => {
  it('has a strict input: no client flags, no mentions, no author', () => {
    for (const extra of [{ client_visible: true }, { client_question: true }, { mentioned_user_ids: [] }, { is_internal: false }, { user_id: OWNER }]) {
      expect(() => op.validate({ task_id: TASK, text: 'x', ...extra })).toThrow();
    }
    expect(() => op.validate({ task_id: TASK, text: '' })).toThrow();
    expect(() => op.validate({ task_id: TASK, text: 'x'.repeat(2001) })).toThrow();
  });
  it('applies as an internal, Bast-authored comment with the chat prefix, and records true before and after', async () => {
    const input = op.validate({ task_id: TASK, text: 'Call Jill first' });
    const p = await op.prepare(ctx() as any, input, 'chat');
    expect(p.reach.needs_tap).toBe(false);
    const r = await op.run(ctx() as any, input, p.expect);
    const row = comments[0];
    expect(row).toMatchObject({ task_id: TASK, user_id: BAST_USER_ID, content: 'From Mike, through the chat: Call Jill first', is_internal: true, client_visible: false, client_question: false, mentioned_user_ids: [] });
    expect(r.target_id).toBe(COMMENT);
    expect(r.before).toEqual({ task_id: TASK, comment: null });
    expect(r.after).toEqual({ task_id: TASK, comment_id: COMMENT });
    expect(r.summary).toBe('Added a note to "Menu proof".');
    expect(r.undoable).toBe(true);
    await r.afterCommit!();
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: MIKE_USER_ID, type: 'comment_added', entityType: 'task', entityId: TASK }));
  });
  it('sends no team notice when Bast holds the task (the author is Bast)', async () => {
    h.db.task.findUnique.mockResolvedValue(task({ assignee_id: BAST_USER_ID, status: 'done', needs_review: false }));
    const r = await op.run(ctx() as any, op.validate({ task_id: TASK, text: 'hi' }), { task_updated_at: UPDATED.toISOString(), last_comment_id: null });
    expect(r.afterCommit).toBeUndefined();
  });
  it('needs a tap on a task Bast holds, and writes nothing in prepare', async () => {
    h.db.task.findUnique.mockResolvedValue(task({ assignee_id: BAST_USER_ID }));
    const p = await op.prepare(ctx() as any, op.validate({ task_id: TASK, text: 'hi' }), 'chat');
    expect(p.reach.needs_tap).toBe(true);
    expect(p.reach.proposal_kind).toBe('bast_start');
    expect(h.db.comment.create).not.toHaveBeenCalled();
  });
  it('a changed thread between prepare and write is refused', async () => {
    const input = op.validate({ task_id: TASK, text: 'hi' });
    const p = await op.prepare(ctx() as any, input, 'chat');
    comments.push({ id: 'zz', task_id: TASK, is_deleted: false, user_id: SABEEN_USER_ID, author_contact_id: null });
    await expect(op.run(ctx() as any, input, p.expect)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.db.comment.create).not.toHaveBeenCalled();
  });
  it('Undo hides the comment and deletes nothing; Undo of a second hide is refused', async () => {
    const input = op.validate({ task_id: TASK, text: 'hi' });
    const p = await op.prepare(ctx() as any, input, 'chat');
    const r = await op.run(ctx() as any, input, p.expect);
    const rec = { id: 'a1', target_type: 'comment', target_id: r.target_id, before: r.before, after: r.after } as any;
    const u = await op.prepareUndo(ctx() as any, rec);
    expect(u.reach.needs_tap).toBe(false);
    expect(await op.undo(ctx() as any, rec, u.expect)).toEqual({ ok: true });
    expect(comments[0].is_deleted).toBe(true);
    expect(comments).toHaveLength(1);
    await expect(op.prepareUndo(ctx() as any, rec)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('hiding a comment on a Bast task a person last wrote on is a tap (it can wake the worker)', async () => {
    h.db.task.findUnique.mockResolvedValue(task({ assignee_id: BAST_USER_ID, status: 'blocked', tags: ['needs-mike'] }));
    comments.push({ id: 'h1', task_id: TASK, is_deleted: false, user_id: OWNER, author_contact_id: null });
    comments.push({ id: COMMENT, task_id: TASK, is_deleted: false, user_id: BAST_USER_ID, author_contact_id: null });
    const u = await op.prepareUndo(ctx() as any, { after: { comment_id: COMMENT, task_id: TASK } } as any);
    expect(u.reach.needs_tap).toBe(true);
  });
});
