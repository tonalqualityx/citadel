import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import type { UserRole } from '@prisma/client';
import { designActorFrom, designClaimHolder, type DesignActor } from '../helpers';
import {
  DRAWER_TASK_SELECT,
  drawerDecision,
  drawerTaskWhere,
  effectiveSite,
  filterDrawerTasks,
  loadDrawer,
  loadSessionFor,
  mySessionsWhere,
  publishPageAccess,
  sessionAccess,
  type DrawerContext,
  type DrawerSite,
  type DrawerTask,
} from '../access';
import { FORBIDDEN_PROJECTION_KEYS } from '../projections';

const DESIGNER = 'd0000000-0000-4000-8000-000000000001';
const SECOND_DESIGNER = 'd0000000-0000-4000-8000-000000000002';
const PROJECT = 'b0000000-0000-4000-8000-000000000001';
const OTHER_PROJECT = 'b0000000-0000-4000-8000-000000000002';
const SITE = 'c0000000-0000-4000-8000-000000000001';
const TASK = 'e0000000-0000-4000-8000-000000000001';
const SESSION = 'f0000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-29T12:00:00Z');

const actor = (userId: string, role: UserRole): DesignActor => designActorFrom({ userId, role, via: 'session' });

function siteRow(over: Partial<DrawerSite> = {}): DrawerSite {
  return { id: SITE, name: 'VCDP', site_type: 'eleventy', design_portal_enabled: true, is_deleted: false, ...over };
}

function task(over: Partial<DrawerTask> = {}, project: Partial<NonNullable<DrawerTask['project']>> = {}): DrawerTask {
  return {
    id: TASK,
    title: 'Home hero',
    status: 'not_started',
    is_deleted: false,
    sort_order: 0,
    phase: null,
    project_phase: { id: 'ph-1', name: 'Design', sort_order: 1 },
    site_id: null,
    site: null,
    project_id: PROJECT,
    project: { id: PROJECT, name: 'VCDP rebuild', status: 'in_progress', is_deleted: false, site_id: SITE, site: siteRow(), ...project },
    claim_holder: null,
    lease_until: null,
    ...over,
  };
}

function ctx(over: Partial<DrawerContext> = {}): DrawerContext {
  return { actor: actor(DESIGNER, 'designer'), assignedProjectIds: [PROJECT], configuredSiteIds: [SITE], now: NOW, ...over };
}

describe('drawerDecision: the baseline is listed and available', () => {
  it('assigned designer, open task, visible project, enabled eleventy site on the box', () => {
    expect(drawerDecision(task(), ctx())).toEqual({ listed: true, site: siteRow(), available: true });
  });
});

describe('drawerDecision: task status (open = not done/abandoned/deleted)', () => {
  const rows: Array<[string, boolean]> = [
    ['not_started', true],
    ['in_progress', true],
    ['review', true],
    ['blocked', true], // a blocked task stays in the drawer with its status chip (design step 2)
    ['done', false],
    ['abandoned', false],
  ];
  for (const [status, listed] of rows) {
    it(`${status} -> ${listed ? 'listed' : 'task_closed'}`, () => {
      const d = drawerDecision(task({ status }), ctx());
      expect(d.listed).toBe(listed);
      if (!listed) expect(d).toEqual({ listed: false, reason: 'task_closed' });
    });
  }
  it('a deleted task is excluded', () => {
    expect(drawerDecision(task({ is_deleted: true }), ctx())).toEqual({ listed: false, reason: 'task_deleted' });
  });
});

describe('drawerDecision: project status (ready | in_progress | review)', () => {
  const rows: Array<[string, boolean]> = [
    ['quote', false],
    ['queue', false],
    ['ready', true],
    ['in_progress', true],
    ['review', true],
    ['done', false],
    ['suspended', false],
    ['cancelled', false],
  ];
  for (const [status, listed] of rows) {
    it(`project ${status} -> ${listed ? 'listed' : 'project_hidden'}`, () => {
      const d = drawerDecision(task({}, { status }), ctx());
      if (listed) expect(d.listed).toBe(true);
      else expect(d).toEqual({ listed: false, reason: 'project_hidden' });
    });
  }
  it('a deleted project is excluded', () => {
    expect(drawerDecision(task({}, { is_deleted: true }), ctx())).toEqual({ listed: false, reason: 'project_deleted' });
  });
  it('a task with no project is excluded (the drawer groups by project)', () => {
    expect(drawerDecision(task({ project_id: null, project: null, site_id: SITE, site: siteRow() }), ctx())).toEqual({ listed: false, reason: 'no_project' });
  });
});

