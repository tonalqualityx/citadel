import { describe, it, expect } from 'vitest';
import { classifyProjectBlockers, type Blocker, type ClassifyProjectBlockersInput, type BlockerKind } from '../blockers';
import { lintNextStepText } from '../next-step-lint';
import { BAST_USER_ID } from '../gate-constants';

// Oracle Projects Tab — dash-law guard. Every blocker `title`/`detail` builder in
// blockers.ts is reader-facing copy Mike acts on directly from the Projects tab, so it's
// bound by the SAME writing-standard dash law as any other client-facing text (see
// ~/.claude/skills/writing-standard/SKILL.md §1). This file enumerates a fixture for
// EVERY blocker kind, runs the real classifier, and lints every produced title/detail
// through the exact same grep-based check the machine-side next-step job's own writes
// are gated on (lib/oracle/projects/next-step-lint.ts, a straight port of
// comment-gate.sh) — so a dash reintroduced into any classify* function's template
// literals fails a test, not a production Projects-tab card.

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
    last_movement_at: NOW.toISOString(),
    stale_muted_until: null,
    ...overrides,
  };
}

function task(overrides: Partial<ClassifyProjectBlockersInput['tasks'][number]> = {}) {
  return {
    id: 'task-1',
    title: 'Build homepage',
    status: 'not_started',
    tags: [] as string[],
    needs_review: false,
    approved: false,
    assignee_id: null,
    assignee_name: null,
    sop_title: null,
    updated_at: '2026-09-09T00:00:00.000Z',
    blocked_by_ids: [] as string[],
    phase_sort: 0,
    sort_order: 0,
    last_comment: null,
    arc: null,
    ...overrides,
  };
}

function assertClean(blocker: Blocker) {
  const titleHits = lintNextStepText(blocker.title).filter((v) => v.rule.includes('dash law'));
  const detailHits = lintNextStepText(blocker.detail).filter((v) => v.rule.includes('dash law'));
  expect(titleHits, `title "${blocker.title}" (kind: ${blocker.kind})`).toEqual([]);
  expect(detailHits, `detail "${blocker.detail}" (kind: ${blocker.kind})`).toEqual([]);
}

// One fixture per kind, each built to exercise the branch most likely to carry
// dash-joined copy (the sop_title suffix, the chase-overdue branch, the flagged-email
// branch, etc.) rather than the plainest possible case.
const FIXTURES: Record<BlockerKind, () => ClassifyProjectBlockersInput> = {
  decision: () =>
    baseInput({
      tasks: [
        task({
          tags: ['needs-mike'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-08T00:00:00.000Z',
            content_excerpt: 'Homepage headline: A or B?',
          },
        }),
      ],
    }),
  clarification: () =>
    baseInput({
      tasks: [
        task({
          tags: ['awaiting-clarification'],
          last_comment: {
            id: 'c1',
            user_id: BAST_USER_ID,
            user_name: 'Bast',
            created_at: '2026-09-08T00:00:00.000Z',
            content_excerpt: 'Which logo file is final?',
          },
        }),
      ],
    }),
  review: () =>
    baseInput({
      // No last_comment, WITH a sop_title -- exercises the "Marked done. Needs your
      // review (SOP)." branch, not just the plain one.
      tasks: [task({ status: 'done', needs_review: true, approved: false, sop_title: 'Homepage Build SOP' })],
    }),
  session_ask: () =>
    baseInput({
      session_asks: [
        {
          session_external_id: 'sess-1',
          queue: 'needs-mike',
          text: 'Should the footer keep the old address?',
          severity: 'high',
          waiting_since: '2026-09-08T00:00:00.000Z',
        },
      ],
    }),
  mention: () =>
    baseInput({
      tasks: [task()],
      mentions: [
        {
          id: 'm1',
          task_id: 'task-1',
          author: { id: 'user-2', name: 'Jordan' },
          created_at: '2026-09-08T00:00:00.000Z',
          excerpt: '@Mike can you weigh in here?',
        },
      ],
    }),
  client_email: () =>
    baseInput({
      // No time entries since receipt -> exercises the FLAGGED branch (the one that used
      // to be dash-joined: "... — asks for status, no time logged since").
      emails: [
        {
          id: 'email-1',
          from: 'client@example.com',
          subject: 'Any update on this?',
          gist: null,
          received_at: '2026-09-08T00:00:00.000Z',
          replied: false,
          deep_link: 'https://mail.google.com/mail/u/0/#inbox/x',
        },
      ],
    }),
  client_approval: () =>
    baseInput({
      // status: replied -> exercises the "Client replied..." branch.
      approval_requests: [
        {
          id: 'ar-1',
          task_id: 'task-1',
          created_at: '2026-09-01T00:00:00.000Z',
          status: 'replied',
          sent_at: '2026-09-05T00:00:00.000Z',
          chase_after_days: 3, send_attempt_at: null,
          replied_at: '2026-09-08T00:00:00.000Z',
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    }),
  someone_else: () =>
    baseInput({
      tasks: [task({ id: 'task-2' })],
      next_step_candidate: {
        task_id: 'task-2',
        assignee_id: 'user-9',
        assignee_name: 'Jordan',
        since: '2026-09-05T00:00:00.000Z',
      },
    }),
  stale: () =>
    baseInput({
      last_movement_at: '2026-08-01T00:00:00.000Z', // well past the 7-day threshold
    }),
  meeting_risk: () =>
    baseInput({
      last_movement_at: '2026-09-01T00:00:00.000Z', // past the 5-day stillness threshold
      calendar_events: [{ id: 'event-1', title: 'Herba check-in', starts_at: '2026-09-12T15:00:00.000Z' }],
    }),
};

describe('blockers copy — dash law (guard)', () => {
  for (const kind of Object.keys(FIXTURES) as BlockerKind[]) {
    it(`${kind}: title/detail carry no em dash, en dash, or dash entity`, () => {
      const input = FIXTURES[kind]();
      const blockers = classifyProjectBlockers(input, NOW);
      const produced = blockers.filter((b) => b.kind === kind);
      expect(produced.length, `expected at least one ${kind} blocker from its fixture`).toBeGreaterThan(0);
      for (const blocker of produced) {
        assertClean(blocker);
      }
    });
  }

  // Also exercise the chase-overdue and mikeOwns-draft client_approval detail branches,
  // which the single fixture above (status: replied) doesn't reach.
  it('client_approval overdue-chase branch carries no dash', () => {
    const input = baseInput({
      approval_requests: [
        {
          id: 'ar-2',
          task_id: 'task-1',
          created_at: '2026-08-25T00:00:00.000Z',
          status: 'sent',
          sent_at: '2026-08-26T00:00:00.000Z',
          chase_after_days: 3, send_attempt_at: null,
          replied_at: null,
          contact: { id: 'contact-1', name: 'Jane Client' },
        },
      ],
    });
    const blockers = classifyProjectBlockers(input, NOW);
    const approval = blockers.find((b) => b.kind === 'client_approval');
    expect(approval).toBeDefined();
    assertClean(approval as Blocker);
  });
});
