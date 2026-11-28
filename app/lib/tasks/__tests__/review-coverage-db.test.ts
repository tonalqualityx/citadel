import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: { task: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() } } }));
vi.mock('@/lib/services/activity', () => ({ logUpdate: vi.fn() }));
vi.mock('@/lib/services/dependencies', () => ({ unblockEligibleDependents: vi.fn(async () => []) }));

import { prisma } from '@/lib/db/prisma';
import { logUpdate } from '@/lib/services/activity';
import { unblockEligibleDependents } from '@/lib/services/dependencies';
import { approveCoveredByReview, dropStampsCoveredBy } from '../review-coverage-db';

const findMany = prisma.task.findMany as Mock;
const updateMany = prisma.task.updateMany as Mock;
const update = prisma.task.update as Mock;

const PERSON = 'person-1';
const BAST = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';
const MIKE = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';

type Row = { id: string; title: string; tags: string[]; status: string; approved: boolean; needs_review: boolean };
const row = (id: string, o: Partial<Row> = {}): Row => ({ id, title: `Task ${id}`, tags: [], status: 'done', approved: false, needs_review: true, ...o });

/** findMany answers both the walk (select has blocked_by) and the covered-row load (select has title). */
function setup(rows: Row[]) {
  findMany.mockImplementation(async (args: { where: { id: { in: string[] } }; select: Record<string, unknown> }) => {
    const ids = args.where.id.in;
    if (args.select.blocked_by) {
      return ids.map((id) =>
        id === 'R'
          ? { id: 'R', project_id: 'P', tags: ['finalize-step'], status: 'done', is_deleted: false, blocked_by: rows.map((r) => ({ id: r.id })) }
          : { id, project_id: 'P', tags: [], status: 'done', is_deleted: false, blocked_by: [] },
      );
    }
    return rows.filter((r) => ids.includes(r.id));
  });
  updateMany.mockResolvedValue({ count: 1 });
}

beforeEach(() => vi.clearAllMocks());

describe('approveCoveredByReview', () => {
  it('approves covered done tasks, logs each with the source, releases dependents', async () => {
    setup([row('A'), row('B', { needs_review: false })]);
    const out = await approveCoveredByReview({ id: 'R', tags: ['finalize-step'] }, PERSON);
    expect(out).toEqual(['A', 'B']);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approved: true, approved_by_id: PERSON }) }));
    expect(logUpdate).toHaveBeenCalledWith(PERSON, 'task', 'A', 'Task A', expect.objectContaining({ approval_source: { from: null, to: 'review-step-covered' }, review_task_id: { from: null, to: 'R' } }));
    expect(unblockEligibleDependents).toHaveBeenCalledWith('A');
    expect(unblockEligibleDependents).toHaveBeenCalledWith('B');
  });

  it('skips security-looking, not-done and already-approved tasks', async () => {
    setup([row('S', { title: 'Security advisory fix' }), row('N', { status: 'in_progress' }), row('P', { approved: true }), row('OK')]);
    expect(await approveCoveredByReview({ id: 'R', tags: ['review-card'] }, PERSON)).toEqual(['OK']);
  });

  it('approves a covered security-looking task only when Mike finished the review', async () => {
    setup([row('S', { title: 'Security advisory fix' }), row('OK')]);
    expect(await approveCoveredByReview({ id: 'R', tags: ['review-card'] }, MIKE)).toEqual(['S', 'OK']);
  });

  it('approves nothing when a bot finished the review or the task is not a review step', async () => {
    setup([row('A')]);
    expect(await approveCoveredByReview({ id: 'R', tags: ['finalize-step'] }, BAST)).toEqual([]);
    expect(await approveCoveredByReview({ id: 'R', tags: ['ordinary'] }, PERSON)).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('skips a task someone else changed in between (guarded write)', async () => {
    setup([row('A')]);
    updateMany.mockResolvedValue({ count: 0 });
    expect(await approveCoveredByReview({ id: 'R', tags: ['finalize-step'] }, PERSON)).toEqual([]);
    expect(logUpdate).not.toHaveBeenCalled();
  });
});

describe('dropStampsCoveredBy', () => {
  it('clears the stamp on done, unapproved, stamped pieces only and invents no approvals', async () => {
    setup([row('A'), row('B', { needs_review: false }), row('C', { approved: true }), row('S', { tags: ['security'] }), row('N', { status: 'review' })]);
    expect(await dropStampsCoveredBy('R')).toEqual(['A']);
    expect(update).toHaveBeenCalledWith({ where: { id: 'A' }, data: { needs_review: false } });
    expect(updateMany).not.toHaveBeenCalled();
    expect(unblockEligibleDependents).toHaveBeenCalledWith('A');
  });
});
