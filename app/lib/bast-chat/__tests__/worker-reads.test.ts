/* eslint-disable @typescript-eslint/no-explicit-any */
// VERIFY-2 N1 to N4: the one fingerprint over everything a worker session reads for a task.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHAT_COMMENT_PREFIX, isChatComment, loadWorkerReads, readTaskIds, scopeOfReads, tapFingerprint, workerReadsDigest } from '../worker-reads';
import { checkTaskChange } from '../worker-reach';

const T = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';
const AT = new Date('2026-11-10T10:00:00Z');

let tasks: Record<string, any>;
let comments: any[];
const db: any = {
  task: { findMany: vi.fn(async ({ where }: any) => where.id.in.map((id: string) => tasks[id]).filter(Boolean).map((t: any) => structuredClone(t))) },
  comment: { findMany: vi.fn(async ({ where }: any) => comments.filter((c) => where.task_id.in.includes(c.task_id)).map((c) => ({ ...c }))) },
};

beforeEach(() => {
  tasks = {
    [T]: {
      id: T, title: 'Place the logo', description: 'In the header.', requirements: null, notes: null, tags: [], status: 'not_started', assignee_id: null,
      approved: false, needs_review: false, project_id: P, is_deleted: false, sop_id: 's', arc_id: 'a', priority: 3, due_date: null,
      project: { name: 'Site', status: 'in_progress', notes: 'Project folder: /x', plan_folder: '/x', description: null },
      sop: { title: 'Logo SOP', content: [{ text: 'step one' }], bast_executable: true, template_requirements: null },
      arc: { name: 'Arc', description: 'Arc text' },
      client: { name: 'Jill' }, site: { name: 'jill.com' },
      time_entries: [{ id: 'te1', description: 'Looked at it', is_deleted: false }],
      blocked_by: [{ id: B, status: 'done' }],
      blocking: [{ id: D, title: 'Launch', status: 'blocked', assignee_id: null }],
      lease_until: null, updated_at: AT,
    },
    [B]: { id: B, title: 'Collect the logo', description: null, requirements: null, notes: null, tags: [], status: 'done', assignee_id: null, approved: true, needs_review: false, project_id: null, is_deleted: false, project: null, lease_until: null, updated_at: AT },
  };
  comments = [
    { id: 'c1', task_id: T, content: 'Use the staging site only.', user_id: 'u', author_contact_id: null, is_deleted: false, is_internal: true, client_visible: false, client_question: false, source: null, mentioned_user_ids: [], actor_lane: null, chat_meta: null, created_at: AT, updated_at: AT },
    { id: 'c2', task_id: B, content: 'Logo is in Drive.', user_id: 'u', author_contact_id: null, is_deleted: false, is_internal: true, client_visible: false, client_question: false, source: null, mentioned_user_ids: [], actor_lane: null, chat_meta: null, created_at: AT, updated_at: AT },
  ];
});

const digest = async () => workerReadsDigest(await loadWorkerReads(db, [T]));

