import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatRunListResponse, formatRunDetailResponse } from '@/lib/api/troubador-formatters';
import { logCreate } from '@/lib/services/activity';
import { notifyTroubadorRunCreated } from '@/lib/services/troubador-notifications';

const runListInclude = {
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true, url: true, site_type: true } },
  assignee: { select: { id: true, name: true, email: true } },
  interview: { select: { status: true } },
  articles: { select: { status: true }, where: { is_deleted: false } },
  _count: { select: { proposals: true } },
};

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

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const stage = searchParams.get('stage') || undefined;
    const statuses = searchParams.get('statuses') || undefined;
    const client_id = searchParams.get('client_id') || undefined;
    const site_id = searchParams.get('site_id') || undefined;
    const assignee_id = searchParams.get('assignee_id') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');

    const stageList = statuses ? statuses.split(',').map((s) => s.trim()).filter(Boolean) : null;

    const where = {
      is_deleted: false,
      ...(stageList && stageList.length > 0
        ? { stage: { in: stageList as any } }
        : stage
        ? { stage: stage as any }
        : {}),
      ...(client_id && { client_id }),
      ...(site_id && { site_id }),
      ...(assignee_id && { assignee_id }),
    };

    const [items, total] = await Promise.all([
      prisma.troubadorRun.findMany({
        where,
        include: runListInclude,
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.troubadorRun.count({ where }),
    ]);

    return NextResponse.json({
      runs: items.map(formatRunListResponse),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createRunSchema = z.object({
  client_id: z.string().uuid(),
  site_id: z.string().uuid(),
  title: z.string().min(1),
  brief: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const data = createRunSchema.parse(await request.json());

    const [client, site] = await Promise.all([
      prisma.client.findFirst({ where: { id: data.client_id, is_deleted: false } }),
      prisma.site.findFirst({ where: { id: data.site_id, is_deleted: false } }),
    ]);
    if (!client) throw new ApiError('Client not found', 404);
    if (!site) throw new ApiError('Site not found', 404);

    const created = await prisma.troubadorRun.create({
      data: {
        client_id: data.client_id,
        site_id: data.site_id,
        title: data.title,
        ...(data.brief !== undefined && { brief: data.brief }),
        stage: 'planning',
        assignee_id: data.assignee_id ?? auth.userId,
        created_by_id: auth.userId,
      },
    });

    logCreate(auth.userId, 'troubador_run', created.id, created.title);
    notifyTroubadorRunCreated(created.id).catch(() => {});

    const run = await prisma.troubadorRun.findUnique({
      where: { id: created.id },
      include: runDetailInclude,
    });

    return NextResponse.json(formatRunDetailResponse(run), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
