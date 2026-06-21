import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { formatArticleForClient } from '@/lib/api/client-projections';

// GET /api/portal/articles
// The logged-in client's articles that are ready for their review (in_review), client-scoped.
// Scope is implicit and un-spoofable: the client_id comes from the session, never from input, so a
// session can only ever list its own client's articles — there is no params clientId to assert.
// Every row is projected through the A2 client-view projection (allow-list), so no internal field
// (research_summary, check_report, billing, scheduling, etc.) can leak.
//   no session → 401 (requireClientAuth)
//   own client → 200 { articles: ClientArticle[] }  (only in_review, only theirs)
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();

    const articles = await prisma.article.findMany({
      where: {
        client_id: session.clientId,
        status: 'in_review',
        is_deleted: false,
      },
      // Only what the client projection exposes; a list need not load comment threads.
      select: {
        id: true,
        title: true,
        status: true,
        body: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { updated_at: 'desc' },
    });

    return NextResponse.json({ articles: articles.map(formatArticleForClient) });
  } catch (error) {
    return handleApiError(error);
  }
}
