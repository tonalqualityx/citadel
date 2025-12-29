import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import type { Prisma } from '@prisma/client';

const createSopSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.any().optional(),
  function_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().max(50)).optional().default([]),
  template_requirements: z.any().optional().nullable(),
  next_review_at: z.string().datetime().optional().nullable(),
  // Task template fields
  default_priority: z.number().int().min(1).max(5).optional().default(3),
  energy_estimate: z.number().int().min(1).max(8).optional().nullable(),
  mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']).optional().default('none'),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']).optional().default('average_drain'),
  // Quality Gate (PM/Admin only review checklist)
  review_requirements: z.any().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    // Filters
    const functionId = searchParams.get('function_id');
    const tag = searchParams.get('tag');
    const search = searchParams.get('search');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    // Pagination
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = (page - 1) * limit;

    // Build where clause
    const where: Prisma.SopWhereInput = {};

    if (!includeInactive) {
      where.is_active = true;
    }

    if (functionId) {
      where.function_id = functionId;
    }

    if (tag) {
      where.tags = { has: tag };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
      ];
    }

    const [sops, total] = await Promise.all([
      prisma.sop.findMany({
        where,
        include: {
          function: {
            select: { id: true, name: true },
          },
          _count: {
            select: { tasks: true, recipe_tasks: true },
          },
        },
        orderBy: { title: 'asc' },
        skip: offset,
        take: limit,
      }),
      prisma.sop.count({ where }),
    ]);

    // Format response
    const formattedSops = sops.map((sop) => ({
      id: sop.id,
      title: sop.title,
      function: sop.function,
      tags: sop.tags,
      is_active: sop.is_active,
      // Task template fields
      default_priority: sop.default_priority,
      energy_estimate: sop.energy_estimate,
      mystery_factor: sop.mystery_factor,
      battery_impact: sop.battery_impact,
      estimated_minutes: sop.estimated_minutes,
      // Stats
      task_count: sop._count.tasks,
      recipe_task_count: sop._count.recipe_tasks,
      last_reviewed_at: sop.last_reviewed_at?.toISOString() || null,
      next_review_at: sop.next_review_at?.toISOString() || null,
      created_at: sop.created_at.toISOString(),
      updated_at: sop.updated_at.toISOString(),
    }));

    return NextResponse.json({
      sops: formattedSops,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createSopSchema.parse(body);

    const sop = await prisma.sop.create({
      data: {
        title: data.title,
        content: data.content ?? undefined,
        function_id: data.function_id,
        tags: data.tags,
        template_requirements: data.template_requirements ?? undefined,
        next_review_at: data.next_review_at ? new Date(data.next_review_at) : null,
        // Task template fields
        default_priority: data.default_priority,
        energy_estimate: data.energy_estimate,
        mystery_factor: data.mystery_factor,
        battery_impact: data.battery_impact,
        // Quality Gate
        review_requirements: data.review_requirements ?? undefined,
      },
      include: {
        function: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({ sop }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
