import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';

// Clarity Phase 7 (Seeing Stone Reckoning P1) — email<->arc attachment. When Mike rules
// an email actionable, it LEAVES the intake drawer and attaches to the resulting
// task/arc (gist, deep link, sender, thread id already live on the ask itself). Accepts
// EITHER arc_id or task_id (never both — a single attach action names one destination);
// setting either flips state to 'handled', same "resolved the instant Mike acts"
// convention as the rest of the intake drawer's actions. Idempotent: re-POSTing the same
// {arc_id} or {task_id} just re-sets the same value and re-confirms state=handled — no
// error, no duplicate side effect. Admin-only, same gate as the sibling
// PATCH/create-task endpoints on this resource.
const attachSchema = z
  .object({
    arc_id: z.string().uuid().optional(),
    task_id: z.string().uuid().optional(),
  })
  .refine((data) => (data.arc_id ? 1 : 0) + (data.task_id ? 1 : 0) === 1, {
    message: 'Provide exactly one of arc_id or task_id',
  });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const ask = await prisma.emailAsk.findUnique({ where: { id } });
    if (!ask) {
      throw new ApiError('Email ask not found', 404);
    }

    const body = await request.json();
    const data = attachSchema.parse(body);

    if (data.arc_id) {
      const arc = await prisma.arc.findUnique({ where: { id: data.arc_id } });
      if (!arc) {
        throw new ApiError('Arc not found', 404);
      }
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
        ...(data.arc_id !== undefined && { arc_id: data.arc_id }),
        ...(data.task_id !== undefined && { task_id: data.task_id }),
        state: 'handled',
      },
    });

    return NextResponse.json(formatEmailAskResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
