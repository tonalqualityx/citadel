import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError, AuthError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';
import { EmailAskState } from '@prisma/client';
import { homeOwner, isSecurityTagged } from '@/lib/work/ask-closure';
import { ownerOfAssignee } from '@/lib/work/decision';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { normalizeRfc } from '@/lib/work/link-asks';

/** Work stage A: why and by whom an ask left open (EmailAsk.closed_reason and closed_by, varchar columns, not enum values). */
const CLOSED_REASONS = ['with_task', 'task_done', 'task_abandoned', 'no_action', 'waiting_them', 'answered_by_mike', 'answered_by_bast', 'meeting_booked', 'archived', 'mike', 'backfill', 'catchup'] as const;
const CLOSED_BYS = ['classifier', 'intake', 'task', 'mike', 'bast', 'backfill', 'catchup'] as const;

/** The email classifier marks the notes it writes with this prefix (email-classifier.py AUTO_NOTE_PREFIX). */
const AUTO_NOTE_PREFIX = '[auto] ';

// Clarity Phase 4a — the crisis-strip "Handled" action and the intake drawer's
// Open/Dismiss actions both land here. Admin-only, same as the rest of the Oracle
// surface (today, waiting-on-me).
const patchSchema = z.object({
  state: z.nativeEnum(EmailAskState).optional(),
  task_id: z.string().uuid().optional().nullable(),
  // Work stage A: the closing record, written together with a state that leaves open (400 otherwise), and the
  // conversation key, which a porter may only write over null.
  closed_reason: z.enum(CLOSED_REASONS).optional(),
  closed_by: z.enum(CLOSED_BYS).optional(),
  conversation_key: z.string().max(255).optional().nullable(),
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
).refine(
  (d) => (d.closed_reason === undefined && d.closed_by === undefined) || (d.state !== undefined && d.state !== 'open'),
  { message: 'closed_reason and closed_by are written together with a state that leaves open' },
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

    // The task the ask will be linked to after this write (the new link, else the one it already has).
    const linkedTaskId = data.task_id !== undefined ? data.task_id : existing.task_id;
    if (data.task_id) {
      const task = await prisma.task.findUnique({ where: { id: data.task_id, is_deleted: false } });
      if (!task) {
        throw new ApiError('Task not found', 404);
      }
    }

    // Work stage A: a security-tagged task's ask is linked but never closed by inference. A machine write (anything but the
    // admin's own tap) that would close it keeps it open; the link still lands. Reported back in ignored_fields.
    const closing = data.state !== undefined && data.state !== 'open' && data.state !== 'archive_requested';
    if (porter && closing && linkedTaskId) {
      const linked = await prisma.task.findUnique({ where: { id: linkedTaskId, is_deleted: false }, select: { tags: true } });
      if (linked && isSecurityTagged(linked.tags)) {
        ignored_fields.push('state');
        delete data.state;
        delete data.closed_reason;
        delete data.closed_by;
      }
    }
    // Work stage B: an ask he reopened (decided_by mike) is held: a machine write never closes it again. Reported in ignored_fields.
    if (porter && closing && existing.decided_by === 'mike') {
      ignored_fields.push('state');
      delete data.state;
      delete data.closed_reason;
      delete data.closed_by;
    }
    // Work stage B: a `work` decision takes its owner from the task it gets linked to (the task's assignee).
    let workOwner: 'mike' | 'bast' | 'sabeen' | null = null;
    if (data.task_id && existing.disposition === 'work' && !existing.owner) {
      const t = await prisma.task.findUnique({ where: { id: data.task_id }, select: { assignee_id: true } });
      const home = await homeOwner(prisma);
      workOwner = ownerOfAssignee(t?.assignee_id ?? null, home?.id ?? null, BOT_USER_IDS) as 'mike' | 'bast' | 'sabeen';
    }
    // conversation_key is written over null only (a porter never rewrites an existing key).
    const conversationKey = data.conversation_key !== undefined ? normalizeRfc(data.conversation_key) : undefined;
    if (conversationKey !== undefined && existing.conversation_key) {
      ignored_fields.push('conversation_key');
    }
    // The closing record: a close that names its reason stamps closed_at too; returning to open clears whatever record the ask holds.
    const leaving = data.closed_reason !== undefined && data.state !== undefined && data.state !== 'open';
    const reopening = data.state === 'open' && (!!existing.closed_at || !!existing.closed_reason || !!existing.closed_by);

    const updated = await prisma.emailAsk.update({
      where: { id },
      data: {
        ...(data.state !== undefined && { state: data.state }),
        ...(data.task_id !== undefined && { task_id: data.task_id }),
        ...(workOwner && { owner: workOwner }),
        ...(conversationKey !== undefined && !existing.conversation_key && { conversation_key: conversationKey }),
        ...(leaving && { closed_at: new Date() }),
        ...(data.closed_reason !== undefined && { closed_reason: data.closed_reason }),
        ...(data.closed_by !== undefined && { closed_by: data.closed_by }),
        ...(reopening && { closed_at: null, closed_reason: null, closed_by: null }),
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
