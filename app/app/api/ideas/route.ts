import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatIdeaResponse } from '@/lib/api/formatters';

const createIdeaSchema = z.object({
  text: z.string().min(1),
  source: z.enum(['session', 'oracle', 'email']),
  source_ref: z.string().max(500).optional().nullable(),
  created_by_id: z.string().uuid().optional().nullable(),
});

const IDEA_INCLUDE = {
  promoted_task: { select: { id: true, title: true } },
} as const;

const VALID_STATUSES = ['open', 'kept', 'promoted', 'discarded'];

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || 'open';
    if (!VALID_STATUSES.includes(status)) {
      throw new ApiError('Invalid status filter', 400);
    }

    const ideas = await prisma.idea.findMany({
      where: { status: status as 'open' | 'kept' | 'promoted' | 'discarded' },
      include: IDEA_INCLUDE,
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({ ideas: ideas.map(formatIdeaResponse), total: ideas.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const data = createIdeaSchema.parse(body);

    const idea = await prisma.idea.create({
      data: {
        text: data.text,
        source: data.source,
        source_ref: data.source_ref,
        created_by_id: data.created_by_id,
      },
      include: IDEA_INCLUDE,
    });

    return NextResponse.json(formatIdeaResponse(idea), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
