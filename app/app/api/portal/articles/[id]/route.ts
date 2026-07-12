import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth, assertClientScope } from '@/lib/services/client-auth';
import { formatArticleForClient } from '@/lib/api/client-projections';
import {
  CLIENT_HIDDEN_ARTICLE_STATUSES,
  CLIENT_ACTIONABLE_ARTICLE_STATUSES,
  loadActionableArticle,
} from '@/lib/articles/portal-actions';
import { validateHtmlFragment } from '@/lib/articles/html-validation';

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

// Body is plain text end-to-end (storage + the team editor + the C4 plain-text editor). Cap the
// length defensively; allow empty so a client may clear it while editing.
const saveEditsSchema = z.object({
  body: z.string().max(100_000),
});

// PATCH /api/portal/articles/:id
// Persist the client's edits to the article body from the C4 review/edit screen. Session-scoped.
// For WordPress-hosted sites the body IS the rendered HTML, so a broken edit (unclosed tag,
// mismatched nesting) would break the published page — validateHtmlFragment structurally checks
// it before saving. Detection: the article's site.site_type when known; otherwise (site_type not
// configured) the heuristic that a trimmed body starting with '<' is HTML. Plain-text/Markdown
// bodies are never validated as HTML, and an empty body (the client clearing the field) is exempt.
//   no session              → 401 (requireClientAuth)
//   another client          → 403 (assertClientScope)
//   missing / internal      → 404 (existence not leaked)
//   already approved        → 409 (the review window is closed; edits are frozen)
//   not in a review stage   → 409
//   broken HTML (WordPress) → 400 { error: <human-friendly message> }
//   own, in review/revision → 200 { article: ClientArticle }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireClientAuth();
    const { id } = await params;

    const article = await loadActionableArticle(id, session);

    // Edits are only accepted while the client is actively reviewing. Once they've approved (or the
    // piece has moved on), the body is frozen — no silent overwrite of finalized content.
    if (article.client_approved_at) {
      throw new ApiError('This article has already been approved and can no longer be edited', 409);
    }
    if (!CLIENT_ACTIONABLE_ARTICLE_STATUSES.has(article.status)) {
      throw new ApiError('This article is not currently open for edits', 409);
    }

    const { body } = saveEditsSchema.parse(await request.json());

    // Only validate structure when this body is (or looks like) HTML — a WordPress site's
    // configured site_type is authoritative when known; otherwise fall back to a cheap heuristic.
    // An empty body (clearing the field) never trips the heuristic and is trivially well-formed.
    const isHtml =
      article.site_type !== null ? article.site_type === 'wordpress' : body.trim().startsWith('<');
    if (isHtml) {
      const validation = validateHtmlFragment(body);
      if (!validation.valid) {
        throw new ApiError(validation.message, 400);
      }
    }

    const updated = await prisma.article.update({
      where: { id },
      data: { body },
      select: {
        id: true,
        title: true,
        status: true,
        body: true,
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

    return NextResponse.json({ article: formatArticleForClient(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}
