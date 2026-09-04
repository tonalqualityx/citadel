import { describe, it, expect } from 'vitest';
import {
  sortProjectCards,
  stalledCount,
  groupByKind,
  deriveByKind,
  KIND_ORDER,
  KIND_HEADINGS,
  shouldCollapseToRows,
  lastMovementSentence,
  isTaskBlocker,
  createTaskPayloadFromBlocker,
  buildSinglePickPlan,
  buildMultiPickPlan,
  defaultArcNameForHeading,
  type KindLensRow,
} from '../projects-logic';
import type { OracleProjectCard, OracleProjectMovement } from '@/lib/hooks/use-oracle-projects';
import type { Blocker } from '@/lib/oracle/projects/blockers';

function card(overrides: Partial<OracleProjectCard> = {}): OracleProjectCard {
  return {
    id: 'proj-1',
    name: 'Herba rebuild',
    client: { id: 'client-1', name: 'Herba' },
    status: 'in_progress',
    next_step: { text: 'Do a thing', owner: null, owner_label: null, source: 'graph', at: null },
    last_movement: null,
    days_quiet: null,
    stale: false,
    stalled_on_mike: false,
    blockers: [],
    counts_by_kind: {},
    refresh_requested_at: null,
    open_url: '/projects/proj-1',
    email_summary: null,
    email_summary_at: null,
    linked_emails: [],
    ...overrides,
  };
}

function blocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'decision',
    id: 'decision:task-1',
    title: 'Approve homepage copy',
    detail: 'Bast needs a yes/no on the homepage headline.',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'task', id: 'task-1', url: '/tasks/task-1' },
    since: '2026-08-01T00:00:00Z',
    actions: ['reply', 'open_task'],
    arc: null,
    ...overrides,
  };
}

