import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';

vi.mock('@/lib/waits/load-blocks', () => ({ loadWaitCandidates: vi.fn() }));

import { loadWaitCandidates } from '@/lib/waits/load-blocks';
import { loadHomeInputs, zonedDayBounds } from '../load';

const U = 'user-1';
const NOW = new Date('2026-11-10T15:00:00Z');
const T = (s: string) => new Date(s);

const client = { id: 'c1', name: 'Grok', status: 'active' };
const project = { id: 'p1', name: 'Site', status: 'in_progress' };

function taskRow(over: object = {}) {
  return {
    id: 't1',
    title: 'Fix it',
    description: null,
    status: 'in_progress',
    tags: ['security'],
    promised_to: null,
    hard_due_at: null,
    hard_due_source: null,
    created_by_id: null,
    due_date: null,
    created_at: T('2026-11-01T12:00:00Z'),
    estimated_minutes: 30,
    energy_estimate: 3,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    site_id: null,
    charter_id: null,
    accord_id: null,
    billing_amount: { toString: () => '120.5' },
    requested_by_contact_id: null,
    client_visible: false,
    requirements: [
      { id: 'b', text: 'Second', completed: true, sort_order: 2 },
      { id: 'a', text: 'First', completed: false, sort_order: 1 },
      { id: 'x', text: '   ' },
    ],
    origin_url: null,
    staging_preview_url: null,
    client,
    project,
    arc: null,
    sop: null,
    requested_by_contact: null,
    blocking: [{ id: 'z1' }, { id: 'z2' }],
    email_asks: [],
    ...over,
  };
}

function askRow(over: object = {}) {
  return {
    id: 'e1',
    message_id: 'm1',
    thread_id: 'th1',
    account: 'mike@becomeindelible.com',
    from_name: 'Jess',
    from_email: 'jess@x.com',
    subject: 'Hi',
    gist: null,
    intent: null,
    is_urgent: false,
    state: 'open',
    task_id: null,
    arc_id: null,
    draft_url: null,
    draft_started_at: null,
    deep_link: 'https://mail/x',
    received_at: T('2026-11-09T12:00:00Z'),
    client: null,
    project: null,
    ...over,
  };
}

