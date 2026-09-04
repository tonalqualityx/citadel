import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logActivity } from '@/lib/services/activity';
import { lintNextStepFields } from '@/lib/oracle/projects/next-step-lint';

// Oracle Projects Tab Phase 3 — PUT used ONLY by the machine-side job
// (~/.claude/tools/citadel-projects/next-step-refresh.py) to write a freshly-inferred
// next-step line. Bearer auth, any authenticated user — this is a machine endpoint, not
// a Mike-only action (contrast PATCH/DELETE on the sibling next-step route).
//
// Mike's override always wins: if the project's CURRENT next_step_source is 'mike',
// next_step_text/owner/source/at are left completely untouched — but email_summary is
// still written (Mike overriding the next-step LINE doesn't mean he wants the running
// email summary frozen too; those are independent pieces of information). Either way,
// next_step_refresh_requested_at is cleared, since the refresh this call answers is done.
//
// next_step_text and email_summary are both linted server-side with the same
// writing-standard gate the machine-side job already ran client-side (belt and
// suspenders: a job bug or a hand-crafted call must not be able to write bad copy) — a
// violation on either field 422s the whole call with no write at all.
const writeSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    owner_id: z.string().uuid().optional(),
    owner_label: z.string().trim().min(1).max(255).optional(),
    email_summary: z.string().trim().max(2000).optional().nullable(),
    source: z.literal('bast'),
    generated_at: z.string().datetime(),
    model: z.string().min(1),
    cost_usd: z.number().nonnegative().optional(),
  })
  .refine((data) => !(data.owner_id && data.owner_label), {
    message: 'Provide at most one of owner_id or owner_label',
  });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true, name: true, next_step_source: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const body = await request.json();
    const data = writeSchema.parse(body);

    if (data.owner_id) {
      const owner = await prisma.user.findUnique({ where: { id: data.owner_id }, select: { id: true } });
      if (!owner) {
        throw new ApiError('Owner not found', 404);
      }
    }

    const violations = lintNextStepFields({ next_step_text: data.text, email_summary: data.email_summary });
    if (violations.length > 0) {
      return NextResponse.json(
        { error: 'next_step_text or email_summary failed the writing-standard lint', violations },
        { status: 422 }
      );
    }

    const mikeOwns = project.next_step_source === 'mike';
    const now = new Date();

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(mikeOwns
          ? {}
          : {
              next_step_text: data.text,
              next_step_owner_id: data.owner_id ?? null,
              next_step_owner_label: data.owner_label ?? null,
              next_step_source: 'bast' as const,
              next_step_at: new Date(data.generated_at),
            }),
        email_summary: data.email_summary ?? null,
        email_summary_at: data.email_summary ? now : null,
        next_step_refresh_requested_at: null,
      },
      include: { next_step_owner: { select: { id: true, name: true } } },
    });

    await logActivity({
      userId: auth.userId,
      action: 'updated',
      entityType: 'project',
      entityId: projectId,
      entityName: project.name,
      changes: {
        next_step_refresh: {
          from: null,
          to: { applied: !mikeOwns, model: data.model, cost_usd: data.cost_usd ?? null },
        },
      },
    });

    return NextResponse.json({
      applied: !mikeOwns,
      next_step: {
        text: updated.next_step_text,
        owner: updated.next_step_owner ? { id: updated.next_step_owner.id, name: updated.next_step_owner.name } : null,
        owner_label: updated.next_step_owner_label,
        source: updated.next_step_source,
        at: updated.next_step_at?.toISOString() ?? null,
      },
      email_summary: updated.email_summary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
