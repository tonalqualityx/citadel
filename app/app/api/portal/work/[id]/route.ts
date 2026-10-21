import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadWorkItem } from '@/lib/portal/requests';

// GET /api/portal/work/:id (portal phase B slice 1)
// One client-visible task in client words: title, state, engagement, the intake answers, and the
// staged preview when it is waiting on the client. 404 for anything the contact may not see, the
// same answer as "missing", so ids cannot be probed. Allow-list only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Not found', 404);
    const item = await loadWorkItem(access, id);
    if (!item) throw new ApiError('Not found', 404);
    return NextResponse.json({ work: item });
  } catch (error) {
    return handleApiError(error);
  }
}
