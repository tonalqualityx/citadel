import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { cancelRequest } from '@/lib/portal/cancel';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

// POST /api/portal/work/:id/cancel
// The client cancels a request. Any portal user who can see the request may (the approve rule).
// Idempotent: a repeat answers 200 with already_cancelled. 409 when the change is live (code
// `live`) or approved and going live (code `going_live`). 404 for work the contact may not see.
// Staff reopen a cancelled request in Citadel; there is no un-cancel here.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Not found', 404);
    const result = await cancelRequest(access, id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
