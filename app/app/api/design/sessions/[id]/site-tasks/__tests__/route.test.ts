import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { GET } from '../route';
import { getRequest, paramsOf, signIn, sessionRow, sessionRouteMatrix, SESSION_ID, SITE_ID, PROJECT_ID, DESIGNER_ID } from '@/lib/design/__tests__/route-test-kit';
import { findForbiddenKeys } from '@/lib/design/projections';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn(async () => ({ id: 'pta-1' })), findMany: vi.fn(async () => [{ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]) },
    designSession: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const auth = requireAuth as Mock;
const userFind = prisma.user.findUnique as Mock;
const sessionFind = prisma.designSession.findUnique as Mock;
const taskFind = prisma.task.findMany as Mock;
const assignFind = prisma.projectTeamAssignment.findMany as Mock;
const call = (query = '') =>
  GET(getRequest(`/api/design/sessions/${SESSION_ID}/site-tasks${query}`), paramsOf({ id: SESSION_ID }));

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Fix the hero', status: 'in_progress', due_date: new Date('2026-11-02T00:00:00Z'), description: 'x'.repeat(1500),
  assignee_id: DESIGNER_ID, assignee: { name: 'Lisa Marie Smith' }, project: { id: PROJECT_ID, name: 'VCDP' }, ...over,
});

function arrange() {
  sessionFind.mockResolvedValue(sessionRow());
  taskFind.mockResolvedValue([row(), row({ id: 't2', title: 'Footer', assignee_id: null, assignee: null, description: null, due_date: null })]);
}
beforeEach(() => {
  vi.clearAllMocks();
  assignFind.mockResolvedValue([{ project_id: PROJECT_ID }]);
  arrange();
});

describe('GET /api/design/sessions/:id/site-tasks', () => {
  it('lists the site\'s open tasks with an allowlisted projection (first name, truncated description, mine flag)', async () => {
    signIn(auth, userFind, 'designer');
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mine).toBe(false);
    expect(json.tasks).toHaveLength(2);
    expect(Object.keys(json.tasks[0]).sort()).toEqual(['assignee_first_name', 'description', 'due_date', 'id', 'mine', 'project', 'status', 'title']);
    expect(json.tasks[0]).toMatchObject({ id: 't1', assignee_first_name: 'Lisa', mine: true, project: { id: PROJECT_ID, name: 'VCDP' } });
    expect(json.tasks[0].description).toHaveLength(1000);
    expect(json.tasks[1]).toMatchObject({ assignee_first_name: null, mine: false, description: null, due_date: null });
    expect(findForbiddenKeys(json)).toEqual([]);
    expect(JSON.stringify(json)).not.toMatch(/Marie|Smith|estimated|billing|email/);
  });

  it('asks the database only for this site\'s open tasks on visible projects, within the designer\'s projects', async () => {
    signIn(auth, userFind, 'designer');
    await call();
    const where = taskFind.mock.calls[0][0].where;
    expect(where).toMatchObject({
      is_deleted: false,
      status: { notIn: ['done', 'abandoned'] },
      project_id: { in: [PROJECT_ID] },
      project: { is_deleted: false, status: { in: ['ready', 'in_progress', 'review'] } },
      OR: [{ site_id: SITE_ID }, { site_id: null, project: { site_id: SITE_ID } }],
    });
    expect(where).not.toHaveProperty('assignee_id');
    expect(taskFind.mock.calls[0][0].select).not.toHaveProperty('estimated_minutes');
  });

  it('?mine=1 filters to the caller\'s own tasks', async () => {
    signIn(auth, userFind, 'designer');
    const json = await (await call('?mine=1')).json();
    expect(json.mine).toBe(true);
    expect(taskFind.mock.calls[0][0].where.assignee_id).toBe(DESIGNER_ID);
  });

  it('a designer on no project sees nothing, and the database is not asked', async () => {
    signIn(auth, userFind, 'designer');
    assignFind.mockResolvedValue([]);
    expect(await (await call()).json()).toEqual({ tasks: [], mine: false });
    expect(taskFind).not.toHaveBeenCalled();
  });

  it('an admin is not limited to assigned projects', async () => {
    signIn(auth, userFind, 'admin');
    await call();
    expect(taskFind.mock.calls[0][0].where.project_id).toEqual({ not: null });
  });

  sessionRouteMatrix('site-tasks', { invoke: () => call(), requireAuth: auth, userFind, assignmentFind: prisma.projectTeamAssignment.findFirst as Mock, arrange: () => arrange(), write: false });
});
