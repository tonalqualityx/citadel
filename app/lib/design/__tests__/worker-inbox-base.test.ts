// Where a new page session branches from (task d3f5d25c): an untracked session on a project with a design track is cut
// from the track's branch, not the site's main branch.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { loadSessionBaseBranches } from '../worker-inbox';

type Row = { project_id: string; site_id: string; branch: string; stage: string; created_at: number };

function fakeDb(rows: Row[]) {
  const findMany = vi.fn(async (args: { where: { project_id: { in: string[] }; stage: { not: string } }; orderBy: { created_at: 'desc' } }) =>
    rows
      .filter((r) => args.where.project_id.in.includes(r.project_id) && r.stage !== args.where.stage.not)
      .sort((a, b) => b.created_at - a.created_at)
      .map(({ project_id, site_id, branch }) => ({ project_id, site_id, branch })));
  return { db: { designTrack: { findMany } } as never, findMany };
}

const S = (id: string, over: Partial<{ track_id: string | null; project_id: string | null; site_id: string }> = {}) => ({
  id, track_id: null, project_id: 'p1', site_id: 's1', ...over,
});

describe('loadSessionBaseBranches', () => {
  it('cuts an untracked page session from its project design track branch', async () => {
    const { db } = fakeDb([{ project_id: 'p1', site_id: 's1', branch: 'design/t-qghpgn4istuf7cwz', stage: 'rest_build', created_at: 1 }]);
    const out = await loadSessionBaseBranches([S('a')], db);
    expect(out.get('a')).toBe('design/t-qghpgn4istuf7cwz');
  });

  it('leaves the site main branch (no entry) when the project has no design track', async () => {
    const { db } = fakeDb([{ project_id: 'other', site_id: 's1', branch: 'design/t-aaaaaaaaaaaaaaaa', stage: 'refine', created_at: 1 }]);
    expect((await loadSessionBaseBranches([S('a')], db)).has('a')).toBe(false);
  });

  it('ignores a cancelled track and prefers the newest live one', async () => {
    const { db } = fakeDb([
      { project_id: 'p1', site_id: 's1', branch: 'design/t-oldoldoldoldoldo', stage: 'done', created_at: 1 },
      { project_id: 'p1', site_id: 's1', branch: 'design/t-newnewnewnewnewne', stage: 'refine', created_at: 2 },
      { project_id: 'p1', site_id: 's1', branch: 'design/t-cancelledcancell', stage: 'cancelled', created_at: 3 },
    ]);
    expect((await loadSessionBaseBranches([S('a')], db)).get('a')).toBe('design/t-newnewnewnewnewne');
  });

  it('needs the same site: a track on another site of the project is not used', async () => {
    const { db } = fakeDb([{ project_id: 'p1', site_id: 's2', branch: 'design/t-aaaaaaaaaaaaaaaa', stage: 'refine', created_at: 1 }]);
    expect((await loadSessionBaseBranches([S('a')], db)).has('a')).toBe(false);
  });

  it('never gives a tracked session or a session with no project a base, and skips the query when none qualifies', async () => {
    const { db, findMany } = fakeDb([{ project_id: 'p1', site_id: 's1', branch: 'design/t-aaaaaaaaaaaaaaaa', stage: 'refine', created_at: 1 }]);
    const out = await loadSessionBaseBranches([S('t', { track_id: 'trk' }), S('n', { project_id: null })], db);
    expect(out.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
