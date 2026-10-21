import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadChatView } from '@/lib/portal/chat/view';

// GET /api/portal/chat/:id?after=<comment id> (portal phase C)
// State, mode, the thread after `after`, whether the assistant is writing (and the note), the one
// thing to answer next, the banner. Expires a stale job first (queued over 60 s, or claimed over 120 s
// without a result) and answers the turn from the question tree. 404 for anything not theirs.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimit(request, 240);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const after = z.string().uuid().safeParse(new URL(request.url).searchParams.get('after'));
    return NextResponse.json(await loadChatView(access, id.data, { after: after.success ? after.data : null }));
  } catch (error) {
    return handleApiError(error);
  }
}
