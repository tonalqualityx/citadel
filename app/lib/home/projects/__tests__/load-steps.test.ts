/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { loadProjectSteps } from '../load';

const U = '11111111-1111-4111-8111-111111111111';
const client = { id: 'c1', name: 'Jack', status: 'active' };
const proj = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Jack Gaughan Artist Site',
  next_step_text: 'Mike, email Jack.',
  next_step_source: 'bast',
  next_step_at: new Date('2026-11-10T08:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  client,
  ...over,
});

function db(projects: any[], last: any[] = []) {
  return {
    project: { findMany: vi.fn().mockResolvedValue(projects), update: vi.fn(), updateMany: vi.fn() },
    task: { groupBy: vi.fn().mockResolvedValue(last) },
  };
}

describe('loadProjectSteps', () => {
  it('reads in-progress projects whose next step is the user\'s and was written by Bast or by him, scoped by owner', async () => {
    const d = db([proj()], [{ project_id: 'p1', _max: { updated_at: new Date('2026-10-20T15:00:00Z') } }]);
    const r = await loadProjectSteps(d as any, U);
    expect(d.project.findMany.mock.calls[0][0].where).toEqual({
      status: 'in_progress',
      next_step_owner_id: U,
      next_step_source: { in: ['bast', 'mike'] },
      next_step_text: { not: null },
    });
    expect(r).toEqual([
      {
        project_id: 'p1',
        project_name: 'Jack Gaughan Artist Site',
        client,
        text: 'Mike, email Jack.',
        source: 'bast',
        step_at: new Date('2026-11-10T08:00:00Z'),
        last_activity_at: new Date('2026-10-20T15:00:00Z'),
      },
    ]);
    expect(d.task.groupBy.mock.calls[0][0]).toMatchObject({ by: ['project_id'], _max: { updated_at: true }, where: { project_id: { in: ['p1'] }, is_deleted: false } });
  });
  it('falls back to the project\'s own updated_at when it has no tasks, skips blank text, and writes nothing', async () => {
    const d = db([proj(), proj({ id: 'p2', next_step_text: '   ' })]);
    const r = await loadProjectSteps(d as any, U);
    expect(r.map((x) => x.project_id)).toEqual(['p1']);
    expect(r[0].last_activity_at).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(d.project.update).not.toHaveBeenCalled();
    expect(d.project.updateMany).not.toHaveBeenCalled();
  });
  it('reads no tasks when there is no step', async () => {
    const d = db([]);
    expect(await loadProjectSteps(d as any, U)).toEqual([]);
    expect(d.task.groupBy).not.toHaveBeenCalled();
  });
});
