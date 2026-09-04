import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — PUT used ONLY by the machine-side sender when a `gog
// gmail send` attempt fails. Bearer, any authenticated user. Stays 'queued' (the next
// poll retries) unless this is the THIRD recorded error in a row, in which case the row
// falls back to 'draft' with send_error set — so a persistently-broken send (a bad
// address, an expired gog token) stops silently retrying forever and surfaces back to
// Mike as a draft needing attention instead. send_error_count resets to 0 on the next
// successful PUT .../sent, or the next draft->queued PATCH (a fresh attempt cycle).
const MAX_SEND_ERRORS = 3;
const MAX_ERROR_LENGTH = 2000;

const sendErrorSchema = z.object({
  error: z.string().min(1),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { id: true, status: true, task_id: true, send_error_count: true },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }
    if (existing.status !== 'queued') {
      throw new ApiError(`Approval request is '${existing.status}', not 'queued'`, 409);
    }

    const body = await request.json();
    const data = sendErrorSchema.parse(body);
    const errorText = data.error.slice(0, MAX_ERROR_LENGTH);

    const nextCount = existing.send_error_count + 1;
    const bounceToDraft = nextCount >= MAX_SEND_ERRORS;

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        send_error: errorText,
        send_error_count: nextCount,
        ...(bounceToDraft ? { status: 'draft' } : {}),
      },
    });

    if (bounceToDraft) {
      await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
        approval_status: { from: 'queued', to: 'draft' },
      });
    }

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      send_error: updated.send_error,
      send_error_count: updated.send_error_count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
