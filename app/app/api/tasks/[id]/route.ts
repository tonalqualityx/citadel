import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { guardChatTaskBody, chatConversationFor, chatPatchGate, withChatTaskLock, CHAT_LANE, RACE_TEXT } from '@/lib/bast-chat/task-filter';
import { withChatAction } from '@/lib/bast-chat/task-record';
import type { PatchTaskExpect } from '@/lib/services/task-patch';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { logUpdate, logDelete } from '@/lib/services/activity';
import { checkTaskAccess, patchTask, mayLeaveTriage, TRIAGE_EXIT_TEXT } from '@/lib/services/task-patch';
import { loadCards } from '@/lib/tasks/triage-card';
import { guardDoxTaskPatch } from '@/lib/dox/guard';
import { mayReadDeal } from '@/lib/deals/access';
import { guardDeskTaskPatch } from '@/lib/triage-desk/guard';
import { recordSessionChange } from '@/lib/triage-desk/changes';
import { readDeals } from '@/lib/deals/read';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    // Check access first
    await checkTaskAccess(id, auth);

    const task = await prisma.task.findUnique({
      where: { id, is_deleted: false },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            dependencies_ordering_only: true,
            client: { select: { id: true, name: true } },
            site: { select: { id: true, name: true } },
          },
        },
        client: { select: { id: true, name: true } },
        charter: { select: { id: true, name: true } },
        arc: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
        reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
        approved_by: { select: { id: true, name: true } },
        function: { select: { id: true, name: true } },
        sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
        created_by: { select: { id: true, name: true } },
        blocked_by: {
          select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } },
        },
        blocking: {
          select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } },
        },
        time_entries: {
          where: { is_deleted: false },
          select: {
            id: true,
            duration: true,
            started_at: true,
            description: true,
            user: { select: { id: true, name: true } },
          },
          orderBy: { started_at: 'desc' },
          take: 10,
        },
      },
    });

    const formattedTask = formatTaskResponse(task);

    // Filter out review_requirements for non-PM/Admin users (Quality Gate is PM/Admin only)
    if (auth.role === 'tech') {
      formattedTask.review_requirements = null;
    }

    // The signed deal of the task's project (or, with no project, of its client): read-only, for the chat lane and for Dox inside its project binding.
    const dealAbout = task ? { projectId: task.project_id ?? null, clientId: task.client_id ?? null } : null;
    const deal = dealAbout && (dealAbout.projectId || dealAbout.clientId) && (await mayReadDeal(auth, request.headers, dealAbout))
      ? await readDeals(prisma, dealAbout)
      : undefined;
    const withDeal = <T extends object>(o: T): T | (T & { deal: typeof deal }) => (deal ? { ...o, deal } : o);

    // A Triage card shows what Release will do (Mike's session or the chat lane only; nobody else gets these fields).
    if (task && task.status === 'triage' && mayLeaveTriage(auth)) {
      const [card] = await loadCards(prisma, [id]);
      if (card) return NextResponse.json(withDeal({ ...formattedTask, triage_kind: card.kind, release_line: card.release_line, release_ready: card.release_ready }));
    }

    return NextResponse.json(withDeal(formattedTask));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const existingTask = await checkTaskAccess(id, auth);
    const rawBody = await request.json();
    // Triage-desk lane: the looks-done mark on a Triage card and nothing else (the body it returns replaces the request's).
    const deskBody = guardDeskTaskPatch(auth, rawBody, { status: existingTask.status, tags: existingTask.tags ?? [] });
    const body = deskBody ?? await guardDoxTaskPatch(
      auth,
      request.headers,
      await guardChatTaskBody(auth, 'PATCH', rawBody, existingTask),
      { id, status: existingTask.status, project_id: existingTask.project_id ?? null, tags: existingTask.tags ?? [], assignee_id: existingTask.assignee_id ?? null, updated_at: existingTask.updated_at ?? null, requested_by_contact_id: existingTask.requested_by_contact_id ?? null, client_visible: existingTask.client_visible ?? null, staging_preview_url: existingTask.staging_preview_url ?? null, approved: existingTask.approved ?? null, client_approved_at: existingTask.client_approved_at ?? null },
    );
    const chatConversation = await chatConversationFor(auth, request.headers, 'PATCH');

    // Chat lane only: the reach check. A change that would start or re-steer Bast, or show something to a client, is
    // stored as a proposal for Mike's tap and nothing is written. Every other caller skips all of this. The check and
    // the write run under the task's locks (withChatTaskLock), so the owner's tap cannot land between them.
    const write = async (): Promise<NextResponse> => {
      let expect: PatchTaskExpect | undefined;
      let existing = existingTask;
      if (auth.lane === CHAT_LANE) {
        const gate = await chatPatchGate({ taskId: id, body: body as Record<string, unknown>, conversationId: chatConversation, existing });
        if (gate.kind === 'proposal') {
          return withChatAction(
            NextResponse.json({ proposed: true, action_id: gate.proposal.id, proposal_kind: gate.proposal.proposal_kind, line: gate.proposal.line }, { status: 202 }),
            gate.proposal.id,
          );
        }
        expect = gate.expect;
        existing = gate.existing;
      }

      const result = await patchTask({
        actor: auth,
        id,
        body,
        expect,
        existing,
        claimToken: request.headers.get('x-claim-token'),
        chatConversation,
      });
      // Only a caller passing `expect` can get this: the chat lane (its reach check read the task first).
      if (!result.ok) throw new ApiError(RACE_TEXT, 409, 'changed_since');
      if (deskBody) await recordSessionChange(auth.userId, id, 'marked the card looks-done');
      return withChatAction(NextResponse.json({
        ...formatTaskResponse(result.task),
        ...(result.completionNudge ? { completion_nudge: result.completionNudge } : {}),
      }), result.chatActionId);
    };
    return auth.lane === CHAT_LANE ? await withChatTaskLock(id, body as Record<string, unknown>, write) : await write();
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    // Get task title for activity log
    const task = await prisma.task.findUnique({
      where: { id },
      select: { title: true, status: true },
    });
    // Deleting a triage task is dropping it: only Mike or the chat lane may (same rule as leaving triage).
    if (task?.status === 'triage' && !mayLeaveTriage(auth)) throw new ApiError(TRIAGE_EXIT_TEXT, 403, 'triage_exit_forbidden');

    // Soft delete
    await prisma.task.update({
      where: { id },
      data: { is_deleted: true },
    });

    // Log activity
    await logDelete(auth.userId, 'task', id, task?.title);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
