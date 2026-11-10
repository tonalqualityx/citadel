/** Designer Portal v2: the session and track every tracked-only designer route starts from (SPEC 4.11). */
import type { DesignSession, DesignTrack } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { loadSessionFor, type SessionAccessMode } from './access';
import type { DesignActor } from './helpers';
import { loadTrack } from './track-core';

/**
 * Load the session for the caller (404 for a stranger, 403 for a pm write), then its track. A session with no track
 * answers 404, exactly like a session that does not exist: tracked-only routes do not exist for untracked sessions.
 */
export async function loadTrackedSession(actor: DesignActor, id: string, mode: SessionAccessMode): Promise<{ session: DesignSession; track: DesignTrack }> {
  const session = await loadSessionFor(actor, id, { mode });
  if (!session.track_id) throw new ApiError('Session not found', 404, 'not_found');
  return { session, track: await loadTrack(prisma, session.track_id) };
}
