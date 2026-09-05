import { describe, it, expect } from 'vitest';
import {
  findNextStepCandidate,
  mergeNextStep,
  type NextStepCandidateTask,
} from '../next-step-candidate';

function task(overrides: Partial<NextStepCandidateTask> = {}): NextStepCandidateTask {
  return {
    id: 't1',
    title: 'Build homepage',
    status: 'not_started',
    blocked_by_ids: [],
    phase_sort: 0,
    sort_order: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    assignee_id: 'user-1',
    assignee_name: 'Alex',
    ...overrides,
  };
}

describe('findNextStepCandidate', () => {
  it('returns null when there are no tasks', () => {
    expect(findNextStepCandidate([])).toBeNull();
  });

  it('picks the only eligible not_started task', () => {
    const t = task();
    const result = findNextStepCandidate([t]);
    expect(result).toEqual({ task: t, assignee: { id: 'user-1', name: 'Alex' } });
  });

  it('excludes a task whose blocked_by task is not done', () => {
    const blocker = task({ id: 'blocker', status: 'in_progress' });
    const dependent = task({ id: 'dependent', blocked_by_ids: ['blocker'] });
    const result = findNextStepCandidate([blocker, dependent]);
    expect(result).toBeNull();
  });

  it('includes a task whose blocked_by task IS done', () => {
    const blocker = task({ id: 'blocker', status: 'done' });
    const dependent = task({ id: 'dependent', blocked_by_ids: ['blocker'] });
    const result = findNextStepCandidate([blocker, dependent]);
    expect(result?.task.id).toBe('dependent');
  });

  it('treats a blocked_by id absent from the task list as NOT done (fail safe)', () => {
    const dependent = task({ id: 'dependent', blocked_by_ids: ['ghost-task'] });
    const result = findNextStepCandidate([dependent]);
    expect(result).toBeNull();
  });

  it('excludes done/in_progress/review/blocked/abandoned tasks', () => {
    const tasks = [
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', status: 'review' }),
      task({ id: 'c', status: 'done' }),
      task({ id: 'd', status: 'blocked' }),
      task({ id: 'e', status: 'abandoned' }),
    ];
    expect(findNextStepCandidate(tasks)).toBeNull();
  });

  it('orders by phase_sort first', () => {
    const later = task({ id: 'later', phase_sort: 1, sort_order: 0 });
    const earlier = task({ id: 'earlier', phase_sort: 0, sort_order: 5 });
    const result = findNextStepCandidate([later, earlier]);
    expect(result?.task.id).toBe('earlier');
  });

  it('orders by sort_order within the same phase_sort', () => {
    const later = task({ id: 'later', phase_sort: 0, sort_order: 2 });
    const earlier = task({ id: 'earlier', phase_sort: 0, sort_order: 1 });
    const result = findNextStepCandidate([later, earlier]);
    expect(result?.task.id).toBe('earlier');
  });

  it('orders by created_at when phase_sort and sort_order tie', () => {
    const later = task({ id: 'later', created_at: '2026-09-02T00:00:00.000Z' });
    const earlier = task({ id: 'earlier', created_at: '2026-09-01T00:00:00.000Z' });
    const result = findNextStepCandidate([later, earlier]);
    expect(result?.task.id).toBe('earlier');
  });

  it('returns assignee: null for an unassigned task', () => {
    const t = task({ assignee_id: null, assignee_name: null });
    const result = findNextStepCandidate([t]);
    expect(result?.assignee).toBeNull();
  });
});

