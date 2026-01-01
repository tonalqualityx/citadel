import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { logCreate } from '@/lib/services/activity';
import { notifyTaskAssigned } from '@/lib/services/notifications';
import { MysteryFactor } from '@prisma/client';

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional().nullable(),
  status: z
    .enum(['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'])
    .optional(),
  priority: z.number().min(1).max(5).optional(),
  project_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  phase_id: z.string().uuid().optional().nullable(),
  phase: z.string().max(100).optional().nullable(), // Legacy field
  sort_order: z.number().optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  function_id: z.string().uuid().optional().nullable(),
  sop_id: z.string().uuid().optional().nullable(),
  energy_estimate: z.number().min(1).max(8).optional().nullable(),
  mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']).optional(),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']).optional(),
  due_date: z.string().datetime().optional().nullable(),
  started_at: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Billing fields
  is_billable: z.boolean().optional(),
  billing_target: z.number().min(1).optional().nullable(),
  is_retainer_work: z.boolean().optional(),
  is_support: z.boolean().optional(),
});

// Project statuses where tasks are visible to Tech users
const VISIBLE_PROJECT_STATUSES = ['ready', 'in_progress', 'review', 'done'];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as any;
    const statuses = searchParams.get('statuses'); // comma-separated list
    const priority = searchParams.get('priority')
      ? parseInt(searchParams.get('priority')!)
      : undefined;
    const projectId = searchParams.get('project_id') || undefined;
    const assigneeId = searchParams.get('assignee_id') || undefined;
    const phase = searchParams.get('phase') || undefined;
    const myTasks = searchParams.get('my_tasks') === 'true';
    const pendingReview = searchParams.get('pending_review') === 'true';

    // Parse multiple statuses if provided
    const statusList = statuses ? statuses.split(',').filter(Boolean) : null;

    // Build base where clause
    const baseConditions: any = {
      is_deleted: false,
      // Support both single status and multiple statuses
      ...(statusList ? { status: { in: statusList } } : status ? { status } : {}),
      ...(priority && { priority }),
      ...(projectId && { project_id: projectId }),
      ...(phase && { phase }),
      // Pending review filter: done tasks that need review and aren't approved
      ...(pendingReview && {
        status: 'done',
        needs_review: true,
        approved: false,
      }),
    };

    // Search condition (if provided)
    const searchCondition = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    // Access control condition for Tech users
    let accessCondition: any = {};
    if (auth.role === 'tech') {
      // Tech users can ONLY see tasks assigned to them
      // AND only from visible projects (or ad-hoc tasks)
      accessCondition = {
        assignee_id: auth.userId,
        OR: [
          { project_id: null },
          { project: { status: { in: VISIBLE_PROJECT_STATUSES } } },
        ],
      };
    } else {
      // PM/Admin can filter by assignee but see all tasks
      if (assigneeId) {
        accessCondition.assignee_id = assigneeId;
      }
      if (myTasks) {
        accessCondition.assignee_id = auth.userId;
      }
    }

    // Combine all conditions with AND
    const where: any = {
      AND: [baseConditions, searchCondition, accessCondition].filter(
        (c) => Object.keys(c).length > 0
      ),
    };

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
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
          sop: { select: { id: true, title: true } },
          created_by: { select: { id: true, name: true } },
          blocked_by: {
            select: { id: true, title: true, status: true },
          },
          blocking: {
            select: { id: true, title: true, status: true },
          },
          time_entries: {
            where: { is_deleted: false },
            select: { duration: true },
          },
        },
        orderBy: [{ priority: 'asc' }, { sort_order: 'asc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.task.count({ where }),
    ]);

    return NextResponse.json({
      tasks: tasks.map(formatTaskResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await request.json();
    const data = createTaskSchema.parse(body);

    // Determine client_id - auto-populate from project if not provided directly
    let clientId = data.client_id;

    // Validate project exists if provided and get retainer info for billing defaults
    let isRetainerProject = false;
    if (data.project_id) {
      const project = await prisma.project.findUnique({
        where: { id: data.project_id, is_deleted: false },
        select: {
          id: true,
          client_id: true,
          is_retainer: true,
          client: { select: { retainer_hours: true } },
        },
      });
      if (!project) {
        throw new ApiError('Project not found', 404);
      }

      // Auto-populate client_id from project if not explicitly provided
      if (!clientId) {
        clientId = project.client_id;
      }

      // Check if this is retainer work (project is retainer or client has retainer hours)
      isRetainerProject = project.is_retainer ||
        (project.client?.retainer_hours != null && Number(project.client.retainer_hours) > 0);

      // Tech users can only create tasks if assigned to the project
      if (auth.role === 'tech') {
        const isAssigned = await prisma.projectTeamAssignment.findFirst({
          where: {
            project_id: data.project_id,
            user_id: auth.userId,
          },
        });
        if (!isAssigned) {
          throw new ApiError('You are not assigned to this project', 403);
        }
      }
    }

    // Validate assignee exists if provided
    if (data.assignee_id) {
      const assignee = await prisma.user.findUnique({
        where: { id: data.assignee_id, is_active: true },
      });
      if (!assignee) {
        throw new ApiError('Assignee not found', 404);
      }
    }

    // Validate function exists if provided
    if (data.function_id) {
      const func = await prisma.function.findUnique({
        where: { id: data.function_id, is_active: true },
      });
      if (!func) {
        throw new ApiError('Function not found', 404);
      }
    }

    // If an SOP is linked, fetch it to copy requirements and defaults
    let sopDefaults: {
      requirements?: any;
      energy_estimate?: number | null;
      mystery_factor?: string;
      battery_impact?: string;
      default_priority?: number;
      review_requirements?: any;
      needs_review?: boolean;
      function_id?: string | null;
    } = {};

    if (data.sop_id) {
      const sop = await prisma.sop.findUnique({
        where: { id: data.sop_id },
        select: {
          template_requirements: true,
          review_requirements: true,
          energy_estimate: true,
          mystery_factor: true,
          battery_impact: true,
          default_priority: true,
          needs_review: true,
          function_id: true,
        },
      });
      if (sop) {
        sopDefaults = {
          requirements: sop.template_requirements,
          review_requirements: sop.review_requirements,
          energy_estimate: sop.energy_estimate,
          mystery_factor: sop.mystery_factor,
          battery_impact: sop.battery_impact,
          default_priority: sop.default_priority,
          needs_review: sop.needs_review,
          function_id: sop.function_id,
        };
      }
    }

    // Determine default reviewer
    // For project tasks: use project creator (PM)
    // For standalone tasks: use task creator
    let defaultReviewerId: string | null = null;
    if (data.project_id) {
      const project = await prisma.project.findUnique({
        where: { id: data.project_id },
        select: { created_by_id: true },
      });
      defaultReviewerId = project?.created_by_id || auth.userId;
    } else {
      // Standalone task - reviewer is the creator
      defaultReviewerId = auth.userId;
    }

    // Calculate estimated minutes if energy estimate provided
    const energyEstimate = data.energy_estimate ?? sopDefaults.energy_estimate;
    const mysteryFactor = data.mystery_factor || sopDefaults.mystery_factor || 'none';
    const estimatedMinutes = energyEstimate
      ? calculateEstimatedMinutes(
          energyEstimate,
          mysteryFactor as MysteryFactor
        )
      : null;

    // Start date: auto-set to today for standalone tasks, null for project tasks
    const startedAt = data.started_at
      ? new Date(data.started_at)
      : data.project_id
        ? null // Project tasks: no auto start date
        : new Date(); // Standalone tasks: default to today

    // Auto-assign based on SOP function if no assignee provided and task is on a project
    let autoAssigneeId: string | null = null;
    const effectiveFunctionId = data.function_id || sopDefaults.function_id || null;
    if (!data.assignee_id && data.project_id && effectiveFunctionId) {
      const teamAssignment = await prisma.projectTeamAssignment.findFirst({
        where: {
          project_id: data.project_id,
          function_id: effectiveFunctionId,
        },
        select: { user_id: true },
      });
      if (teamAssignment) {
        autoAssigneeId = teamAssignment.user_id;
      }
    }

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        status: data.status || 'not_started',
        priority: data.priority || sopDefaults.default_priority || 3,
        project_id: data.project_id,
        client_id: clientId,
        phase_id: data.phase_id,
        phase: data.phase, // Legacy field
        sort_order: data.sort_order || 0,
        assignee_id: data.assignee_id || autoAssigneeId,
        function_id: effectiveFunctionId,
        sop_id: data.sop_id,
        requirements: sopDefaults.requirements || undefined,
        review_requirements: sopDefaults.review_requirements || undefined,
        needs_review: sopDefaults.needs_review ?? true,
        reviewer_id: defaultReviewerId,
        energy_estimate: energyEstimate,
        mystery_factor: mysteryFactor as MysteryFactor,
        battery_impact: (data.battery_impact || sopDefaults.battery_impact || 'average_drain') as 'average_drain' | 'high_drain' | 'energizing',
        estimated_minutes: estimatedMinutes,
        started_at: startedAt,
        due_date: data.due_date ? new Date(data.due_date) : null,
        notes: data.notes,
        // Billing fields - auto-suggest retainer work for retainer clients/projects
        is_billable: data.is_billable ?? true,
        billing_target: data.billing_target,
        is_retainer_work: data.is_retainer_work ?? isRetainerProject,
        is_support: data.is_support ?? false,
        created_by_id: auth.userId,
      },
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
        project_phase: {
          select: { id: true, name: true, icon: true, sort_order: true },
        },
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
        reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
        approved_by: { select: { id: true, name: true } },
        function: { select: { id: true, name: true } },
        sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
        created_by: { select: { id: true, name: true } },
      },
    });

    // Log activity
    await logCreate(auth.userId, 'task', task.id, task.title);

    // Notify assignee (if assigned to someone other than the creator)
    if (task.assignee_id && task.assignee_id !== auth.userId) {
      const creator = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { name: true },
      });
      await notifyTaskAssigned(task.id, task.assignee_id, creator?.name || 'Someone');
    }

    return NextResponse.json(formatTaskResponse(task), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