describe('drawerDecision: site', () => {
  it('design portal disabled', () => {
    expect(drawerDecision(task({}, { site: siteRow({ design_portal_enabled: false }) }), ctx())).toEqual({ listed: false, reason: 'site_disabled' });
  });
  it('not an eleventy site (wordpress, unset)', () => {
    expect(drawerDecision(task({}, { site: siteRow({ site_type: 'wordpress' }) }), ctx())).toEqual({ listed: false, reason: 'site_not_eleventy' });
    expect(drawerDecision(task({}, { site: siteRow({ site_type: null }) }), ctx())).toEqual({ listed: false, reason: 'site_not_eleventy' });
  });
  it('deleted site', () => {
    expect(drawerDecision(task({}, { site: siteRow({ is_deleted: true }) }), ctx())).toEqual({ listed: false, reason: 'site_deleted' });
  });
  it('no site on the task or the project', () => {
    expect(drawerDecision(task({}, { site_id: null, site: null }), ctx())).toEqual({ listed: false, reason: 'no_site' });
  });
  it('site not in the box map: listed, greyed (available = false)', () => {
    expect(drawerDecision(task(), ctx({ configuredSiteIds: [] }))).toEqual({ listed: true, site: siteRow(), available: false });
  });
  it("the task's own site wins over the project's (task.site_id ?? project.site_id)", () => {
    const off = siteRow({ id: 'c0000000-0000-4000-8000-000000000009', design_portal_enabled: false });
    const t = task({ site_id: off.id, site: off });
    expect(effectiveSite(t)).toBe(off);
    expect(drawerDecision(t, ctx())).toEqual({ listed: false, reason: 'site_disabled' });
  });
});

describe('drawerDecision: who', () => {
  it('a second designer not on the project: excluded', () => {
    expect(drawerDecision(task(), ctx({ actor: actor(SECOND_DESIGNER, 'designer'), assignedProjectIds: [OTHER_PROJECT] }))).toEqual({
      listed: false,
      reason: 'not_assigned',
    });
  });
  it('admin and pm see every enabled site task without an assignment', () => {
    expect(drawerDecision(task(), ctx({ actor: actor('admin-1', 'admin'), assignedProjectIds: [] })).listed).toBe(true);
    expect(drawerDecision(task(), ctx({ actor: actor('pm-1', 'pm'), assignedProjectIds: [] })).listed).toBe(true);
  });
  it('tech never reads the drawer', () => {
    expect(drawerDecision(task(), ctx({ actor: actor('tech-1', 'tech') }))).toEqual({ listed: false, reason: 'role_not_allowed' });
  });
});

describe('drawerDecision: claims', () => {
  const live = new Date(NOW.getTime() + 60_000);
  const expired = new Date(NOW.getTime() - 60_000);
  it('claimed by another holder with a live lease: excluded', () => {
    expect(drawerDecision(task({ claim_holder: 'bast:citadel-worker', lease_until: live }), ctx())).toEqual({ listed: false, reason: 'claimed_elsewhere' });
  });
  it("claimed by another holder whose lease ran out: listed", () => {
    expect(drawerDecision(task({ claim_holder: 'bast:citadel-worker', lease_until: expired }), ctx()).listed).toBe(true);
  });
  it("held by the task's own design session: listed", () => {
    expect(drawerDecision(task({ claim_holder: designClaimHolder(TASK), lease_until: live }), ctx()).listed).toBe(true);
  });
});

describe('filterDrawerTasks', () => {
  it('keeps only listed tasks, in order', () => {
    const tasks = [
      task({ id: 'e0000000-0000-4000-8000-00000000000a' }),
      task({ id: 'e0000000-0000-4000-8000-00000000000b', status: 'done' }),
      task({ id: 'e0000000-0000-4000-8000-00000000000c', status: 'blocked' }),
    ];
    expect(filterDrawerTasks(tasks, ctx()).map((r) => r.task.id)).toEqual(['e0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000c']);
  });
});

