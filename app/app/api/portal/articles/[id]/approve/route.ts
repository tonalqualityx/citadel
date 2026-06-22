import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { recordArticleClientApproval } from '@/lib/services/portal';
import {
  CLIENT_ACTIONABLE_ARTICLE_STATUSES,
  loadActionableArticle,
} from '@/lib/articles/portal-actions';

// POST /api/portal/articles/:id/approve
// Client signs off on the article from the C4 review screen. Records client_approved_at +
// approved_by_contact_id (the logged-in contact) and advances the article toward `approved`.
// Session-scoped and idempotent — a second approval is a no-op, never an error.
//   no session              → 401 (requireClientAuth)
//   another client          → 403 (assertClientScope)
//   missing / internal      → 404 (existence not leaked)
//   not in a review stage   → 409 (and not already approved)
//   own, in review/revision → 200 { status, approved_at, already_approved }
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireClientAuth();
    const { id } = await params;

    const article = await loadActionableArticle(id, session);

    // Idempotent: an already-approved article just re-confirms, even though `approved` is no longer
    // in the actionable set. Record-helper is the source of truth for the approval fields.
    if (!article.client_approved_at && !CLIENT_ACTIONABLE_ARTICLE_STATUSES.has(article.status)) {
      throw new ApiError('This article is not currently open for approval', 409);
    }

    // Attribute the approval to the actual logged-in contact (not just the client's primary).
    const result = await recordArticleClientApproval(id, session.contactId);
    if (!result) {
      // The article existed a moment ago (loadActionableArticle passed); a null here means it
      // vanished mid-request — surface as not-found rather than guessing.
      throw new ApiError('Article not found', 404);
    }

    // Advance the article forward on a first approval. Only from a live review stage, so a later
    // re-confirm never churns the status of a piece that's already moved on.
    if (!result.already_approved && CLIENT_ACTIONABLE_ARTICLE_STATUSES.has(article.status)) {
      await prisma.article.update({ where: { id }, data: { status: 'approved' } });
    }

    return NextResponse.json({
      status: 'approved',
      approved_at: result.approved_at,
      already_approved: result.already_approved,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
