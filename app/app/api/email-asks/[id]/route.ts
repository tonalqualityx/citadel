import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';
import { EmailAskState } from '@prisma/client';

// Clarity Phase 4a — the crisis-strip "Handled" action and the intake drawer's
// Open/Dismiss actions both land here. Admin-only, same as the rest of the Oracle
// surface (today, waiting-on-me).
const patchSchema = z.object({
  state: z.nativeEnum(EmailAskState).optional(),
  task_id: z.string().uuid().optional().nullable(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const body = await request.json();
    const data = patchSchema.parse(body);

    const existing = await prisma.emailAsk.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Email ask not found', 404);
    }

    if (data.task_id) {
      const task = await prisma.task.findUnique({ where: { id: data.task_id, is_deleted: false } });
      if (!task) {
        throw new ApiError('Task not found', 404);
      }
    }

    const updated = await prisma.emailAsk.update({
      where: { id },
      data: {
        ...(data.state !== undefined && { state: data.state }),
        ...(data.task_id !== undefined && { task_id: data.task_id }),
      },
    });

    return NextResponse.json(formatEmailAskResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
