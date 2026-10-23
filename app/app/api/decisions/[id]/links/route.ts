import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { linkSchema, requireWriter } from '@/lib/decisions';

// Link a decision to a task, project, client or other entity. Duplicates are a 200 no-op.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireWriter(await requireAuth());
    const { id } = await params;
    const l = linkSchema.parse(await request.json());
    const decision = await prisma.decision.findUnique({ where: { id }, select: { id: true } });
    if (!decision) throw new ApiError('Decision not found', 404);

    const existing = await prisma.decisionLink.findUnique({
      where: {
        decision_id_entity_kind_entity_id_relation: {
          decision_id: id,
          entity_kind: l.entity_kind,
          entity_id: l.entity_id,
          relation: l.relation,
        },
      },
    });
    if (existing) return NextResponse.json(existing, { status: 200 });

    const created = await prisma.decisionLink.create({
      data: { decision_id: id, entity_kind: l.entity_kind, entity_id: l.entity_id, relation: l.relation },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