function makeDb() {
  return {
    task: {
      findMany: vi.fn().mockImplementation(async (a: { where: { status?: unknown } }) => (a.where.status === 'done' ? [] : [])),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    timeEntry: { groupBy: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    homeAction: { findMany: vi.fn().mockResolvedValue([]) },
    homeOwedThread: { findMany: vi.fn().mockResolvedValue([]) },
    // Slice 9a: his open cards from sent mail.
    homeReconcileChange: { findMany: vi.fn().mockResolvedValue([]) },
    homeKeeperRun: { findFirst: vi.fn().mockResolvedValue(null) },
    // Slice 4b: the switch (no row = off) and the outbox rows of his presses.
    homeKeeperSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    emailOutbox: { findMany: vi.fn().mockResolvedValue([]) },
    homeSiteIncident: { findMany: vi.fn().mockResolvedValue([]) },
    // Slice 6c: the outside scan results on a row.
    homeEmergencyWatch: { findMany: vi.fn().mockResolvedValue([]) },
    homeScoreWeight: { findMany: vi.fn().mockResolvedValue([]) },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
    client: { findMany: vi.fn().mockResolvedValue([]) },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
    oracleSession: { findMany: vi.fn().mockResolvedValue([]) },
    homeItemState: { findMany: vi.fn().mockResolvedValue([]) },
    wait: { findMany: vi.fn().mockResolvedValue([]) },
    emailAsk: { findMany: vi.fn().mockResolvedValue([]) },
    calendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    userPreference: { findUnique: vi.fn().mockResolvedValue(null) },
  };
}
type Db = ReturnType<typeof makeDb>;
const asDb = (db: Db) => db as unknown as PrismaClient;

let db: Db;
beforeEach(() => {
  vi.clearAllMocks();
  db = makeDb();
  (loadWaitCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

const taskCall = (db: Db, review: boolean) =>
  db.task.findMany.mock.calls.map((c) => c[0]).find((a) => (a.where.status === 'done') === review);
const askCalls = (db: Db) => db.emailAsk.findMany.mock.calls.map((c) => c[0]);

describe('loadHomeInputs: tasks', () => {
  it('scopes the task read to the one user and the plan 1.1 rule', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    const arg = taskCall(db, false);
    expect(arg.where.is_deleted).toBe(false);
    expect(arg.where.status).toEqual({ notIn: ['done', 'abandoned'] });
    expect(arg.where.OR[0]).toEqual({ assignee_id: U });
    expect(arg.where.AND).toEqual([
      {
        OR: [
          { project_id: null },
          { project: { status: { notIn: ['quote', 'queue', 'suspended', 'cancelled', 'done'] } } },
        ],
      },
    ]);
  });

  it('Slice 3: also reads open tasks assigned to a bot and tagged needs-mike, and marks only those bot_task', async () => {
    const BOT = BOT_USER_IDS[0];
    db.task.findMany.mockImplementation(async (a: { where: { status?: unknown } }) =>
      a.where.status === 'done'
        ? []
        : [taskRow({ id: 'mine', assignee_id: U }), taskRow({ id: 'bast', assignee_id: BOT, tags: ['needs-mike'] })]
    );
    const { tasks } = await loadHomeInputs(asDb(db), U, NOW);
    const arg = taskCall(db, false);
    expect(arg.where.OR[1]).toEqual({ assignee_id: { in: [...BOT_USER_IDS] }, tags: { has: 'needs-mike' } });
    expect(arg.where.is_deleted).toBe(false);
    expect(arg.select.assignee_id).toBe(true);
    expect(Object.fromEntries(tasks.map((t) => [t.id, t.bot_task]))).toEqual({ mine: false, bast: true });
  });

  it('never selects priority or is_focus', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    const select = taskCall(db, false).select;
    expect(select).not.toHaveProperty('priority');
    expect(select).not.toHaveProperty('is_focus');
  });

  it('maps a task: decimals, requirements, counts, nested refs', async () => {
    db.task.findMany.mockImplementation(async (a: { where: { status?: unknown } }) =>
      a.where.status === 'done' ? [] : [taskRow()]
    );
    const { tasks } = await loadHomeInputs(asDb(db), U, NOW);
    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t.billing_amount).toBe(120.5);
    expect(t.open_blocking_count).toBe(2);
    expect(t.has_open_email_ask).toBe(false);
    expect(t.requirements).toEqual([
      { text: 'First', completed: false },
      { text: 'Second', completed: true },
    ]);
    expect(t.client).toEqual(client);
    expect(t).not.toHaveProperty('priority');
    expect(t).not.toHaveProperty('is_focus');
  });

  it('person-waiting clock: created_at, moved forward by the newest human comment only', async () => {
    db.task.findMany.mockImplementation(async (a: { where: { status?: unknown } }) =>
      a.where.status === 'done'
        ? []
        : [taskRow({ id: 't1' }), taskRow({ id: 't2' }), taskRow({ id: 't3', created_at: T('2026-11-05T00:00:00Z') })]
    );
    db.comment.findMany.mockResolvedValue([
      { task_id: 't1', created_at: T('2026-11-08T00:00:00Z') }, // newest first
      { task_id: 't1', created_at: T('2026-11-03T00:00:00Z') },
      { task_id: 't3', created_at: T('2026-11-02T00:00:00Z') }, // older than created_at: ignored
    ]);
    const { tasks } = await loadHomeInputs(asDb(db), U, NOW);
    const by = Object.fromEntries(tasks.map((t) => [t.id, t.clock_started_at.toISOString()]));
    expect(by.t1).toBe('2026-11-08T00:00:00.000Z');
    expect(by.t2).toBe('2026-11-01T12:00:00.000Z');
    expect(by.t3).toBe('2026-11-05T00:00:00.000Z');
    const where = db.comment.findMany.mock.calls[0][0].where;
    expect(where.user_id).toEqual({ notIn: [...BOT_USER_IDS] });
    expect(where.is_deleted).toBe(false);
    expect(where.task_id).toEqual({ in: ['t1', 't2', 't3'] });
  });

  it('skips the comment read when there are no tasks', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    expect(db.comment.findMany).not.toHaveBeenCalled();
  });

  it('selects the Slice 2 task fields and maps them', async () => {
    const hard = T('2026-11-15T05:00:00Z');
    db.task.findMany.mockResolvedValueOnce([
      taskRow({ hard_due_at: hard, hard_due_source: 'domain renews', created_by_id: 'u9' }),
    ]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    const sel = taskCall(db, false).select;
    expect(sel.hard_due_at).toBe(true);
    expect(sel.hard_due_source).toBe(true);
    expect(sel.created_by_id).toBe(true);
    expect(r.tasks[0].hard_due_at).toBe(hard);
    expect(r.tasks[0].hard_due_source).toBe('domain renews');
    expect(r.tasks[0].created_by_id).toBe('u9');
  });

  it('reads held-project tasks as a groupBy with names, and the total is their sum', async () => {
    db.task.groupBy.mockResolvedValue([
      { project_id: 'p1', _count: { _all: 1 } },
      { project_id: 'p2', _count: { _all: 3 } },
      { project_id: null, _count: { _all: 9 } },
    ]);
    db.project.findMany.mockResolvedValue([
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Grok' },
    ]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    const arg = db.task.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(['project_id']);
    expect(arg.where.assignee_id).toBe(U);
    expect(arg.where.project).toEqual({ status: { in: ['quote', 'queue', 'suspended'] } });
    expect(db.project.findMany.mock.calls.map((c) => c[0].where)).toContainEqual({ id: { in: ['p1', 'p2'] } });
    expect(r.held_projects).toEqual([
      { project: { id: 'p2', name: 'Grok' }, count: 3 },
      { project: { id: 'p1', name: 'Alpha' }, count: 1 },
    ]);
    expect(r.held_project_task_count).toBe(4);
  });

  it('skips the project read and returns zero when nothing is held', async () => {
    const r = await loadHomeInputs(asDb(db), U, NOW);
    // Only Slice 8b's own next-step read touches projects; the held-project name read is skipped.
    expect(db.project.findMany.mock.calls.map((c) => c[0].where)).not.toContainEqual(expect.objectContaining({ id: expect.anything() }));
    expect(r.held_projects).toEqual([]);
    expect(r.held_project_task_count).toBe(0);
  });
});

describe('loadHomeInputs: keeper lines', () => {
  const row = (over: object = {}) => ({
    id: 'a1',
    action: 'keeper_stagger',
    after: { line: ' Gave 3 waiting tasks a day to come back. ', details: ['One', '', 5, 'Two'] },
    created_at: T('2026-11-10T07:35:00Z'),
    undo_until: T('2026-11-13T07:35:00Z'),
    ...over,
  });

  it('asks for this user, source keeper, the last 72 hours, not undone, newest first', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    const arg = db.homeAction.findMany.mock.calls[0][0];
    expect(arg.where.user_id).toBe(U);
    expect(arg.where.source).toBe('keeper');
    expect(arg.where.undone_at).toBeNull();
    expect(arg.where.created_at.gte).toEqual(new Date(NOW.getTime() - 72 * 3600 * 1000));
    expect(arg.orderBy).toEqual({ created_at: 'desc' });
  });

  it('maps after.line and after.details, and drops rows with no line or an unknown action', async () => {
    db.homeAction.findMany.mockResolvedValue([
      row(),
      row({ id: 'a2', after: { details: ['x'] } }),
      row({ id: 'a3', after: null }),
      row({ id: 'a4', action: 'not_now' }),
      row({ id: 'a5', undo_until: null }),
    ]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.keeper_lines.map((l) => l.id)).toEqual(['a1', 'a5']);
    expect(r.keeper_lines[0]).toEqual({
      id: 'a1',
      action: 'keeper_stagger',
      text: 'Gave 3 waiting tasks a day to come back.',
      details: ['One', 'Two'],
      at: T('2026-11-10T07:35:00Z'),
      undo_until: T('2026-11-13T07:35:00Z'),
    });
    expect(r.keeper_lines[1].undo_until).toEqual(T('2026-11-13T07:35:00Z'));
  });
});

describe('loadHomeInputs: review folds', () => {
  const piece = (id: string, projectId: string | null, completed: string | null, updated = '2026-11-09T00:00:00Z') => ({
    id,
    title: `Piece ${id}`,
    completed_at: completed ? T(completed) : null,
    updated_at: T(updated),
    project: projectId ? { ...project, id: projectId, client } : null,
  });

  it('uses the waiting-on-me rule', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    const w = taskCall(db, true).where;
    expect(w).toMatchObject({ is_deleted: false, status: 'done', needs_review: true, approved: false });
    expect(w.OR).toEqual([{ reviewer_id: null }, { reviewer_id: U }]);
  });

  it('folds by project, oldest finished piece first, clock from the earliest completion', async () => {
    db.task.findMany.mockImplementation(async (a: { where: { status?: unknown } }) =>
      a.where.status === 'done'
        ? [
            piece('b', 'p9', '2026-11-05T00:00:00Z'),
            piece('a', 'p9', '2026-11-03T00:00:00Z'),
            piece('n', null, null, '2026-11-07T00:00:00Z'),
            piece('o', 'p2', '2026-11-08T00:00:00Z'),
          ]
        : []
    );
    const { review_folds } = await loadHomeInputs(asDb(db), U, NOW);
    expect(review_folds).toHaveLength(3);
    const p9 = review_folds.find((f) => f.project?.id === 'p9')!;
    expect(p9.pieces.map((p) => p.id)).toEqual(['a', 'b']);
    expect(p9.waiting_since.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(p9.client).toEqual(client);
    const none = review_folds.find((f) => f.project === null)!;
    expect(none.client).toBeNull();
    expect(none.waiting_since.toISOString()).toBe('2026-11-07T00:00:00.000Z'); // updated_at fallback
    expect(review_folds[0].project?.id).toBe('p9'); // oldest clock first
  });
});

describe('loadHomeInputs: session asks', () => {
  const sess = (over: object) => ({
    id: 's1',
    external_id: 'ext-1',
    title: 'Stronghold',
    waiting_on: 'Pick a color',
    ask_queue: 'decide',
    ask_severity: 'client_blocking',
    status: 'running',
    remote_url: 'https://claude.ai/code/x',
    last_event_at: T('2026-11-10T10:00:00Z'),
    updated_at: T('2026-11-09T10:00:00Z'),
    arc: null,
    ...over,
  });

  it('applies the plan 1.1 filter', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    const where = db.oracleSession.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ waiting_on: { not: null }, archived_at: null, status: { notIn: ['ended', 'stale'] } });
  });

  it('keeps the newest when an external_id collides, skips blank asks and unkeyable ids, takes arc client and project', async () => {
    db.oracleSession.findMany.mockResolvedValue([
      sess({ id: 'old', last_event_at: T('2026-11-01T00:00:00Z') }),
      sess({ id: 'new', last_event_at: T('2026-11-10T11:00:00Z'), arc: { id: 'a1', name: 'Arc', client_id: 'c1', project_id: 'p1', closed_at: null, snoozed_until: null, client, project } }),
      sess({ id: 'blank', external_id: 'ext-2', waiting_on: '   ' }),
      sess({ id: 'spacey', external_id: 'has space' }),
      sess({ id: 'nolast', external_id: 'ext-3', last_event_at: null, updated_at: T('2026-11-04T00:00:00Z') }),
    ]);
    const { session_asks } = await loadHomeInputs(asDb(db), U, NOW);
    expect(session_asks.map((s) => s.id)).toEqual(['new', 'nolast']);
    expect(session_asks[0].client).toEqual(client);
    expect(session_asks[0].project).toEqual(project);
    expect(session_asks[0].arc?.id).toBe('a1');
    expect(session_asks[1].asked_at.toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });
});

