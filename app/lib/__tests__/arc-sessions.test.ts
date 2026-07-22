import { describe, it, expect } from 'vitest';
import { mergeArcSessions, type ArcLinkedSession } from '../arc-sessions';

function session(overrides: Partial<ArcLinkedSession> = {}): ArcLinkedSession {
  return {
    id: 'session-1',
    external_id: 'ext-1',
    title: 'A session',
    status: 'running',
    remote_url: null,
    needs_attention: false,
    last_event_at: null,
    ...overrides,
  };
}

// Clarity Phase 4c — the arc board header's session panel: an arc's linked session(s)
// come from two sources (Arc.origin_session_external_id + arc_id-linked OracleSession
// rows). This dedupes/merges them.
describe('mergeArcSessions', () => {
  it('returns the linked list unchanged when there is no origin session', () => {
    const linked = [session({ id: 'a' })];
    expect(mergeArcSessions(linked, null)).toBe(linked);
  });

  it('prepends the origin session when it is not already among the linked set', () => {
    const linked = [session({ id: 'a', external_id: 'ext-a' })];
    const origin = session({ id: 'origin', external_id: 'ext-origin' });

    const result = mergeArcSessions(linked, origin);

    expect(result.map((s) => s.id)).toEqual(['origin', 'a']);
  });

  it('does not duplicate the origin session when it is already in the linked set', () => {
    const linked = [session({ id: 'shared', external_id: 'ext-shared' })];
    const origin = session({ id: 'shared', external_id: 'ext-shared' });

    const result = mergeArcSessions(linked, origin);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('shared');
  });

  it('returns an empty array when there are no linked sessions and no origin session', () => {
    expect(mergeArcSessions([], null)).toEqual([]);
  });

  it('returns just the origin session when there is no arc_id-linked session at all', () => {
    const origin = session({ id: 'origin-only' });
    expect(mergeArcSessions([], origin)).toEqual([origin]);
  });
});
