import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { requireClientAuth, switchActiveClient } from '@/lib/services/client-auth';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

const bodySchema = z.object({ client_id: z.string().min(1).max(64) });

// POST /api/portal/session/client { client_id }
// Switch the session's active client. 401 without a session; 403 when the target is not in the
// person's current accessible list (re-resolved server-side, never trusted from the browser).
export async function POST(request: NextRequest) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;
  try {
    const session = await requireClientAuth();
    const { client_id } = bodySchema.parse(await request.json().catch(() => ({})));
    const target = await switchActiveClient(session, client_id);
    return NextResponse.json({
      active_client_id: target.clientId,
      client: { id: target.clientId, name: target.name, role: target.role },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
