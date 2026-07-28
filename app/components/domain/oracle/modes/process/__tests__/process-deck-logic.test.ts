import { describe, it, expect } from 'vitest';
import { buildProcessDeck, currentCard, deckProgress } from '../process-deck-logic';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';
import type { ReviewGroup } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';
import type { AdminSoonTask } from '@/lib/hooks/use-admin-soon';

function ask(overrides: Partial<EmailAsk> = {}): EmailAsk {
  return {
    id: 'ask-1',
    message_id: 'm1',
    thread_id: null,
    account: 'a@b.com',
    from_name: null,
    from_email: 'x@y.com',
    subject: 'subject',
    gist: null,
    queue: null,
    severity: null,
    is_urgent: false,
    state: 'open',
    training_note: null,
    intent: 'general',
    proposed_event_at: null,
    proposed_event_title: null,
    proposed_event_minutes: null,
    calendar_requested: false,
    calendar_event_id: null,
    task_id: null,
    deep_link: 'https://mail.google.com',
    received_at: '2026-07-27T09:00:00.000Z',
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

function reviewGroup(overrides: Partial<ReviewGroup> = {}): ReviewGroup {
  return {
    key: 'client-1',
    label: 'A Client',
    count: 1,
    oldestWaitAt: null,
    topItemTitle: 'A task',
    items: [],
    arcId: null,
    ...overrides,
  };
}

function adminTask(overrides: Partial<AdminSoonTask> = {}): AdminSoonTask {
  return {
    id: 'admin-1',
    title: 'Pay Tara',
    status: 'not_started',
    priority: 3,
    due_date: null,
    promised_to: null,
    client: null,
    source_intent: null,
    ...overrides,
  };
}

describe('buildProcessDeck', () => {
  it('orders intake before review before admin', () => {
    const deck = buildProcessDeck({
      intakeAsks: [ask({ id: 'i1' })],
      reviewGroups: [reviewGroup({ key: 'r1' })],
      adminTasks: [adminTask({ id: 'a1' })],
    });
    expect(deck.map((c) => c.stage)).toEqual(['intake', 'review', 'admin']);
  });

  it('groups intake by lane in admin/meeting/sales/general order', () => {
    const deck = buildProcessDeck({
      intakeAsks: [
        ask({ id: 'general-1', intent: 'general' }),
        ask({ id: 'admin-1', intent: 'admin' }),
        ask({ id: 'sales-1', intent: 'sales' }),
        ask({ id: 'meeting-1', intent: 'meeting' }),
      ],
      reviewGroups: [],
      adminTasks: [],
    });
    expect(deck.map((c) => (c.stage === 'intake' ? c.ask.id : null))).toEqual([
      'admin-1',
      'meeting-1',
      'sales-1',
      'general-1',
    ]);
  });

  it('within a lane, sorts oldest received_at first (sweep order — opposite of the drawer)', () => {
    const deck = buildProcessDeck({
      intakeAsks: [
        ask({ id: 'newer', intent: 'general', received_at: '2026-07-27T12:00:00.000Z' }),
        ask({ id: 'older', intent: 'general', received_at: '2026-07-27T08:00:00.000Z' }),
      ],
      reviewGroups: [],
      adminTasks: [],
    });
    expect(deck.map((c) => (c.stage === 'intake' ? c.ask.id : null))).toEqual(['older', 'newer']);
  });

  it('null intent is treated as general', () => {
    const deck = buildProcessDeck({ intakeAsks: [ask({ intent: null })], reviewGroups: [], adminTasks: [] });
    expect(deck).toHaveLength(1);
  });
});

describe('currentCard — the routed-key cursor', () => {
  it('returns the first unrouted card', () => {
    const deck = buildProcessDeck({ intakeAsks: [ask({ id: 'a' }), ask({ id: 'b' })], reviewGroups: [], adminTasks: [] });
    expect(currentCard(deck, new Set())?.key).toBe(`intake:a`);
    expect(currentCard(deck, new Set([`intake:a`]))?.key).toBe(`intake:b`);
  });

  it('returns null when every card is routed', () => {
    const deck = buildProcessDeck({ intakeAsks: [ask({ id: 'a' })], reviewGroups: [], adminTasks: [] });
    expect(currentCard(deck, new Set([`intake:a`]))).toBeNull();
  });

  it('survives a deck that SHRINKS underneath it (the real-world case: every route action invalidates the query)', () => {
    // Simulate: card "a" was routed and the underlying query refetch already dropped it
    // from the new deck entirely (not just marked routed) — currentCard must not skip "b".
    const fullDeck = buildProcessDeck({ intakeAsks: [ask({ id: 'a' }), ask({ id: 'b' }), ask({ id: 'c' })], reviewGroups: [], adminTasks: [] });
    const routed = new Set([`intake:a`]);
    expect(currentCard(fullDeck, routed)?.key).toBe(`intake:b`);

    // Deck shrinks (a's ask disappeared from the server response after refetch) — b is
    // still correctly next, never skipped to c.
    const shrunkDeck = buildProcessDeck({ intakeAsks: [ask({ id: 'b' }), ask({ id: 'c' })], reviewGroups: [], adminTasks: [] });
    expect(currentCard(shrunkDeck, routed)?.key).toBe(`intake:b`);
  });

  it('an empty deck returns null', () => {
    expect(currentCard([], new Set())).toBeNull();
  });
});

describe('deckProgress', () => {
  it('counts done vs total', () => {
    const deck = buildProcessDeck({ intakeAsks: [ask({ id: 'a' }), ask({ id: 'b' })], reviewGroups: [], adminTasks: [] });
    expect(deckProgress(deck, new Set([`intake:a`]))).toEqual({ done: 1, total: 2 });
  });

  it('an empty deck is 0 of 0', () => {
    expect(deckProgress([], new Set())).toEqual({ done: 0, total: 0 });
  });
});
