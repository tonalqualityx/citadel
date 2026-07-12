import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { notifyArticleClientChangesRequested } from '@/lib/services/troubador-notifications';
import {
  CLIENT_ACTIONABLE_ARTICLE_STATUSES,
  loadActionableArticle,
} from '@/lib/articles/portal-actions';

const requestChangesSchema = z.object({
  note: z.string().min(1, 'Please describe what needs changing').max(5000),
});

// POST /api/portal/articles/:id/request-changes
// Client sends the article back from the C4 review screen. Records their note as a client-visible
// ArticleComment and sets the article to `needs_revision` so the team picks it back up.
//   no session              → 401 (requireClientAuth)
//   another client          → 403 (assertClientScope)
//   missing / internal      → 404 (existence not leaked)
//   already approved        → 409 (can't reopen a piece you've signed off)
//   not in a review stage   → 409
//   empty note              → 400 (zod)
//   own, in review/revision → 200 { status: 'needs_revision' }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireClientAuth();
    const { id } = await params;

    const article = await loadActionableArticle(id, session);

    if (article.client_approved_at) {
      throw new ApiError('This article has already been approved', 409);
    }
    if (!CLIENT_ACTIONABLE_ARTICLE_STATUSES.has(article.status)) {
      throw new ApiError('This article is not currently open for changes', 409);
    }

    const { note } = requestChangesSchema.parse(await request.json());

    // Attribute the change request to the acting contact in the comment *content*. The comment is
    // authored with user_id: null so the client-safe projection renders it as "Indelible" — the
    // internal worker persona never leaks to the client surface. ArticleComment has no is_internal
    // flag, so this is client-visible by design (it IS the client's own feedback echoed in-thread).
    const contact = await prisma.clientContact.findUnique({
      where: { id: session.contactId },
      select: { name: true },
    });
    const attribution = contact?.name ? `${contact.name} (client)` : 'Client';

    await prisma.$transaction([
      prisma.articleComment.create({
        data: {
          article_id: id,
          user_id: null,
          content: `${attribution} requested changes via the portal:\n\n${note}`,
          is_feedback: true,
        },
      }),
      prisma.article.update({
        where: { id },
        data: { status: 'needs_revision', locked: false },
      }),
    ]);

    // Notify the run's assignee. Fire-and-forget: never fail the client's request.
    notifyArticleClientChangesRequested(id, note).catch(() => {});

    return NextResponse.json({ message: 'Thanks — sent back for changes', status: 'needs_revision' });
  } catch (error) {
    return handleApiError(error);
  }
}
