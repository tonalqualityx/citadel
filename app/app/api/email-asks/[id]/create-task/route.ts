import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { serializeRichText } from '@/lib/api/blocknote';
import { resolveArc } from '@/lib/arc-resolution';
import { priorityForSeverity } from '@/lib/ask-severity';
import { stripSubjectPrefix, matchClientByEmailDomain } from '@/lib/email-asks';

// Clarity Phase 4a — the crisis strip's/intake drawer's "Create" and "Create + open"
// backend. Admin-only, same as the rest of the Oracle surface. Idempotent: if the ask
// already has a task_id, this just returns the existing task with 200 rather than
// creating a second one — a double-click or a retried "Create + open" navigation never
// duplicates.
const DEFAULT_ASSIGNEE_EMAIL = 'mike@becomeindelible.com';

const createTaskSchema = z.object({
  arc_id: z.string().uuid().optional(),
  arc_name: z.string().min(1).max(300).optional(),
  // Out of v1 scope per the spec — SOP guessing isn't built yet; this is a passthrough
  // only, wired straight to Task.sop_id with no resolution logic behind it.
  sop_id: z.string().uuid().optional(),
});

const TASK_INCLUDE = {
  project: {
    select: { id: true, name: true, status: true, client: { select: { id: true, name: true } } },
  },
  client: { select: { id: true, name: true } },
  arc: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
  reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
  approved_by: { select: { id: true, name: true } },
  created_by: { select: { id: true, name: true } },
} as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const ask = await prisma.emailAsk.findUnique({ where: { id } });
    if (!ask) {
      throw new ApiError('Email ask not found', 404);
    }

    // Idempotent: already has a task -> return it as-is, 200, no second Task created.
    if (ask.task_id) {
      const existingTask = await prisma.task.findUnique({
        where: { id: ask.task_id },
        include: TASK_INCLUDE,
      });
      if (existingTask) {
        return NextResponse.json(formatTaskResponse(existingTask));
      }
      // task_id pointed at something that no longer exists — fall through and create
      // fresh rather than 404ing on an ask the operator is trying to act on right now.
    }

    // Body is entirely optional — the common "Create" click sends none.
    const body = await request.json().catch(() => ({}));
    const data = createTaskSchema.parse(body);

    // Assignee: primary operator, same email-lookup helper/default as session-tasks.
    const assignee = await prisma.user.findUnique({
      where: { email: DEFAULT_ASSIGNEE_EMAIL, is_active: true },
    });
    if (!assignee) {
      throw new ApiError(`Default assignee ${DEFAULT_ASSIGNEE_EMAIL} not found or inactive`, 500);
    }

    // Client match: from_email's domain against every non-deleted client's Client.email
    // domain; null if nothing matches (never guessed at, never blocks task creation).
    const clients = await prisma.client.findMany({
      where: { is_deleted: false, email: { not: null } },
      select: { id: true, email: true },
    });
    const clientId = matchClientByEmailDomain(ask.from_email, clients);

    // Arc resolution: same shared logic session-tasks uses (lib/arc-resolution.ts). No
    // originating session here — an email-born task has no session_external_id.
    const arcId = await resolveArc({ arc_id: data.arc_id, arc_name: data.arc_name });

    const title = stripSubjectPrefix(ask.subject) || ask.subject;
    const descriptionLines = [ask.gist, `Email: ${ask.deep_link}`].filter(Boolean);
    const priority = priorityForSeverity(ask.severity);

    const task = await prisma.task.create({
      data: {
        title,
        description: serializeRichText(descriptionLines.join('\n\n')),
        status: 'not_started',
        priority,
        client_id: clientId,
        assignee_id: assignee.id,
        source: 'email',
        source_ref: ask.message_id,
        origin_url: ask.deep_link,
        arc_id: arcId,
        sop_id: data.sop_id ?? null,
        needs_review: false,
        created_by_id: auth.userId,
      },
      include: TASK_INCLUDE,
    });

    await prisma.emailAsk.update({
      where: { id: ask.id },
      data: { task_id: task.id, state: 'handled' },
    });

    return NextResponse.json(formatTaskResponse(task), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
