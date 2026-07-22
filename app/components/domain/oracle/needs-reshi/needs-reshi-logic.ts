// Clarity Phase 3/5 — Needs Reshi. Pure, dependency-free adapters (no React) that turn the
// merged "everything waiting on Mike" feed into renderable card/group shapes. This is what
// lets AskCard stay a dumb presentational component and keeps the merge/cap/group logic
// testable without mounting anything.
//
// Clarity Phase 5 rework (Mike's ruling, 2026-07-22):
//   1. Decide + Answer merge into ONE "Waiting on you" queue — see waitingCardToAskCardData
//      / buildWaitingColumn below. A small type chip (decision/reply) preserves which
//      original queue an item came from.
//   2. Legacy hook-flagged needs_attention sessions with NO declared ask are REMOVED from
//      this screen entirely (they used to render here as compact Answer-column cards via
//      the now-deleted legacySessionToAskCardData/buildAnswerColumn) — linked-to-an-arc ones
//      become a quiet attention dot on the arc's own card instead (see oracle-logic.ts's
//      legacyNeedsAttentionArcIds), unlinked ones move to the Fleet screen (WaitingStrip).
//   3. Review groups by client (falling back to arc, then "Other"), sorted oldest-wait-first
//      — see groupReviewByClient below. The 13-card wall becomes a handful of group cards;
//      expanding one still shows the individual items via the existing per-item AskCard/peek
//      drawer.
import type { WaitingOnMeCard } from '@/lib/hooks/use-waiting-on-me';
import { capColumnCards, type ColumnCapResult } from '@/lib/kanban-caps';

export type AskCardPrimaryAction =
  | { kind: 'open_review'; taskId: string }
  | { kind: 'respond'; remoteUrl: string }
  | { kind: 'none' };

export type WaitingQueueType = 'decision' | 'reply';

export interface AskCardData {
  id: string;
  // "session" or "quest" — the source line, nothing louder (severity/type chips carry the
  // rest of the signal).
  sourceLabel: string;
  // Generic context label shown next to sourceLabel: an arc name for manifest cards, a
  // client name for grouped review items.
  contextLabel?: string | null;
  bodyText: string;
  severity?: 'client_blocking' | 'launch_blocking' | 'internal' | null;
  primaryAction: AskCardPrimaryAction;
  // Clarity Phase 5 — the "Waiting on you" queue's type chip: which of the (now-merged)
  // decide/answer queues this item originally declared. Undefined outside that queue
  // (Review's grouped cards don't carry it).
  queueType?: WaitingQueueType;
}

export function waitingOnMeCardToAskCardData(
  card: WaitingOnMeCard,
  remoteUrl?: string | null,
  queueType?: WaitingQueueType
): AskCardData {
  if (card.type === 'task') {
    return {
      id: `task-${card.id}`,
      sourceLabel: 'quest',
      contextLabel: card.arc?.name ?? null,
      bodyText: card.title ?? 'Untitled',
      severity: card.severity,
      primaryAction: card.task_id ? { kind: 'open_review', taskId: card.task_id } : { kind: 'none' },
      queueType,
    };
  }

  return {
    id: `session-${card.id}`,
    sourceLabel: 'session',
    contextLabel: card.arc?.name ?? null,
    bodyText: card.title ?? 'Untitled',
    severity: card.severity,
    primaryAction: remoteUrl ? { kind: 'respond', remoteUrl } : { kind: 'none' },
    queueType,
  };
}

/**
 * Builds the merged "Waiting on you" queue's final card list: the server's own `waiting`
 * array (already decide-then-answer ordered, each item carrying `queue_type`), capped to
 * the binding density limit. `remoteUrlByExternalId` resolves a session card's live Respond
 * deep-link the same way the legacy Answer column used to.
 */
export function buildWaitingColumn(
  waitingCards: (WaitingOnMeCard & { queue_type?: WaitingQueueType })[],
  remoteUrlByExternalId: Map<string, string | null | undefined>
): ColumnCapResult<AskCardData> {
  const mapped = waitingCards.map((card) =>
    waitingOnMeCardToAskCardData(
      card,
      card.session_external_id ? remoteUrlByExternalId.get(card.session_external_id) : undefined,
      card.queue_type
    )
  );
  return capColumnCards(mapped);
}

// ============================================
// Clarity Phase 5 — Review grouping by client/arc/Other
// ============================================

export interface ReviewGroup {
  key: string;
  label: string;
  count: number;
  /** ISO timestamp of the oldest-waiting item in this group, or null if none of the
   *  group's items carry a waiting_since. */
  oldestWaitAt: string | null;
  topItemTitle: string;
  items: AskCardData[];
}

type ReviewCardInput = WaitingOnMeCard;

function groupKeyAndLabel(card: ReviewCardInput): { key: string; label: string } {
  if (card.client) return { key: `client-${card.client.id}`, label: card.client.name };
  if (card.arc) return { key: `arc-${card.arc.id}`, label: card.arc.name };
  return { key: 'other', label: 'Other' };
}

/**
 * Groups the Review column's cards by client (falling back to arc, then "Other"), sorted
 * oldest-wait-first (the group carrying the longest-waiting item leads). Within a group,
 * items are sorted oldest-first too, so `topItemTitle` is genuinely the thing that's been
 * waiting longest — the whole point of surfacing it on the collapsed group card.
 */
export function groupReviewByClient(cards: ReviewCardInput[]): ReviewGroup[] {
  const groups = new Map<string, { label: string; items: ReviewCardInput[] }>();

  for (const card of cards) {
    const { key, label } = groupKeyAndLabel(card);
    const existing = groups.get(key);
    if (existing) existing.items.push(card);
    else groups.set(key, { label, items: [card] });
  }

  function waitMs(c: ReviewCardInput): number {
    if (!c.waiting_since) return 0;
    const t = new Date(c.waiting_since).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  const result: ReviewGroup[] = Array.from(groups.entries()).map(([key, { label, items }]) => {
    // Oldest (smallest timestamp) first; items with no waiting_since sort last within the
    // group (treated as "just now", never mistaken for the oldest).
    const sortedItems = [...items].sort((a, b) => {
      const aMs = a.waiting_since ? waitMs(a) : Infinity;
      const bMs = b.waiting_since ? waitMs(b) : Infinity;
      return aMs - bMs;
    });
    const oldest = sortedItems.find((i) => !!i.waiting_since) ?? sortedItems[0];

    return {
      key,
      label,
      count: sortedItems.length,
      oldestWaitAt: oldest?.waiting_since ?? null,
      topItemTitle: oldest?.title ?? 'Untitled',
      items: sortedItems.map((c) => waitingOnMeCardToAskCardData(c)),
    };
  });

  // Oldest-wait-first across groups: a group with no timestamped item at all sorts last.
  return result.sort((a, b) => {
    const aMs = a.oldestWaitAt ? new Date(a.oldestWaitAt).getTime() : Infinity;
    const bMs = b.oldestWaitAt ? new Date(b.oldestWaitAt).getTime() : Infinity;
    return aMs - bMs;
  });
}