describe('sortProjectCards', () => {
  it('puts stalled_on_mike projects before non-stalled ones', () => {
    const notStalled = card({ id: 'a', stalled_on_mike: false, days_quiet: 100 });
    const stalled = card({ id: 'b', stalled_on_mike: true, days_quiet: 1 });
    const sorted = sortProjectCards([notStalled, stalled]);
    expect(sorted.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('within the same stalled bucket, sorts days_quiet descending (quietest first)', () => {
    const a = card({ id: 'a', stalled_on_mike: true, days_quiet: 3 });
    const b = card({ id: 'b', stalled_on_mike: true, days_quiet: 30 });
    const c = card({ id: 'c', stalled_on_mike: true, days_quiet: 10 });
    const sorted = sortProjectCards([a, b, c]);
    expect(sorted.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('null days_quiet (no recorded movement ever) sorts as quietest — first in its bucket', () => {
    const withMovement = card({ id: 'a', stalled_on_mike: true, days_quiet: 500 });
    const neverMoved = card({ id: 'b', stalled_on_mike: true, days_quiet: null });
    const sorted = sortProjectCards([withMovement, neverMoved]);
    expect(sorted.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [card({ id: 'a', stalled_on_mike: false }), card({ id: 'b', stalled_on_mike: true })];
    const copy = [...input];
    sortProjectCards(input);
    expect(input).toEqual(copy);
  });
});

describe('stalledCount', () => {
  it('counts only stalled_on_mike cards', () => {
    const cards = [
      card({ id: 'a', stalled_on_mike: true }),
      card({ id: 'b', stalled_on_mike: false }),
      card({ id: 'c', stalled_on_mike: true }),
    ];
    expect(stalledCount(cards)).toBe(2);
  });

  it('is 0 for an empty list', () => {
    expect(stalledCount([])).toBe(0);
  });
});

describe('groupByKind', () => {
  it('orders groups in the stable heading order, skipping empty kinds', () => {
    const row = (kind: Blocker['kind']): KindLensRow => ({
      blocker: blocker({ kind, id: `${kind}:1` }),
      project: { id: 'proj-1', name: 'Herba rebuild' },
    });
    const byKind: Record<string, KindLensRow[]> = {
      stale: [row('stale')],
      review: [row('review')],
      mention: [row('mention')],
    };
    const groups = groupByKind(byKind);
    expect(groups.map((g) => g.kind)).toEqual(['review', 'mention', 'stale']);
    expect(groups.map((g) => g.heading)).toEqual(['Reviews', 'Mentions', 'Stale']);
  });

  it('produces no group for a kind with an empty array', () => {
    const groups = groupByKind({ review: [] });
    expect(groups).toEqual([]);
  });

  it('covers every kind in KIND_ORDER with a heading', () => {
    for (const kind of KIND_ORDER) {
      expect(KIND_HEADINGS[kind]).toBeTruthy();
    }
  });
});

// LOW-12 — the by-kind lens no longer needs a second `?lens=kind` fetch: it derives the
// same grouping client-side from the project-lens response's own `projects` array.
describe('deriveByKind', () => {
  it('groups every project\'s blockers by kind, tagging each row with its project', () => {
    const projects = [
      {
        id: 'proj-1',
        name: 'Website Redesign',
        blockers: [blocker({ kind: 'review', id: 'review:1' }), blocker({ kind: 'mention', id: 'mention:1' })],
      },
      {
        id: 'proj-2',
        name: 'Brand Refresh',
        blockers: [blocker({ kind: 'review', id: 'review:2' })],
      },
    ];
    const byKind = deriveByKind(projects);
    expect(byKind.review).toHaveLength(2);
    expect(byKind.review.map((r) => r.project.id)).toEqual(['proj-1', 'proj-2']);
    expect(byKind.mention).toHaveLength(1);
    expect(byKind.mention[0].project).toEqual({ id: 'proj-1', name: 'Website Redesign' });
  });

  it('an empty projects array produces an empty map', () => {
    expect(deriveByKind([])).toEqual({});
  });

  it('a project with no blockers contributes nothing', () => {
    expect(deriveByKind([{ id: 'proj-1', name: 'X', blockers: [] }])).toEqual({});
  });

  it('feeds straight into groupByKind, matching the route\'s own ?lens=kind shape', () => {
    const projects = [{ id: 'proj-1', name: 'Website Redesign', blockers: [blocker({ kind: 'stale', id: 'stale:1' })] }];
    const groups = groupByKind(deriveByKind(projects));
    expect(groups).toEqual([{ kind: 'stale', heading: 'Stale', rows: [{ blocker: blocker({ kind: 'stale', id: 'stale:1' }), project: { id: 'proj-1', name: 'Website Redesign' } }] }]);
  });

  it('the full stable heading order matches the spec', () => {
    expect(KIND_ORDER.map((k) => KIND_HEADINGS[k])).toEqual([
      'Reviews',
      'Decisions',
      'Clarifications',
      'Client approvals',
      'Client emails',
      'Mentions',
      'Session asks',
      'Nudges',
      'Meeting risk',
      'Stale',
    ]);
  });
});

describe('shouldCollapseToRows', () => {
  it('is false at and below 20', () => {
    expect(shouldCollapseToRows(0)).toBe(false);
    expect(shouldCollapseToRows(20)).toBe(false);
  });

  it('is true above 20', () => {
    expect(shouldCollapseToRows(21)).toBe(true);
    expect(shouldCollapseToRows(100)).toBe(true);
  });
});

describe('lastMovementSentence', () => {
  it('reports no recorded movement when null', () => {
    expect(lastMovementSentence(null, null)).toBe('No recorded movement yet.');
  });

  const movement: OracleProjectMovement = { at: '2026-09-01T00:00:00Z', who: 'Mike', what: 'commented' };

  it('says "today" for daysQuiet 0', () => {
    expect(lastMovementSentence(movement, 0)).toBe('Mike commented today.');
  });

  it('says "yesterday" for daysQuiet 1', () => {
    expect(lastMovementSentence(movement, 1)).toBe('Mike commented yesterday.');
  });

  it('says "N days ago" for daysQuiet > 1', () => {
    expect(lastMovementSentence(movement, 12)).toBe('Mike commented 12 days ago.');
  });

  it('omits the "when" clause when daysQuiet is null but movement exists', () => {
    expect(lastMovementSentence(movement, null)).toBe('Mike commented.');
  });
});

describe('isTaskBlocker', () => {
  it('true for a task-sourced blocker', () => {
    expect(isTaskBlocker(blocker({ source: { type: 'task', id: 't-1', url: '/tasks/t-1' } }))).toBe(true);
  });

  it('false for an email-sourced blocker', () => {
    expect(isTaskBlocker(blocker({ source: { type: 'email', id: 'e-1', url: 'https://mail.google.com/x' } }))).toBe(false);
  });
});

describe('createTaskPayloadFromBlocker', () => {
  it('uses the blocker title/detail verbatim, assigns Mike, and sets project_id', () => {
    const input = createTaskPayloadFromBlocker(
      { title: 'Reply to Andy re: homepage copy', detail: 'Andy asked for one tweak to the CTA.' },
      'proj-1',
      'mike-1'
    );
    expect(input).toEqual({
      title: 'Reply to Andy re: homepage copy',
      description: 'Andy asked for one tweak to the CTA.',
      project_id: 'proj-1',
      assignee_id: 'mike-1',
    });
  });
});

describe('buildSinglePickPlan', () => {
  it('a task blocker attaches/picks directly, no task creation', () => {
    const b = blocker({ source: { type: 'task', id: 'task-9', url: '/tasks/task-9' } });
    const plan = buildSinglePickPlan(b, 'proj-1', 'mike-1', 'arc-1');
    expect(plan).toEqual({
      needsTaskCreation: false,
      createTaskInput: null,
      existingTaskId: 'task-9',
      arcId: 'arc-1',
      alreadyInArc: null,
    });
  });

  it('a non-task blocker requires task creation first, titled/described from the blocker', () => {
    const b = blocker({
      kind: 'client_email',
      title: 'Andy asked for an update',
      detail: 'No reply yet on the homepage copy question.',
      source: { type: 'email', id: 'email-1', url: 'https://mail.google.com/x' },
    });
    const plan = buildSinglePickPlan(b, 'proj-1', 'mike-1');
    expect(plan.needsTaskCreation).toBe(true);
    expect(plan.existingTaskId).toBeNull();
    expect(plan.createTaskInput).toEqual({
      title: 'Andy asked for an update',
      description: 'No reply yet on the homepage copy question.',
      project_id: 'proj-1',
      assignee_id: 'mike-1',
    });
    expect(plan.arcId).toBeNull();
    expect(plan.alreadyInArc).toBeNull();
  });

  // MEDIUM-3 — re-homing
  describe('re-homing (alreadyInArc)', () => {
    it('a task already in a DIFFERENT arc is flagged and NOT attached by default', () => {
      const b = blocker({
        source: { type: 'task', id: 'task-9', url: '/tasks/task-9' },
        arc: { id: 'arc-old', name: 'Old arc' },
      });
      const plan = buildSinglePickPlan(b, 'proj-1', 'mike-1', 'arc-new');
      expect(plan.alreadyInArc).toEqual({ id: 'arc-old', name: 'Old arc' });
      expect(plan.arcId).toBeNull(); // attach step skipped
      expect(plan.existingTaskId).toBe('task-9'); // the pick itself still proceeds
    });

    it('moveIfAlreadyInArc:true re-homes the task instead of skipping', () => {
      const b = blocker({
        source: { type: 'task', id: 'task-9', url: '/tasks/task-9' },
        arc: { id: 'arc-old', name: 'Old arc' },
      });
      const plan = buildSinglePickPlan(b, 'proj-1', 'mike-1', 'arc-new', true);
      expect(plan.alreadyInArc).toBeNull();
      expect(plan.arcId).toBe('arc-new');
    });

    it('a task already in the SAME arc being targeted is not flagged', () => {
      const b = blocker({
        source: { type: 'task', id: 'task-9', url: '/tasks/task-9' },
        arc: { id: 'arc-1', name: 'Current arc' },
      });
      const plan = buildSinglePickPlan(b, 'proj-1', 'mike-1', 'arc-1');
      expect(plan.alreadyInArc).toBeNull();
      expect(plan.arcId).toBe('arc-1');
    });

    it('picking with no target arc never flags alreadyInArc, even if the task has one', () => {
      const b = blocker({
        source: { type: 'task', id: 'task-9', url: '/tasks/task-9' },
        arc: { id: 'arc-old', name: 'Old arc' },
      });
      const plan = buildSinglePickPlan(b, 'proj-1', 'mike-1', null);
      expect(plan.alreadyInArc).toBeNull();
      expect(plan.arcId).toBeNull();
    });
  });
});

describe('buildMultiPickPlan', () => {
  const projectA = { id: 'proj-a', name: 'Website Redesign' };
  const projectB = { id: 'proj-b', name: 'Brand Refresh' };

  it('splits task and non-task blockers, and sets projectId when all selections share one project', () => {
    const taskBlocker = blocker({ source: { type: 'task', id: 'task-1', url: '/tasks/task-1' } });
    const emailBlocker = blocker({
      kind: 'client_email',
      id: 'client_email:email-2',
      title: 'Reply to the client',
      detail: 'They are waiting on a status update.',
      source: { type: 'email', id: 'email-2', url: 'https://mail.google.com/x' },
    });
    const plan = buildMultiPickPlan(
      [
        { blocker: taskBlocker, project: projectA },
        { blocker: emailBlocker, project: projectA },
      ],
      'Reviews, Sep 4 2026',
      'mike-1'
    );
    expect(plan.arcName).toBe('Reviews, Sep 4 2026');
    expect(plan.projectId).toBe('proj-a');
    expect(plan.existingTaskIds).toEqual(['task-1']);
    expect(plan.tasksToCreate).toEqual([
      {
        blockerId: 'client_email:email-2',
        input: {
          title: 'Reply to the client',
          description: 'They are waiting on a status update.',
          project_id: 'proj-a',
          assignee_id: 'mike-1',
        },
      },
    ]);
    expect(plan.skippedAlreadyInArc).toEqual([]);
  });

  // MEDIUM-3 — re-homing, multi-select
  it('a task already in a DIFFERENT arc is skipped (not attached) unless moveAlreadyArced is true', () => {
    const arced = blocker({
      id: 'arced-1',
      title: 'Ship the fix',
      source: { type: 'task', id: 'task-arced', url: '/tasks/task-arced' },
      arc: { id: 'arc-old', name: 'Old arc' },
    });
    const clean = blocker({ id: 'clean-1', source: { type: 'task', id: 'task-clean', url: '/tasks/task-clean' } });

    const skipped = buildMultiPickPlan(
      [
        { blocker: arced, project: projectA },
        { blocker: clean, project: projectA },
      ],
      'New arc',
      'mike-1'
    );
    expect(skipped.existingTaskIds).toEqual(['task-clean']);
    expect(skipped.skippedAlreadyInArc).toEqual([{ blockerId: 'arced-1', title: 'Ship the fix', arc: { id: 'arc-old', name: 'Old arc' } }]);

    const moved = buildMultiPickPlan(
      [
        { blocker: arced, project: projectA },
        { blocker: clean, project: projectA },
      ],
      'New arc',
      'mike-1',
      true
    );
    expect(moved.existingTaskIds).toEqual(expect.arrayContaining(['task-arced', 'task-clean']));
    expect(moved.skippedAlreadyInArc).toEqual([]);
  });

  it('projectId is null when selections span multiple projects — never guesses one', () => {
    const b1 = blocker({ id: 'b1', source: { type: 'task', id: 'task-1', url: '/tasks/task-1' } });
    const b2 = blocker({ id: 'b2', source: { type: 'task', id: 'task-2', url: '/tasks/task-2' } });
    const plan = buildMultiPickPlan(
      [
        { blocker: b1, project: projectA },
        { blocker: b2, project: projectB },
      ],
      'Mixed picks',
      'mike-1'
    );
    expect(plan.projectId).toBeNull();
  });

  it('an empty selection produces an empty plan with the given name', () => {
    const plan = buildMultiPickPlan([], 'Empty', 'mike-1');
    expect(plan).toEqual({
      arcName: 'Empty',
      projectId: null,
      existingTaskIds: [],
      tasksToCreate: [],
      skippedAlreadyInArc: [],
    });
  });
});

describe('defaultArcNameForHeading', () => {
  it('combines the heading and the formatted date with a comma, never a dash', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    expect(defaultArcNameForHeading('Reviews', now)).toBe('Reviews, Sep 4 2026');
  });
});
