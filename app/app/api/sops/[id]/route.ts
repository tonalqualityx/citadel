import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, notFound } from '@/lib/api/errors';
import type { Prisma } from '@prisma/client';

const updateSopSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.any().optional(),
  function_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().max(50)).optional(),
  template_requirements: z.any().optional().nullable(),
  is_active: z.boolean().optional(),
  next_review_at: z.string().datetime().optional().nullable(),
  mark_reviewed: z.boolean().optional(), // Special flag to mark as reviewed now
  // Task template fields
  default_priority: z.number().int().min(1).max(5).optional(),
  energy_estimate: z.number().int().min(1).max(8).optional().nullable(),
  mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']).optional(),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']).optional(),
  // PM/Admin checklists
  setup_requirements: z.any().optional().nullable(),
  review_requirements: z.any().optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const sop = await prisma.sop.findUnique({
      where: { id },
      include: {
        function: {
          select: { id: true, name: true },
        },
        tasks: {
          where: { is_deleted: false },
          select: {
            id: true,
            title: true,
            status: true,
            project: {
              select: { id: true, name: true },
            },
          },
          take: 10,
          orderBy: { created_at: 'desc' },
        },
        recipe_tasks: {
          select: {
            id: true,
            title: true,
            phase: {
              select: {
                id: true,
                name: true,
                recipe: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        _count: {
          select: { tasks: true, recipe_tasks: true },
        },
      },
    });

    if (!sop) {
      return notFound('SOP not found');
    }

    return NextResponse.json({
      sop: {
        id: sop.id,
        title: sop.title,
        content: sop.content,
        function: sop.function,
        tags: sop.tags,
        template_requirements: sop.template_requirements,
        setup_requirements: sop.setup_requirements,
        review_requirements: sop.review_requirements,
        is_active: sop.is_active,
        // Task template fields
        default_priority: sop.default_priority,
        energy_estimate: sop.energy_estimate,
        mystery_factor: sop.mystery_factor,
        battery_impact: sop.battery_impact,
        estimated_minutes: sop.estimated_minutes,
        // Review tracking
        last_reviewed_at: sop.last_reviewed_at?.toISOString() || null,
        next_review_at: sop.next_review_at?.toISOString() || null,
        // Stats
        task_count: sop._count.tasks,
        recipe_task_count: sop._count.recipe_tasks,
        recent_tasks: sop.tasks,
        recipe_tasks: sop.recipe_tasks,
        created_at: sop.created_at.toISOString(),
        updated_at: sop.updated_at.toISOString(),
      },
    });
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
    const data = updateSopSchema.parse(body);

    // Check if SOP exists
    const existing = await prisma.sop.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return notFound('SOP not found');
    }

    // Build update data
    const updateData: Prisma.SopUpdateInput = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.function_id !== undefined) {
      updateData.function = data.function_id
        ? { connect: { id: data.function_id } }
        : { disconnect: true };
    }
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.template_requirements !== undefined) {
      updateData.template_requirements = data.template_requirements;
    }
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.next_review_at !== undefined) {
      updateData.next_review_at = data.next_review_at ? new Date(data.next_review_at) : null;
    }

    // Task template fields
    if (data.default_priority !== undefined) updateData.default_priority = data.default_priority;
    if (data.energy_estimate !== undefined) updateData.energy_estimate = data.energy_estimate;
    if (data.mystery_factor !== undefined) updateData.mystery_factor = data.mystery_factor;
    if (data.battery_impact !== undefined) updateData.battery_impact = data.battery_impact;
    // PM/Admin checklists
    if (data.setup_requirements !== undefined) {
      updateData.setup_requirements = data.setup_requirements;
    }
    if (data.review_requirements !== undefined) {
      updateData.review_requirements = data.review_requirements;
    }

    // Mark as reviewed
    if (data.mark_reviewed) {
      updateData.last_reviewed_at = new Date();
    }

    const sop = await prisma.sop.update({
      where: { id },
      data: updateData,
      include: {
        function: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({ sop });
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

    // Check if SOP exists
    const existing = await prisma.sop.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return notFound('SOP not found');
    }

    // Soft delete by setting is_active to false
    await prisma.sop.update({
      where: { id },
      data: { is_active: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
