/**
 * Client-portal article action policy (C5).
 *
 * Shared status policy + load/scope guard for the three client-portal article writes
 * (approve, request-changes, save-edits). Keeps the "which stages may a client touch"
 * rule in one place so the GET read path and the write paths can never drift.
 */

import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { assertClientScope, type ClientSession } from '@/lib/services/client-auth';

/**
 * Statuses an internal draft is in BEFORE it is ever shown to a client. A client must never
 * learn such an article exists — callers 404 (not 403) so existence itself isn't leaked.
 * Everything at or past `in_review` (the review handoff), minus `dropped`, is loadable by its
 * own client. (Mirrors the GET route's policy — single source of truth.)
 */
export const CLIENT_HIDDEN_ARTICLE_STATUSES = new Set([
  'pending_research',
  'researched',
  'drafting',
  'dropped',
]);

/**
 * Stages in which a client may still act on an article: it is in review, or has been sent back
 * for revision. Once approved/scheduled/published the client review window is closed, and an
 * internal draft is never actionable.
 */
export const CLIENT_ACTIONABLE_ARTICLE_STATUSES = new Set(['in_review', 'needs_revision']);

/** The minimal article shape every action route needs for its guards. */
export interface ActionableArticle {
  id: string;
  status: string;
  client_id: string;
  client_approved_at: Date | null;
  body: string | null;
}

/**
 * Load an article for a client-portal write and enforce the two access gates:
 *   - 404 when missing or in an internal/hidden stage (existence not leaked)
 *   - 403 when it belongs to another client (assertClientScope)
 * Returns the row for the caller's own per-action guards (status / already-approved).
 */
export async function loadActionableArticle(
  id: string,
  session: ClientSession
): Promise<ActionableArticle> {
  const article = await prisma.article.findFirst({
    where: { id, is_deleted: false },
    select: {
      id: true,
      status: true,
      client_id: true,
      client_approved_at: true,
      body: true,
    },
  });

  if (!article || CLIENT_HIDDEN_ARTICLE_STATUSES.has(article.status)) {
    throw new ApiError('Article not found', 404);
  }

  assertClientScope(session, article.client_id);

  return article;
}
