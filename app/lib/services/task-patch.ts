import { carryCardIntoProject } from '@/lib/tasks/project-brief';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { withSavepoint } from '@/lib/db/scope';
import type { AuthPayload } from '@/lib/auth/middleware';
import { taskWriteWhere, chatWriteMiss, CHAT_LANE } from '@/lib/bast-chat/task-filter';
import { recordChatPatch } from '@/lib/bast-chat/task-record';
import { ApiError } from '@/lib/api/errors';
import { serializeRichText } from '@/lib/api/blocknote';
import { canTransitionTaskStatus } from '@/lib/calculations/status';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { logStatusChange } from '@/lib/services/activity';
import {
  unblockEligibleDependents,
  reblockDependents,
  areBlockersSatisfied,
  wouldCreateCycle,
} from '@/lib/services/dependencies';
import { notifyTaskAssigned } from '@/lib/services/notifications';
import { onTaskProgress } from '@/lib/portal/waits';
import { clearPreviewClaims } from '@/lib/sends/claims';
import { assertClaimHeld, CLEAR_CLAIM_DATA } from '@/lib/tasks/claims';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MysteryFactor, BatteryImpact, TaskStatus } from '@prisma/client';
import { closeAsksForTask } from '@/lib/work/ask-closure'; // Work stage A: the one closure of a finished task's emails
import { voidApprovalIfRestaged, stampApproval, getApprovalBindingMode } from '@/lib/portal/receipts'; // Fleet item 5

/**
 * The core of PATCH /api/tasks/:id, moved here unchanged so the route, Undo and the owner's tap run exactly the
 * same side effects (activity log, claim rule, dependent unblock and reblock, portal first response, completion
 * nudge, client approval void and stamp, assignee notice, the chat change record).
 *
 * The route keeps authentication, the access check, request parsing, the chat lane guard and conversation, and
 * the HTTP response. Errors are thrown exactly as before (ApiError, ZodError, Prisma errors) for the caller's
 * handler. The one new behaviour is `expect`, a compare-and-set condition that only a caller passing it sees.
 */

// Schema for requirement items (flat items)
const requirementItemSchema = z.object({
  id: z.string(),
  type: z.literal('item').optional(),
  text: z.string(),
  completed: z.boolean().optional().default(false),
  completed_at: z.string().nullable().optional(),
  completed_by: z.string().nullable().optional(),
  sort_order: z.number(),
});

// Schema for requirement sections (with nested items)
const requirementSectionSchema = z.object({
  id: z.string(),
  type: z.literal('section'),
  title: z.string(),
  icon: z.string().optional(),
  sort_order: z.number(),
  items: z.array(requirementItemSchema),
});

// Combined schema for requirements - can be items or sections
const requirementEntrySchema = z.union([requirementSectionSchema, requirementItemSchema]);

const taskStatusSchema = z.enum(['triage', 'not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned']);

