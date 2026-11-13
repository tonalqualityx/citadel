/**
 * Which project a Triage card may be linked to by a session (the triage desk or the chat lane; the owner's own session is not narrowed).
 * A card may be linked only to a project that no OTHER Triage card is using and that belongs to the card's own client or is internal (no
 * client). Without this a session could point its card at another client's queued project and then redraw that project's shape or set its
 * launch date through its own card. A card that has no client yet may take any such project (it then takes the project's client).
 */
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { isTriageDeskLane } from '@/lib/triage-desk/guard';
import { isChatLane } from './questions';
import { DATE_SOURCE_MESSAGE, type DateSource } from './plan-schema';

type Db = Pick<PrismaClient, 'task' | 'project'>;

export function linkIsNarrowed(auth: Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>): boolean {
  return isTriageDeskLane(auth) || isChatLane(auth);
}

export async function assertLinkableProject(db: Db, cardId: string, cardClientId: string | null, projectId: string): Promise<void> {
  const p = await db.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { id: true, client_id: true } });
  if (!p) return; // the route answers 404
  const other = await db.task.count({ where: { project_id: projectId, status: 'triage', is_deleted: false, id: { not: cardId } } });
  if (other > 0) throw new ApiError('Another Triage card already uses that project, so this card cannot be linked to it.', 409, 'project_in_use');
  if (p.client_id && cardClientId && p.client_id !== cardClientId) {
    throw new ApiError("That project belongs to a different client than this card, so it cannot be linked from here.", 409, 'project_other_client');
  }
}

/**
 * PATCH /api/tasks/:id/triage dates as the chat lane: the launch and start dates are the project's own. The chat may set them on any project, the one
 * the portal shows included, but only with the source of the date (the deal, the SOW, a client email, or Mike's words); the route records each changed
 * date with that source (lib/tasks/date-changes.ts). Without a source the answer is 422. The owner's own session needs no source.
 */
export function guardChatProjectDates(auth: Parameters<typeof isChatLane>[0], datesGiven: boolean, source: DateSource | undefined): void {
  if (!datesGiven || !isChatLane(auth)) return;
  if (!source) throw new ApiError(DATE_SOURCE_MESSAGE, 422, 'date_source_required');
}