describe('loadHomeInputs: waits', () => {
  const cand = (id: string, owner: string, state = 'needs_human') => ({
    id,
    kind: 'internal',
    state,
    title: id,
    due_at: T('2026-11-12T00:00:00Z'),
    blocks_client: false,
    client_waiting_since: null,
    nag_level: 0,
    project_id: null,
    task_id: null,
    approval_request_id: null,
    client: null,
    resolved_user_id: owner,
  });
  const waitRow = (id: string) => ({
    id,
    kind: 'internal',
    template_key: 'charter.price_review',
    state: 'needs_human',
    title: id,
    detail: 'details',
    started_at: T('2026-11-01T00:00:00Z'),
    due_at: T('2026-11-12T00:00:00Z'),
    blocks_client: true,
    client_waiting_since: T('2026-11-02T00:00:00Z'),
    task_id: 'tk',
    approval_request_id: null,
    charter_id: 'ch1',
    email_thread_id: 'th9',
    email_account: 'mike@becomeindelible.com',
    client,
    project,
  });

  it('keeps only the user\'s waits and does a second read for the missing fields', async () => {
    (loadWaitCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([cand('w1', U), cand('w2', 'someone-else'), cand('w3', U)]);
    db.wait.findMany.mockResolvedValue([waitRow('w3'), waitRow('w1')]);
    const { waits } = await loadHomeInputs(asDb(db), U, NOW);
    expect(db.wait.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['w1', 'w3'] } });
    expect(waits.map((w) => w.id)).toEqual(['w1', 'w3']); // candidate order (due_at asc) kept
    expect(waits[0]).toMatchObject({
      template_key: 'charter.price_review',
      detail: 'details',
      charter_id: 'ch1',
      email_thread_id: 'th9',
      email_account: 'mike@becomeindelible.com',
      client,
      project,
    });
    expect(waits[0].started_at.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('skips the second read when none are the user\'s, and drops a wait resolved between reads', async () => {
    (loadWaitCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([cand('w2', 'someone-else')]);
    expect((await loadHomeInputs(asDb(db), U, NOW)).waits).toEqual([]);
    expect(db.wait.findMany).not.toHaveBeenCalled();

    (loadWaitCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([cand('w1', U)]);
    db.wait.findMany.mockResolvedValue([]);
    expect((await loadHomeInputs(asDb(db), U, NOW)).waits).toEqual([]);
  });
});

describe('loadHomeInputs: email asks', () => {
  it('groups open non-urgent asks by account and thread, falling back to message_id', async () => {
    db.emailAsk.findMany.mockImplementation(async (a: { where: { state: string; is_urgent?: boolean } }) => {
      if (a.where.state === 'open' && a.where.is_urgent === false) {
        return [
          askRow({ id: 'e3', message_id: 'm3', thread_id: 'th1', received_at: T('2026-11-09T12:00:00Z') }),
          askRow({ id: 'e5', message_id: 'm5', thread_id: null, received_at: T('2026-11-08T12:00:00Z') }),
          askRow({ id: 'e2', message_id: 'm2', thread_id: 'th1', received_at: T('2026-11-07T12:00:00Z') }),
          askRow({ id: 'e6', message_id: 'm6', thread_id: 'th1', account: 'mike@whoismikedion.com', received_at: T('2026-11-06T12:00:00Z') }),
          askRow({ id: 'bad', message_id: 'mb', thread_id: 'has space' }),
        ];
      }
      return [];
    });
    const { threads } = await loadHomeInputs(asDb(db), U, NOW);
    expect(threads.map((t) => [t.account, t.thread_id, t.asks.map((x) => x.id)])).toEqual([
      ['mike@becomeindelible.com', 'th1', ['e3', 'e2']],
      ['mike@becomeindelible.com', 'm5', ['e5']],
      ['mike@whoismikedion.com', 'th1', ['e6']],
    ]);
  });

  it('reads crisis mail as open and urgent', async () => {
    db.emailAsk.findMany.mockImplementation(async (a: { where: { is_urgent?: boolean } }) =>
      a.where.is_urgent === true ? [askRow({ id: 'c1', is_urgent: true })] : []
    );
    const { crises } = await loadHomeInputs(asDb(db), U, NOW);
    expect(crises.map((c) => c.id)).toEqual(['c1']);
    expect(askCalls(db).some((a) => a.where.state === 'open' && a.where.is_urgent === true)).toBe(true);
  });

  it('reads classifier auto-closes of the last 24 hours', async () => {
    db.emailAsk.findMany.mockImplementation(async (a: { where: { state: string } }) =>
      a.where.state === 'handled'
        ? [{ id: 'h1', from_name: 'X', from_email: 'x@y.z', subject: 's', gist: null, deep_link: 'l', updated_at: T('2026-11-10T14:00:00Z'), client: { name: 'Acme' } }]
        : []
    );
    const { auto_handled } = await loadHomeInputs(asDb(db), U, NOW);
    const where = askCalls(db).find((a) => a.where.state === 'handled').where;
    expect(where.updated_at).toEqual({ gte: new Date(NOW.getTime() - 24 * 3600 * 1000) });
    expect(where.training_note).toEqual({ startsWith: '[auto] ' });
    expect(auto_handled).toEqual([
      { id: 'h1', from_name: 'X', from_email: 'x@y.z', subject: 's', gist: null, client_name: 'Acme', deep_link: 'l', handled_at: T('2026-11-10T14:00:00Z') },
    ]);
  });
});

describe('loadHomeInputs: calendar and time zone', () => {
  it('reads events overlapping the zoned day', async () => {
    await loadHomeInputs(asDb(db), U, NOW, { timezone: 'America/New_York' });
    const where = db.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.starts_at.lt.toISOString()).toBe('2026-11-11T05:00:00.000Z');
    expect(where.ends_at.gt.toISOString()).toBe('2026-11-10T05:00:00.000Z');
    expect(db.userPreference.findUnique).not.toHaveBeenCalled();
  });

  it('reads the user\'s own preference when no zone is passed, and falls back to New York', async () => {
    await loadHomeInputs(asDb(db), U, NOW);
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where: { user_id: U }, select: { timezone: true } });
    const where = db.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where.ends_at.gt.toISOString()).toBe('2026-11-10T05:00:00.000Z');
  });

  it('zonedDayBounds handles the fall-back day (25 hours) and other zones', () => {
    const b = zonedDayBounds(T('2026-11-01T12:00:00Z'), 'America/New_York');
    expect(b.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    const k = zonedDayBounds(T('2026-11-10T22:00:00Z'), 'Asia/Karachi');
    expect(k.start.toISOString()).toBe('2026-11-10T19:00:00.000Z'); // already Nov 11 in Karachi
    expect(k.start.getTime() - 5 * 3600 * 1000).toBeLessThan(T('2026-11-11T00:00:00Z').getTime());
  });
});

describe('loadHomeInputs: read-only', () => {
  it('returns the user id and now', async () => {
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.user_id).toBe(U);
    expect(r.now).toBe(NOW);
  });

  it('calls no write method (the fake db has none) and the source never mentions rollover or /api/today', () => {
    const src = readFileSync(join(__dirname, '..', 'load.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/rolloverTodayPicksIfNeeded|today-rollover|\/api\/today/);
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$transaction)\(/);
  });
});

describe('loadHomeInputs: Slice 4a owed rows', () => {
  it('reads the owner\'s own home_owed_thread rows and the drafter\'s last finished run', async () => {
    const rows = [{ thread_key: 'thread:a:b', state: 'drafted', draft_id: 'd1' }];
    db.homeOwedThread.findMany.mockResolvedValue(rows);
    db.homeKeeperRun.findFirst.mockResolvedValue({ finished_at: T('2026-11-10T14:30:00Z') });
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.owed_rows).toEqual(rows);
    expect(r.drafter_fresh_at).toEqual(T('2026-11-10T14:30:00Z'));
    expect(db.homeOwedThread.findMany.mock.calls[0][0].where).toEqual({ user_id: U });
    expect(db.homeKeeperRun.findFirst.mock.calls[0][0].where).toMatchObject({ user_id: U, kind: 'owed_reply' });
  });
  it('no rows and no run give [] and null', async () => {
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.owed_rows).toEqual([]);
    expect(r.drafter_fresh_at).toBeNull();
  });
  it('keeps a keeper_owed_drafts line', async () => {
    db.homeAction.findMany.mockResolvedValue([
      { id: 'o1', action: 'keeper_owed_drafts', after: { line: 'Drafted a reply to Pat. It is in your Gmail drafts.' }, created_at: T('2026-11-10T12:00:00Z'), undo_until: T('2026-11-10T12:00:00Z') },
    ]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.keeper_lines.map((l) => l.action)).toEqual(['keeper_owed_drafts']);
  });
});

