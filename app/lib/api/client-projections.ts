/**
 * Client-view projections for the Client Portal.
 *
 * The portal (work + article approval) must NEVER expose internal/team data. These
 * serializers are the single source of truth for what a client may see and are the
 * building block every client-facing endpoint (C-series) projects through.
 *
 * Design: explicit ALLOW-LIST. We build the client object field-by-field from the
 * loosely-typed Prisma row, so a newly-added internal column can never leak by
 * default — it simply isn't copied. Comments are filtered to client-visible only via
 * `filterClientVisible` (drops `is_internal === true`; article comments have no such
 * flag yet, so all pass — forward-compatible once one is added).
 *
 * Hidden by omission (task): energy_estimate, mystery_factor, battery_impact, all
 * billing fields, review_requirements, requirements, priority, source/provenance,
 * assignee/reviewer/created_by/approved_by internals, sop/function, notes,
 * blocked_by/blocking, time_entries, sort_order, internal IDs.
 * Hidden by omission (article): research_summary, check_state/report, social_copy,
 * locked, claimed_*, run_id, client/site, approved_by internals, scheduling dates.
 */

import { parseJsonField } from './formatters';
import { filterClientVisible } from '@/lib/comments/visibility';

/** Client-safe comment shape: content + author display name only. No email/avatar/id/is_internal. */
export interface ClientComment {
  id: string;
  content: string;
  author_name: string | null;
  created_at: unknown;
}

function formatCommentForClient(comment: any): ClientComment {
  return {
    id: comment.id,
    content: comment.content,
    author_name: comment.user?.name ?? null,
    created_at: comment.created_at,
  };
}

/** Map an already-fetched comment list to the client-safe shape, dropping internal notes. */
function clientComments(comments: any[] | undefined): ClientComment[] {
  if (!comments) return [];
  return filterClientVisible(comments).map(formatCommentForClient);
}

/**
 * Project a Task down to the client-safe view.
 * Exposes ONLY: id, title, description, status, time estimate, client-visible comments, timestamps.
 */
export function formatTaskForClient(task: any) {
  return {
    id: task.id,
    title: task.title,
    description: parseJsonField(task.description),
    status: task.status,
    estimated_minutes: task.estimated_minutes ?? null,
    comments: clientComments(task.comments),
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

/**
 * Project an Article down to the client-safe view.
 * Exposes ONLY: id, title, status, body, client-visible comments, timestamps.
 */
export function formatArticleForClient(article: any) {
  return {
    id: article.id,
    title: article.title,
    status: article.status,
    body: article.body ?? null,
    comments: clientComments(article.comments),
    created_at: article.created_at,
    updated_at: article.updated_at,
  };
}
