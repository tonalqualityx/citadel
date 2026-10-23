import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError, AuthError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';
import { EmailAskState } from '@prisma/client';

/** The email classifier marks the notes it writes with this prefix (email-classifier.py AUTO_NOTE_PREFIX). */
const AUTO_NOTE_PREFIX = '[auto] ';

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
  // Draft-started marker (Mike 2026-10-15) — machine-set by the classifier: a Mike draft
  // exists in this ask's thread. NOT a reply (sent-only rule). The two fields are set or
  // cleared together; draft_url must be a Gmail link (defence in depth — it is rendered
  // as an href).
  draft_started_at: z.string().datetime({ offset: true }).optional().nullable(),
  draft_url: z
    .string()
    .max(1000)
    .url()
    .refine((u) => u.startsWith('https://mail.google.com/'), 'draft_url must be a Gmail link')
    .optional()
    .nullable(),
}).refine(
  (d) =>
    (d.draft_started_at === undefined) === (d.draft_url === undefined) &&
    (d.draft_started_at == null) === (d.draft_url == null),
  { message: 'draft_started_at and draft_url are set or cleared together' },
);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    // Admin, or the Porter lane key (the email classifier, fleet item 6). Porter never touches a note
    // Mike typed: it may write training_note only over an empty note and only an AUTO_NOTE_PREFIX
    // note, and it may set calendar_requested to false (clearing after the event) but never true.
    // Anything else is dropped and reported back in ignored_fields.
    const porter = auth.role !== 'admin' && auth.lane === 'porter';
    if (auth.role !== 'admin' && !porter) throw new AuthError('Insufficient permissions', 403);
    const { id } = await params;

    const body = await request.json();
    const data = patchSchema.parse(body);
    const ignored_fields: string[] = [];

    const existing = await prisma.emailAsk.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Email ask not found', 404);
    }

    if (porter) {
      if (data.training_note !== undefined) {
        const storedEmpty = !(existing.training_note ?? '').trim();
        const isAuto = typeof data.training_note === 'string' && data.training_note.startsWith(AUTO_NOTE_PREFIX);
        if (!storedEmpty || !isAuto) {
          ignored_fields.push('training_note');
          delete data.training_note;
        }
      }
      if (data.calendar_requested !== undefined && data.calendar_requested !== false) {
        ignored_fields.push('calendar_requested');
        delete data.calendar_requested;
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
        // Draft marker: set/cleared as a pair (the schema refine guarantees both or neither).
        ...(data.draft_url !== undefined && {
          draft_url: data.draft_url,
          draft_started_at: data.draft_started_at ? new Date(data.draft_started_at) : null,
        }),
        // Leaving `open` (any path: classifier sent-reply, Handled, Dismiss, Archive, attach, create-task) always
        // clears the marker, even if the same body tried to set it.
        ...(data.state !== undefined && data.state !== 'open' && { draft_started_at: null, draft_url: null }),
      },
    });

    return NextResponse.json(
      ignored_fields.length > 0 ? { ...formatEmailAskResponse(updated), ignored_fields } : formatEmailAskResponse(updated)
    );
  } catch (error) {
    return handleApiError(error);
  }
}