const updateTaskSchema = z.object({
  // Accepted alongside other fields and held to the same transition rules and side effects
  // as a status-only PATCH (it used to be absent here, so a combined body dropped it silently).
  status: taskStatusSchema.optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.any().optional(), // BlockNote JSON content
  priority: z.number().min(1).max(5).optional(),
  is_focus: z.boolean().optional(), // User focus flag
  project_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  site_id: z.string().uuid().optional().nullable(),
  // Clarity Phase 4b — the update schema predates arcs; present+non-null validates the arc
  // exists (404 if not) and attaches it, explicit null detaches, absent leaves untouched.
  arc_id: z.string().uuid().optional().nullable(),
  phase: z.string().max(100).optional().nullable(),
  sort_order: z.number().optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  function_id: z.string().uuid().optional().nullable(),
  sop_id: z.string().uuid().optional().nullable(),
  energy_estimate: z.number().min(1).max(8).optional().nullable(),
  mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']).optional(),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']).optional(),
  due_date: z.string().datetime().optional().nullable(),
  notes: z.any().optional(), // BlockNote JSON content
  // Clarity Phase 8 (composition) — absent = untouched; explicit null clears back to
  // "internal/target"; a non-empty string sets "promised to this person". Permissive
  // server-side by design (see route.ts POST comment).
  promised_to: z.string().max(200).optional().nullable(),
  // Home screen Slice 2: a real outside date and who or what set it. due_date is untouched.
  hard_due_at: z.string().datetime().nullable().optional(),
  hard_due_source: z.string().trim().min(3).max(200).nullable().optional(),
  requirements: z.array(requirementEntrySchema).optional().nullable(),
  // Quality Gate (PM/Admin only)
  review_requirements: z.array(requirementEntrySchema).optional().nullable(),
  // Review workflow fields
  needs_review: z.boolean().optional(),
  reviewer_id: z.string().uuid().optional().nullable(),
  approved: z.boolean().optional(),
  // Billing fields (PM/Admin only)
  is_billable: z.boolean().optional(),
  // Client portal (A3): share this task with the client's portal lists. PM/Admin only.
  client_visible: z.boolean().optional(),
  billing_target: z.number().min(1).optional().nullable(),
  billing_amount: z.number().min(0).optional().nullable(),
  is_retainer_work: z.boolean().optional(),
  is_support: z.boolean().optional(),
  // Time tracking
  no_time_needed: z.boolean().optional(),
  // Bast triage: classification + provenance + staging approval
  tags: z.array(z.string().max(50)).optional(),
  plan_item_ids: z.array(z.string().uuid()).max(50).optional(),
  source: z.enum(['portal', 'email', 'internal']).optional(),
  source_ref: z.string().max(255).optional().nullable(),
  requested_by_contact_id: z.string().uuid().optional().nullable(),
  staging_preview_url: z.string().max(500).optional().nullable(),
  staging_deployed_at: z.string().datetime().optional().nullable(),
  client_approved_at: z.string().datetime().optional().nullable(),
  approved_by_contact_id: z.string().uuid().optional().nullable(),
  // Fleet item 5: where a client's yes came from (portal | approval_link | email:<Message-ID>)
  approval_source: z.string().max(300).optional().nullable(),
  // project-record-citadel-changes.md addendum (ruling 32) — additive/removable dependency
  // editing. Not in allowedTechFields above, so tech users can't reach this (PM/Admin only,
  // same gating as the other planning-shaped fields on this route).
  blocked_by_ids: z
    .object({
      connect: z.array(z.string().uuid()).optional(),
      disconnect: z.array(z.string().uuid()).optional(),
    })
    .optional(),
}).superRefine((d, ctx) => {
  if (d.hard_due_at && !d.hard_due_source) {
    ctx.addIssue({ code: 'custom', path: ['hard_due_source'], message: 'hard_due_source is required when hard_due_at is set' });
  }
});

const updateStatusSchema = z.object({
  status: taskStatusSchema,
});

function assertStatusTransition(from: TaskStatus, to: TaskStatus) {
  if (!canTransitionTaskStatus(from, to)) {
    throw new ApiError(`Cannot transition from ${from} to ${to}`, 400);
  }
}

/**
 * Who may take a task OUT of triage (release to not_started, or drop to abandoned): Mike signed in (a browser
 * session of the owner user, which is also how the chat's tap and Undo write, through `ownerActor`), or the Bast
 * chat's own server path (the enforced bast-chat lane key). A worker or bot token, a lane-less key, another lane and
 * every other signed-in user are refused. Anyone may file INTO triage (status triage on create, or not_started ->
 * triage), so only the exit is checked. Enforced here, in the one patch path, so no route can step around it.
 */
export function mayLeaveTriage(auth: Pick<AuthPayload, 'userId' | 'via' | 'lane' | 'laneEnforced'>): boolean {
  if (auth.via === 'session' && auth.userId === MIKE_USER_ID) return true;
  return auth.via === 'api_key' && auth.lane === CHAT_LANE && auth.laneEnforced === true;
}

export const TRIAGE_EXIT_TEXT = 'Only Mike can release or drop a task in triage.';

function assertTriageExit(auth: AuthPayload, from: TaskStatus, to: TaskStatus) {
  if (from === 'triage' && to !== 'triage' && !mayLeaveTriage(auth)) {
    throw new ApiError(TRIAGE_EXIT_TEXT, 403, 'triage_exit_forbidden');
  }
}

/** Filing a task into triage forces client_visible false; this tag remembers it was true so release can restore it. */
export const TRIAGE_WAS_VISIBLE_TAG = 'triage-was-client-visible';

/**
 * What a status change does to client_visible and the marker tag. Into triage: remember a true value in the tag.
 * Out of triage: put a remembered true back and drop the tag. `baseTags` is the tag list the write will start from.
 */
export function triageVisibilityPatch(
  existing: { status: TaskStatus; client_visible: boolean; tags: string[] },
  nextStatus: TaskStatus | undefined,
  baseTags: string[],
): { client_visible?: boolean; tags?: string[] } {
  if (nextStatus === undefined || nextStatus === existing.status) return {};
  if (nextStatus === 'triage' && existing.status !== 'triage') {
    return existing.client_visible && !baseTags.includes(TRIAGE_WAS_VISIBLE_TAG) ? { tags: [...baseTags, TRIAGE_WAS_VISIBLE_TAG] } : {};
  }
  if (existing.status === 'triage' && nextStatus !== 'triage' && baseTags.includes(TRIAGE_WAS_VISIBLE_TAG)) {
    return { client_visible: true, tags: baseTags.filter((t) => t !== TRIAGE_WAS_VISIBLE_TAG) };
  }
  return {};
}

