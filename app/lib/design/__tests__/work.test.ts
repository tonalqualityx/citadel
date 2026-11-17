import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('../sessions', () => ({
  createOrGetSession: vi.fn().mockResolvedValue({ session: { id: 'sess-1' }, created: true }),
  loadSessionDefaults: vi.fn().mockResolvedValue({ enabled: true }),
}));

import { designActorFrom } from '../helpers';
import { createOrGetSession } from '../sessions';
import { loadStartSites, startWork } from '../work';

const SITE = 'c0000000-0000-4000-8000-000000000001';
const PROJECT = 'b0000000-0000-4000-8000-000000000001';

function fakeDb(opts: { assigned?: string[] } = {}) {
  return {
    site: {
      findMany: vi.fn().mockResolvedValue([{ id: SITE, name: 'Site' }]),
      findUnique: vi.fn().mockResolvedValue({ id: SITE, is_deleted: false, design_portal_enabled: true, site_type: 'eleventy' }),
    },
    projectTeamAssignment: { findMany: vi.fn().mockResolvedValue((opts.assigned ?? []).map((project_id) => ({ project_id }))) },
    designTrack: { findFirst: vi.fn().mockResolvedValue(null) },
    project: { findFirst: vi.fn().mockResolvedValue({ id: PROJECT, client_id: null }) },
    designWorkerState: { findUnique: vi.fn().mockResolvedValue({ configured_site_ids: [SITE] }) },
    task: { create: vi.fn().mockResolvedValue({ id: 'task-1' }), update: vi.fn() },
  };
}

const actor = (role: 'designer' | 'admin' | 'pm' | 'tech') => designActorFrom({ userId: `${role}-1`, role, via: 'session' });

beforeEach(() => vi.clearAllMocks());

describe('loadStartSites', () => {
  it('tech: every design-enabled site with an open project, no assignment lookup', async () => {
    const db = fakeDb();
    expect(await loadStartSites(actor('tech'), db as never)).toEqual([{ id: SITE, name: 'Site' }]);
    expect(db.projectTeamAssignment.findMany).not.toHaveBeenCalled();
    // No project-id limit in the where clause, as for an admin.
    const where = db.site.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('"id":{"in"');
  });
  it('admin: same as tech', async () => {
    const db = fakeDb();
    await loadStartSites(actor('admin'), db as never);
    expect(db.projectTeamAssignment.findMany).not.toHaveBeenCalled();
  });
  it('designer with no assignments: none; designer with one: limited to it', async () => {
    expect(await loadStartSites(actor('designer'), fakeDb() as never)).toEqual([]);
    const db = fakeDb({ assigned: [PROJECT] });
    await loadStartSites(actor('designer'), db as never);
    expect(db.projectTeamAssignment.findMany).toHaveBeenCalled();
    expect(JSON.stringify(db.site.findMany.mock.calls[0][0].where)).toContain(PROJECT);
  });
  it('pm: none, nothing queried', async () => {
    const db = fakeDb();
    expect(await loadStartSites(actor('pm'), db as never)).toEqual([]);
    expect(db.site.findMany).not.toHaveBeenCalled();
  });
});

describe('startWork', () => {
  it('tech: creates the task assigned to her and opens the session, no assignment lookup', async () => {
    const db = fakeDb();
    const t = actor('tech');
    expect(await startWork(t, { site_id: SITE, title: ' Fix the header ' }, db as never)).toEqual({ session_id: 'sess-1', task_id: 'task-1' });
    expect(db.projectTeamAssignment.findMany).not.toHaveBeenCalled();
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ title: 'Fix the header', assignee_id: t.userId, project_id: PROJECT });
    expect(createOrGetSession).toHaveBeenCalledWith(t, 'task-1', db);
  });
  it('designer not on a project for the site: 404, nothing created', async () => {
    const db = fakeDb({ assigned: [] });
    await expect(startWork(actor('designer'), { site_id: SITE, title: 'x' }, db as never)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.task.create).not.toHaveBeenCalled();
  });
  it('pm: 403', async () => {
    const db = fakeDb();
    await expect(startWork(actor('pm'), { site_id: SITE, title: 'x' }, db as never)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.task.create).not.toHaveBeenCalled();
  });
});