describe('drawerTaskWhere', () => {
  it('designer: only assigned projects; open tasks; visible projects; enabled eleventy sites', () => {
    const w = drawerTaskWhere(actor(DESIGNER, 'designer'), [PROJECT, OTHER_PROJECT]);
    expect(w).toMatchObject({
      is_deleted: false,
      status: { notIn: ['done', 'abandoned'] },
      project_id: { in: [PROJECT, OTHER_PROJECT] },
      project: { is_deleted: false, status: { in: ['ready', 'in_progress', 'review'] } },
    });
    expect(w.OR).toHaveLength(2);
  });
  it('designer with a project filter keeps it inside her assignments', () => {
    expect(drawerTaskWhere(actor(DESIGNER, 'designer'), [PROJECT], OTHER_PROJECT).project_id).toEqual({ in: [] });
    expect(drawerTaskWhere(actor(DESIGNER, 'designer'), [PROJECT], PROJECT).project_id).toEqual({ in: [PROJECT] });
  });
  it('admin: any project', () => {
    expect(drawerTaskWhere(actor('a', 'admin'), []).project_id).toEqual({ not: null });
    expect(drawerTaskWhere(actor('a', 'admin'), [], PROJECT).project_id).toBe(PROJECT);
  });
});

describe('DRAWER_TASK_SELECT reads no forbidden field', () => {
  it('top level and nested', () => {
    const keys = JSON.stringify(DRAWER_TASK_SELECT);
    for (const k of [...FORBIDDEN_PROJECTION_KEYS, 'description']) expect(keys).not.toContain(`"${k}"`);
  });
});

function drawerDb(opts: { assignments?: string[]; tasks?: DrawerTask[]; state?: unknown; sessions?: unknown[]; publishes?: unknown[] }) {
  return {
    projectTeamAssignment: { findMany: vi.fn().mockResolvedValue((opts.assignments ?? []).map((project_id) => ({ project_id }))) },
    task: { findMany: vi.fn().mockResolvedValue(opts.tasks ?? []) },
    designWorkerState: { findUnique: vi.fn().mockResolvedValue(opts.state ?? null) },
    designSession: { findMany: vi.fn().mockResolvedValue(opts.sessions ?? []) },
    designPublish: { findMany: vi.fn().mockResolvedValue(opts.publishes ?? []) },
  };
}