describe('loadHomeInputs: Slice 6a site incidents, rules and lines', () => {
  const inc = (over: object = {}) => ({
    id: 'i1',
    user_id: U,
    site_id: 's1',
    domain: 'jillscafe.com',
    client_id: 'c1',
    source: 'uptime_mail',
    monitor: null,
    ask_ids: ['e1'],
    started_at: T('2026-11-10T14:00:00Z'),
    last_checked_at: T('2026-11-10T14:55:00Z'),
    last_check_up: false,
    check_summary: null,
    watchdog_escalated: false,
    closed_at: null,
    close_reason: null,
    ...over,
  });

  it('reads this user\'s open incidents and answered mail ones of the last 3 days, with the client name and the mail link', async () => {
    db.homeSiteIncident.findMany.mockResolvedValue([inc()]);
    db.emailAsk.findMany.mockImplementation(async (a: { where: { id?: unknown } }) =>
      a.where.id ? [{ id: 'e1', deep_link: 'https://mail/e1', received_at: T('2026-11-10T13:00:00Z') }] : [],
    );
    db.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Jill' }]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    const arg = db.homeSiteIncident.findMany.mock.calls[0][0];
    expect(arg.where.user_id).toBe(U);
    expect(arg.where.OR[0]).toEqual({ closed_at: null });
    expect(arg.where.OR[1]).toMatchObject({ source: 'uptime_mail', close_reason: 'answered' });
    expect(arg.where.OR[1].closed_at.gte).toEqual(new Date(NOW.getTime() - 3 * 86400000));
    expect(r.site_incidents).toHaveLength(1);
    expect(r.site_incidents[0]).toMatchObject({ site_id: 's1', domain: 'jillscafe.com', client_name: 'Jill', source: 'uptime_mail', last_check_up: false });
    expect(r.site_incidents[0].mail_links).toEqual([{ label: 'The email thread', href: 'https://mail/e1' }]);
  });

  it('Slice 6c: reads this user\'s stored outside scan results that came after the item landed, and no others', async () => {
    db.homeEmergencyWatch.findMany.mockResolvedValue([
      { item_key: 'task:t1', first_seen_at: T('2026-11-10T10:00:00Z'), scan_at: T('2026-11-10T10:30:00Z'), scan_summary: 'nothing new found from outside.' },
      { item_key: 'task:t2', first_seen_at: T('2026-11-10T11:00:00Z'), scan_at: T('2026-11-10T10:30:00Z'), scan_summary: 'older than the landing' },
      { item_key: 'task:t3', first_seen_at: T('2026-11-10T11:00:00Z'), scan_at: null, scan_summary: null },
    ]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    const arg = db.homeEmergencyWatch.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ user_id: U, cleared_at: null });
    expect(r.outside_checks).toEqual([{ item_key: 'task:t1', summary: 'nothing new found from outside.', at: T('2026-11-10T10:30:00Z') }]);
  });

  it('no incidents means [] and no extra reads', async () => {
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.site_incidents).toEqual([]);
    expect(db.client.findMany).not.toHaveBeenCalled();
  });

  it('reads only this user\'s confirmed rules of the home-emergency lane, and the zone', async () => {
    db.decision.findMany.mockResolvedValue([
      { key: 'home-not-emergency:sender:alerts@wpmudev.com' },
      { key: 'home-not-emergency:site:jillscafe.com' },
      { key: 'something-else' },
    ]);
    const r = await loadHomeInputs(asDb(db), U, NOW, { timezone: 'America/Chicago' });
    const arg = db.decision.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ lane: 'home-emergency', status: 'confirmed', created_by_id: U });
    expect(r.not_emergency_rules).toEqual([
      { kind: 'sender', value: 'alerts@wpmudev.com' },
      { kind: 'site', value: 'jillscafe.com' },
    ]);
    expect(r.timezone).toBe('America/Chicago');
    const fallback = await loadHomeInputs(asDb(db), U, NOW);
    expect(fallback.timezone).toBe('America/New_York');
  });

  it('Slice 7a: keeps the measures and guard lines, with the line text and details', async () => {
    const m = { id: 'm1', action: 'keeper_measures', after: { line: 'Last week: 188 open items, 6 past their day.', details: ['Hard dates met: 1. Hard dates missed: 0.'] }, created_at: T('2026-11-23T12:00:00Z'), undo_until: null };
    const g = { id: 'g1', action: 'keeper_guard', after: { line: 'You approved 23 of 24 sign-offs and approvals last week.', details: [] }, created_at: T('2026-11-23T12:00:01Z'), undo_until: null };
    db.homeAction.findMany.mockResolvedValueOnce([g, m]).mockResolvedValueOnce([]);
    const r = await loadHomeInputs(asDb(db), U, T('2026-11-23T13:00:00Z'));
    expect(r.keeper_lines.map((l) => [l.id, l.action, l.text])).toEqual([
      ['g1', 'keeper_guard', 'You approved 23 of 24 sign-offs and approvals last week.'],
      ['m1', 'keeper_measures', 'Last week: 188 open items, 6 past their day.'],
    ]);
    expect(r.keeper_lines[1].details).toEqual(['Hard dates met: 1. Hard dates missed: 0.']);
  });

  it('keeps the "answers again" lines (no Undo id on the screen) and a saved-rule line while its Undo is open', async () => {
    const rule = { id: 'r1', action: 'not_emergency_rule', after: { line: 'Saved a rule: mail from a@b.com is not an emergency.' }, created_at: T('2026-11-09T12:00:00Z'), undo_until: T('2026-11-16T12:00:00Z') };
    const watch = { id: 'w1', action: 'watch_site_cleared', after: { line: 'jillscafe.com answers again (checked 10:42).', details: ['jillscafe.com'] }, created_at: T('2026-11-10T14:00:00Z'), undo_until: null };
    db.homeAction.findMany.mockResolvedValueOnce([watch]).mockResolvedValueOnce([rule]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.keeper_lines.map((l) => [l.id, l.action])).toEqual([['w1', 'watch_site_cleared'], ['r1', 'not_emergency_rule']]);
    const second = db.homeAction.findMany.mock.calls[1][0];
    expect(second.where).toMatchObject({ user_id: U, action: 'not_emergency_rule', undone_at: null });
    expect(second.where.undo_until.gt).toEqual(NOW);
  });
});

