import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth, assertClientScope } from '@/lib/services/client-auth';
import { formatArticleForClient } from '@/lib/api/client-projections';

// Statuses an internal draft is in BEFORE it is ever shown to a client. A client must never learn
// such an article exists — we 404 (not 403) so existence itself isn't leaked. Everything at or past
// `in_review` (the review handoff) — plus `dropped` excluded — is loadable by its own client.
const CLIENT_HIDDEN_ARTICLE_STATUSES = new Set(['pending_research', 'researched', 'drafting', 'dropped']);

// GET /api/portal/articles/:id
// Load ONE article for the C4 full-screen review/edit screen, client-scoped and projected.
// Scope is enforced two ways: the row must belong to the session's client (assertClientScope), and
// only client-visible stages load (internal drafts 404, hiding their existence).
//   no session         → 401 (requireClientAuth)
//   another client      → 403 (assertClientScope)
//   missing / internal  → 404
//   own, in_review+     → 200 { article: ClientArticle }  (allow-list projection, client-safe comments)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireClientAuth();
    const { id } = await params;

    const article = await prisma.article.findFirst({
      where: { id, is_deleted: false },
      // Only the projection's allow-listed fields, plus client_id for the scope gate. Comments are
      // loaded with the author's display name; the projection drops everything else.
      select: {
        id: true,
        title: true,
        status: true,
        body: true,
        client_id: true,
        created_at: true,
        updated_at: true,
        comments: {
          where: { is_deleted: false },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            content: true,
            created_at: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    // Don't reveal an internal draft (or a non-existent id) exists.
    if (!article || CLIENT_HIDDEN_ARTICLE_STATUSES.has(article.status)) {
      throw new ApiError('Article not found', 404);
    }

    // Hard scope gate: a session may only ever read its own client's article.
    assertClientScope(session, article.client_id);

    return NextResponse.json({ article: formatArticleForClient(article) });
  } catch (error) {
    return handleApiError(error);
  }
}
