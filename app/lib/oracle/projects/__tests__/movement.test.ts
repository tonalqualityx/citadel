import { describe, it, expect } from 'vitest';
import { lastMovement, isStale, daysSince, type LastMovementInput } from '../movement';
import { BAST_USER_ID } from '../gate-constants';

function input(overrides: Partial<LastMovementInput> = {}): LastMovementInput {
  return {
    time_entries: [],
    activity_log: [],
    comments: [],
    ...overrides,
  };
}

describe('lastMovement', () => {
  it('returns null when nothing has happened', () => {
    expect(lastMovement(input())).toBeNull();
  });

  it('counts a time entry as movement', () => {
    const m = lastMovement(
      input({ time_entries: [{ user_id: 'user-1', user_name: 'Alex', started_at: '2026-09-01T10:00:00.000Z' }] })
    );
    expect(m).toEqual({ at: '2026-09-01T10:00:00.000Z', who: 'Alex', what: 'logged time' });
  });

  it('counts a human activity-log status change as movement', () => {
    const m = lastMovement(
      input({
        activity_log: [
          {
            id: 'log-1',
            user_id: 'user-1',
            user_name: 'Alex',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:00:00.000Z',
            status_to: 'in_progress',
          },
        ],
      })
    );
    expect(m?.at).toBe('2026-09-01T10:00:00.000Z');
    expect(m?.what).toBe('moved task to in_progress');
  });

  it('counts a human comment as movement', () => {
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: 'user-1',
            user_name: 'Alex',
            content: 'Done with this piece.',
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
      })
    );
    expect(m).toEqual({ at: '2026-09-01T10:00:00.000Z', who: 'Alex', what: 'commented' });
  });

  it('a bot (non-Bast) comment never counts', () => {
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: '9fc0c13c-4943-4d84-9b04-ff56e087228e', // Oracle bot
            user_name: 'Oracle',
            content: 'Finished the sweep.',
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('a Bast comment matching the escalation pattern never counts, even alongside a coinciding status change', () => {
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            content: 'Parking this, needs-mike.',
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:01:00.000Z',
            status_to: 'in_progress',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('a non-escalation Bast comment counts ONLY when it coincides (within 10 min) with a Bast status change to done/in_progress on the same task', () => {
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            content: 'Wrote the draft and moved it forward.',
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:05:00.000Z', // 5 min later, within window
            status_to: 'done',
          },
        ],
      })
    );
    expect(m).toEqual({ at: '2026-09-01T10:00:00.000Z', who: 'Bast', what: 'made progress' });
  });

  it('a non-escalation Bast comment does NOT count when the coinciding status change is more than 10 minutes away', () => {
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            content: 'Wrote the draft.',
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:15:00.000Z', // 15 min later, outside window
            status_to: 'done',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('a non-escalation Bast comment does NOT count when the coinciding status change is on a DIFFERENT task', () => {
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            content: 'Wrote the draft.',
            created_at: '2026-09-01T10:00:00.000Z',
          },
        ],
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-OTHER',
            created_at: '2026-09-01T10:01:00.000Z',
            status_to: 'done',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('returns the MOST RECENT candidate across all sources', () => {
    const m = lastMovement(
      input({
        time_entries: [{ user_id: 'u1', user_name: 'Alex', started_at: '2026-09-01T00:00:00.000Z' }],
        comments: [
          {
            id: 'c1',
            task_id: 't1',
            user_id: 'u2',
            user_name: 'Jamie',
            content: 'Latest note',
            created_at: '2026-09-03T00:00:00.000Z',
          },
        ],
      })
    );
    expect(m?.at).toBe('2026-09-03T00:00:00.000Z');
    expect(m?.who).toBe('Jamie');
  });
});

describe('daysSince', () => {
  it('returns Infinity for null', () => {
    expect(daysSince(null, new Date('2026-09-10T00:00:00.000Z'))).toBe(Infinity);
  });

  it('computes whole days between the timestamp and now', () => {
    expect(daysSince('2026-09-01T00:00:00.000Z', new Date('2026-09-08T00:00:00.000Z'))).toBe(7);
  });
});

describe('isStale', () => {
  it('is not stale with no movement history but treats it as Infinity days -> stale', () => {
    // No movement at all is the maximally stale case.
    expect(isStale(input(), new Date())).toBe(true);
  });

  it('is not stale when the last movement was under 7 days ago', () => {
    const now = new Date('2026-09-08T00:00:00.000Z');
    const recent = input({
      time_entries: [{ user_id: 'u1', user_name: 'Alex', started_at: '2026-09-05T00:00:00.000Z' }],
    });
    expect(isStale(recent, now)).toBe(false);
  });

  it('is stale at exactly 7 days', () => {
    const now = new Date('2026-09-08T00:00:00.000Z');
    const atThreshold = input({
      time_entries: [{ user_id: 'u1', user_name: 'Alex', started_at: '2026-09-01T00:00:00.000Z' }],
    });
    expect(isStale(atThreshold, now)).toBe(true);
  });
});