describe('loadDrawer', () => {
  it('designer: reads assignments, filters, attaches the latest session and its publish date', async () => {
    const finished = new Date('2026-10-28T10:00:00Z');
    const db = drawerDb({
      assignments: [PROJECT],
      tasks: [task(), task({ id: 'e0000000-0000-4000-8000-00000000000b', status: 'done' })],
      state: { configured_site_ids: [SITE], last_heartbeat_at: NOW, paused: false },
      sessions: [
        { id: SESSION, task_id: TASK, designer_id: DESIGNER, status: 'awaiting_input', publish_requested_at: null, last_publish_id: 'pub-1', created_at: NOW },
        { id: 'older', task_id: TASK, designer_id: DESIGNER, status: 'closed', publish_requested_at: null, last_publish_id: null, created_at: new Date(0) },
      ],
      publishes: [{ id: 'pub-1', finished_at: finished }],
    });
    const data = await loadDrawer(actor(DESIGNER, 'designer'), { now: NOW }, db as never);
    expect(data.rows.map((r) => r.task.id)).toEqual([TASK]);
    expect(data.sessionsByTask.get(TASK)?.id).toBe(SESSION);
    expect(data.publishedAt.get('pub-1')).toBe(finished);
    expect(db.projectTeamAssignment.findMany).toHaveBeenCalledWith({ where: { user_id: DESIGNER }, select: { project_id: true } });
    expect(db.task.findMany.mock.calls[0][0].select).toBe(DRAWER_TASK_SELECT);
  });
  it('a designer on no project: no task query at all', async () => {
    const db = drawerDb({ assignments: [] });
    const data = await loadDrawer(actor(SECOND_DESIGNER, 'designer'), {}, db as never);
    expect(data.rows).toEqual([]);
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
  it('admin: no assignment lookup', async () => {
    const db = drawerDb({ tasks: [task()], state: { configured_site_ids: [], last_heartbeat_at: null, paused: true } });
    const data = await loadDrawer(actor('admin-1', 'admin'), { now: NOW }, db as never);
    expect(db.projectTeamAssignment.findMany).not.toHaveBeenCalled();
    expect(data.rows[0].available).toBe(false);
    expect(data.worker).toEqual({ last_heartbeat_at: null, paused: true });
  });
  it('tech: 403', async () => {
    await expect(loadDrawer(actor('tech-1', 'tech'), {}, drawerDb({}) as never)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('a malformed project filter returns nothing without querying', async () => {
    const db = drawerDb({ assignments: [PROJECT] });
    expect((await loadDrawer(actor(DESIGNER, 'designer'), { projectId: 'nope' }, db as never)).rows).toEqual([]);
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
});

describe('sessionAccess: role x owner x mode', () => {
  const rows: Array<[UserRole, string, 'read' | 'write', 'ok' | 'not_found' | 'forbidden']> = [
    ['designer', DESIGNER, 'read', 'ok'],
    ['designer', DESIGNER, 'write', 'ok'],
    ['designer', SECOND_DESIGNER, 'read', 'not_found'],
    ['designer', SECOND_DESIGNER, 'write', 'not_found'],
    ['admin', 'admin-1', 'read', 'ok'],
    ['admin', 'admin-1', 'write', 'ok'],
    ['pm', 'pm-1', 'read', 'ok'],
    ['pm', 'pm-1', 'write', 'forbidden'],
    ['tech', 'tech-1', 'read', 'not_found'],
    ['tech', 'tech-1', 'write', 'not_found'],
  ];
  for (const [role, userId, mode, expected] of rows) {
    it(`${role} ${userId === DESIGNER ? '(owner)' : ''} ${mode} -> ${expected}`, () => {
      expect(sessionAccess({ userId, role }, { designer_id: DESIGNER }, mode)).toBe(expected);
    });
  }
});

describe('loadSessionFor', () => {
  const row = { id: SESSION, designer_id: DESIGNER, status: 'awaiting_input' };
  const db = (found: unknown) => ({ designSession: { findUnique: vi.fn().mockResolvedValue(found) } });

  it('owner gets the row', async () => {
    expect(await loadSessionFor(actor(DESIGNER, 'designer'), SESSION, {}, db(row) as never)).toBe(row);
  });
  it('malformed id: 404 without a query', async () => {
    const d = db(row);
    await expect(loadSessionFor(actor(DESIGNER, 'designer'), 'nope', {}, d as never)).rejects.toMatchObject({ statusCode: 404 });
    expect(d.designSession.findUnique).not.toHaveBeenCalled();
  });
  it('missing row: 404', async () => {
    await expect(loadSessionFor(actor(DESIGNER, 'designer'), SESSION, {}, db(null) as never)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("another designer's session: 404, never 403", async () => {
    await expect(loadSessionFor(actor(SECOND_DESIGNER, 'designer'), SESSION, { mode: 'write' }, db(row) as never)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('pm reads, and gets 403 on write', async () => {
    expect(await loadSessionFor(actor('pm-1', 'pm'), SESSION, { mode: 'read' }, db(row) as never)).toBe(row);
    await expect(loadSessionFor(actor('pm-1', 'pm'), SESSION, { mode: 'write' }, db(row) as never)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('admin writes any session', async () => {
    expect(await loadSessionFor(actor('admin-1', 'admin'), SESSION, { mode: 'write' }, db(row) as never)).toBe(row);
  });
  it('tech: 404', async () => {
    await expect(loadSessionFor(actor('tech-1', 'tech'), SESSION, {}, db(row) as never)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('list and publish-page access', () => {
  it('mySessionsWhere', () => {
    expect(mySessionsWhere({ userId: DESIGNER, role: 'designer' })).toEqual({ designer_id: DESIGNER });
    expect(mySessionsWhere({ userId: 'a', role: 'admin' })).toEqual({});
    expect(mySessionsWhere({ userId: 'p', role: 'pm' })).toBeNull();
    expect(mySessionsWhere({ userId: 't', role: 'tech' })).toBeNull();
  });
  it('publishPageAccess: admin, pm, the session designer; others 404', () => {
    const s = { designer_id: DESIGNER };
    expect(publishPageAccess({ userId: 'a', role: 'admin' }, s)).toBe('ok');
    expect(publishPageAccess({ userId: 'p', role: 'pm' }, s)).toBe('ok');
    expect(publishPageAccess({ userId: DESIGNER, role: 'designer' }, s)).toBe('ok');
    expect(publishPageAccess({ userId: SECOND_DESIGNER, role: 'designer' }, s)).toBe('not_found');
    expect(publishPageAccess({ userId: 't', role: 'tech' }, s)).toBe('not_found');
  });
});
