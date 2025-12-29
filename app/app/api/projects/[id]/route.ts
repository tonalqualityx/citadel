import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatProjectResponse } from '@/lib/api/formatters';
import { canTransitionProjectStatus } from '@/lib/calculations/status';

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  type: z.enum(['project', 'retainer', 'internal']).optional(),
  billing_type: z.enum(['fixed', 'hourly', 'retainer', 'none']).optional().nullable(),
  client_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional().nullable(),
  start_date: z.string().datetime().optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
  completed_date: z.string().datetime().optional().nullable(),
  budget_amount: z.number().min(0).optional().nullable(),
  budget_hours: z.number().min(0).optional().nullable(),
  hourly_rate: z.number().min(0).optional().nullable(),
  is_retainer: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

const lockBudgetSchema = z.object({
  lock_budget: z.literal(true),
  budget_hours: z.number().min(0),
  hourly_rate: z.number().min(0).optional(),
  budget_amount: z.number().min(0).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum([
    'quote',
    'queue',
    'ready',
    'in_progress',
    'review',
    'done',
    'suspended',
    'cancelled',
  ]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const project = await prisma.project.findUnique({
      where: { id, is_deleted: false },
      include: {
        client: { select: { id: true, name: true, status: true } },
        site: { select: { id: true, name: true, url: true } },
        created_by: { select: { id: true, name: true } },
        phases: {
          orderBy: { sort_order: 'asc' },
        },
        tasks: {
          where: { is_deleted: false },
          include: {
            assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
            function: { select: { id: true, name: true } },
            project_phase: { select: { id: true, name: true, icon: true, sort_order: true } },
            time_entries: {
              where: { is_deleted: false },
              select: { duration: true },
            },
          },
          orderBy: [
            { project_phase: { sort_order: 'asc' } },
            { sort_order: 'asc' },
          ],
        },
        team_assignments: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            function: { select: { id: true, name: true } },
          },
        },
        milestones: {
          orderBy: { sort_order: 'asc' },
        },
        time_entries: {
          where: { is_deleted: false, is_running: false },
          include: {
            user: { select: { id: true, name: true } },
          },
          orderBy: { started_at: 'desc' },
          take: 50, // Limit to recent entries
        },
        _count: { select: { tasks: true, time_entries: true } },
      },
    });

    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    return NextResponse.json(formatProjectResponse(project));
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
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();

    // Check if this is a budget lock operation
    if (body.lock_budget === true) {
      const lockData = lockBudgetSchema.parse(body);

      const existingProject = await prisma.project.findUnique({
        where: { id, is_deleted: false },
        select: { budget_locked: true },
      });

      if (!existingProject) {
        throw new ApiError('Project not found', 404);
      }

      if (existingProject.budget_locked) {
        throw new ApiError('Budget is already locked', 400);
      }

      const project = await prisma.project.update({
        where: { id },
        data: {
          budget_hours: lockData.budget_hours,
          hourly_rate: lockData.hourly_rate,
          budget_amount: lockData.budget_amount,
          budget_locked: true,
          budget_locked_at: new Date(),
          budget_locked_by_id: auth.userId,
        },
        include: {
          client: { select: { id: true, name: true, status: true } },
          site: { select: { id: true, name: true, url: true } },
          created_by: { select: { id: true, name: true } },
          tasks: {
            where: { is_deleted: false },
            select: { estimated_minutes: true, status: true, energy_estimate: true, mystery_factor: true },
          },
        },
      });

      return NextResponse.json(formatProjectResponse(project));
    }

    // Check if this is a status-only update
    if (body.status && Object.keys(body).length === 1) {
      const statusData = updateStatusSchema.parse(body);

      const existingProject = await prisma.project.findUnique({
        where: { id, is_deleted: false },
        select: { status: true },
      });

      if (!existingProject) {
        throw new ApiError('Project not found', 404);
      }

      if (!canTransitionProjectStatus(existingProject.status, statusData.status)) {
        throw new ApiError(
          `Cannot transition from ${existingProject.status} to ${statusData.status}`,
          400
        );
      }

      const updateData: any = { status: statusData.status };

      // Set completed_date when transitioning to done
      if (statusData.status === 'done') {
        updateData.completed_date = new Date();
      }
      // Clear completed_date when reopening
      if (existingProject.status === 'done' && statusData.status !== 'done') {
        updateData.completed_date = null;
      }

      const project = await prisma.project.update({
        where: { id },
        data: updateData,
        include: {
          client: { select: { id: true, name: true, status: true } },
          site: { select: { id: true, name: true, url: true } },
          created_by: { select: { id: true, name: true } },
          tasks: {
            where: { is_deleted: false },
            select: { estimated_minutes: true, status: true },
          },
        },
      });

      return NextResponse.json(formatProjectResponse(project));
    }

    // Regular update
    const data = updateProjectSchema.parse(body);

    // Validate client exists if changing
    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    // Validate site exists if changing
    if (data.site_id) {
      const site = await prisma.site.findUnique({
        where: { id: data.site_id, is_deleted: false },
      });
      if (!site) {
        throw new ApiError('Site not found', 404);
      }
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...data,
        start_date: data.start_date !== undefined
          ? (data.start_date ? new Date(data.start_date) : null)
          : undefined,
        target_date: data.target_date !== undefined
          ? (data.target_date ? new Date(data.target_date) : null)
          : undefined,
        completed_date: data.completed_date !== undefined
          ? (data.completed_date ? new Date(data.completed_date) : null)
          : undefined,
      },
      include: {
        client: { select: { id: true, name: true, status: true } },
        site: { select: { id: true, name: true, url: true } },
        created_by: { select: { id: true, name: true } },
        tasks: {
          where: { is_deleted: false },
          select: { estimated_minutes: true, status: true },
        },
      },
    });

    return NextResponse.json(formatProjectResponse(project));
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
    requireRole(auth, ['admin']);
    const { id } = await params;

    // Soft delete
    await prisma.project.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
