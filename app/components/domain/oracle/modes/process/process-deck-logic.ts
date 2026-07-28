// Clarity Phase 8 (composition) — the Process dealer: ONE CARD AT A TIME (mode-escort law
// #3: "Process deals one card at a time, never a list-wall, even when escorted"), over
// intake asks -> review batches -> admin-soon tasks, in that order.
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';
import type { ReviewGroup } from '@/components/domain/oracle/needs-reshi/needs-reshi-logic';
import type { AdminSoonTask } from '@/lib/hooks/use-admin-soon';

export type ProcessCard =
  | { key: `intake:${string}`; stage: 'intake'; ask: EmailAsk }
  | { key: `review:${string}`; stage: 'review'; group: ReviewGroup }
  | { key: `admin:${string}`; stage: 'admin'; task: AdminSoonTask };

const INTAKE_LANE_ORDER = ['admin', 'meeting', 'sales', 'general'] as const;

/**
 * Deck order (binding, documented):
 *  1. Intake asks — grouped by lane in admin/meeting/sales/general order (admin first,
 *     Phase 6b's don't-get-paid ruling), oldest received_at first WITHIN a lane. This is
 *     deliberately the OPPOSITE of the drawer's own newest-first scan order — a sweep
 *     clears the backlog oldest-first, the drawer is for scanning what just arrived.
 *  2. Review batches — groupReviewByClient()'s own output, already oldest-wait-first.
 *  3. Admin-soon tasks — server order (due asc nulls last, priority asc, created asc).
 */
export function buildProcessDeck(input: {
  intakeAsks: EmailAsk[];
  reviewGroups: ReviewGroup[];
  adminTasks: AdminSoonTask[];
}): ProcessCard[] {
  const intakeByLane = INTAKE_LANE_ORDER.flatMap((lane) =>
    input.intakeAsks
      .filter((a) => (a.intent ?? 'general') === lane)
      .sort((a, b) => a.received_at.localeCompare(b.received_at))
  );

  return [
    ...intakeByLane.map((ask): ProcessCard => ({ key: `intake:${ask.id}`, stage: 'intake', ask })),
    ...input.reviewGroups.map((group): ProcessCard => ({ key: `review:${group.key}`, stage: 'review', group })),
    ...input.adminTasks.map((task): ProcessCard => ({ key: `admin:${task.id}`, stage: 'admin', task })),
  ];
}

/**
 * The cursor is a ROUTED-KEY SET, not an index — the correctness point. Every route action
 * invalidates the underlying query, the deck re-derives with one fewer item, and an index
 * cursor would skip the card that slid into the old index. `currentCard` is always the
 * first card whose key isn't in `routed`, so the deck can shrink or grow underneath without
 * ever skipping or repeating a card.
 */
export function currentCard(deck: ProcessCard[], routed: ReadonlySet<string>): ProcessCard | null {
  return deck.find((c) => !routed.has(c.key)) ?? null;
}

export function deckProgress(deck: ProcessCard[], routed: ReadonlySet<string>): { done: number; total: number } {
  const total = deck.length;
  const done = deck.filter((c) => routed.has(c.key)).length;
  return { done, total };
}
