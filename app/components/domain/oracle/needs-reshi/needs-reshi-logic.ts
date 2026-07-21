// Clarity Phase 3 — Needs Reshi. Pure, dependency-free adapters (no React) that turn the
// two source shapes — a manifest ask from /api/waiting-on-me, and a "legacy" hook-flagged
// needs_attention session with no manifest ask (see oracle-logic.ts's
// legacyNeedsAttentionSessions) — into one common, renderable card shape. This is what lets
// AskCard stay a dumb presentational component and keeps the merge/cap logic testable
// without mounting anything.
import type { WaitingOnMeCard } from '@/lib/hooks/use-waiting-on-me';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import { capColumnCards, type ColumnCapResult } from '@/lib/kanban-caps';

export type AskCardPrimaryAction =
  | { kind: 'open_review'; taskId: string }
  | { kind: 'respond'; remoteUrl: string }
  | { kind: 'none' };

export interface AskCardData {
  id: string;
  // "session", "session · legacy", or "quest" — the ONLY visual distinction between a
  // manifest-declared session ask and a legacy hook-flagged one, per the binding
  // correction: nothing louder than the source line.
  sourceLabel: string;
  // Generic context label shown next to sourceLabel: an arc name for manifest cards, the
  // session's own title for legacy cards ("session title, attention_reason text" per the
  // binding correction — title identifies WHICH session, bodyText is the actual ask).
  contextLabel?: string | null;
  bodyText: string;
  severity?: 'client_blocking' | 'launch_blocking' | 'internal' | null;
  primaryAction: AskCardPrimaryAction;
}

const DEFAULT_LEGACY_ATTENTION_TEXT = 'Claude is waiting for your input';

export function waitingOnMeCardToAskCardData(
  card: WaitingOnMeCard,
  remoteUrl?: string | null
): AskCardData {
  if (card.type === 'task') {
    return {
      id: `task-${card.id}`,
      sourceLabel: 'quest',
      contextLabel: card.arc?.name ?? null,
      bodyText: card.title ?? 'Untitled',
      severity: card.severity,
      primaryAction: card.task_id ? { kind: 'open_review', taskId: card.task_id } : { kind: 'none' },
    };
  }

  return {
    id: `session-${card.id}`,
    sourceLabel: 'session',
    contextLabel: card.arc?.name ?? null,
    bodyText: card.title ?? 'Untitled',
    severity: card.severity,
    primaryAction: remoteUrl ? { kind: 'respond', remoteUrl } : { kind: 'none' },
  };
}

/** A legacy needs-attention session, rendered as a compact Answer-column card: session
 *  title as the context label, attention_reason (or a sensible default) as the body text,
 *  Respond as the primary action when a remote_url exists. */
export function legacySessionToAskCardData(session: OracleSessionWithMachine): AskCardData {
  return {
    id: `legacy-${session.external_id}`,
    sourceLabel: 'session · legacy',
    contextLabel: session.title ?? session.external_id,
    bodyText: session.attention_reason?.trim() || DEFAULT_LEGACY_ATTENTION_TEXT,
    severity: null,
    primaryAction: session.remote_url ? { kind: 'respond', remoteUrl: session.remote_url } : { kind: 'none' },
  };
}

/**
 * Builds the Answer column's final card list: manifest asks first, then legacy
 * needs-attention sessions appended, capped together (never capped separately then
 * concatenated — the binding density cap applies to the merged list, since prod carries
 * ~13 legacy sessions on day one and the cap is load-bearing there specifically).
 */
export function buildAnswerColumn(
  manifestAnswerCards: WaitingOnMeCard[],
  legacySessions: OracleSessionWithMachine[],
  remoteUrlByExternalId: Map<string, string | null | undefined>
): ColumnCapResult<AskCardData> {
  const merged: AskCardData[] = [
    ...manifestAnswerCards.map((card) =>
      waitingOnMeCardToAskCardData(
        card,
        card.session_external_id ? remoteUrlByExternalId.get(card.session_external_id) : undefined
      )
    ),
    ...legacySessions.map(legacySessionToAskCardData),
  ];
  return capColumnCards(merged);
}
