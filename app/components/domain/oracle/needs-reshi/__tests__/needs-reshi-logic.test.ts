import { describe, it, expect } from 'vitest';
import type { WaitingOnMeCard } from '@/lib/hooks/use-waiting-on-me';
import type { OracleSessionWithMachine } from '@/lib/types/oracle';
import {
  waitingOnMeCardToAskCardData,
  legacySessionToAskCardData,
  buildAnswerColumn,
} from '../needs-reshi-logic';

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
    due_date: null,
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
    due_date: null,
    ...overrides,
  };
}

function legacySession(overrides: Partial<OracleSessionWithMachine> = {}): OracleSessionWithMachine {
  return {
    id: 'session-row-1',
    external_id: 'legacy-ext-1',
    source: 'claude_code',
    title: 'grantibly-wright-b1 — gate review',
    cwd: '/home/mike/clients/grantibly',
    model: 'claude-opus-4-5',
    remote_url: 'https://claude.ai/code/session_legacy1',
    status: 'waiting',
    needs_attention: true,
    attention_reason: 'Approval needed: publish B1 gate deliverable.',
    started_at: '2026-07-09T18:00:00.000Z',
    last_event_at: '2026-07-09T19:00:00.000Z',
    ended_at: null,
    tokens_total: 1000,
    agents: [],
    machine: { id: 'm1', name: 'reshi-workstation', hostname: null, last_heartbeat_at: null, stale: false, sessions: [], commands: [] },
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
});

describe('legacySessionToAskCardData', () => {
  it('sources as "session · legacy" — the only visual distinction from a manifest ask', () => {
    const data = legacySessionToAskCardData(legacySession());
    expect(data.sourceLabel).toBe('session · legacy');
  });

  it('carries the session title as the context label and attention_reason as the body text', () => {
    const data = legacySessionToAskCardData(legacySession());
    expect(data.contextLabel).toBe('grantibly-wright-b1 — gate review');
    expect(data.bodyText).toBe('Approval needed: publish B1 gate deliverable.');
  });

  it('falls back to external_id for the context label when the session has no title', () => {
    const data = legacySessionToAskCardData(legacySession({ title: null }));
    expect(data.contextLabel).toBe('legacy-ext-1');
  });

  it('falls back to a default text when attention_reason is null/blank', () => {
    expect(legacySessionToAskCardData(legacySession({ attention_reason: null })).bodyText).toBe(
      'Claude is waiting for your input'
    );
    expect(legacySessionToAskCardData(legacySession({ attention_reason: '   ' })).bodyText).toBe(
      'Claude is waiting for your input'
    );
  });

  it('respond action when remote_url is present', () => {
    const data = legacySessionToAskCardData(legacySession());
    expect(data.primaryAction).toEqual({ kind: 'respond', remoteUrl: 'https://claude.ai/code/session_legacy1' });
  });

  it('none action when remote_url is absent', () => {
    const data = legacySessionToAskCardData(legacySession({ remote_url: null }));
    expect(data.primaryAction).toEqual({ kind: 'none' });
  });

  it('carries no severity chip (legacy sessions have no declared ask_severity)', () => {
    const data = legacySessionToAskCardData(legacySession());
    expect(data.severity).toBeNull();
  });
});

describe('buildAnswerColumn', () => {
  it('merges manifest answer cards and legacy sessions into one list', () => {
    const remoteUrlMap = new Map([['sess-1', 'https://claude.ai/code/session_x']]);
    const result = buildAnswerColumn([sessionAskCard()], [legacySession()], remoteUrlMap);
    expect(result.visible.map((c) => c.sourceLabel)).toEqual(['session', 'session · legacy']);
  });

  it('applies the density cap to the MERGED list, not each source separately', () => {
    const manyLegacy = Array.from({ length: 10 }, (_, i) =>
      legacySession({ external_id: `legacy-${i}`, attention_reason: `Reason ${i}` })
    );
    const manifestCards = [sessionAskCard(), sessionAskCard({ id: 'card-3', session_external_id: 'sess-2' })];
    const result = buildAnswerColumn(manifestCards, manyLegacy, new Map());

    // 2 manifest + 10 legacy = 12 total; capped at the binding max (6), overflow = 6.
    expect(result.visible).toHaveLength(6);
    expect(result.overflowCount).toBe(6);
  });

  it('returns an empty result when there is nothing on either side', () => {
    const result = buildAnswerColumn([], [], new Map());
    expect(result.visible).toHaveLength(0);
    expect(result.overflowCount).toBe(0);
  });
});
