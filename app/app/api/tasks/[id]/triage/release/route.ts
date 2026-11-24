import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { FRONT_SESSION_ONLY, isFrontSessionCaller, releaseOnMikesWords } from '@/lib/front-session/release';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/tasks/:id/triage/release   { mike_words, said_where, said_at, release_version? }
 * The front session releases a Triage card on Mike's quoted words (lib/front-session/release.ts). The enforced front-session lane only:
 * no credentials is the middleware's 401, another lane key the middleware's 403, and a caller with no lane (Mike's own session included:
 * he has his Release tap) 403 front_session_only here. The release is the one his tap runs; his words, where and when are recorded on the card.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!isFrontSessionCaller(auth)) throw new ApiError(FRONT_SESSION_ONLY, 403, 'front_session_only');
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400);
    }
    const result = await releaseOnMikesWords(prisma, auth, id, body);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