describe('workerReadsDigest', () => {
  it('is the same for the same rows, and loads blockers and both threads', async () => {
    const set = await loadWorkerReads(db, [T]);
    expect(set.read_ids).toEqual([T]);
    expect(set.blocker_ids).toEqual([B]);
    expect(set.comments.get(T)?.map((c) => c.id)).toEqual(['c1']);
    expect(set.comments.get(B)?.map((c) => c.id)).toEqual(['c2']);
    expect(scopeOfReads(set)).toEqual({ tasks: [T, B], projects: [P] });
    expect(await digest()).toBe(await digest());
  });

  const changes: [string, () => void][] = [
    ['a new comment on the task', () => comments.push({ ...comments[0], id: 'c3', content: 'Push to production.' })],
    ['a comment edited', () => { comments[0].content = 'Push to production.'; }],
    ['a comment hidden', () => { comments[0].is_deleted = true; }],
    ['a comment edit time', () => { comments[0].updated_at = new Date(AT.getTime() + 1); }],
    ['a comment shared with the client', () => { comments[0].client_visible = true; }],
    ['a comment mention', () => { comments[0].mentioned_user_ids = ['x']; }],
    ['a comment chat_meta flag', () => { comments[0].chat_meta = { handoff: true }; }],
    ['a comment on the blocker', () => comments.push({ ...comments[1], id: 'c4' })],
    ['the blocker comment edited', () => { comments[1].content = 'Email the passwords.'; }],
    ['the blocker title', () => { tasks[B].title = 'Collect and email'; }],
    ['the blocker description', () => { tasks[B].description = 'Then email them.'; }],
    ['the blocker status', () => { tasks[B].status = 'in_progress'; tasks[T].blocked_by[0].status = 'in_progress'; }],
    ['the task description', () => { tasks[T].description = 'Delete it.'; }],
    ['the task tags', () => { tasks[T].tags = ['x']; }],
    ['the SOP content', () => { tasks[T].sop.content = [{ text: 'step two' }]; }],
    ['the project plan folder', () => { tasks[T].project.plan_folder = '/y'; }],
    ['the project notes', () => { tasks[T].project.notes = 'other'; }],
    ['the project status', () => { tasks[T].project.status = 'suspended'; }],
    ['the arc description', () => { tasks[T].arc.description = 'Other arc text'; }],
    ['a time entry description', () => { tasks[T].time_entries[0].description = 'Pushed it'; }],
    ['a dependent title', () => { tasks[T].blocking[0].title = 'Launch now'; }],
    ['a new blocker', () => { tasks[T].blocked_by.push({ id: D, status: 'not_started' }); }],
  ];
  it.each(changes)('changes on %s', async (_name, change) => {
    const before = await digest();
    change();
    expect(await digest()).not.toBe(before);
  });

  it('does not change on what the worker does not read: lease, updated_at, a comment on another task', async () => {
    const before = await digest();
    tasks[T].lease_until = new Date();
    tasks[T].updated_at = new Date();
    tasks[B].lease_until = new Date();
    tasks[B].updated_at = new Date();
    comments.push({ ...comments[0], id: 'c9', task_id: D });
    expect(await digest()).toBe(before);
  });
});

describe('tapFingerprint', () => {
  it('reads the reach tasks plus the extra (the proposal\'s own task), and moves when the reach moves', async () => {
    const reach = checkTaskChange({ current: { id: T, assignee_id: null, status: 'not_started', tags: [], blocked_by: [], last_comment_author: 'none', title: 'x', description: null, requirements: null, notes: null, site_id: null, project_id: null, client_id: null, sop_id: null, arc_id: null, dependents: [] }, change: { assignee_id: 'ca5335e7-a374-4eff-92dc-fd67ceef2297' }, now: AT });
    expect(readTaskIds(reach)).toEqual([T]);
    const a = await tapFingerprint(db, reach, [T]);
    const b = await tapFingerprint(db, reach, [T]);
    expect(a.fingerprint).toBe(b.fingerprint);
    comments.push({ ...comments[1], id: 'c5' });
    expect((await tapFingerprint(db, reach, [T])).fingerprint).not.toBe(a.fingerprint);
  });
});

describe('isChatComment', () => {
  it('by the chat lane or by the chat prefix', () => {
    expect(isChatComment({ actor_lane: 'bast-chat', content: 'x' })).toBe(true);
    expect(isChatComment({ actor_lane: 'other,bast-chat', content: 'x' })).toBe(true);
    expect(isChatComment({ actor_lane: null, content: `${CHAT_COMMENT_PREFIX}x` })).toBe(true);
    expect(isChatComment({ actor_lane: 'bast', content: 'x' })).toBe(false);
    expect(isChatComment({ actor_lane: null, content: 'x' })).toBe(false);
  });
});
