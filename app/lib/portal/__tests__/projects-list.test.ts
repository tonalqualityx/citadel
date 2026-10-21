import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: { project: { findMany: vi.fn() }, task: { findMany: vi.fn() } } }));

import { prisma } from '@/lib/db/prisma';
import { loadProjectList, nextMilestone } from '../projects-list';
import { projectAccessWhere, type PortalAccess } from '../access';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const owner: PortalAccess = { contactId: 'c1', clientId: 'cl1', role: 'owner' };

describe('nextMilestone', () => {
  it('is the earliest open milestone; undated ones come after; completed ones are skipped', () => {
    expect(
      nextMilestone([
        { name: 'Done', target_date: '2026-09-01', completed_at: '2026-09-02', sort_order: 0 },
        { name: 'Undated', target_date: null, completed_at: null, sort_order: 0 },
        { name: 'Launch', target_date: '2026-12-01', completed_at: null, sort_order: 2 },
        { name: 'Content', target_date: '2026-11-01', completed_at: null, sort_order: 1 },
      ])
    ).toEqual({ name: 'Content', target_date: '2026-11-01' });
    expect(nextMilestone([{ name: 'A', target_date: null, completed_at: null, sort_order: 1 }, { name: 'B', target_date: null, completed_at: null, sort_order: 0 }])?.name).toBe('B');
  });
  it('is null with nothing open', () => {
    expect(nextMilestone([])).toBeNull();
    expect(nextMilestone([{ name: 'x', target_date: null, completed_at: 'd', sort_order: 0 }])).toBeNull();
  });
});

describe('loadProjectList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    p.task.findMany.mockResolvedValue([]);
  });
  const proj = (id: string, status: string, over: Record<string, unknown> = {}) => ({ id, name: `P ${id}`, status, target_date: null, updated_at: new Date('2026-10-20'), milestones: [], ...over });

  it('scopes with the A3 project rule plus the listed statuses only', async () => {
    p.project.findMany.mockResolvedValue([]);
    await loadProjectList(owner);
    const where = p.project.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual(projectAccessWhere(owner));
    expect(where.AND[1]).toEqual({ status: { in: ['ready', 'in_progress', 'review', 'done'] } });
    expect(p.task.findMany).not.toHaveBeenCalled();
  });

  it('a revoked contact sees nothing', async () => {
    expect(await loadProjectList({ ...owner, revoked: true })).toEqual({ active: [], complete: [] });
    expect(p.project.findMany).not.toHaveBeenCalled();
  });

  it('puts active first, complete after, with status words, progress and the next milestone', async () => {
    p.project.findMany.mockResolvedValue([
      proj('a', 'done'),
      proj('b', 'in_progress', { milestones: [{ name: 'Content ready', target_date: new Date('2026-11-01'), completed_at: null, sort_order: 0 }] }),
      proj('c', 'ready', { target_date: new Date('2026-12-01') }),
    ]);
    p.task.findMany.mockResolvedValue([
      { id: 't1', title: 'x', project_id: 'b', status: 'done', client_visible: true, approved: false },
      { id: 't2', title: 'y', project_id: 'b', status: 'in_progress', client_visible: true, approved: false },
      { id: 't3', title: 'z', project_id: 'b', status: 'abandoned', client_visible: true, approved: false },
    ]);
    const r = await loadProjectList(owner);
    expect(r.active.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r.complete.map((x) => x.id)).toEqual(['a']);
    expect(r.active[0]).toMatchObject({ status_label: 'In progress', progress: { done: 1, total: 2 }, next_milestone: { name: 'Content ready' } });
    expect(r.active[1]).toMatchObject({ status_label: 'Starting soon', progress: { done: 0, total: 0 } });
    expect(r.complete[0]).toMatchObject({ status_label: 'Complete', next_milestone: null });
  });

  it('counts only client-visible tasks the contact may see, and never selects money, tags or owners', async () => {
    p.project.findMany.mockResolvedValue([proj('b', 'in_progress')]);
    await loadProjectList(owner);
    const arg = p.task.findMany.mock.calls[0][0];
    expect(JSON.stringify(arg.where)).toContain('client_approved_at');
    expect(JSON.stringify(arg.where)).toContain('requested_by_contact_id');
    const keys = [...Object.keys(arg.select), ...Object.keys(p.project.findMany.mock.calls[0][0].select)];
    for (const banned of ['tags', 'assignee_id', 'estimated_minutes', 'billing_amount', 'is_billable']) expect(keys).not.toContain(banned);
  });
});
