/**
 * Client-safe comment visibility.
 *
 * Internal/team comments (incl. Bast's automated technical summaries) carry
 * `is_internal = true` and must never reach client-facing surfaces. These helpers
 * are the single source of truth for that filter, shared by the team comment APIs
 * (client `audience` view) and the future client-portal endpoints (C1/C5).
 */

/** Prisma `where` fragment matching only comments a client may see. */
export const CLIENT_VISIBLE_COMMENT_WHERE = { is_internal: false } as const;

/** Merge the client-visible constraint into an existing Prisma `where` clause. */
export function clientVisibleCommentWhere<T extends Record<string, unknown>>(
  where: T
): T & { is_internal: false } {
  return { ...where, is_internal: false };
}

/** Drop internal comments from an already-fetched list (defensive, in-memory filter). */
export function filterClientVisible<T extends { is_internal?: boolean }>(
  comments: T[]
): T[] {
  return comments.filter((c) => c.is_internal !== true);
}