describe('loadHomeInputs: Slice 7b learned weights and Learned lines', () => {
  it('reads only the owner\'s weights that are not at 100, and returns them as the weights input', async () => {
    db.homeScoreWeight.findMany.mockResolvedValue([{ evidence_key: 'client:c1', label: 'Grok', weight_pct: 105 }]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(db.homeScoreWeight.findMany.mock.calls[0][0].where).toEqual({ user_id: U, weight_pct: { not: 100 } });
    expect(r.weights).toEqual([{ evidence_key: 'client:c1', label: 'Grok', weight_pct: 105 }]);
  });

  it('keeps a Learned line while its seven day Undo is open, with its text and details', async () => {
    const learned = { id: 'l1', action: 'keeper_learned', after: { line: 'Learned: Grok work now comes up a little sooner.', details: ['You moved 3 items up and set none aside in the last 4 weeks.'] }, created_at: T('2026-11-08T12:00:00Z'), undo_until: T('2026-11-15T12:00:00Z') };
    db.homeAction.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([learned]);
    const r = await loadHomeInputs(asDb(db), U, NOW);
    expect(r.keeper_lines.map((l) => [l.id, l.action, l.text])).toEqual([['l1', 'keeper_learned', 'Learned: Grok work now comes up a little sooner.']]);
    const third = db.homeAction.findMany.mock.calls[2][0];
    expect(third.where).toMatchObject({ user_id: U, action: 'keeper_learned', source: 'keeper', undone_at: null });
    expect(third.where.undo_until.gt).toEqual(NOW);
  });
});

describe('loadHomeInputs: Slice 9a cards and lines from his sent mail', () => {
  it('reads his own open cards (not past two weeks) and leaves out a card whose task closed another way', async () => {
    const db = makeDb();
    const cardRow = (over: object = {}) => ({
      id: 'c1', kind: 'done', title: 'Your email says you removed File Manager. Mark this done?', lines: ['q'], reason: 'security', link: 'https://mail.google.com/x',
      created_at: T('2026-11-10T12:00:00Z'), plan: { type: 'done' }, minutes_estimate: null, estimate_basis: null, quote_to: 'Kue Chen', quote_at: T('2026-11-09T15:00:00Z'),
      target_key: 'task:t-open', message: { lookback: false }, ...over,
    });
    db.homeReconcileChange.findMany.mockResolvedValue([cardRow(), cardRow({ id: 'c2', target_key: 'task:t-closed' }), cardRow({ id: 'c3', kind: 'track', target_key: null, message: { lookback: true } })]);
    db.task.findMany.mockImplementation(async (a: { where: { id?: unknown } }) => (a.where.id ? [{ id: 't-open', assignee_id: U }] : []));
    const raw = await loadHomeInputs(db as unknown as PrismaClient, U, NOW, { timezone: 'America/New_York' });
    expect(raw.reconcile_cards?.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(raw.reconcile_cards?.[1].look_back).toBe(true);
    const where = db.homeReconcileChange.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ user_id: U, mode: 'card', state: 'open' });
  });

  it('a card for done or waiting that is no longer his task is left out', async () => {
    const db = makeDb();
    db.homeReconcileChange.findMany.mockResolvedValue([
      { id: 'c1', kind: 'done', title: 't', lines: [], reason: null, link: null, created_at: NOW, plan: {}, minutes_estimate: null, estimate_basis: null, quote_to: null, quote_at: null, target_key: 'task:t1', message: { lookback: false } },
    ]);
    db.task.findMany.mockImplementation(async (a: { where: { id?: unknown } }) => (a.where.id ? [{ id: 't1', assignee_id: 'someone-else' }] : []));
    const raw = await loadHomeInputs(db as unknown as PrismaClient, U, NOW, { timezone: 'America/New_York' });
    expect(raw.reconcile_cards).toEqual([]);
  });

  it('turns an automatic note into a Handled line with its details and link, undone ones excluded by the query', async () => {
    const db = makeDb();
    db.homeAction.findMany.mockImplementation(async (a: { where: { source?: string; OR?: unknown } }) =>
      a.where.OR
        ? [{ id: 'n1', action: 'reconcile_note', source: 'reconcile', before: {}, after: { line: 'Noted on "x" from your email to Kue Chen, November 9.', details: ['q'], link: 'https://mail.google.com/x' }, created_at: NOW, undo_until: new Date(NOW.getTime() + 3600_000) }]
        : []
    );
    const raw = await loadHomeInputs(db as unknown as PrismaClient, U, NOW, { timezone: 'America/New_York' });
    expect(raw.reconcile_lines).toHaveLength(1);
    expect(raw.reconcile_lines?.[0]).toMatchObject({ id: 'n1', note: true, details: ['q'], link: 'https://mail.google.com/x', time_prompt: null });
    const call = db.homeAction.findMany.mock.calls.find((c) => (c[0] as { where: { OR?: unknown } }).where.OR);
    expect((call?.[0] as { where: Record<string, unknown> }).where).toMatchObject({ user_id: U, undone_at: null });
  });
});
