import { describe, it, expect } from 'vitest';
import {
  classifyProjectBlockers,
  ownerIsMike,
  type ClassifyProjectBlockersInput,
  type BlockerTask,
} from '../blockers';
import { BAST_USER_ID, MIKE_USER_ID } from '../gate-constants';

const NOW = new Date('2026-09-10T12:00:00.000Z');

function baseInput(overrides: Partial<ClassifyProjectBlockersInput> = {}): ClassifyProjectBlockersInput {
  return {
    project: { id: 'proj-1', name: 'Herba rebuild', client: { id: 'client-1', name: 'Herba' } },
    tasks: [],
    mentions: [],
    session_asks: [],
    emails: [],
    approval_requests: [],
    calendar_events: [],
    time_entries: [],
    dismissals: [],
    next_step_candidate: null,
    last_movement_at: NOW.toISOString(), // fresh by default so stale/meeting_risk don't fire incidentally
    stale_muted_until: null,
    ...overrides,
  };
}

function task(overrides: Partial<BlockerTask> = {}): BlockerTask {
  return {
    id: 'task-1',
    title: 'Build homepage',
    status: 'not_started',
    tags: [],
    needs_review: false,
    approved: false,
    assignee_id: null,
    assignee_name: null,
    sop_title: null,
    updated_at: '2026-09-09T00:00:00.000Z',
    blocked_by_ids: [],
    phase_sort: 0,
    sort_order: 0,
    last_comment: null,
    arc: null,
    ...overrides,
  };
}

