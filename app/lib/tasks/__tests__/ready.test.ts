import { describe, it, expect } from 'vitest';
import { CLEARED_BLOCKER_STATUSES, hasOpenBlockerWhere, noOpenBlockerWhere, readySince } from '../ready';

const MADE = new Date('2026-11-10T00:00:00.000Z');

describe('ready: when a task is ready for its owner (task abe6e46c)', () => {
  it('only done and abandoned blockers are finished; Triage is not', () => {
    expect(CLEARED_BLOCKER_STATUSES).toEqual(['done', 'abandoned']);
    expect(noOpenBlockerWhere.blocked_by.none.status.notIn).not.toContain('triage');
    expect(hasOpenBlockerWhere.blocked_by.some.status.notIn).toEqual(['done', 'abandoned']);
  });

  it('a task with no blockers is ready from when it was made', () => {
    expect(readySince(MADE, [])).toEqual(MADE);
    expect(readySince(MADE, undefined)).toEqual(MADE);
  });

  it('becomes ready when its last blocker finishes', () => {
    const first = new Date('2026-11-20T00:00:00.000Z');
    const last = new Date('2026-11-28T00:00:00.000Z');
    expect(
      readySince(MADE, [
        { status: 'done', completed_at: first },
        { status: 'done', completed_at: last },
      ])
    ).toEqual(last);
  });

  it('an abandoned blocker without completed_at uses updated_at', () => {
    const at = new Date('2026-11-21T00:00:00.000Z');
    expect(readySince(MADE, [{ status: 'abandoned', completed_at: null, updated_at: at }])).toEqual(at);
  });

  it('ignores unfinished blockers and blockers finished before the task was made', () => {
    expect(readySince(MADE, [{ status: 'triage', completed_at: null, updated_at: new Date('2026-11-27T00:00:00Z') }])).toEqual(MADE);
    expect(readySince(MADE, [{ status: 'done', completed_at: new Date('2026-11-01T00:00:00Z') }])).toEqual(MADE);
  });
});
