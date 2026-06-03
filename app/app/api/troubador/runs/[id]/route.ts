import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatRunDetailResponse } from '@/lib/api/troubador-formatters';
import { logStatusChange, logUpdate } from '@/lib/services/activity';

const runDetailInclude = {
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true, url: true, site_type: true } },
  assignee: { select: { id: true, name: true, email: true } },
  interview: true,
  proposals: { orderBy: { created_at: 'asc' as const } },
  articles: {
    where: { is_deleted: false },
    include: {
      client: { select: { id: true, name: true } },
      site: { select: { id: true, name: true, url: true, site_type: true } },
      _count: { select: { comments: true } },
    },
  },
  schedule: true,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
      include: runDetailInclude,
    });
    if (!run) throw new ApiError('Run not found', 404);

    return NextResponse.json(formatRunDetailResponse(run));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateRunSchema = z.object({
  brief: z.string().optional(),
  goal_type: z.string().optional(),
  target_offering: z.string().optional(),
  must_cover: z.string().optional(),
  avoid: z.string().optional(),
  ready: z.boolean().optional(),
  selection_ready: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  action: z.enum(['cancel']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const existing = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
    });
    if (!existing) throw new ApiError('Run not found', 404);

    const data = updateRunSchema.parse(await request.json());

    const update: Record<string, unknown> = {};
    let newStage: string | null = null;

    if (data.action === 'cancel') {
      update.stage = 'cancelled';
      newStage = 'cancelled';
    } else {
      if (data.brief !== undefined) update.brief = data.brief;
      if (data.goal_type !== undefined) update.goal_type = data.goal_type;
      if (data.target_offering !== undefined) update.target_offering = data.target_offering;
      if (data.must_cover !== undefined) update.must_cover = data.must_cover;
      if (data.avoid !== undefined) update.avoid = data.avoid;
      if (data.ready !== undefined) update.ready = data.ready;
      if (data.selection_ready !== undefined) update.selection_ready = data.selection_ready;
      if (data.assignee_id !== undefined) update.assignee_id = data.assignee_id;
    }

    const run = await prisma.troubadorRun.update({
      where: { id },
      data: update,
      include: runDetailInclude,
    });

    if (newStage && newStage !== existing.stage) {
      logStatusChange(auth.userId, 'troubador_run', id, run.title, existing.stage, newStage);
    } else {
      logUpdate(auth.userId, 'troubador_run', id, run.title, {}).catch(() => {});
    }

    return NextResponse.json(formatRunDetailResponse(run));
  } catch (error) {
    return handleApiError(error);
  }
}