type StatusTransitionData = {
  status: TaskStatus;
  started_at?: Date;
  is_focus?: boolean;
  completed_at?: Date | null;
};

/** The fields a move into `newStatus` writes besides the status itself. */
function statusTransitionData(
  existingTask: { status: TaskStatus; started_at: Date | null },
  newStatus: TaskStatus
): StatusTransitionData {
  const updateData: StatusTransitionData = { status: newStatus };

  // Set timestamps and focus based on status
  if (newStatus === 'in_progress') {
    if (!existingTask.started_at) {
      updateData.started_at = new Date();
    }
    // Auto-focus tasks when moved to in_progress
    updateData.is_focus = true;
  }
  if (newStatus === 'done') {
    updateData.completed_at = new Date();
  }
  // Clear completed_at when reopening
  if (existingTask.status === 'done' && newStatus !== 'done') {
    updateData.completed_at = null;
  }

  return updateData;
}

export type CompletionNudge = { thread_id: string | null; subject: string; from_email: string };

/**
 * Side effects of a status write, shared by the status-only and combined PATCH paths:
 * activity log, dependent propagation, portal first-response, and the completion nudge.
 */
async function afterStatusChange(
  userId: string,
  existingTask: { status: TaskStatus },
  task: {
    id: string;
    title: string;
    arc_id: string | null;
    source: string;
    status: string;
    staging_preview_url: string | null;
  },
  newStatus: TaskStatus
): Promise<CompletionNudge | null> {
  await logStatusChange(userId, 'task', task.id, task.title, existingTask.status, newStatus);

  // Propagate blocking status to dependent tasks
  await propagateBlockingStatus(task.id, newStatus, existingTask.status);
  await resolvePortalFirstResponse(task);

  // Work stage A: a task that ends closes the emails linked to it (one Handled line, Undo for 72 hours). Best effort here:
  // the status write is already saved, and the nightly catch-up closes anything this misses.
  if (newStatus === 'done' || newStatus === 'abandoned') {
    await closeAsksForTask(prisma, task.id, newStatus).catch((e) => console.error('closeAsksForTask failed', task.id, e));
  }

  // Clarity Phase 7 — the completion-nudge hook: closing a task that has an
  // attached email (directly, or via its arc) prompts the follow-through — Bast
  // drafts "work is done" on the original thread for Mike's send (draft-only,
  // forever; SOUL law). Fires only on the transition INTO done, never on a no-op
  // re-PATCH of an already-done task. Direct task attachment wins over the arc's
  // when both exist (the more specific link).
  if (newStatus !== 'done' || existingTask.status === 'done') return null;

  const attachedEmail =
    (await prisma.emailAsk.findFirst({
      where: { task_id: task.id },
      orderBy: { received_at: 'desc' },
      select: { thread_id: true, subject: true, from_email: true },
    })) ??
    (task.arc_id
      ? await prisma.emailAsk.findFirst({
          where: { arc_id: task.arc_id },
          orderBy: { received_at: 'desc' },
          select: { thread_id: true, subject: true, from_email: true },
        })
      : null);

  if (!attachedEmail) return null;
  return {
    thread_id: attachedEmail.thread_id ?? null,
    subject: attachedEmail.subject,
    from_email: attachedEmail.from_email,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- unchanged since main; this file is linted now because the chat round touched it
export async function checkTaskAccess(taskId: string, auth: any): Promise<any> {
  const task = await prisma.task.findUnique({
    where: { id: taskId, is_deleted: false },
    include: {
      project: { select: { id: true, status: true } },
    },
  });

  if (!task) {
    throw new ApiError('Task not found', 404);
  }

  // Tech users can only access tasks they can see; a triage task is parked for Mike and never one of them.
  if (auth.role === 'tech') {
    if (task.status === 'triage') throw new ApiError('Task not found', 404);
    let isVisible = false;

    // Tech users can view tasks where they are the assignee
    if (task.assignee_id === auth.userId) {
      isVisible = true;
    }
    // OR tasks in projects where they are a team member
    else if (task.project_id) {
      const isTeamMember = await prisma.projectTeamAssignment.findFirst({
        where: {
          project_id: task.project_id,
          user_id: auth.userId,
        },
      });
      if (isTeamMember) {
        isVisible = true;
      }
    }

    if (!isVisible) {
      throw new ApiError('Task not found', 404);
    }
  }

  return task;
}

/**
 * When a task's status changes, propagate that change to dependent tasks:
 * - If completed: unblock dependents whose blockers are all satisfied (ordering-only → done;
 *   approval-gated default → done AND approved, so completion alone won't unblock them).
 * - If reopened from done: re-block dependent tasks that are in active states.
 *
 * Satisfaction logic and the queries live in `@/lib/services/dependencies` so the reactive
 * triggers here and the self-healing sweep (`healBlockedTasks`) share one predicate.
 */
async function propagateBlockingStatus(taskId: string, newStatus: string, oldStatus: string) {
  // Only propagate when status actually changed
  if (newStatus === oldStatus) return;

  if (newStatus === 'done') {
    await unblockEligibleDependents(taskId);
  } else if (oldStatus === 'done') {
    await reblockDependents(taskId);
  }
}

/**
 * Portal phase B: a portal request that has moved off not_started, or is staged for the client,
 * has an answer, so its first-response clock is resolved. Best effort: a wait hiccup must never
 * fail a task update. Only portal tasks can hold such a clock, so every other task skips the query.
 */
async function resolvePortalFirstResponse(task: {
  id: string;
  source: string;
  status: string;
  staging_preview_url: string | null;
}) {
  if (task.source !== 'portal') return;
  try {
    // A savepoint inside a locked Bast chat request, so this best-effort write cannot abort the change (lib/db/scope.ts).
    await withSavepoint(() => onTaskProgress(prisma, task));
  } catch (error) {
    console.error('portal first-response resolve failed', error);
  }
}

/**
 * Compare-and-set condition for `patchTask`. Every field given must still hold on the task, or nothing is
 * written and the result is `{ ok: false, reason: 'changed_since' }`. `updated_at` is compared to the
 * millisecond (a Date or an ISO string).
 */
export type PatchTaskExpect = {
  assignee_id?: string | null;
  updated_at?: Date | string;
  status?: TaskStatus;
  title?: string;
};

export type PatchTaskInput = {
  /** The auth payload of the caller (requireAuth()). */
  actor: AuthPayload;
  id: string;
  /** The request body, as parsed (and, for the chat lane, already passed through guardChatTaskBody). */
  body: Record<string, unknown>;
  /** Optional compare-and-set. Absent: the write is exactly the route's. */
  expect?: PatchTaskExpect;
  /** The task as the caller's access check read it. Absent: read here with the same check (404 when hidden). */
  existing?: Awaited<ReturnType<typeof checkTaskAccess>>;
  /** The `x-claim-token` header value, when the caller holds the claim. */
  claimToken?: string | null;
  /** The chat conversation for the change record (chatConversationFor), null for every other caller. */
  chatConversation?: string | null;
};

export type PatchTaskChangedSince = {
  ok: false;
  reason: 'changed_since';
  /** The expect fields that no longer hold, when known before the write. Empty: the write itself missed. */
  fields: (keyof PatchTaskExpect)[];
};

function changedSince(fields: (keyof PatchTaskExpect)[]): PatchTaskChangedSince {
  return { ok: false, reason: 'changed_since', fields };
}

function sameTime(a: Date | string | null | undefined, b: Date | string | null | undefined): boolean {
  const ta = a == null ? null : new Date(a).getTime();
  const tb = b == null ? null : new Date(b).getTime();
  return ta === tb;
}

/** The expect fields that do not match the task as read now. */
function expectMismatch(
  expect: PatchTaskExpect,
  existing: { assignee_id?: string | null; updated_at?: Date | null; status?: string; title?: string },
): (keyof PatchTaskExpect)[] {
  const fields: (keyof PatchTaskExpect)[] = [];
  if ('assignee_id' in expect && (expect.assignee_id ?? null) !== (existing.assignee_id ?? null)) fields.push('assignee_id');
  if ('updated_at' in expect && !sameTime(expect.updated_at, existing.updated_at)) fields.push('updated_at');
  if ('status' in expect && expect.status !== existing.status) fields.push('status');
  if ('title' in expect && expect.title !== existing.title) fields.push('title');
  return fields;
}

/** The write target: exactly `taskWriteWhere` without `expect`; with it, the expect fields are added. */
function writeWhere(
  auth: AuthPayload,
  id: string,
  existing: { assignee_id?: string | null; updated_at?: Date | null },
  expect: PatchTaskExpect | undefined,
) {
  if (!expect) return taskWriteWhere(auth, id, existing);
  return {
    ...taskWriteWhere(auth, id, existing),
    ...('assignee_id' in expect ? { assignee_id: expect.assignee_id ?? null } : {}),
    ...(expect.updated_at !== undefined ? { updated_at: new Date(expect.updated_at) } : {}),
    ...(expect.status !== undefined ? { status: expect.status } : {}),
    ...(expect.title !== undefined ? { title: expect.title } : {}),
  };
}

/**
 * `.catch` handler for the writes: without `expect`, exactly `chatWriteMiss`. With `expect`, a missed write
 * (Prisma P2025, the compare-and-set did not hold) resolves to null, which patchTask turns into changed_since.
 */
function writeMiss(auth: AuthPayload, expect: PatchTaskExpect | undefined) {
  const miss = chatWriteMiss(auth);
  return (e: unknown): null => {
    if (expect && typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2025') return null;
    return miss(e);
  };
}

/**
 * Apply a task PATCH: everything PATCH /api/tasks/:id does between authentication and the response.
 * Returns the written task (with the route's include), the completion nudge, and the chat change record id.
 */
/** A project card finished: what it said about the project becomes the project's own description (never over one a person wrote). Never fails the status change. */
async function carryProjectCard(id: string): Promise<void> {
  await carryCardIntoProject(prisma, id).catch(() => false);
}

export async function patchTask(input: PatchTaskInput) {
  const { actor: auth, id, body, expect, claimToken, chatConversation = null } = input;
  const existingTask = input.existing ?? (await checkTaskAccess(id, auth));

  if (expect) {
    const fields = expectMismatch(expect, existingTask);
    if (fields.length > 0) return changedSince(fields);
  }

  // Fleet item 3: wherever `status` appears in the body (status-only or mixed), moves to in_progress,
  // review or done need the claim token while another worker holds a live lease. A person on a browser
  // session may move it anyway; the lease is then cleared in the same write below. No live lease, or
  // mode off, behaves exactly as before.
  let claimCleared: Record<string, null> = {};
  let claimCheck: Awaited<ReturnType<typeof assertClaimHeld>> | null = null;
  if (typeof body.status === 'string' && body.status !== existingTask.status && ['in_progress', 'review', 'done'].includes(body.status)) {
    const check = await assertClaimHeld(id, claimToken ?? null, { action: `move to ${body.status}`, caller: { userId: auth.userId, role: auth.role, via: auth.via } });
    claimCheck = check;
    if (check.overridden_holder) claimCleared = { ...CLEAR_CLAIM_DATA };
  }

  // Check if this is a status-only update
  if (body.status && Object.keys(body).length === 1) {
    const statusData = updateStatusSchema.parse(body);

    assertStatusTransition(existingTask.status, statusData.status);
    assertTriageExit(auth, existingTask.status, statusData.status);
    const enteringTriage = statusData.status === 'triage' && existingTask.status !== 'triage';
    const updateData = {
      ...statusTransitionData(existingTask, statusData.status),
      ...claimCleared,
      // Into triage: nothing may hold the task, and nothing about it is client-visible.
      ...(enteringTriage ? { ...CLEAR_CLAIM_DATA, client_visible: false } : {}),
      ...triageVisibilityPatch(existingTask, statusData.status, existingTask.tags),
    };

    const task = await prisma.task.update({
      where: writeWhere(auth, id, existingTask, expect),
      data: updateData,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            client: { select: { id: true, name: true } },
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
        blocked_by: { select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } } },
        blocking: { select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } } },
      },
    }).catch(writeMiss(auth, expect));
    if (!task) return changedSince([]);

    await claimCheck?.logOverride();

    // A task leaving review for rework spends its preview notice claims (a revised preview is told afresh).
    if (existingTask.status === 'review' && statusData.status !== 'review' && statusData.status !== 'done') await clearPreviewClaims(id);

    const completionNudge = await afterStatusChange(
      auth.userId,
      existingTask,
      task,
      statusData.status
    );
    if (statusData.status === 'done' && existingTask.status !== 'done') await carryProjectCard(id);

    const chatAction = await recordChatPatch(auth, existingTask, task, chatConversation);
    return { ok: true as const, task, completionNudge, chatActionId: chatAction };
  }

  // Regular update - PM/Admin only for most fields
  // Tech users can only update certain fields on their own tasks
  if (auth.role === 'tech') {
    const allowedTechFields = [
      'status',
      'title',
      'description',
      'priority',
      'is_focus',
      'notes',
      'requirements',
      'assignee_id',
      'energy_estimate',
      'mystery_factor',
      'battery_impact',
      'due_date',
      'no_time_needed',
      'site_id',
      'promised_to',
    ];
    const attemptedFields = Object.keys(body);
    const disallowedFields = attemptedFields.filter(
      (f) => !allowedTechFields.includes(f)
    );
    if (disallowedFields.length > 0) {
      throw new ApiError(
        `Tech users cannot update: ${disallowedFields.join(', ')}`,
        403
      );
    }
  }

  const data = updateTaskSchema.parse(body);
  if (data.status !== undefined) {
    assertStatusTransition(existingTask.status, data.status);
    assertTriageExit(auth, existingTask.status, data.status);
  }
  // A combined body that re-sends the current status (a retried close-out, a full-form save)
  // is not a status change: no completed_at reset, no re-focus, no activity entry.
  const statusChange =
    data.status !== undefined && data.status !== existingTask.status ? data.status : undefined;

  // Calculate estimated minutes if energy estimate, mystery, or battery changes
  let estimatedMinutes = existingTask.estimated_minutes;
  if (data.energy_estimate !== undefined || data.mystery_factor !== undefined || data.battery_impact !== undefined) {
    const energy = data.energy_estimate ?? existingTask.energy_estimate;
    const mystery = (data.mystery_factor ?? existingTask.mystery_factor) as MysteryFactor;
    const battery = (data.battery_impact ?? existingTask.battery_impact) as BatteryImpact;
    estimatedMinutes = energy ? calculateEstimatedMinutes(energy, mystery, battery) : null;
  }

  // Determine client_id update
  // If client_id is explicitly provided, use that
  // If project_id is being changed and client_id not provided, auto-update from new project
  let clientIdUpdate: string | null | undefined = undefined;
  if (data.client_id !== undefined) {
    // Explicit client_id provided
    clientIdUpdate = data.client_id;
  } else if (data.project_id !== undefined && data.project_id !== existingTask.project_id) {
    // project_id is being changed, auto-populate client_id from new project
    if (data.project_id) {
      const newProject = await prisma.project.findUnique({
        where: { id: data.project_id, is_deleted: false },
        select: { client_id: true },
      });
      clientIdUpdate = newProject?.client_id ?? null;
    } else {
      // project_id is being cleared, keep existing client_id (for ad-hoc tasks)
      // Don't update client_id automatically when removing from project
    }
  }

  // Clarity Phase 4b — arc_id: present+non-null validates the arc exists (404 if not),
  // explicit null detaches, absent (undefined) leaves the existing arc_id untouched.
  let arcIdUpdate: string | null | undefined = undefined;
  if (data.arc_id !== undefined) {
    if (data.arc_id === null) {
      arcIdUpdate = null;
    } else {
      const arc = await prisma.arc.findUnique({ where: { id: data.arc_id }, select: { id: true } });
      if (!arc) {
        throw new ApiError('Arc not found', 404);
      }
      arcIdUpdate = data.arc_id;
    }
  }

  // project-record-citadel-changes.md addendum (ruling 32) — dependency connect/disconnect.
  // Validate connect ids exist, reject a cycle with 422, and note whether the connect
  // introduces an unsatisfied blocker (forces status to `blocked` below, mirroring the
  // wizard's dependency wiring). Release on disconnect relies on the existing
  // unblockEligibleDependents/healBlockedTasks sweep, never a bespoke path here.
  let forceBlockedStatus = false;
  if (data.blocked_by_ids !== undefined) {
    const connectIds = data.blocked_by_ids.connect ?? [];
    const disconnectIds = data.blocked_by_ids.disconnect ?? [];

    if (connectIds.length > 0) {
      const blockers = await prisma.task.findMany({
        where: { id: { in: connectIds }, is_deleted: false },
        select: { id: true },
      });
      if (blockers.length !== new Set(connectIds).size) {
        throw new ApiError('One or more blocker tasks not found', 404);
      }

      if (await wouldCreateCycle(id, connectIds)) {
        throw new ApiError('Adding this dependency would create a cycle', 422);
      }

      if (!(await areBlockersSatisfied(connectIds))) {
        forceBlockedStatus = true;
      }
    }
  }

  // A connect with an unsatisfied blocker forces the dependent to `blocked`, never on a task
  // that is (or is being moved to) done/abandoned: completed work doesn't get resurrected by
  // a later dependency edit.
  const requestedStatus: TaskStatus = statusChange ?? existingTask.status;
  const newStatus: TaskStatus | undefined =
    forceBlockedStatus && !['done', 'abandoned', 'triage'].includes(requestedStatus)
      ? 'blocked'
      : statusChange;

  // Build update data explicitly to avoid Prisma type conflicts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unchanged since main
  const updateData: Record<string, any> = {
    estimated_minutes: estimatedMinutes,
    // Applied first so an explicit field in the same body (e.g. is_focus) wins.
    ...(newStatus !== undefined ? statusTransitionData(existingTask, newStatus) : {}),
    ...claimCleared,
  };

  if (data.title !== undefined) updateData.title = data.title;
  // Triage: a parked idea is never shown to a client, and entering it drops any claim on the task.
  if ((statusChange ?? existingTask.status) === 'triage') {
    updateData.client_visible = false;
    if (statusChange === 'triage') Object.assign(updateData, CLEAR_CLAIM_DATA);
  }
  // Description and notes accept Markdown / plain string / raw BlockNote array;
  // normalized to a BlockNote JSON document and stored in the Text field.
  if (data.description !== undefined) {
    updateData.description = serializeRichText(data.description);
  }
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.is_focus !== undefined) updateData.is_focus = data.is_focus;
  if (data.project_id !== undefined) updateData.project_id = data.project_id;
  if (clientIdUpdate !== undefined) updateData.client_id = clientIdUpdate;
  if (data.site_id !== undefined) updateData.site_id = data.site_id;
  if (arcIdUpdate !== undefined) updateData.arc_id = arcIdUpdate;
  if (data.phase !== undefined) updateData.phase = data.phase;
  if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
  if (data.assignee_id !== undefined) updateData.assignee_id = data.assignee_id;
  if (data.function_id !== undefined) updateData.function_id = data.function_id;

  // Auto-assign when function_id changes and no explicit assignee provided
  if (
    data.function_id !== undefined &&
    data.function_id !== existingTask.function_id &&
    data.assignee_id === undefined
  ) {
    const projectId = data.project_id ?? existingTask.project_id;
    if (projectId && data.function_id) {
      const teamAssignment = await prisma.projectTeamAssignment.findFirst({
        where: {
          project_id: projectId,
          function_id: data.function_id,
        },
        select: { user_id: true },
      });
      if (teamAssignment) {
        updateData.assignee_id = teamAssignment.user_id;
      }
    }
  }

  if (data.sop_id !== undefined) updateData.sop_id = data.sop_id;
  if (data.energy_estimate !== undefined) updateData.energy_estimate = data.energy_estimate;
  if (data.mystery_factor !== undefined) updateData.mystery_factor = data.mystery_factor;
  if (data.battery_impact !== undefined) updateData.battery_impact = data.battery_impact;
  if (data.notes !== undefined) {
    updateData.notes = serializeRichText(data.notes);
  }
  if (data.requirements !== undefined) updateData.requirements = data.requirements;
  // review_requirements (Quality Gate) - only PM/Admin can update
  if (data.review_requirements !== undefined && auth.role !== 'tech') {
    updateData.review_requirements = data.review_requirements;
  }
  if (data.due_date !== undefined) {
    updateData.due_date = data.due_date ? new Date(data.due_date) : null;
  }
  if (data.promised_to !== undefined) updateData.promised_to = data.promised_to;
  if (data.hard_due_at !== undefined) {
    updateData.hard_due_at = data.hard_due_at ? new Date(data.hard_due_at) : null;
    updateData.hard_due_source = data.hard_due_at ? (data.hard_due_source ?? null) : null;
  } else if (data.hard_due_source !== undefined) {
    // A source alone only edits the label of a date already on the task.
    updateData.hard_due_source = data.hard_due_source;
  }

  // Review workflow fields - only task creator or PM/Admin can update
  const canUpdateReviewFields = existingTask.created_by_id === auth.userId || auth.role !== 'tech';

  if (canUpdateReviewFields) {
    if (data.needs_review !== undefined) {
      updateData.needs_review = data.needs_review;
      // If turning off needs_review, clear approval
      if (!data.needs_review) {
        updateData.approved = false;
        updateData.approved_at = null;
        updateData.approved_by_id = null;
      }
    }
    if (data.reviewer_id !== undefined) updateData.reviewer_id = data.reviewer_id;

    // Approval - can be set by reviewer, task creator, or PM/Admin
    if (data.approved !== undefined) {
      updateData.approved = data.approved;
      if (data.approved) {
        updateData.approved_at = new Date();
        updateData.approved_by_id = auth.userId;
      } else {
        updateData.approved_at = null;
        updateData.approved_by_id = null;
      }
    }
  }

  // Billing fields - PM/Admin only (not in allowedTechFields)
  if (auth.role !== 'tech') {
    if (data.is_billable !== undefined) updateData.is_billable = data.is_billable;
    if (data.billing_target !== undefined) updateData.billing_target = data.billing_target;
    if (data.billing_amount !== undefined) updateData.billing_amount = data.billing_amount;
    if (data.is_retainer_work !== undefined) updateData.is_retainer_work = data.is_retainer_work;
    if (data.is_support !== undefined) updateData.is_support = data.is_support;
    if (data.client_visible !== undefined && (statusChange ?? existingTask.status) !== 'triage') updateData.client_visible = data.client_visible;
  }

  // Time tracking fields
  if (data.no_time_needed !== undefined) updateData.no_time_needed = data.no_time_needed;

  // Bast triage: classification + provenance + staging approval
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.plan_item_ids !== undefined) updateData.plan_item_ids = [...new Set(data.plan_item_ids)];
  // Triage entry/exit: remember and restore client_visible (an explicit client_visible in the body is ignored while in triage).
  {
    const patch = triageVisibilityPatch(existingTask, statusChange, (updateData.tags as string[] | undefined) ?? existingTask.tags);
    if (patch.tags) updateData.tags = patch.tags;
    if (patch.client_visible !== undefined) updateData.client_visible = patch.client_visible;
  }
  if (data.source !== undefined) updateData.source = data.source;
  if (data.source_ref !== undefined) updateData.source_ref = data.source_ref;
  if (data.requested_by_contact_id !== undefined) updateData.requested_by_contact_id = data.requested_by_contact_id;
  if (data.staging_preview_url !== undefined) updateData.staging_preview_url = data.staging_preview_url;
  if (data.staging_deployed_at !== undefined) {
    updateData.staging_deployed_at = data.staging_deployed_at ? new Date(data.staging_deployed_at) : null;
  }
  if (data.client_approved_at !== undefined) {
    updateData.client_approved_at = data.client_approved_at ? new Date(data.client_approved_at) : null;
  }
  if (data.approved_by_contact_id !== undefined) updateData.approved_by_contact_id = data.approved_by_contact_id;

  // project-record-citadel-changes.md addendum (ruling 32) — apply the dependency edit (the
  // forced `blocked` it can cause is folded into newStatus above).
  if (data.blocked_by_ids?.connect?.length || data.blocked_by_ids?.disconnect?.length) {
    updateData.blocked_by = {
      ...(data.blocked_by_ids.connect?.length
        ? { connect: data.blocked_by_ids.connect.map((bid) => ({ id: bid })) }
        : {}),
      ...(data.blocked_by_ids.disconnect?.length
        ? { disconnect: data.blocked_by_ids.disconnect.map((bid) => ({ id: bid })) }
        : {}),
    };
  }

  // Fleet item 5: a new preview address on an approved task voids the yes (never on a done task; mode off keeps it).
  // A request that also sets client_approved_at is a new yes for the new address, so nothing is voided then.
  const wasApproved = Boolean(existingTask.client_approved_at) || (existingTask.tags ?? []).includes('client-approved');
  let approvalVoided = false;
  if (wasApproved && typeof data.staging_preview_url === 'string' && data.staging_preview_url !== existingTask.staging_preview_url && !data.client_approved_at) {
    const r = await voidApprovalIfRestaged(id, { previewUrl: data.staging_preview_url }, { actorUserId: auth.userId, mode: await getApprovalBindingMode(), reason: 'preview address changed' });
    approvalVoided = r.voided;
    if (r.voided) {
      // The yes is gone: the update below must not write it back.
      delete updateData.client_approved_at;
      delete updateData.approved_by_contact_id;
      // A tag list in the same request replaces the tags AFTER the void, so it must not bring the yes (or spent
      // notice claims) back.
      if (Array.isArray(updateData.tags)) {
        updateData.tags = (updateData.tags as string[]).filter((t) => t !== 'client-approved' && !t.startsWith('cp:') && !t.startsWith('preview-notified:'));
      }
    }
  }

  const task = await prisma.task.update({
    where: writeWhere(auth, id, existingTask, expect),
    data: updateData,
    include: {
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          client: { select: { id: true, name: true } },
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
      project_phase: { select: { id: true, name: true, icon: true, sort_order: true } },
      blocked_by: { select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } } },
      blocking: { select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true, status: true } } } },
      time_entries: {
        where: { is_deleted: false },
        select: { id: true, duration: true },
      },
    },
  }).catch(writeMiss(auth, expect));
  if (!task) return changedSince([]);
  if (existingTask.status === 'review' && updateData.status && updateData.status !== 'review' && updateData.status !== 'done') await clearPreviewClaims(id);
  await claimCheck?.logOverride();

  // Fleet item 5: a client yes written through this route is bound to the build on the preview, with its source.
  if (data.client_approved_at && task.status !== 'done' && (!wasApproved || approvalVoided || existingTask.client_approved_at?.toISOString() !== task.client_approved_at?.toISOString())) {
    await stampApproval(id, data.approval_source ?? 'api', undefined, auth.userId);
  }

  // A requested status change gets the status-only side effects. A forced `blocked` from a
  // dependency connect alone keeps its existing behavior (no activity entry).
  let completionNudge: CompletionNudge | null = null;
  if (statusChange !== undefined && newStatus !== undefined) {
    completionNudge = await afterStatusChange(auth.userId, existingTask, task, newStatus);
    if (newStatus === 'done' && existingTask.status !== 'done') await carryProjectCard(id);
  } else {
    await resolvePortalFirstResponse(task);
  }

  // When a blocker is newly approved, approval-gated dependents become workable — unblock them.
  // (ordering-only dependents were already unblocked when the blocker hit `done`.)
  if (updateData.approved === true) {
    await unblockEligibleDependents(id);
  }

  // Notify new assignee if assignment changed to someone other than the updater
  if (
    task.assignee_id &&
    task.assignee_id !== existingTask.assignee_id &&
    task.assignee_id !== auth.userId
  ) {
    const updater = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    });
    await notifyTaskAssigned(task.id, task.assignee_id, updater?.name || 'Someone');
  }

  const chatAction = await recordChatPatch(auth, existingTask, task, chatConversation);
  return { ok: true as const, task, completionNudge, chatActionId: chatAction };
}

export type PatchTaskResult = Awaited<ReturnType<typeof patchTask>>;
export type PatchTaskOk = Extract<PatchTaskResult, { ok: true }>;
