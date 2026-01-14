import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { canTransitionTaskStatus } from '@/lib/calculations/status';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { logStatusChange, logUpdate, logDelete } from '@/lib/services/activity';
import { notifyTaskAssigned } from '@/lib/services/notifications';
import { MysteryFactor, TaskStatus } from '@prisma/client';

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

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.any().optional(), // BlockNote JSON content
  priority: z.number().min(1).max(5).optional(),
  is_focus: z.boolean().optional(), // User focus flag
  project_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
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
  requirements: z.array(requirementEntrySchema).optional().nullable(),
  // Quality Gate (PM/Admin only)
  review_requirements: z.array(requirementEntrySchema).optional().nullable(),
  // Review workflow fields
  needs_review: z.boolean().optional(),
  reviewer_id: z.string().uuid().optional().nullable(),
  approved: z.boolean().optional(),
  // Billing fields (PM/Admin only)
  is_billable: z.boolean().optional(),
  billing_target: z.number().min(1).optional().nullable(),
  billing_amount: z.number().min(0).optional().nullable(),
  is_retainer_work: z.boolean().optional(),
  is_support: z.boolean().optional(),
  // Time tracking
  no_time_needed: z.boolean().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned']),
});

// Project statuses where tasks are visible to Tech users
const VISIBLE_PROJECT_STATUSES = ['ready', 'in_progress', 'review', 'done'];

async function checkTaskAccess(taskId: string, auth: any): Promise<any> {
  const task = await prisma.task.findUnique({
    where: { id: taskId, is_deleted: false },
    include: {
      project: { select: { id: true, status: true } },
    },
  });

  if (!task) {
    throw new ApiError('Task not found', 404);
  }

  // Tech users can only access tasks they can see
  if (auth.role === 'tech') {
    let isVisible = false;

    // Ad-hoc tasks assigned to the user
    if (!task.project_id && task.assignee_id === auth.userId) {
      isVisible = true;
    }
    // Tasks in projects where user is a team member
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
            client: { select: { id: true, name: true } },
            site: { select: { id: true, name: true } },
          },
        },
        client: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
        reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
        approved_by: { select: { id: true, name: true } },
        function: { select: { id: true, name: true } },
        sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
        created_by: { select: { id: true, name: true } },
        blocked_by: {
          select: { id: true, title: true, status: true },
        },
        blocking: {
          select: { id: true, title: true, status: true },
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

    return NextResponse.json(formattedTask);
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
    const body = await request.json();

    // Check if this is a status-only update
    if (body.status && Object.keys(body).length === 1) {
      const statusData = updateStatusSchema.parse(body);

      if (!canTransitionTaskStatus(existingTask.status, statusData.status)) {
        throw new ApiError(
          `Cannot transition from ${existingTask.status} to ${statusData.status}`,
          400
        );
      }

      const updateData: any = { status: statusData.status };

      // Set timestamps and focus based on status
      if (statusData.status === 'in_progress') {
        if (!existingTask.started_at) {
          updateData.started_at = new Date();
        }
        // Auto-focus tasks when moved to in_progress
        updateData.is_focus = true;
      }
      if (statusData.status === 'done') {
        updateData.completed_at = new Date();
      }
      // Clear completed_at when reopening
      if (existingTask.status === 'done' && statusData.status !== 'done') {
        updateData.completed_at = null;
      }

      const task = await prisma.task.update({
        where: { id },
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
          assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
          reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
          approved_by: { select: { id: true, name: true } },
          function: { select: { id: true, name: true } },
          sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
          created_by: { select: { id: true, name: true } },
          blocked_by: { select: { id: true, title: true, status: true } },
          blocking: { select: { id: true, title: true, status: true } },
        },
      });

      // Log status change activity
      await logStatusChange(
        auth.userId,
        'task',
        task.id,
        task.title,
        existingTask.status,
        statusData.status
      );

      return NextResponse.json(formatTaskResponse(task));
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

    // Calculate estimated minutes if energy estimate changes
    let estimatedMinutes = existingTask.estimated_minutes;
    if (data.energy_estimate !== undefined || data.mystery_factor !== undefined) {
      const energy = data.energy_estimate ?? existingTask.energy_estimate;
      const mystery = (data.mystery_factor ?? existingTask.mystery_factor) as MysteryFactor;
      estimatedMinutes = energy ? calculateEstimatedMinutes(energy, mystery) : null;
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

    // Build update data explicitly to avoid Prisma type conflicts
    const updateData: Record<string, any> = {
      estimated_minutes: estimatedMinutes,
    };

    if (data.title !== undefined) updateData.title = data.title;
    // Description and notes are BlockNote JSON - stringify for storage in Text field
    if (data.description !== undefined) {
      updateData.description = data.description ? JSON.stringify(data.description) : null;
    }
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.is_focus !== undefined) updateData.is_focus = data.is_focus;
    if (data.project_id !== undefined) updateData.project_id = data.project_id;
    if (clientIdUpdate !== undefined) updateData.client_id = clientIdUpdate;
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
      updateData.notes = data.notes ? JSON.stringify(data.notes) : null;
    }
    if (data.requirements !== undefined) updateData.requirements = data.requirements;
    // review_requirements (Quality Gate) - only PM/Admin can update
    if (data.review_requirements !== undefined && auth.role !== 'tech') {
      updateData.review_requirements = data.review_requirements;
    }
    if (data.due_date !== undefined) {
      updateData.due_date = data.due_date ? new Date(data.due_date) : null;
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
    }

    // Time tracking fields
    if (data.no_time_needed !== undefined) updateData.no_time_needed = data.no_time_needed;

    const task = await prisma.task.update({
      where: { id },
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
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
        reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
        approved_by: { select: { id: true, name: true } },
        function: { select: { id: true, name: true } },
        sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
        created_by: { select: { id: true, name: true } },
        project_phase: { select: { id: true, name: true, icon: true, sort_order: true } },
        blocked_by: { select: { id: true, title: true, status: true } },
        blocking: { select: { id: true, title: true, status: true } },
        time_entries: {
          where: { is_deleted: false },
          select: { id: true, duration: true },
        },
      },
    });

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

    return NextResponse.json(formatTaskResponse(task));
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
      select: { title: true },
    });

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
