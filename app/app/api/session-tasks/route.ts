import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { serializeRichText } from '@/lib/api/blocknote';
import { getArcStatus } from '@/lib/arc-status';
import { AskSeverity } from '@prisma/client';

// The quest-from-session endpoint: a Claude Code session (or the future heartbeat) parks
// a real Task on Mike, tied back to the session that spawned it. Bearer auth via
// requireAuth() (same util the rest of the API uses — cookie session OR API key).
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

const SEVERITY_TO_PRIORITY: Record<AskSeverity, number> = {
  client_blocking: 1,
  launch_blocking: 2,
  internal: 3,
};

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

    // Assignee resolution: explicit assignee_id wins; otherwise fall back to the
    // env-configured default (no "primary admin" lookup pattern exists elsewhere in this
    // repo to reuse, per spec — read at request time so a config change takes effect
    // without a redeploy).
    const assigneeId = data.assignee_id ?? process.env.CLARITY_DEFAULT_ASSIGNEE_ID ?? null;
    if (!assigneeId) {
      throw new ApiError(
        'assignee_id is required (no CLARITY_DEFAULT_ASSIGNEE_ID configured)',
        400
      );
    }
    const assignee = await prisma.user.findUnique({
      where: { id: assigneeId, is_active: true },
    });
    if (!assignee) {
      throw new ApiError('Assignee not found', 404);
    }

    // Arc resolution: arc_id used as-is (404 if missing); arc_name reuses an exact-name,
    // non-complete arc, or creates a new one attributed to the calling session.
    let arcId: string | null = null;
    if (data.arc_id) {
      const arc = await prisma.arc.findUnique({ where: { id: data.arc_id } });
      if (!arc) {
        throw new ApiError('Arc not found', 404);
      }
      arcId = arc.id;
    } else if (data.arc_name) {
      const sameName = await prisma.arc.findMany({
        where: { name: data.arc_name },
        include: { tasks: { select: { status: true } } },
        orderBy: { created_at: 'desc' },
      });
      const reusable = sameName.find((arc) => getArcStatus(arc) !== 'complete');

      if (reusable) {
        arcId = reusable.id;
      } else {
        const created = await prisma.arc.create({
          data: {
            name: data.arc_name,
            origin_session_external_id: data.session_external_id,
          },
        });
        arcId = created.id;
      }
    }

    const priority = data.severity ? SEVERITY_TO_PRIORITY[data.severity] : 3;

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: serializeRichText(data.description),
        status: 'not_started',
        priority,
        client_id: data.client_id ?? null,
        assignee_id: assigneeId,
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
