import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { serializeRichText } from '@/lib/api/blocknote';
import { resolveArc } from '@/lib/arc-resolution';
import { SEVERITY_TO_PRIORITY } from '@/lib/ask-severity';

// The quest-from-session endpoint: a Claude Code session (or the future heartbeat) parks
// a real Task on Mike, tied back to the session that spawned it. Bearer auth via
// requireAuth() (same util the rest of the API uses — cookie session OR API key).
// Session-born quests default to the primary operator when no assignee is given.
const DEFAULT_ASSIGNEE_EMAIL = 'mike@becomeindelible.com';

const sessionTaskSchema = z
  .object({
    session_external_id: z.string().min(1).max(255),
    title: z.string().min(1).max(500),
    description: z.any().optional().nullable(),
    arc_id: z.string().uuid().optional(),
    arc_name: z.string().min(1).max(300).optional(),
    client_id: z.string().uuid().optional().nullable(),
    severity: z.enum(['client_blocking', 'launch_blocking', 'internal']).optional(),
    assignee_id: z.string().uuid().optional(),
    due_date: z.string().datetime().optional().nullable(),
  })
  .refine((data) => !(data.arc_id && data.arc_name), {
    message: 'Provide at most one of arc_id or arc_name, not both',
    path: ['arc_id'],
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

const DEDUPE_STATUSES = ['not_started', 'in_progress'] as const;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await request.json();
    const data = sessionTaskSchema.parse(body);

    // Dedup: an existing session-originated task for this session, still active, whose
    // title matches case/whitespace-insensitively never gets duplicated — it gets touched.
    const candidates = await prisma.task.findMany({
      where: {
        is_deleted: false,
        source: 'session',
        source_session_external_id: data.session_external_id,
        status: { in: [...DEDUPE_STATUSES] },
      },
      include: TASK_INCLUDE,
    });
    const normalizedIncomingTitle = normalizeTitle(data.title);
    const dedupeMatch = candidates.find((t) => normalizeTitle(t.title) === normalizedIncomingTitle);

    if (dedupeMatch) {
      const updated = await prisma.task.update({
        where: { id: dedupeMatch.id },
        data: {
          ...(data.description !== undefined && { description: serializeRichText(data.description) }),
        },
        include: TASK_INCLUDE,
      });

      return NextResponse.json({ ...formatTaskResponse(updated), deduped: true });
    }

    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    // Assignee resolution: explicit assignee_id wins; otherwise default to the primary
    // operator, resolved by email at request time.
    let assignee;
    if (data.assignee_id) {
      assignee = await prisma.user.findUnique({
        where: { id: data.assignee_id, is_active: true },
      });
      if (!assignee) {
        throw new ApiError('Assignee not found', 404);
      }
    } else {
      assignee = await prisma.user.findUnique({
        where: { email: DEFAULT_ASSIGNEE_EMAIL, is_active: true },
      });
      if (!assignee) {
        throw new ApiError(
          `Default assignee ${DEFAULT_ASSIGNEE_EMAIL} not found or inactive`,
          500
        );
      }
    }

    // Arc resolution: arc_id used as-is (404 if missing); arc_name reuses an exact-name,
    // non-complete arc, or creates a new one attributed to the calling session. Shared
    // with /api/email-asks/[id]/create-task — see lib/arc-resolution.ts.
    const arcId = await resolveArc({
      arc_id: data.arc_id,
      arc_name: data.arc_name,
      originSessionExternalId: data.session_external_id,
    });

    const priority = data.severity ? SEVERITY_TO_PRIORITY[data.severity] : 3;

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: serializeRichText(data.description),
        status: 'not_started',
        priority,
        client_id: data.client_id ?? null,
        assignee_id: assignee.id,
        due_date: data.due_date ? new Date(data.due_date) : null,
        source: 'session',
        source_session_external_id: data.session_external_id,
        arc_id: arcId,
        needs_review: false,
        created_by_id: auth.userId,
      },
      include: TASK_INCLUDE,
    });

    return NextResponse.json({ ...formatTaskResponse(task), deduped: false }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
