import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatArcResponse } from '@/lib/api/formatters';
import { getArcStatus, type ArcStatus } from '@/lib/arc-status';

const createArcSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
});

const ARC_INCLUDE = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  tasks: { select: { status: true } },
} as const;

const VALID_STATUS_FILTERS: ArcStatus[] = ['empty', 'open', 'complete'];

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const statusFilter = searchParams.get('status') as ArcStatus | null;
    const clientId = searchParams.get('client_id') || undefined;
    const projectId = searchParams.get('project_id') || undefined;

    if (statusFilter && !VALID_STATUS_FILTERS.includes(statusFilter)) {
      throw new ApiError('Invalid status filter', 400);
    }

    const arcs = await prisma.arc.findMany({
      where: {
        ...(clientId && { client_id: clientId }),
        ...(projectId && { project_id: projectId }),
      },
      include: ARC_INCLUDE,
      orderBy: { created_at: 'desc' },
    });

    const shaped = arcs.map((arc) => formatArcResponse(arc, getArcStatus(arc)));
    const filtered = statusFilter ? shaped.filter((a) => a.status === statusFilter) : shaped;

    return NextResponse.json({ arcs: filtered, total: filtered.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const data = createArcSchema.parse(body);

    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    if (data.project_id) {
      const project = await prisma.project.findUnique({
        where: { id: data.project_id, is_deleted: false },
      });
      if (!project) {
        throw new ApiError('Project not found', 404);
      }
    }

    const arc = await prisma.arc.create({
      data: {
        name: data.name,
        description: data.description,
        client_id: data.client_id,
        project_id: data.project_id,
      },
      include: ARC_INCLUDE,
    });

    return NextResponse.json(formatArcResponse(arc, getArcStatus(arc)), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
