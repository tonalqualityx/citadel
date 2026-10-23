import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { releaseClaim, RELEASE_STATUSES } from '@/lib/tasks/claims';

const bodySchema = z.object({ token: z.string().min(1).max(100), status: z.enum(RELEASE_STATUSES).optional().nullable() });

// POST /api/tasks/:id/claim/release - give the task up, optionally moving it to a status in the same statement.
// A wrong token changes nothing and answers released:false.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const released = await releaseClaim({ taskId: id, token: body.token, status: body.status ?? null });
    return NextResponse.json({ released });
  } catch (error) {
    return handleApiError(error);
  }
}
