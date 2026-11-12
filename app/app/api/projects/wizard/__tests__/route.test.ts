import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'creator' })),
  requireRole: vi.fn(),
}));

const txMock = {
  project: { create: vi.fn(async () => ({ id: 'proj-1' })) },
  projectPhase: { create: vi.fn(async () => ({ id: 'phase-1' })) },
  projectPage: { createMany: vi.fn() },
  projectTeamAssignment: { createMany: vi.fn() },
  task: { create: vi.fn(), update: vi.fn() },
};
let taskSeq = 0;

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    recipe: { findUnique: vi.fn() },
    project: { findUnique: vi.fn(async () => ({ id: 'proj-1' })) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txMock)),
  },
}));

import { prisma } from '@/lib/db/prisma';

const FN_BOT = '55555555-5555-4555-8555-555555555555';
const FN_DESIGN = '66666666-6666-4666-8666-666666666666';

function recipe() {
  const sop = (id: string, fnId: string, fnName: string) => ({
    id: `sop-${id}`, title: `SOP ${id}`, function_id: fnId, function: { name: fnName },
    default_priority: 'medium', energy_estimate: 1, mystery_factor: 1, battery_impact: 'average_drain',
    template_requirements: null,
  });
  return {
    is_active: true,
    default_type: 'website',
    phases: [{
      id: 'rp-1', name: 'Build', icon: null, sort_order: 0,
      tasks: [
        { id: 'rt-bot', title: null, is_variable: false, variable_source: null, depends_on_ids: [], sop: sop('bot', FN_BOT, 'Bot') },
        { id: 'rt-design', title: null, is_variable: false, variable_source: null, depends_on_ids: [], sop: sop('design', FN_DESIGN, 'Design') },
        { id: 'rt-after', title: null, is_variable: false, variable_source: null, depends_on_ids: ['rt-bot'], sop: sop('after', FN_DESIGN, 'Design') },
      ],
    }],
  };
}

function request(team: Array<Record<string, unknown>>) {
  return new NextRequest('http://localhost/api/projects/wizard', {
    method: 'POST',
    body: JSON.stringify({
      recipe_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      name: 'Test project',
      pages: [],
      team_assignments: team,
    }),
  });
}

const MANAGER = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';

describe('POST /api/projects/wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskSeq = 0;
    txMock.task.create.mockImplementation(async () => ({ id: `task-${++taskSeq}` }));
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(recipe() as never);
  });

  it('leaves Bot steps unassigned, sends others to the manager, creates all tasks in triage', async () => {
    const res = await POST(request([{ function_id: FN_BOT, user_id: MEMBER }, { function_id: '77777777-7777-4777-8777-777777777777', user_id: MANAGER, is_lead: true }]));
    expect(res.status).toBe(201);
    const creates = txMock.task.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(creates).toHaveLength(3);
    expect(creates[0].assignee_id).toBeNull();
    expect(creates[1].assignee_id).toBe(MANAGER);
    expect(creates[2].assignee_id).toBe(MANAGER);
    for (const d of creates) expect(d.status).toBe('triage');
  });

  it('falls back to Mike when the project has no manager', async () => {
    await POST(request([])) ;
    const creates = txMock.task.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(creates[0].assignee_id).toBeNull();
    expect(creates[1].assignee_id).toBe(MIKE_USER_ID);
  });

  it('keeps the dependency wiring unchanged', async () => {
    await POST(request([{ function_id: FN_DESIGN, user_id: MEMBER }]));
    expect(txMock.task.update).toHaveBeenCalledTimes(1);
    expect(txMock.task.update).toHaveBeenCalledWith({
      where: { id: 'task-3' },
      data: { blocked_by: { connect: [{ id: 'task-1' }] } },
    });
  });
});
