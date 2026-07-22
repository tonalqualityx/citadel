import { prisma } from '@/lib/db/prisma';
import { getArcStatus } from '@/lib/arc-status';
import { ApiError } from '@/lib/api/errors';

// Clarity Phase 4a: extracted verbatim from app/api/session-tasks/route.ts's inline arc
// resolution (POST handler) so /api/email-asks/[id]/create-task can reuse the EXACT same
// arc_id/arc_name resolution logic instead of a second, drifting copy. Behavior is
// unchanged from the original inline version — session-tasks' own tests are the
// regression guard for that (this file has its own unit tests too).
export interface ArcResolutionInput {
  arc_id?: string | null;
  arc_name?: string | null;
  /** Attributed as the new arc's origin_session_external_id if a new arc is created via
   *  arc_name. Optional — callers with no originating session (e.g. an email-born task)
   *  simply omit it, leaving origin_session_external_id null. */
  originSessionExternalId?: string | null;
}

/**
 * Resolves arc_id used as-is (404 via ApiError if missing); arc_name reuses an
 * exact-name, non-complete arc if one exists, else creates a new one. Returns null if
 * neither arc_id nor arc_name was given. Throws ApiError(400) if both were given —
 * callers should already validate mutual exclusivity at the schema level (e.g. Zod's
 * .refine on session-tasks' body), but this is the last line of defense so the shared
 * function stays safe to call standalone.
 */
export async function resolveArc(input: ArcResolutionInput): Promise<string | null> {
  const { arc_id, arc_name, originSessionExternalId } = input;

  if (arc_id && arc_name) {
    throw new ApiError('Provide at most one of arc_id or arc_name, not both', 400);
  }

  if (arc_id) {
    const arc = await prisma.arc.findUnique({ where: { id: arc_id } });
    if (!arc) {
      throw new ApiError('Arc not found', 404);
    }
    return arc.id;
  }

  if (arc_name) {
    const sameName = await prisma.arc.findMany({
      where: { name: arc_name },
      include: { tasks: { select: { status: true } } },
      orderBy: { created_at: 'desc' },
    });
    const reusable = sameName.find((arc) => getArcStatus(arc) !== 'complete');

    if (reusable) {
      return reusable.id;
    }

    const created = await prisma.arc.create({
      data: {
        name: arc_name,
        origin_session_external_id: originSessionExternalId ?? null,
      },
    });
    return created.id;
  }

  return null;
}
