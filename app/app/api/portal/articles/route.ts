import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import {
  formatArticleForClient,
  formatArticleForClientSummary,
} from '@/lib/api/client-projections';

// Just enough fields for the read-only summary sections — no body/comments, no scheduling dates.
const SUMMARY_SELECT = {
  id: true,
  title: true,
  status: true,
  updated_at: true,
  published_url: true,
} as const;

// GET /api/portal/articles
// The logged-in client's articles, client-scoped, grouped by where they stand in the review
// pipeline. Scope is implicit and un-spoofable: the client_id comes from the session, never from
// input, so a session can only ever list its own client's articles — there is no params clientId
// to assert. Every row is projected through an allow-list (A2 for `articles`, a lighter summary
// projection for the read-only groups), so no internal field (research_summary, check_report,
// billing, scheduling, etc.) can leak.
//   no session → 401 (requireClientAuth)
//   own client → 200 { articles, in_revision, approved, published }
//     articles:    in_review only — unchanged shape/behavior (back-compat; "Ready for your review")
//     in_revision: needs_revision — "We're revising this now"
//     approved:    approved OR scheduled — "Approved — publishing soon"
//     published:   published — includes published_url
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();

    const baseWhere = { client_id: session.clientId, is_deleted: false } as const;

    const [articles, inRevision, approved, published] = await Promise.all([
      prisma.article.findMany({
        where: { ...baseWhere, status: 'in_review' },
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
      }),
      prisma.article.findMany({
        where: { ...baseWhere, status: 'needs_revision' },
        select: SUMMARY_SELECT,
        orderBy: { updated_at: 'desc' },
      }),
      prisma.article.findMany({
        where: { ...baseWhere, status: { in: ['approved', 'scheduled'] } },
        select: SUMMARY_SELECT,
        orderBy: { updated_at: 'desc' },
      }),
      prisma.article.findMany({
        where: { ...baseWhere, status: 'published' },
        select: SUMMARY_SELECT,
        orderBy: { updated_at: 'desc' },
      }),
    ]);

    return NextResponse.json({
      articles: articles.map(formatArticleForClient),
      in_revision: inRevision.map(formatArticleForClientSummary),
      approved: approved.map(formatArticleForClientSummary),
      published: published.map(formatArticleForClientSummary),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
