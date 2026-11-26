import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import {
  clearWaiting,
  formatWaiting,
  patchWaiting,
  patchWaitingSchema,
  setWaiting,
  setWaitingSchema,
  WAITING_SCALARS,
} from '@/lib/tasks/waiting';

// Waiting on someone (task 23cd54cf). A marked card leaves Mike's waiting lists until the follow-up time passes.
const idSchema = z.string().uuid();
type Ctx = { params: Promise<{ id: string }> };

// GET /api/tasks/:id/waiting - the card's mark ({ waiting_on: null } when it has none).
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = idSchema.parse((await params).id);
    const task = await prisma.task.findUnique({ where: { id }, select: { id: true, status: true, is_deleted: true, ...WAITING_SCALARS } });
    if (!task || task.is_deleted) throw new ApiError('Task not found', 404);
    return NextResponse.json({ task_id: id, waiting_on: formatWaiting(task) });
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT /api/tasks/:id/waiting - mark the card waiting on a contact, a user or a named person. Replaces any mark it had.
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = idSchema.parse((await params).id);
    const body = setWaitingSchema.parse(await request.json());
    const task = await setWaiting(auth.userId, id, body);
    return NextResponse.json({ task_id: id, waiting_on: formatWaiting(task) });
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/tasks/:id/waiting - change the follow-up date, thread or note, or record follow_up_sent_at.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = idSchema.parse((await params).id);
    const body = patchWaitingSchema.parse(await request.json());
    const task = await patchWaiting(auth.userId, id, body);
    return NextResponse.json({ task_id: id, waiting_on: formatWaiting(task) });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/tasks/:id/waiting - take the mark off. Idempotent.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = idSchema.parse((await params).id);
    await clearWaiting(auth.userId, id);
    return NextResponse.json({ task_id: id, waiting_on: null });
  } catch (error) {
    return handleApiError(error);
  }
}
