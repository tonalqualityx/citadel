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

  it('a Bast comment matching the escalation pattern never counts via the comment path, even alongside a coinciding status change that is not itself a progress status', () => {
    // The coinciding status change here is 'blocked', not done/in_progress — it neither
    // satisfies bastCommentCoincidesWithProgress NOR the MEDIUM-3 activity-log-credit
    // rule (which only ever credits Bast status changes TO done/in_progress). This
    // isolates "an escalation comment never counts on its own" from the separate
    // activity-log-credit behavior covered by its own tests below.
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
            status_to: 'blocked',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('MEDIUM-3: a Bast activity-log status change to done/in_progress counts as movement on its own, regardless of any accompanying comment', () => {
    // Production-verbatim shape: the comment itself ("...gates green, nothing blocked.")
    // fails the comment-path escalation check (its first sentence contains "blocked"),
    // but the coinciding Bast status change to done is real work and must still register.
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            content: 'Tests pass, gates green, nothing blocked.',
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
            created_at: '2026-09-01T10:00:30.000Z',
            status_to: 'done',
          },
        ],
      })
    );
    expect(m).not.toBeNull();
    expect(m?.at).toBe('2026-09-01T10:00:30.000Z');
    expect(m?.what).toBe('moved task to done');
  });

  it('MEDIUM-3: a Bast status change to done counts as movement even with no comment at all', () => {
    const m = lastMovement(
      input({
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:00:00.000Z',
            status_to: 'done',
          },
        ],
      })
    );
    expect(m).toEqual({ at: '2026-09-01T10:00:00.000Z', who: 'Bast', what: 'moved task to done' });
  });

  it('MEDIUM-3: a Bast status change to something other than done/in_progress does NOT count', () => {
    const m = lastMovement(
      input({
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:00:00.000Z',
            status_to: 'blocked',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('MEDIUM-3: a non-Bast bot activity-log status change to done still never counts', () => {
    const m = lastMovement(
      input({
        activity_log: [
          {
            id: 'log-1',
            user_id: '9fc0c13c-4943-4d84-9b04-ff56e087228e', // Oracle bot
            user_name: 'Oracle',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:00:00.000Z',
            status_to: 'done',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('MEDIUM-3: a Bast comment opening with "done" counts via the comment path even though "cannot" appears later in the body (production-verbatim shape)', () => {
    // C4 (Phase 3 carry-over): the coinciding activity-log entry is 'done', not
    // 'in_progress' — in_progress no longer credits Bast with movement on its own OR
    // via the comment-coincidence check (PROGRESS_STATUSES is done-only as of C4).
    const m = lastMovement(
      input({
        comments: [
          {
            id: 'c1',
            task_id: 'task-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            content:
              '@Mike done. The 988 spec is written, reviewed, and ready to ship, but I cannot deploy it without your sign-off on the copy.',
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
            created_at: '2026-09-01T10:05:00.000Z',
            status_to: 'done',
          },
        ],
      })
    );
    // Both the comment path (leading "done" overrides the later "cannot") and the
    // activity-log path (Bast moved the task to done) agree movement happened;
    // lastMovement just returns whichever candidate is latest.
    expect(m).not.toBeNull();
  });

  it('C4: a Bast activity-log status change to in_progress no longer counts as movement, even alone', () => {
    const m = lastMovement(
      input({
        activity_log: [
          {
            id: 'log-1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            action: 'status_changed',
            entity_type: 'task',
            entity_id: 'task-1',
            created_at: '2026-09-01T10:00:00.000Z',
            status_to: 'in_progress',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('C4: a non-escalation Bast comment does NOT count via the comment path when the coinciding status change is to in_progress (only done coincidence credits)', () => {
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
            created_at: '2026-09-01T10:01:00.000Z',
            status_to: 'in_progress',
          },
        ],
      })
    );
    expect(m).toBeNull();
  });

  it('a non-escalation Bast comment counts via the comment path ONLY when it coincides (within 10 min) with a Bast status change to done/in_progress on the same task', () => {
    // MEDIUM-3: the coinciding activity-log entry is now ALSO independently a movement
    // candidate on its own (it's a Bast status change to done) — so overall movement is
    // never null here regardless of the window. What the coincidence window still
    // controls is whether the COMMENT ITSELF contributes a candidate; since both
    // candidates exist and the activity one is later (10:05 > 10:00), it's the one that
    // wins the max either way. See the two tests below for a case where the window does
    // NOT line up and the comment path contributes nothing at all.
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
    expect(m).toEqual({ at: '2026-09-01T10:05:00.000Z', who: 'Bast', what: 'moved task to done' });
  });

  it('a non-escalation Bast comment does NOT contribute via the comment path when the coinciding status change is more than 10 minutes away (but the activity-log entry still counts on its own, per MEDIUM-3)', () => {
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
    // Not null: the activity entry is its own independent movement candidate. What this
    // test actually isolates is that its `at`/`what` come from the ACTIVITY entry
    // (10:15, "moved task to done"), not from the comment ("made progress" @ 10:00) —
    // proving the comment path itself did NOT coincide and contributed nothing.
    expect(m).toEqual({ at: '2026-09-01T10:15:00.000Z', who: 'Bast', what: 'moved task to done' });
  });

  it('a non-escalation Bast comment does NOT contribute via the comment path when the coinciding status change is on a DIFFERENT task (but the activity-log entry still counts on its own, per MEDIUM-3)', () => {
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
    // Not null: the activity entry (on task-OTHER) is its own independent candidate.
    // The `at` (10:01, from the activity entry) proves the comment path (which would
    // have reported 10:00, "made progress") did not fire.
    expect(m).toEqual({ at: '2026-09-01T10:01:00.000Z', who: 'Bast', what: 'moved task to done' });
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
