import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { POST } from '../route';
import { jsonRequest, signIn, anonymous, sessionRow, SITE_ID, PROJECT_ID, SESSION_ID } from '@/lib/design/__tests__/route-test-kit';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    projectTeamAssignment: { findMany: vi.fn() },
    designPortalSettings: { findUnique: vi.fn() },
    designWorkerState: { findUnique: vi.fn() },
    task: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/design/sessions', async (orig) => ({ ...(await orig<typeof import('@/lib/design/sessions')>()), createOrGetSession: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession } from '@/lib/design/sessions';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const siteFind = prisma.site.findUnique as Mock;
const projectFind = prisma.project.findFirst as Mock;
const assignments = prisma.projectTeamAssignment.findMany as Mock;
const taskCreate = prisma.task.create as Mock;
const taskUpdate = prisma.task.update as Mock;
const create = createOrGetSession as Mock;

const call = (b: unknown = { site_id: SITE_ID, title: 'Fix the footer' }, headers?: Record<string, string>) =>
  POST(jsonRequest('/api/design/work', 'POST', b, headers));

beforeEach(() => {
  vi.clearAllMocks();
  siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, design_portal_enabled: true, site_type: 'eleventy' });
  assignments.mockResolvedValue([{ project_id: PROJECT_ID }]);
  projectFind.mockResolvedValue({ id: PROJECT_ID, client_id: 'client-1' });
  (prisma.designPortalSettings.findUnique as Mock).mockResolvedValue({ enabled: true, default_session_budget_usd: { toString: () => '25' }, model: 'opus', effort: 'high' });
  (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ configured_site_ids: [SITE_ID] });
  taskCreate.mockResolvedValue({ id: 'task-1' });
  taskUpdate.mockResolvedValue({});
  create.mockResolvedValue({ session: sessionRow(), created: true });
});

describe('POST /api/design/work', () => {
  it('a designer on the project gets 201, a task on the open project and a session', async () => {
    const uid = signIn(auth, userFind, 'designer');
    const res = await call({ site_id: SITE_ID, title: '  Fix the footer ', detail: 'Links wrap on mobile' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ session_id: SESSION_ID });
    expect(taskCreate.mock.calls[0][0].data).toMatchObject({
      title: 'Fix the footer', description: 'Links wrap on mobile', status: 'not_started', project_id: PROJECT_ID, client_id: 'client-1',
      site_id: SITE_ID, assignee_id: uid, created_by_id: uid, tags: ['design-work'], energy_estimate: 3, mystery_factor: 'average', battery_impact: 'average_drain',
    });
    expect(taskCreate.mock.calls[0][0].data.estimated_minutes).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: uid }), 'task-1', expect.anything());
    // the open project is the newest visible one, limited to her projects
    expect(projectFind.mock.calls.at(-1)![0]).toMatchObject({ orderBy: { created_at: 'desc' }, where: { is_deleted: false, status: { in: ['ready', 'in_progress', 'review'] }, id: { in: [PROJECT_ID] } } });
  });

  it('an admin may start work on any enabled site (no assignment lookup)', async () => {
    signIn(auth, userFind, 'admin');
    expect((await call()).status).toBe(201);
    expect(assignments).not.toHaveBeenCalled();
  });

  it('a designer not on a project for that site is 404', async () => {
    signIn(auth, userFind, 'designer');
    projectFind.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('a designer with no assignments at all is 404; an unknown site is 404', async () => {
    signIn(auth, userFind, 'designer');
    assignments.mockResolvedValueOnce([]);
    expect((await call()).status).toBe(404);
    siteFind.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
  });

  it('a site that is not design-enabled is 409', async () => {
    signIn(auth, userFind, 'designer');
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, design_portal_enabled: false, site_type: 'eleventy' });
    expect((await call()).status).toBe(409);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('an enabled site that is not eleventy is 409', async () => {
    signIn(auth, userFind, 'admin');
    siteFind.mockResolvedValue({ id: SITE_ID, is_deleted: false, design_portal_enabled: true, site_type: 'wordpress' });
    expect((await call()).status).toBe(409);
  });

  it('no open project for the site is 409 with the message', async () => {
    signIn(auth, userFind, 'designer');
    projectFind.mockResolvedValueOnce({ id: PROJECT_ID }).mockResolvedValueOnce(null);
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain('no open project for this site');
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('the box not serving the site is 409 and no task is made', async () => {
    signIn(auth, userFind, 'designer');
    (prisma.designWorkerState.findUnique as Mock).mockResolvedValue({ configured_site_ids: [] });
    expect((await call()).status).toBe(409);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('soft-deletes the task when the session engine refuses afterwards', async () => {
    signIn(auth, userFind, 'designer');
    const { ApiError } = await import('@/lib/api/errors');
    create.mockRejectedValueOnce(new ApiError('Someone else is working on this task', 409, 'task_claimed'));
    expect((await call()).status).toBe(409);
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { is_deleted: true } });
  });

  it('an API key is 403, anonymous is 401, pm is 403, cross-site is 403', async () => {
    signIn(auth, userFind, 'admin', { via: 'api_key' });
    expect((await call()).status).toBe(403);
    anonymous(auth);
    expect((await call()).status).toBe(401);
    signIn(auth, userFind, 'pm');
    expect((await call()).status).toBe(403);
    signIn(auth, userFind, 'designer');
    expect((await call(undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('strict body: an unknown field, a bad site id, an empty or 121-char title, a 2001-char detail are 400', async () => {
    signIn(auth, userFind, 'designer');
    const bad: unknown[] = [
      { site_id: SITE_ID, title: 'x', extra: 1 },
      { site_id: 'nope', title: 'x' },
      { site_id: SITE_ID, title: '   ' },
      { site_id: SITE_ID, title: 'x'.repeat(121) },
      { site_id: SITE_ID, title: 'x', detail: 'y'.repeat(2001) },
      { title: 'x' },
    ];
    for (const b of bad) expect((await call(b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    expect((await call({ site_id: SITE_ID, title: 'x'.repeat(120), detail: 'y'.repeat(2000) })).status).toBe(201);
  });
});
