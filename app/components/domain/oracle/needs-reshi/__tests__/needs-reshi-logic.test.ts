import { describe, it, expect } from 'vitest';
import type { WaitingOnMeCard, WaitingQueueCard } from '@/lib/hooks/use-waiting-on-me';
import { waitingOnMeCardToAskCardData, buildWaitingColumn, groupReviewByClient } from '../needs-reshi-logic';

function taskCard(overrides: Partial<WaitingOnMeCard> = {}): WaitingOnMeCard {
  return {
    type: 'task',
    id: 'card-1',
    title: 'Design homepage mockups',
    status: 'done',
    priority: null,
    severity: 'client_blocking',
    task_id: 'task-1',
    session_external_id: null,
    arc: null,
    client: null,
    due_date: null,
    waiting_since: null,
    ...overrides,
  };
}

function sessionAskCard(overrides: Partial<WaitingOnMeCard> = {}): WaitingOnMeCard {
  return {
    type: 'session_ask',
    id: 'card-2',
    title: 'Approve the backup plan?',
    status: 'waiting',
    priority: null,
    severity: 'internal',
    task_id: null,
    session_external_id: 'sess-1',
    arc: { id: 'arc-1', name: 'Password window' },
    client: null,
    due_date: null,
    waiting_since: null,
    ...overrides,
  };
}

describe('waitingOnMeCardToAskCardData', () => {
  it('maps a task card to an open_review action, sourced as "quest"', () => {
    const data = waitingOnMeCardToAskCardData(taskCard());
    expect(data.sourceLabel).toBe('quest');
    expect(data.bodyText).toBe('Design homepage mockups');
    expect(data.severity).toBe('client_blocking');
    expect(data.primaryAction).toEqual({ kind: 'open_review', taskId: 'task-1' });
  });

  it('maps a session_ask card with a remote_url to a respond action, sourced as "session"', () => {
    const data = waitingOnMeCardToAskCardData(sessionAskCard(), 'https://claude.ai/code/session_x');
    expect(data.sourceLabel).toBe('session');
    expect(data.contextLabel).toBe('Password window');
    expect(data.primaryAction).toEqual({ kind: 'respond', remoteUrl: 'https://claude.ai/code/session_x' });
  });

  it('maps a session_ask card with no remote_url to a none action', () => {
    const data = waitingOnMeCardToAskCardData(sessionAskCard(), undefined);
    expect(data.primaryAction).toEqual({ kind: 'none' });
  });

  it('a task card with no task_id falls back to a none action', () => {
    const data = waitingOnMeCardToAskCardData(taskCard({ task_id: null }));
    expect(data.primaryAction).toEqual({ kind: 'none' });
  });

  it('carries the queueType through when given', () => {
    const data = waitingOnMeCardToAskCardData(sessionAskCard(), null, 'decision');
    expect(data.queueType).toBe('decision');
  });

  it('leaves queueType undefined when not given (e.g. a grouped Review item)', () => {
    const data = waitingOnMeCardToAskCardData(taskCard());
    expect(data.queueType).toBeUndefined();
  });
});

// Clarity Phase 5 — Decide + Answer merged into one "Waiting on you" queue.
describe('buildWaitingColumn', () => {
  function waitingCard(overrides: Partial<WaitingQueueCard> = {}): WaitingQueueCard {
    return { ...sessionAskCard(), queue_type: 'decision', ...overrides };
  }

  it('maps each card, tagging queueType from queue_type', () => {
    const result = buildWaitingColumn(
      [waitingCard({ id: 'd1', queue_type: 'decision' }), waitingCard({ id: 'a1', queue_type: 'reply' })],
      new Map()
    );
    expect(result.visible.map((c) => c.queueType)).toEqual(['decision', 'reply']);
  });

  it('resolves a session card\'s live Respond deep-link via the remote-url map', () => {
    const result = buildWaitingColumn(
      [waitingCard({ session_external_id: 'ext-1' })],
      new Map([['ext-1', 'https://claude.ai/code/session_x']])
    );
    expect(result.visible[0].primaryAction).toEqual({
      kind: 'respond',
      remoteUrl: 'https://claude.ai/code/session_x',
    });
  });

  it('applies the density cap to the merged list', () => {
    const many = Array.from({ length: 10 }, (_, i) => waitingCard({ id: `w-${i}` }));
    const result = buildWaitingColumn(many, new Map());
    expect(result.visible).toHaveLength(6);
    expect(result.overflowCount).toBe(4);
  });

  it('returns an empty result for an empty queue', () => {
    const result = buildWaitingColumn([], new Map());
    expect(result.visible).toHaveLength(0);
    expect(result.overflowCount).toBe(0);
  });
});

// Clarity Phase 5 — Review grouped by client (fallback arc, then "Other"), oldest-wait-first.
describe('groupReviewByClient', () => {
  it('groups cards under their client, using the client name as the label', () => {
    const groups = groupReviewByClient([
      taskCard({ id: 't1', client: { id: 'c1', name: 'Herba' } }),
      taskCard({ id: 't2', client: { id: 'c1', name: 'Herba' } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Herba');
    expect(groups[0].count).toBe(2);
  });

  it('falls back to the arc name when there is no client', () => {
    const groups = groupReviewByClient([
      sessionAskCard({ id: 's1', client: null, arc: { id: 'arc-9', name: 'Growth Roadmap' } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Growth Roadmap');
    expect(groups[0].key).toBe('arc-arc-9');
  });

  it('falls back to "Other" when there is neither client nor arc', () => {
    const groups = groupReviewByClient([taskCard({ id: 't1', client: null, arc: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Other');
    expect(groups[0].key).toBe('other');
  });

  it('sorts groups oldest-wait-first (across groups)', () => {
    const groups = groupReviewByClient([
      taskCard({
        id: 'newer',
        client: { id: 'c-newer', name: 'Newer Client' },
        waiting_since: '2026-07-20T00:00:00.000Z',
      }),
      taskCard({
        id: 'older',
        client: { id: 'c-older', name: 'Older Client' },
        waiting_since: '2026-07-01T00:00:00.000Z',
      }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Older Client', 'Newer Client']);
  });

  it('within a group, sorts items oldest-first and reports the oldest as the top item', () => {
    const groups = groupReviewByClient([
      taskCard({
        id: 'newer',
        title: 'Newer thing',
        client: { id: 'c1', name: 'Herba' },
        waiting_since: '2026-07-20T00:00:00.000Z',
      }),
      taskCard({
        id: 'older',
        title: 'Older thing',
        client: { id: 'c1', name: 'Herba' },
        waiting_since: '2026-07-01T00:00:00.000Z',
      }),
    ]);
    expect(groups[0].topItemTitle).toBe('Older thing');
    expect(groups[0].oldestWaitAt).toBe('2026-07-01T00:00:00.000Z');
    expect(groups[0].items.map((i) => i.bodyText)).toEqual(['Older thing', 'Newer thing']);
  });

  it('a group with no timestamped items at all sorts last, and its oldestWaitAt is null', () => {
    const groups = groupReviewByClient([
      taskCard({ id: 't1', client: { id: 'c-timed', name: 'Timed' }, waiting_since: '2026-07-01T00:00:00.000Z' }),
      taskCard({ id: 't2', client: { id: 'c-untimed', name: 'Untimed' }, waiting_since: null }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Timed', 'Untimed']);
    expect(groups[1].oldestWaitAt).toBeNull();
  });

  it('returns an empty array for no review cards', () => {
    expect(groupReviewByClient([])).toEqual([]);
  });
});
