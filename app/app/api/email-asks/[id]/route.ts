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
  // Clarity Phase 4b — Mike's own correction/calibration note on a classification, entered
  // from the intake drawer's "note for Bast" input.
  training_note: z.string().max(2000).optional().nullable(),
  // Clarity Phase 6 — the meeting-lane card's "Add to calendar" button intent flag. Only
  // ever set to true from the UI (there's no "un-request" action); the machine-side cron
  // reads it via GET /api/email-asks?calendar_requested=true.
  calendar_requested: z.boolean().optional(),
  // Clarity Phase 6 (addendum) — the machine-side calendar executor's completion write:
  // closes the loop calendar_requested opened. Setting calendar_event_id (including
  // explicitly clearing it to null) atomically flips calendar_requested back to false in
  // the SAME update, regardless of what else the request body sent — the state machine is
  // requested -> executed, and this is the only transition out of "requested". This is the
  // one write path in this API for a field the schema doc comment otherwise calls
  // "entirely machine-set".
  calendar_event_id: z.string().max(255).optional().nullable(),
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
        ...(data.training_note !== undefined && { training_note: data.training_note }),
        ...(data.calendar_requested !== undefined && { calendar_requested: data.calendar_requested }),
        // calendar_event_id's spread comes LAST and always pins calendar_requested: false
        // alongside it — the atomic requested -> executed transition wins over any
        // calendar_requested value the same request body also happened to send.
        ...(data.calendar_event_id !== undefined && {
          calendar_event_id: data.calendar_event_id,
          calendar_requested: false,
        }),
      },
    });

    return NextResponse.json(formatEmailAskResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