describe('mergeNextStep', () => {
  const candidateTask = task({ id: 'candidate', title: 'Write the brief' });
  const candidate = { task: candidateTask, assignee: { id: 'user-1', name: 'Alex' } };

  it("Mike's override wins even when a graph candidate exists", () => {
    const line = mergeNextStep(
      {
        next_step_text: "Wait for Mike's call with the client",
        next_step_owner: { id: 'mike', name: 'Mike' },
        next_step_owner_label: null,
        next_step_source: 'mike',
        next_step_at: '2026-09-03T00:00:00.000Z',
      },
      candidate
    );
    expect(line).toEqual({
      text: "Wait for Mike's call with the client",
      owner: { id: 'mike', name: 'Mike' },
      owner_label: null,
      source: 'mike',
      at: '2026-09-03T00:00:00.000Z',
    });
  });

  it("Bast's line wins over the graph candidate when there's no Mike override", () => {
    const line = mergeNextStep(
      {
        next_step_text: 'Bast thinks the next move is a follow-up email',
        next_step_owner: { id: 'user-2', name: 'Jamie' },
        next_step_owner_label: null,
        next_step_source: 'bast',
        next_step_at: '2026-09-02T00:00:00.000Z',
      },
      candidate
    );
    expect(line.source).toBe('bast');
    expect(line.text).toBe('Bast thinks the next move is a follow-up email');
  });

  it('falls back to the fresh graph candidate when no mike/bast line is stored', () => {
    const line = mergeNextStep(
      { next_step_text: null, next_step_owner: null, next_step_owner_label: null, next_step_source: null, next_step_at: null },
      candidate
    );
    expect(line).toEqual({
      text: 'Next: Write the brief (Alex)',
      owner: { id: 'user-1', name: 'Alex' },
      owner_label: null,
      source: 'graph',
      at: candidateTask.created_at,
    });
  });

  it('a stored source=graph line is ignored in favor of a freshly computed candidate', () => {
    const line = mergeNextStep(
      {
        next_step_text: 'STALE: Next: some old task',
        next_step_owner: null,
        next_step_owner_label: null,
        next_step_source: 'graph',
        next_step_at: '2026-08-01T00:00:00.000Z',
      },
      candidate
    );
    expect(line.text).toBe('Next: Write the brief (Alex)');
    expect(line.source).toBe('graph');
  });

  it('renders "(unassigned)" when the graph candidate has no assignee', () => {
    const line = mergeNextStep(
      { next_step_text: null, next_step_owner: null, next_step_owner_label: null, next_step_source: null, next_step_at: null },
      { task: candidateTask, assignee: null }
    );
    expect(line.text).toBe('Next: Write the brief (unassigned)');
  });

  it('reports "no ready task" when there is no candidate and no stored line', () => {
    const line = mergeNextStep(
      { next_step_text: null, next_step_owner: null, next_step_owner_label: null, next_step_source: null, next_step_at: null },
      null
    );
    expect(line.source).toBe('none');
    expect(line.owner).toBeNull();
    expect(line.text).toMatch(/no ready task/i);
  });
});

describe('mergeNextStep — owner_label (Phase 3)', () => {
  const candidateTask = task({ id: 'candidate', title: 'Write the brief' });
  const candidate = { task: candidateTask, assignee: { id: 'user-1', name: 'Alex' } };

  it("passes through Mike's owner_label when next_step_owner is null", () => {
    const line = mergeNextStep(
      {
        next_step_text: 'Waiting on Andy to send the logo files',
        next_step_owner: null,
        next_step_owner_label: 'Andy (client)',
        next_step_source: 'mike',
        next_step_at: '2026-09-03T00:00:00.000Z',
      },
      candidate
    );
    expect(line.owner).toBeNull();
    expect(line.owner_label).toBe('Andy (client)');
  });

  it("passes through Bast's owner_label the same way", () => {
    const line = mergeNextStep(
      {
        next_step_text: 'Waiting on the client contact to reply',
        next_step_owner: null,
        next_step_owner_label: 'Jordan (client)',
        next_step_source: 'bast',
        next_step_at: '2026-09-02T00:00:00.000Z',
      },
      candidate
    );
    expect(line.owner_label).toBe('Jordan (client)');
  });

  it('a graph candidate never carries an owner_label', () => {
    const line = mergeNextStep(
      { next_step_text: null, next_step_owner: null, next_step_owner_label: null, next_step_source: null, next_step_at: null },
      candidate
    );
    expect(line.owner_label).toBeNull();
  });
});