describe('classifyProjectBlockers — decision', () => {
  it('fires when a task is tagged needs-mike and the last comment is by a bot', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: ['needs-mike'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Need your call on the color palette.',
          },
        }),
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({
      kind: 'decision',
      id: 'decision:task-1',
      detail: 'Need your call on the color palette.',
      owner: { id: MIKE_USER_ID, name: 'Mike', is_mike: true },
    });
    expect(blockers[0].actions).not.toContain('dismiss'); // decision resolves via state change, not dismiss
  });

  it('does NOT fire when the last comment is by a human (already replied to)', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: ['needs-mike'],
          last_comment: {
            id: 'c1',
            user_id: 'user-1',
            user_name: 'Mike',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Blue, obviously.',
          },
        }),
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('does NOT fire without the needs-mike tag', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: [],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Note.',
          },
        }),
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  // HIGH-1
  it('does NOT fire when the task is done, even tagged needs-mike with a bot last comment', () => {
    const input = baseInput({
      tasks: [
        task({
          status: 'done',
          tags: ['needs-mike'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Need your call on the color palette.',
          },
        }),
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  // HIGH-1
  it('does NOT fire when the task is abandoned, even tagged needs-mike with a bot last comment', () => {
    const input = baseInput({
      tasks: [
        task({
          status: 'abandoned',
          tags: ['needs-mike'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Need your call on the color palette.',
          },
        }),
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  // HIGH-1
  it('still fires on an open (not_started) task tagged needs-mike', () => {
    const input = baseInput({
      tasks: [
        task({
          status: 'not_started',
          tags: ['needs-mike'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Need your call on the color palette.',
          },
        }),
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(1);
  });
});

describe('classifyProjectBlockers — clarification', () => {
  it('fires when tagged awaiting-clarification with a bot last comment', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: ['awaiting-clarification'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Which domain should this point to?',
          },
        }),
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe('clarification');
    expect(blockers[0].owner.is_mike).toBe(true);
  });

  // HIGH-1
  it('does NOT fire when the task is done, even tagged awaiting-clarification', () => {
    const input = baseInput({
      tasks: [
        task({
          status: 'done',
          tags: ['awaiting-clarification'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: 'Which domain should this point to?',
          },
        }),
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });
});

describe('classifyProjectBlockers — review', () => {
  it('fires for a done+needs_review+!approved task', () => {
    const input = baseInput({
      tasks: [task({ status: 'done', needs_review: true, approved: false })],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'review', id: 'review:task-1' });
    expect(blockers[0].actions).toEqual(expect.arrayContaining(['approve', 'request_changes', 'dismiss']));
  });

  it('does not fire once approved', () => {
    const input = baseInput({
      tasks: [task({ status: 'done', needs_review: true, approved: true })],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('is dropped when a dismissal matches the current task.updated_at marker', () => {
    const t = task({ status: 'done', needs_review: true, approved: false, updated_at: '2026-09-09T00:00:00.000Z' });
    const input = baseInput({
      tasks: [t],
      dismissals: [
        { kind: 'task', source_id: 'task-1', source_marker: '2026-09-09T00:00:00.000Z', dismissed_at: NOW.toISOString() },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('resurfaces once the task updates again after the dismissed marker', () => {
    const t = task({ status: 'done', needs_review: true, approved: false, updated_at: '2026-09-11T00:00:00.000Z' });
    const input = baseInput({
      tasks: [t],
      dismissals: [
        { kind: 'task', source_id: 'task-1', source_marker: '2026-09-09T00:00:00.000Z', dismissed_at: NOW.toISOString() },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(1);
  });
});

describe('classifyProjectBlockers — session_ask', () => {
  it('fires for a session ask tied to the project', () => {
    const input = baseInput({
      session_asks: [
        { session_external_id: 'sess-1', queue: 'decide', text: 'Which CMS?', severity: 'launch_blocking', waiting_since: '2026-09-09T00:00:00.000Z' },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'session_ask', title: 'Which CMS?', owner: { is_mike: true } });
  });

  it('is dropped when dismissed with a marker matching the current ask text', () => {
    const input = baseInput({
      session_asks: [{ session_external_id: 'sess-1', queue: 'decide', text: 'Which CMS?', severity: null, waiting_since: null }],
      dismissals: [],
    });
    const blockersBefore = classifyProjectBlockers(input, NOW);
    const marker = blockersBefore[0].id; // not the real hash, just to grab the shape; recompute properly below
    void marker;

    // Recreate with a matching dismissal by reusing the same hash the module computes
    // internally is not exposed, so instead assert the round trip: dismiss, then the
    // SAME text again is suppressed, but a CHANGED text is not.
    const dismissed = classifyProjectBlockers(
      baseInput({
        session_asks: [{ session_external_id: 'sess-1', queue: 'decide', text: 'Which CMS?', severity: null, waiting_since: null }],
        dismissals: [{ kind: 'session_ask', source_id: 'sess-1', source_marker: hashOf('Which CMS?'), dismissed_at: NOW.toISOString() }],
      }),
      NOW
    );
    expect(dismissed).toHaveLength(0);

    const changedTextStillFires = classifyProjectBlockers(
      baseInput({
        session_asks: [{ session_external_id: 'sess-1', queue: 'decide', text: 'Which CMS now?', severity: null, waiting_since: null }],
        dismissals: [{ kind: 'session_ask', source_id: 'sess-1', source_marker: hashOf('Which CMS?'), dismissed_at: NOW.toISOString() }],
      }),
      NOW
    );
    expect(changedTextStillFires).toHaveLength(1);
  });

  // LOW-8
  it('source.url points at /oracle with the session id as a query param, not an API-only path', () => {
    const input = baseInput({
      session_asks: [
        { session_external_id: 'sess-1', queue: 'decide', text: 'Which CMS?', severity: null, waiting_since: null },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].source.url).toBe('/oracle?session=sess-1');
  });
});

// Mirrors blockers.ts's private hashAskText (djb2, hex) so the dismissal test above can
// construct a matching marker without the module exporting its internal hash.
function hashOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

describe('classifyProjectBlockers — mention', () => {
  it('fires for a pre-filtered mention with no later Mike reply', () => {
    const input = baseInput({
      tasks: [task()],
      mentions: [
        { id: 'c1', task_id: 'task-1', author: { id: 'user-2', name: 'Jamie' }, created_at: '2026-09-09T00:00:00.000Z', excerpt: '@Mike thoughts?' },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'mention', title: 'Jamie mentioned you', owner: { is_mike: true } });
  });

  it('is dropped when dismissed by comment id', () => {
    const input = baseInput({
      tasks: [task()],
      mentions: [{ id: 'c1', task_id: 'task-1', author: { id: 'user-2', name: 'Jamie' }, created_at: '2026-09-09T00:00:00.000Z', excerpt: 'hi' }],
      dismissals: [{ kind: 'mention', source_id: 'c1', source_marker: 'c1', dismissed_at: NOW.toISOString() }],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  // LOW-12 — a NEW mention (different comment id) on the same task, arriving after an
  // earlier mention was dismissed, is NOT suppressed by that earlier dismissal — each
  // mention's dismissal marker is its own comment id, not the task.
  it('re-surfaces on a new mention for the same task after an earlier one was dismissed', () => {
    const input = baseInput({
      tasks: [task()],
      mentions: [
        { id: 'c2', task_id: 'task-1', author: { id: 'user-2', name: 'Jamie' }, created_at: '2026-09-10T00:00:00.000Z', excerpt: 'ping again' },
      ],
      dismissals: [{ kind: 'mention', source_id: 'c1', source_marker: 'c1', dismissed_at: NOW.toISOString() }],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].id).toBe('mention:c2');
  });

  // HIGH-1
  it('does NOT fire when the mentioned task is done', () => {
    const input = baseInput({
      tasks: [task({ status: 'done' })],
      mentions: [{ id: 'c1', task_id: 'task-1', author: { id: 'user-2', name: 'Jamie' }, created_at: '2026-09-09T00:00:00.000Z', excerpt: 'hi' }],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  // HIGH-1
  it('does NOT fire when the mentioned task is abandoned', () => {
    const input = baseInput({
      tasks: [task({ status: 'abandoned' })],
      mentions: [{ id: 'c1', task_id: 'task-1', author: { id: 'user-2', name: 'Jamie' }, created_at: '2026-09-09T00:00:00.000Z', excerpt: 'hi' }],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  // LOW-8
  it('source.url points at the task, unchanged (mention has no separate deep link)', () => {
    const input = baseInput({
      tasks: [task()],
      mentions: [{ id: 'c1', task_id: 'task-1', author: { id: 'user-2', name: 'Jamie' }, created_at: '2026-09-09T00:00:00.000Z', excerpt: 'hi' }],
    });
    expect(classifyProjectBlockers(input, NOW)[0].source.url).toBe('/tasks/task-1');
  });
});

// MEDIUM-4
describe('classifyProjectBlockers — decision/mention dedup', () => {
  it('does NOT also emit a mention when the same comment already produced a decision blocker', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: ['needs-mike'],
          last_comment: {
            id: 'shared-comment',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: '@Mike need your call here.',
          },
        }),
      ],
      mentions: [
        {
          id: 'shared-comment',
          task_id: 'task-1',
          author: { id: BAST_USER_ID, name: 'Bast' },
          created_at: '2026-09-09T00:00:00.000Z',
          excerpt: '@Mike need your call here.',
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe('decision');
  });

  it('still emits a mention for a DIFFERENT comment id on the same task', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: ['needs-mike'],
          last_comment: {
            id: 'comment-A',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-09T00:00:00.000Z',
            content_excerpt: '@Mike need your call here.',
          },
        }),
      ],
      mentions: [
        {
          id: 'comment-B',
          task_id: 'task-1',
          author: { id: BAST_USER_ID, name: 'Bast' },
          created_at: '2026-09-08T00:00:00.000Z',
          excerpt: 'earlier ping',
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers.map((b) => b.kind).sort()).toEqual(['decision', 'mention']);
  });
});

describe('classifyProjectBlockers — client_email', () => {
  it('fires for an unreplied linked email', () => {
    const input = baseInput({
      emails: [
        { id: 'email-1', deep_link: 'https://mail.google.com/mail/u/0/#inbox/email-1', from: 'client@herba.com', subject: 'New logo files', gist: 'Attached the logo pack', received_at: '2026-09-09T00:00:00.000Z', replied: false },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].detail).toBe('Attached the logo pack');
  });

  it('never fires once replied', () => {
    const input = baseInput({
      emails: [{ id: 'email-1', deep_link: 'https://mail.google.com/mail/u/0/#inbox/email-1', from: 'client@herba.com', subject: 'New logo files', gist: null, received_at: '2026-09-09T00:00:00.000Z', replied: true }],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('flags "asks for status, no time logged since" when the subject matches and no time was logged after it arrived', () => {
    const input = baseInput({
      emails: [
        { id: 'email-1', deep_link: 'https://mail.google.com/mail/u/0/#inbox/email-1', from: 'client@herba.com', subject: 'Any update on the build?', gist: null, received_at: '2026-09-09T00:00:00.000Z', replied: false },
      ],
      time_entries: [],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    // Dash-law fix: two plain sentences, not a dash-joined fragment.
    expect(blockers[0].detail).toMatch(/Asks for status\. No time logged since\./);
  });

  it('does NOT flag the status pattern when time WAS logged after the email arrived', () => {
    const input = baseInput({
      emails: [
        { id: 'email-1', deep_link: 'https://mail.google.com/mail/u/0/#inbox/email-1', from: 'client@herba.com', subject: 'Any update on the build?', gist: null, received_at: '2026-09-09T00:00:00.000Z', replied: false },
      ],
      time_entries: [{ started_at: '2026-09-09T12:00:00.000Z' }],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers[0].detail).not.toMatch(/no time logged/);
  });

  // LOW-8
  it('source.url is the EmailAsk deep_link (Gmail), not the API-only /email-asks path', () => {
    const input = baseInput({
      emails: [
        {
          id: 'email-1',
          deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-abc',
          from: 'client@herba.com',
          subject: 'New logo files',
          gist: null,
          received_at: '2026-09-09T00:00:00.000Z',
          replied: false,
        },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].source.url).toBe('https://mail.google.com/mail/u/0/#inbox/msg-abc');
  });
});

describe('classifyProjectBlockers — client_approval', () => {
  it('owner is Mike for a draft', () => {
    const input = baseInput({
      approval_requests: [
        { id: 'ar-1', task_id: 'task-1', created_at: '2026-09-01T00:00:00.000Z', status: 'draft', sent_at: null, chase_after_days: 3, send_attempt_at: null, replied_at: null, contact: null },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].owner.is_mike).toBe(true);
  });

  it('owner is the client contact once sent and within the chase window', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sent',
          sent_at: '2026-09-10T00:00:00.000Z', // sent today, well inside chase_after_days
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    const blocker = classifyProjectBlockers(input, NOW)[0];
    expect(blocker.owner).toEqual({ id: 'contact-1', name: 'Jane Client', is_mike: false });
    expect(blocker.kind).toBe('client_approval');
  });

  it('owner flips to Mike once the chase window (business days) has elapsed', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sent',
          sent_at: '2026-09-01T00:00:00.000Z', // Tuesday; NOW is 2026-09-10 (Thursday) — well over 3 business days
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    const blocker = classifyProjectBlockers(input, NOW)[0];
    expect(blocker.owner.is_mike).toBe(true);
  });

  it('owner is Mike once the client has replied', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'replied',
          sent_at: '2026-09-09T00:00:00.000Z',
          chase_after_days: 3, send_attempt_at: null,
          replied_at: '2026-09-10T00:00:00.000Z',
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].owner.is_mike).toBe(true);
  });

  it('does not fire once approved or changes_requested or cancelled', () => {
    for (const status of ['approved', 'changes_requested', 'cancelled'] as const) {
      const input = baseInput({
        approval_requests: [{ id: 'ar-1', task_id: 'task-1', created_at: '2026-09-01T00:00:00.000Z', status, sent_at: null, chase_after_days: 3, send_attempt_at: null, replied_at: null, contact: null }],
      });
      expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
    }
  });

  it('client_approval blockers never carry a dismiss action', () => {
    const input = baseInput({
      approval_requests: [{ id: 'ar-1', task_id: 'task-1', created_at: '2026-09-01T00:00:00.000Z', status: 'draft', sent_at: null, chase_after_days: 3, send_attempt_at: null, replied_at: null, contact: null }],
    });
    expect(classifyProjectBlockers(input, NOW)[0].actions).not.toContain('dismiss');
  });

  // MEDIUM-7 — a draft/queued approval has no sent_at/replied_at; `since` must fall back
  // to created_at (so it actually ages) rather than `now` (which never ages at all).
  it('a draft approval\'s `since` is its created_at, not `now`', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-08-20T00:00:00.000Z',
          status: 'draft',
          sent_at: null,
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: null,
        },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].since).toBe('2026-08-20T00:00:00.000Z');
  });

  it('a queued approval\'s `since` is also its created_at', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-08-15T00:00:00.000Z',
          status: 'queued',
          sent_at: null,
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: null,
        },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].since).toBe('2026-08-15T00:00:00.000Z');
  });

  // Phase 5 fixes (HIGH-1/MEDIUM-1, layer 2) — a 'sending' row is the sender mid-flight
  // (or retry-recording a confirmed delivery); it is not a blocker until it's been
  // claimed for more than 30 minutes with nothing recorded.
  it('a freshly-claimed sending row is not a blocker at all', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sending',
          sent_at: null,
          chase_after_days: 3,
          send_attempt_at: '2026-09-10T11:45:00.000Z', // 15 minutes before NOW
          replied_at: null,
          contact: null,
        },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('a sending row stuck over 30 minutes surfaces as "Approval send unconfirmed", owned by Mike, with the two manual-override actions', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sending',
          sent_at: null,
          chase_after_days: 3,
          send_attempt_at: '2026-09-10T11:00:00.000Z', // 60 minutes before NOW
          replied_at: null,
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    const blocker = blockers[0];
    expect(blocker.kind).toBe('client_approval');
    expect(blocker.owner).toEqual({ id: MIKE_USER_ID, name: 'Mike', is_mike: true });
    expect(blocker.detail).toContain('unconfirmed');
    expect(blocker.detail.toLowerCase()).toContain('do not resend');
    expect(blocker.actions).toEqual(['mark_sent_manually', 'release_to_draft']);
    expect(blocker.since).toBe('2026-09-10T11:00:00.000Z');
  });

  it('a stuck sending row falls back to created_at for `since` when send_attempt_at is somehow null', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sending',
          sent_at: null,
          chase_after_days: 3,
          send_attempt_at: null,
          replied_at: null,
          contact: null,
        },
      ],
    });
    expect(classifyProjectBlockers(input, NOW)[0].since).toBe('2026-09-01T00:00:00.000Z');
  });

  // Spec polish (2026-09-04) — chase_draft/chase_target render on client_approval
  // blockers past the chase clock, and a 'chase' row never becomes its own blocker.
  describe('chase_draft / chase_target', () => {
    it('are both null while still within the chase window', () => {
      const blocker = classifyProjectBlockers(
        baseInput({
          approval_requests: [
            {
              id: 'ar-1',
              task_id: 'task-1',
              created_at: '2026-09-01T00:00:00.000Z',
              status: 'sent',
              sent_at: '2026-09-10T00:00:00.000Z', // sent today, well inside chase_after_days
              chase_after_days: 3,
              send_attempt_at: null,
              replied_at: null,
              contact: { id: 'contact-1', name: 'Jane Client' },
            },
          ],
        }),
        NOW
      )[0];
      expect(blocker.chase_draft).toBeNull();
      expect(blocker.chase_target).toBeNull();
      // chase_due_at is still populated (a future date) even though the clock hasn't
      // run out — only chase_draft/chase_target wait for the overdue moment.
      expect(blocker.chase_due_at).not.toBeNull();
    });

    it('populate once the chase window (business days) has elapsed, using the contact\'s id and email', () => {
      const blocker = classifyProjectBlockers(
        baseInput({
          approval_requests: [
            {
              id: 'ar-1',
              task_id: 'task-1',
              created_at: '2026-09-01T00:00:00.000Z',
              status: 'sent',
              sent_at: '2026-09-01T00:00:00.000Z', // Tuesday; NOW is 2026-09-10 — well over 3 business days
              chase_after_days: 3,
              send_attempt_at: null,
              replied_at: null,
              contact: { id: 'contact-1', name: 'Jane Client', email: 'jane@client.com' },
            },
          ],
          tasks: [task({ id: 'task-1', title: 'Approve homepage copy' })],
        }),
        NOW
      )[0];
      expect(blocker.chase_draft).not.toBeNull();
      expect(blocker.chase_draft?.subject).toContain('Approve homepage copy');
      expect(blocker.chase_draft?.body).toContain('3 business days');
      expect(blocker.chase_target).toEqual({ task_id: 'task-1', contact_id: 'contact-1', email: 'jane@client.com' });
    });

    it('falls back to the row\'s own to_email when no contact email is on file', () => {
      const blocker = classifyProjectBlockers(
        baseInput({
          approval_requests: [
            {
              id: 'ar-1',
              task_id: 'task-1',
              created_at: '2026-09-01T00:00:00.000Z',
              status: 'sent',
              sent_at: '2026-09-01T00:00:00.000Z',
              chase_after_days: 3,
              send_attempt_at: null,
              replied_at: null,
              contact: null,
              to_email: 'plain@client.com',
            },
          ],
        }),
        NOW
      )[0];
      expect(blocker.chase_target).toEqual({ task_id: 'task-1', contact_id: null, email: 'plain@client.com' });
    });

    it('email is null when neither a contact email nor to_email is on file', () => {
      const blocker = classifyProjectBlockers(
        baseInput({
          approval_requests: [
            {
              id: 'ar-1',
              task_id: 'task-1',
              created_at: '2026-09-01T00:00:00.000Z',
              status: 'sent',
              sent_at: '2026-09-01T00:00:00.000Z',
              chase_after_days: 3,
              send_attempt_at: null,
              replied_at: null,
              contact: null,
            },
          ],
        }),
        NOW
      )[0];
      expect(blocker.chase_target).toEqual({ task_id: 'task-1', contact_id: null, email: null });
    });
  });

  // Spec polish (2026-09-04) — a 'chase' row is a follow-up attached to the original
  // approval, never a blocker of its own (it would otherwise double up on the Projects
  // tab alongside the original, still-overdue client_approval blocker it was queued for).
  describe('kind: chase rows never produce their own blocker', () => {
    it.each(['draft', 'queued', 'sent', 'replied'] as const)('kind:chase, status:%s produces no blocker', (status) => {
      const input = baseInput({
        approval_requests: [
          {
            id: 'ar-chase-1',
            task_id: 'task-1',
            created_at: '2026-09-01T00:00:00.000Z',
            status,
            sent_at: status === 'sent' || status === 'replied' ? '2026-09-01T00:00:00.000Z' : null,
            chase_after_days: 3,
            send_attempt_at: null,
            replied_at: null,
            contact: null,
            kind: 'chase',
          },
        ],
      });
      expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
    });

    it('a chase row does not suppress the original approval row\'s own blocker', () => {
      const input = baseInput({
        approval_requests: [
          {
            id: 'ar-original',
            task_id: 'task-1',
            created_at: '2026-09-01T00:00:00.000Z',
            status: 'sent',
            sent_at: '2026-09-01T00:00:00.000Z',
            chase_after_days: 3,
            send_attempt_at: null,
            replied_at: null,
            contact: null,
          },
          {
            id: 'ar-chase-1',
            task_id: 'task-1',
            created_at: '2026-09-08T00:00:00.000Z',
            status: 'queued',
            sent_at: null,
            chase_after_days: 3,
            send_attempt_at: null,
            replied_at: null,
            contact: null,
            kind: 'chase',
          },
        ],
      });
      const blockers = classifyProjectBlockers(input, NOW);
      expect(blockers).toHaveLength(1);
      expect(blockers[0].id).toBe('client_approval:ar-original');
    });
  });
});

describe('classifyProjectBlockers — someone_else', () => {
  it('fires when the next-step candidate is assigned to a non-Mike, non-bot person', () => {
    const input = baseInput({
      next_step_candidate: { task_id: 'task-2', assignee_id: 'user-9', assignee_name: 'Jordan', since: '2026-09-05T00:00:00.000Z' },
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'someone_else', owner: { id: 'user-9', is_mike: false }, detail: 'has had it 5 days' });
  });

  it('does not fire when the candidate is unassigned', () => {
    const input = baseInput({
      next_step_candidate: { task_id: 'task-2', assignee_id: null, assignee_name: null, since: '2026-09-05T00:00:00.000Z' },
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('does not fire when the candidate is assigned to Mike', () => {
    const input = baseInput({
      next_step_candidate: { task_id: 'task-2', assignee_id: MIKE_USER_ID, assignee_name: 'Mike', since: '2026-09-05T00:00:00.000Z' },
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('does not fire when the candidate is assigned to a bot', () => {
    const input = baseInput({
      next_step_candidate: { task_id: 'task-2', assignee_id: BAST_USER_ID, assignee_name: 'Bast', since: '2026-09-05T00:00:00.000Z' },
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });
});

describe('classifyProjectBlockers — stale', () => {
  it('fires when there has been no positive movement for 7+ days', () => {
    const input = baseInput({ last_movement_at: '2026-09-01T12:00:00.000Z' }); // 9 days before NOW
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe('stale');
  });

  it('does not fire under 7 days', () => {
    const input = baseInput({ last_movement_at: '2026-09-05T12:00:00.000Z' }); // 5 days before NOW
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('is suppressed when stale_muted_until is in the future', () => {
    const input = baseInput({
      last_movement_at: '2026-08-01T00:00:00.000Z',
      stale_muted_until: '2026-09-20T00:00:00.000Z',
    });
    expect(classifyProjectBlockers(input, NOW)).toHaveLength(0);
  });

  it('fires when stale_muted_until is in the past', () => {
    const input = baseInput({
      last_movement_at: '2026-08-01T00:00:00.000Z',
      stale_muted_until: '2026-09-01T00:00:00.000Z',
    });
    expect(classifyProjectBlockers(input, NOW).some((b) => b.kind === 'stale')).toBe(true);
  });

  it('is suppressed when the only other blocker is a client-owned client_approval', () => {
    const input = baseInput({
      last_movement_at: '2026-08-01T00:00:00.000Z',
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sent',
          sent_at: '2026-09-09T00:00:00.000Z', // recent, still within chase window -> client-owned
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe('client_approval');
  });

  it('still fires alongside a MIKE-owned client_approval blocker', () => {
    const input = baseInput({
      last_movement_at: '2026-08-01T00:00:00.000Z',
      approval_requests: [{ id: 'ar-1', task_id: 'task-1', created_at: '2026-09-01T00:00:00.000Z', status: 'draft', sent_at: null, chase_after_days: 3, send_attempt_at: null, replied_at: null, contact: null }],
    });
    const kinds = classifyProjectBlockers(input, NOW).map((b) => b.kind);
    expect(kinds).toEqual(expect.arrayContaining(['client_approval', 'stale']));
  });

  // LOW-12 — the stale dismissal's marker is the last_movement_at it was dismissed
  // against. Once real movement happens, last_movement_at changes, the marker no longer
  // matches, and the (now-stale-again) project re-surfaces rather than staying
  // permanently silenced by an old dismissal.
  it('re-surfaces once movement changes last_movement_at past a stale dismissal keyed to the OLD movement', () => {
    const oldMovement = '2026-08-01T00:00:00.000Z';
    const dismissedInput = baseInput({
      last_movement_at: oldMovement,
      dismissals: [{ kind: 'stale', source_id: 'proj-1', source_marker: oldMovement, dismissed_at: NOW.toISOString() }],
    });
    expect(classifyProjectBlockers(dismissedInput, NOW)).toHaveLength(0); // dismissal still matches

    // Movement happened, but it's STILL 7+ days ago as of NOW (still stale) — only the
    // marker changed, which is exactly what should invalidate the old dismissal.
    const newMovement = '2026-08-25T00:00:00.000Z';
    const afterMovementInput = baseInput({
      last_movement_at: newMovement,
      dismissals: [{ kind: 'stale', source_id: 'proj-1', source_marker: oldMovement, dismissed_at: NOW.toISOString() }],
    });
    const blockers = classifyProjectBlockers(afterMovementInput, NOW);
    expect(blockers.some((b) => b.kind === 'stale')).toBe(true);
  });
});

describe('classifyProjectBlockers — meeting_risk', () => {
  it('fires when a calendar event with the client falls within 3 days and there has been no movement in 5+ days', () => {
    const input = baseInput({
      last_movement_at: '2026-09-04T00:00:00.000Z', // 6 days before NOW
      calendar_events: [{ id: 'event-1', title: 'Herba check-in', starts_at: '2026-09-12T15:00:00.000Z' }],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers.some((b) => b.kind === 'meeting_risk')).toBe(true);
  });

  it('does not fire when movement is recent (under 5 days)', () => {
    const input = baseInput({
      last_movement_at: '2026-09-08T00:00:00.000Z', // 2 days before NOW
      calendar_events: [{ id: 'event-1', title: 'Herba check-in', starts_at: '2026-09-12T15:00:00.000Z' }],
    });
    expect(classifyProjectBlockers(input, NOW).some((b) => b.kind === 'meeting_risk')).toBe(false);
  });
});

describe('ownerIsMike', () => {
  it('is true when any blocker is owned by Mike', () => {
    const input = baseInput({
      tasks: [task({ status: 'done', needs_review: true, approved: false })],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(ownerIsMike(blockers)).toBe(true);
  });

  it('is false when every blocker is owned by someone else', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'sent',
          sent_at: '2026-09-09T00:00:00.000Z',
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(ownerIsMike(blockers)).toBe(false);
  });

  it('is false when there are no blockers at all', () => {
    expect(ownerIsMike(classifyProjectBlockers(baseInput(), NOW))).toBe(false);
  });
});

// MEDIUM-3 — re-homing: every task-sourced blocker carries the task's CURRENT arc (if
// any) so the pick-to-arc dialogs can flag "already in arc X" instead of silently
// re-homing a task that's already live somewhere else.
describe('classifyProjectBlockers — arc pass-through', () => {
  it('a task-sourced blocker (decision) carries the task\'s current arc', () => {
    const input = baseInput({
      tasks: [
        task({
          tags: ['needs-mike'],
          last_comment: { id: 'c1', user_id: BAST_USER_ID, user_name: 'Bast', created_at: '2026-09-08T00:00:00.000Z', content_excerpt: 'x' },
          arc: { id: 'arc-1', name: 'Launch prep' },
        }),
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers[0].arc).toEqual({ id: 'arc-1', name: 'Launch prep' });
  });

  it('a task-sourced blocker with no current arc reports arc: null', () => {
    const input = baseInput({
      tasks: [
        task({
          status: 'done',
          needs_review: true,
          approved: false,
          arc: null,
        }),
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers[0].kind).toBe('review');
    expect(blockers[0].arc).toBeNull();
  });

  it('a non-task-sourced blocker (client_email) always reports arc: null', () => {
    const input = baseInput({
      emails: [
        {
          id: 'email-1',
          from: 'client@example.com',
          subject: 'Status?',
          gist: null,
          received_at: '2026-09-08T00:00:00.000Z',
          replied: false,
          deep_link: 'https://mail.google.com/x',
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers[0].kind).toBe('client_email');
    expect(blockers[0].arc).toBeNull();
  });

  it('someone_else carries the candidate task\'s current arc', () => {
    const input = baseInput({
      tasks: [task({ id: 'task-2', arc: { id: 'arc-2', name: 'Q3 cleanup' } })],
      next_step_candidate: { task_id: 'task-2', assignee_id: 'user-9', assignee_name: 'Jordan', since: '2026-09-05T00:00:00.000Z' },
    });
    const blockers = classifyProjectBlockers(input, NOW);
    expect(blockers[0]).toMatchObject({ kind: 'someone_else', arc: { id: 'arc-2', name: 'Q3 cleanup' } });
  });
});
