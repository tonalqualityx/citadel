import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatProposalResponse } from '@/lib/api/troubador-formatters';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
    });
    if (!run) throw new ApiError('Run not found', 404);

    const proposals = await prisma.topicProposal.findMany({
      where: { run_id: id },
      orderBy: { created_at: 'asc' },
    });

    return NextResponse.json({ proposals: proposals.map(formatProposalResponse) });
  } catch (error) {
    return handleApiError(error);
  }
}

const archetypeEnum = z.enum(['pillar', 'thought_leadership', 'case_study', 'how_to', 'commodity']);

const postProposalsSchema = z.object({
  proposals: z.array(
    z.object({
      title: z.string().min(1),
      archetype: archetypeEnum.optional(),
      primary_keyword: z.string().optional(),
      search_volume: z.number().int().optional(),
      keyword_difficulty: z.number().int().optional(),
      rationale: z.string().optional(),
    })
  ),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
    });
    if (!run) throw new ApiError('Run not found', 404);

    if (!(run.stage === 'planning' && run.ready === true)) {
      throw new ApiError('Run not ready for proposals', 409);
    }

    const data = postProposalsSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      await tx.topicProposal.deleteMany({ where: { run_id: id, source: 'troubador' } });
      if (data.proposals.length > 0) {
        await tx.topicProposal.createMany({
          data: data.proposals.map((p) => ({
            run_id: id,
            title: p.title,
            ...(p.archetype !== undefined && { archetype: p.archetype }),
            ...(p.primary_keyword !== undefined && { primary_keyword: p.primary_keyword }),
            ...(p.search_volume !== undefined && { search_volume: p.search_volume }),
            ...(p.keyword_difficulty !== undefined && { keyword_difficulty: p.keyword_difficulty }),
            ...(p.rationale !== undefined && { rationale: p.rationale }),
            source: 'troubador',
          })),
        });
      }
      await tx.troubadorRun.update({ where: { id }, data: { stage: 'topic_selection' } });
    });

    return NextResponse.json({
      run_id: id,
      stage: 'topic_selection',
      proposals_count: data.proposals.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const patchProposalsSchema = z.object({
  select: z.array(z.string()).optional(),
  deselect: z.array(z.string()).optional(),
  save_for_later: z.array(z.string()).optional(),
  add: z
    .array(
      z.object({
        title: z.string().min(1),
        primary_keyword: z.string().optional(),
        archetype: archetypeEnum.optional(),
      })
    )
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const run = await prisma.troubadorRun.findFirst({
      where: { id, is_deleted: false },
    });
    if (!run) throw new ApiError('Run not found', 404);

    const data = patchProposalsSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      if (data.select && data.select.length > 0) {
        await tx.topicProposal.updateMany({
          where: { id: { in: data.select }, run_id: id },
          data: { selected: true },
        });
      }
      if (data.deselect && data.deselect.length > 0) {
        await tx.topicProposal.updateMany({
          where: { id: { in: data.deselect }, run_id: id },
          data: { selected: false },
        });
      }
      if (data.save_for_later && data.save_for_later.length > 0) {
        await tx.topicProposal.updateMany({
          where: { id: { in: data.save_for_later }, run_id: id },
          data: { saved_for_later: true },
        });
      }
      if (data.add && data.add.length > 0) {
        await tx.topicProposal.createMany({
          data: data.add.map((p) => ({
            run_id: id,
            title: p.title,
            ...(p.primary_keyword !== undefined && { primary_keyword: p.primary_keyword }),
            ...(p.archetype !== undefined && { archetype: p.archetype }),
            source: 'human',
            selected: true,
          })),
        });
      }
    });

    const selected_count = await prisma.topicProposal.count({
      where: { run_id: id, selected: true },
    });

    return NextResponse.json({ run_id: id, selected_count });
  } catch (error) {
    return handleApiError(error);
  }
}
