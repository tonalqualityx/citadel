import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logCreate } from '@/lib/services/activity';
import {
  buildApprovalDraftEmail,
  lintApprovalEmail,
  formatApprovalRequestResponse,
  type ApprovalRequestWithRelations,
} from '@/lib/services/approval-requests';
import type { ApprovalRequestStatus } from '@prisma/client';

// Oracle Projects Tab Phase 5 — the client-approval loop's request/reply table.
// POST creates a draft (never sends — see the plan's Adaptations section: gog only runs
// on Mike's machine, via the machine-side sender, PATCH .../[id] {status:'queued'} is
// the only way a row starts moving toward a real send). GET lists rows, filtered by
// `status` and/or `task_id` — `?status=queued` is the machine-side sender's own poll;
// `?task_id=` is ApprovalPanel's own fetch for one task's approval history.

const INCLUDE = {
  contact: { select: { id: true, name: true, email: true } },
  task: { select: { id: true, title: true } },
} as const;

const createSchema = z.object({
  task_id: z.string().uuid(),
  contact_id: z.string().uuid().optional().nullable(),
  to_email: z.string().email().max(255).optional().nullable(),
  subject: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createSchema.parse(body);

    const task = await prisma.task.findUnique({
      where: { id: data.task_id, is_deleted: false },
      select: { id: true, title: true, project_id: true, staging_preview_url: true },
    });
    if (!task) {
      throw new ApiError('Task not found', 404);
    }
    if (!task.project_id) {
      throw new ApiError('Task has no project. An approval request needs one.', 400);
    }

    if (data.contact_id) {
      const project = await prisma.project.findUnique({
        where: { id: task.project_id },
        select: { client_id: true },
      });
      const contact = await prisma.clientContact.findUnique({
        where: { id: data.contact_id },
        select: { id: true, client_id: true, is_deleted: true },
      });
      if (!contact || contact.is_deleted || contact.client_id !== project?.client_id) {
        throw new ApiError('Contact not found on this task\'s client', 404);
      }
    }

    // Server-side draft: only built when the caller didn't supply its own subject/body.
    // draft_source: 'graph' — a plain template, not an inference. A Bast-written draft
    // (next-step-refresh-style inference) is a later, separate job — see the plan's
    // Phase 5 notes.
    const usingTemplate = !data.subject || !data.body;
    const template = usingTemplate
      ? buildApprovalDraftEmail({ taskTitle: task.title, deliverableUrl: task.staging_preview_url })
      : null;
    const subject = data.subject ?? template!.subject;
    const emailBody = data.body ?? template!.body;

    const violations = lintApprovalEmail({ subject, body: emailBody });
    if (violations.length > 0) {
      return NextResponse.json(
        { error: 'subject or body failed the writing-standard lint', violations },
        { status: 422 }
      );
    }

    const created = await prisma.approvalRequest.create({
      data: {
        task_id: task.id,
        project_id: task.project_id,
        contact_id: data.contact_id ?? null,
        to_email: data.to_email ?? null,
        subject,
        body: emailBody,
        draft_source: usingTemplate ? 'graph' : null,
        created_by_id: auth.userId,
      },
      include: INCLUDE,
    });

    await logCreate(auth.userId, 'task', task.id, `Approval request: ${task.title}`);

    return NextResponse.json(formatApprovalRequestResponse(created as ApprovalRequestWithRelations), {
      status: 201,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const VALID_STATUSES = new Set<ApprovalRequestStatus>([
  'draft',
  'queued',
  'sending',
  'sent',
  'replied',
  'approved',
  'changes_requested',
  'cancelled',
]);

// GET /api/approval-requests — bearer, any authenticated user (matches the next-step
// engine's machine-endpoint convention: the sender polls `?status=queued` on a plain
// service bearer token, not a pm/admin cookie session). `?task_id=` is additive, used by
// ApprovalPanel to load one task's approval history regardless of status. `?thread_id=`
// is the inbound-email classifier's own lookup (POST .../reply's doc comment) — it
// matches an inbound message's Gmail thread against a 'sent' ApprovalRequest.
export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const taskId = searchParams.get('task_id');
    const threadId = searchParams.get('thread_id');

    if (statusParam && !VALID_STATUSES.has(statusParam as ApprovalRequestStatus)) {
      throw new ApiError(`Invalid status: ${statusParam}`, 400);
    }
    if (taskId && !z.string().uuid().safeParse(taskId).success) {
      throw new ApiError(`Invalid task_id: ${taskId}`, 400);
    }

    const where: { status?: ApprovalRequestStatus; task_id?: string; thread_id?: string } = {};
    if (statusParam) where.status = statusParam as ApprovalRequestStatus;
    if (taskId) where.task_id = taskId;
    if (threadId) where.thread_id = threadId;

    const rows = await prisma.approvalRequest.findMany({
      where,
      include: INCLUDE,
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({
      requests: rows.map((r) => formatApprovalRequestResponse(r as ApprovalRequestWithRelations)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
