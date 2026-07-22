// Clarity Phase 4c — the arc board header's session panel. An arc's "linked session(s)"
// come from TWO sources per the spec: Arc.origin_session_external_id (provenance — the
// session that first spawned this arc, a plain string field, not a relation) AND any
// OracleSession rows with arc_id = this arc (the real relation, sessions can be linked to
// an arc after the fact too). Kept as a pure, dependency-free merge function so the
// dedupe logic is unit-testable without a database.

export interface ArcLinkedSession {
  id: string;
  external_id: string;
  title: string | null;
  status: string;
  remote_url: string | null;
  needs_attention: boolean;
  last_event_at: Date | string | null;
}

/**
 * Merge the arc_id-linked sessions with an (optional, separately-looked-up) origin
 * session, deduped by id. The origin session is provenance — it's presented first when
 * it isn't already among the arc_id-linked set (most of the time it IS, since arc-
 * originated sessions get their arc_id set too; this only matters for older arcs whose
 * origin session predates the arc_id relation, or where the origin session was later
 * unlinked).
 */
export function mergeArcSessions(
  linked: ArcLinkedSession[],
  origin: ArcLinkedSession | null
): ArcLinkedSession[] {
  if (!origin) return linked;
  if (linked.some((s) => s.id === origin.id)) return linked;
  return [origin, ...linked];
}
