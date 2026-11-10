import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

// Project wizard: SOP tags onto tasks (design-job:*, design-stage:*, design-runner only),
// Site.design_path = portal once, v1 assignment unchanged. SPEC 7.1 (W0.4).

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

const tx = {
  project: { create: vi.fn() },
  projectPhase: { create: vi.fn() },
  projectPage: { createMany: vi.fn() },
  projectTeamAssignment: { createMany: vi.fn() },
  task: { create: vi.fn(), update: vi.fn() },
  site: { updateMany: vi.fn() },
};

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    recipe: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRecipeFind = prisma.recipe.findUnique as Mock;
const mockProjectFind = prisma.project.findUnique as Mock;
const mockTransaction = prisma.$transaction as Mock;

const RECIPE_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const SITE_ID = '33333333-3333-4333-8333-333333333333';
const FUNC_BOT = '44444444-4444-4444-8444-444444444444';
const FUNC_DESIGN = '55555555-5555-4555-8555-555555555555';
const VAR_TASK_ID = '77777777-7777-4777-8777-777777777777';
const USER_DESIGNER = '66666666-6666-4666-8666-666666666666';

function sop(id: string, functionId: string, tags: string[]) {
  return {
    id,
    title: `SOP ${id}`,
    function_id: functionId,
    default_priority: 3,
    energy_estimate: 2,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    template_requirements: null,
    tags,
  };
}

function recipeTask(id: string, s: ReturnType<typeof sop>, extra: Record<string, unknown> = {}) {
  return { id, title: null, is_variable: false, variable_source: null, depends_on_ids: [] as string[], sop: s, ...extra };
}

function recipeWith(tasks: ReturnType<typeof recipeTask>[]) {
  return {
    id: RECIPE_ID,
    is_active: true,
    default_type: 'website',
    phases: [{ id: 'rp-1', name: 'Design and Build', icon: null, sort_order: 0, tasks }],
  };
}

function request(overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/projects/wizard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipe_id: RECIPE_ID,
      client_id: CLIENT_ID,
      site_id: SITE_ID,
      name: 'Test project',
      pages: [],
      team_assignments: [],
      ...overrides,
    }),
  });
}

function createdTasks(): Array<Record<string, unknown>> {
  return tx.task.create.mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'a@example.com' });
  let n = 0;
  tx.project.create.mockResolvedValue({ id: 'proj-1' });
  tx.projectPhase.create.mockResolvedValue({ id: 'pp-1' });
  tx.task.create.mockImplementation(async () => ({ id: `task-${++n}` }));
  tx.task.update.mockResolvedValue({});
  tx.site.updateMany.mockResolvedValue({ count: 1 });
  mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
  mockProjectFind.mockResolvedValue({ id: 'proj-1' });
});

describe('POST /api/projects/wizard design tags', () => {
  it('copies design-job:, design-stage: and design-runner tags onto the task', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([
        recipeTask('rt-1', sop('s1', FUNC_BOT, ['design-job:provision', 'design-runner'])),
        recipeTask('rt-2', sop('s2', FUNC_DESIGN, ['design-stage:art_direction'])),
      ])
    );
    const res = await POST(request());
    expect(res.status).toBe(201);
    const tasks = createdTasks();
    expect(tasks[0].tags).toEqual(['design-job:provision', 'design-runner']);
    expect(tasks[1].tags).toEqual(['design-stage:art_direction']);
  });

  it('copies no other SOP tag, including near misses', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([
        recipeTask(
          'rt-1',
          sop('s1', FUNC_BOT, [
            'bast-doable',
            'stack:eleventy',
            'design-runner-x',
            'xdesign-runner',
            'design-jobs',
            'design-job:home_build',
            'design-runner',
          ])
        ),
      ])
    );
    await POST(request());
    expect(createdTasks()[0].tags).toEqual(['design-job:home_build', 'design-runner']);
  });

  it('copies tags on the per-page (variable) branch too', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([
        recipeTask(VAR_TASK_ID, sop('s1', FUNC_BOT, ['design-job:rest_build', 'other']), {
          is_variable: true,
          variable_source: 'sitemap_page',
        }),
      ])
    );
    await POST(request({ pages: [{ name: 'About', selected_variable_tasks: [VAR_TASK_ID] }] }));
    const tasks = createdTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toEqual(['design-job:rest_build']);
  });

  it('a recipe with no design tags creates tasks with no tags, as before', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([recipeTask('rt-1', sop('s1', FUNC_BOT, ['bast-doable', 'stack:eleventy'])), recipeTask('rt-2', sop('s2', FUNC_BOT, []))])
    );
    await POST(request());
    for (const task of createdTasks()) expect(task.tags).toEqual([]);
    expect(tx.site.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/wizard design_path', () => {
  it('sets design_path to portal only where it is null, in the same transaction', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([recipeTask('rt-1', sop('s1', FUNC_BOT, ['design-job:provision', 'design-runner']))])
    );
    await POST(request());
    expect(tx.site.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.site.updateMany).toHaveBeenCalledWith({
      where: { id: SITE_ID, design_path: null },
      data: { design_path: 'portal' },
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('never overwrites an existing design_path (the write is guarded on null)', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([recipeTask('rt-1', sop('s1', FUNC_BOT, ['design-job:provision']))])
    );
    // A site that already has a path matches no row, so the guarded update changes nothing.
    tx.site.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(request());
    expect(res.status).toBe(201);
    const call = tx.site.updateMany.mock.calls[0][0] as { where: { design_path: null } };
    expect(call.where.design_path).toBeNull();
  });

  it('does not touch the site when the recipe has no design-job: SOP', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([recipeTask('rt-1', sop('s1', FUNC_DESIGN, ['design-stage:review', 'design-runner']))])
    );
    await POST(request());
    expect(tx.site.updateMany).not.toHaveBeenCalled();
  });

  it('does not touch a site when the request has no site_id', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([recipeTask('rt-1', sop('s1', FUNC_BOT, ['design-job:provision']))])
    );
    await POST(request({ site_id: null }));
    expect(tx.site.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/wizard assignment', () => {
  it('assigns from team_assignments only; Bot tasks get nobody by default', async () => {
    mockRecipeFind.mockResolvedValue(
      recipeWith([
        recipeTask('rt-1', sop('s1', FUNC_BOT, ['design-job:provision', 'design-runner'])),
        recipeTask('rt-2', sop('s2', FUNC_DESIGN, ['design-stage:art_direction'])),
      ])
    );
    await POST(request({ team_assignments: [{ function_id: FUNC_DESIGN, user_id: USER_DESIGNER }] }));
    const tasks = createdTasks();
    expect(tasks[0].assignee_id).toBeNull();
    expect(tasks[1].assignee_id).toBe(USER_DESIGNER);
  });
});
