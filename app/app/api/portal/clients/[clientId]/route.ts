import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth, assertClientScope } from '@/lib/services/client-auth';

// GET /api/portal/clients/:clientId
// Minimal client-scoped portal resource. Foundation for the C3+ client screens and the
// canonical demonstration that requireClientAuth + assertClientScope isolate clients:
//   no session       → 401
//   own client       → 200 (id + name only — never internal fields)
//   another client   → 403
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const session = await requireClientAuth();
    const { clientId } = await params;

    // Hard scope gate: a session may only ever read its own client.
    assertClientScope(session, clientId);

    const client = await prisma.client.findFirst({
      where: { id: clientId, is_deleted: false },
      select: { id: true, name: true },
    });

    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    return NextResponse.json({ client });
  } catch (error) {
    return handleApiError(error);
  }
}
