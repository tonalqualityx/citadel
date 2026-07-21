import { describe, it, expect } from 'vitest';
import { getArcStatus, getArcProgressPercent } from '../arc-status';

describe('getArcStatus', () => {
  it('is empty when the arc has no tasks, regardless of closed_at', () => {
    expect(getArcStatus({ closed_at: null, tasks: [] })).toBe('empty');
    expect(getArcStatus({ closed_at: new Date(), tasks: [] })).toBe('empty');
  });

  it('is open when it has at least one non-terminal task and is not explicitly closed', () => {
    expect(
      getArcStatus({
        closed_at: null,
        tasks: [{ status: 'not_started' }, { status: 'in_progress' }],
      })
    ).toBe('open');
  });

  it('is open when some tasks are terminal but at least one is still active', () => {
    expect(
      getArcStatus({
        closed_at: null,
        tasks: [{ status: 'done' }, { status: 'in_progress' }],
      })
    ).toBe('open');
  });

  it('is complete when closed_at is set, even if tasks are still open (explicit close override)', () => {
    expect(
      getArcStatus({
        closed_at: new Date(),
        tasks: [{ status: 'not_started' }, { status: 'blocked' }],
      })
    ).toBe('complete');
  });

  it('is complete when every task is done', () => {
    expect(
      getArcStatus({
        closed_at: null,
        tasks: [{ status: 'done' }, { status: 'done' }],
      })
    ).toBe('complete');
  });

  it('is complete when every task is abandoned', () => {
    expect(
      getArcStatus({
        closed_at: null,
        tasks: [{ status: 'abandoned' }, { status: 'abandoned' }],
      })
    ).toBe('complete');
  });

  it('is complete when tasks are a mix of only done and abandoned (abandoned-only-mix regression guard)', () => {
    expect(
      getArcStatus({
        closed_at: null,
        tasks: [{ status: 'done' }, { status: 'abandoned' }, { status: 'abandoned' }],
      })
    ).toBe('complete');
  });

  it('is open when a review-status task is present alongside done tasks (review is not terminal)', () => {
    expect(
      getArcStatus({
        closed_at: null,
        tasks: [{ status: 'done' }, { status: 'review' }],
      })
    ).toBe('open');
  });
});

describe('getArcProgressPercent', () => {
  it('is 0 for an empty arc (never a 0%-guilt display, just a plain 0)', () => {
    expect(getArcProgressPercent([])).toBe(0);
  });

  it('is 0 when no tasks are resolved', () => {
    expect(getArcProgressPercent([{ status: 'not_started' }, { status: 'in_progress' }])).toBe(0);
  });

  it('is 100 when every task is done', () => {
    expect(getArcProgressPercent([{ status: 'done' }, { status: 'done' }])).toBe(100);
  });

  it('counts abandoned as resolved alongside done', () => {
    expect(
      getArcProgressPercent([{ status: 'done' }, { status: 'abandoned' }, { status: 'in_progress' }, { status: 'not_started' }])
    ).toBe(50);
  });

  it('rounds to the nearest whole percent', () => {
    expect(
      getArcProgressPercent([{ status: 'done' }, { status: 'not_started' }, { status: 'not_started' }])
    ).toBe(33);
  });

  it('does not count review as resolved', () => {
    expect(getArcProgressPercent([{ status: 'done' }, { status: 'review' }])).toBe(50);
  });
});
