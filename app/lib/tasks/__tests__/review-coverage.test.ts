import { describe, it, expect } from 'vitest';
import { isReviewStep, coveredByReviewStep, isCoveredByReviewStep, type CoverageNode, type NodeLoader } from '../review-coverage';

type N = { id: string; project?: string | null; tags?: string[]; status?: string; deleted?: boolean; blockedBy?: string[] };

/** Builds both loaders from one list of tasks; `blockedBy` is the source of truth and `blocking` is derived. */
function graph(nodes: N[]): { back: NodeLoader; fwd: NodeLoader } {
  const make = (dir: 'back' | 'fwd'): NodeLoader => async (ids) => {
    const m = new Map<string, CoverageNode>();
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id);
      if (!n) continue;
      const edges = dir === 'back' ? n.blockedBy ?? [] : nodes.filter((o) => (o.blockedBy ?? []).includes(id)).map((o) => o.id);
      m.set(id, { id, project_id: n.project ?? null, tags: n.tags ?? [], status: n.status ?? 'done', is_deleted: n.deleted ?? false, edges });
    }
    return m;
  };
  return { back: make('back'), fwd: make('fwd') };
}

describe('isReviewStep', () => {
  it('is a review card or a finalize-step', () => {
    expect(isReviewStep(['review-card'])).toBe(true);
    expect(isReviewStep(['client-review'])).toBe(true);
    expect(isReviewStep(['x', 'finalize-step'])).toBe(true);
    expect(isReviewStep(['preview', 'needs-review'])).toBe(false);
    expect(isReviewStep(null)).toBe(false);
  });
});

describe('coveredByReviewStep', () => {
  const ids = (xs: CoverageNode[]) => xs.map((x) => x.id).sort();

  it('walks blockers transitively inside the project', async () => {
    const g = graph([
      { id: 'R', project: 'P', tags: ['finalize-step'], blockedBy: ['A', 'B'] },
      { id: 'A', project: 'P', blockedBy: ['C'] },
      { id: 'B', project: 'P' },
      { id: 'C', project: 'P' },
    ]);
    expect(ids(await coveredByReviewStep('R', g.back))).toEqual(['A', 'B', 'C']);
  });

  it('stays in the review step project and skips deleted tasks', async () => {
    const g = graph([
      { id: 'R', project: 'P', tags: ['review-card'], blockedBy: ['A', 'X', 'D'] },
      { id: 'A', project: 'P', blockedBy: ['Y'] },
      { id: 'X', project: 'Q' },
      { id: 'Y', project: 'Q' },
      { id: 'D', project: 'P', deleted: true },
    ]);
    expect(ids(await coveredByReviewStep('R', g.back))).toEqual(['A']);
  });

  it('does not walk through another review step', async () => {
    const g = graph([
      { id: 'R2', project: 'P', tags: ['review-card'], blockedBy: ['M'] },
      { id: 'M', project: 'P', tags: ['finalize-step'], blockedBy: ['A'] },
      { id: 'A', project: 'P' },
    ]);
    expect(ids(await coveredByReviewStep('R2', g.back))).toEqual([]);
  });

  it('is cycle safe', async () => {
    const g = graph([
      { id: 'R', project: 'P', tags: ['review-card'], blockedBy: ['A'] },
      { id: 'A', project: 'P', blockedBy: ['B'] },
      { id: 'B', project: 'P', blockedBy: ['A', 'R'] },
    ]);
    expect(ids(await coveredByReviewStep('R', g.back))).toEqual(['A', 'B']);
  });

  it('a review step with no project covers direct blockers only', async () => {
    const g = graph([
      { id: 'R', tags: ['review-card'], blockedBy: ['A'] },
      { id: 'A', blockedBy: ['B'] },
      { id: 'B' },
    ]);
    expect(ids(await coveredByReviewStep('R', g.back))).toEqual(['A']);
  });

  it('returns every task of a large project (no cap)', async () => {
    const pieces: N[] = Array.from({ length: 500 }, (_, i) => ({ id: `T${i}`, project: 'P' }));
    const g = graph([{ id: 'R', project: 'P', tags: ['review-card'], blockedBy: pieces.map((p) => p.id) }, ...pieces]);
    expect((await coveredByReviewStep('R', g.back)).length).toBe(500);
  });
});

describe('isCoveredByReviewStep', () => {
  it('finds a review step downstream in the same project, transitively', async () => {
    const g = graph([
      { id: 'A', project: 'P' },
      { id: 'B', project: 'P', blockedBy: ['A'] },
      { id: 'R', project: 'P', tags: ['finalize-step'], status: 'blocked', blockedBy: ['B'] },
    ]);
    expect(await isCoveredByReviewStep('A', g.fwd)).toBe(true);
  });

  it('is false with no review step, another project, an abandoned review step, or a review step in between', async () => {
    const g = graph([
      { id: 'A', project: 'P' },
      { id: 'B', project: 'P', blockedBy: ['A'] },
      { id: 'C', project: 'Q', blockedBy: ['B'] },
      { id: 'R', project: 'Q', tags: ['review-card'], blockedBy: ['C'] },
      { id: 'S', project: 'P', tags: ['review-card'], status: 'abandoned', blockedBy: ['B'] },
      { id: 'M', project: 'P', tags: ['review-card'], blockedBy: ['E'] },
      { id: 'E', project: 'P' },
      { id: 'R3', project: 'P', tags: ['review-card'], blockedBy: ['M'] },
    ]);
    expect(await isCoveredByReviewStep('A', g.fwd)).toBe(false);
    // E is covered by M directly, and that is the only way R3 could reach it: walking never passes through M to R3 for tasks upstream of M.
    expect(await isCoveredByReviewStep('E', g.fwd)).toBe(true);
  });

  it('is cycle safe and no-project means direct only', async () => {
    const g = graph([
      { id: 'A', project: 'P', blockedBy: ['B'] },
      { id: 'B', project: 'P', blockedBy: ['A'] },
      { id: 'N1' },
      { id: 'N2', blockedBy: ['N1'] },
      { id: 'NR', tags: ['review-card'], blockedBy: ['N2'] },
      { id: 'N3', tags: ['review-card'], blockedBy: ['N1'] },
    ]);
    expect(await isCoveredByReviewStep('A', g.fwd)).toBe(false);
    expect(await isCoveredByReviewStep('N2', g.fwd)).toBe(true);
    expect(await isCoveredByReviewStep('N1', g.fwd)).toBe(true); // N3 is a direct dependent
    const g2 = graph([{ id: 'N1' }, { id: 'N2', blockedBy: ['N1'] }, { id: 'NR', tags: ['review-card'], blockedBy: ['N2'] }]);
    expect(await isCoveredByReviewStep('N1', g2.fwd)).toBe(false);
  });
});
