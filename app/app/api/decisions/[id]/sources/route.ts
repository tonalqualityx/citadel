import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireWriter, sourceSchema } from '@/lib/decisions';

// Attach another source to a decision. The same kind + ref twice is a 200 no-op.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireWriter(await requireAuth());
    const { id } = await params;
    const s = sourceSchema.parse(await request.json());
    const decision = await prisma.decision.findUnique({ where: { id }, select: { id: true } });
    if (!decision) throw new ApiError('Decision not found', 404);

    const existing = await prisma.decisionSource.findUnique({
      where: { decision_id_kind_ref: { decision_id: id, kind: s.kind, ref: s.ref } },
    });
    if (existing) return NextResponse.json(existing, { status: 200 });

    const created = await prisma.decisionSource.create({
      data: {
        decision_id: id,
        kind: s.kind,
        ref: s.ref,
        thread_ref: s.thread_ref ?? null,
        quote: s.quote ?? null,
        author_label: s.author_label ?? null,
        author_user_id: s.author_user_id ?? null,
        author_contact_id: s.author_contact_id ?? null,
        at: s.at ?? null,
        extracted_by: s.extracted_by ?? null,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
