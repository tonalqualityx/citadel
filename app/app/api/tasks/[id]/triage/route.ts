import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireTriageOwner } from '@/lib/tasks/triage-auth';
import { TRIAGE_KINDS } from '@/lib/tasks/triage-kind';
import { loadCards } from '@/lib/tasks/triage-card';

async function cardOr404(id: string) {
  const [card] = await loadCards(prisma, [id]);
  if (!card) throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
  return card;
}

/**
 * GET /api/tasks/:id/triage
 * One Triage card as the Triage tab shows it (kind, age, summary, release_line, release_ready, open questions, looks done, project block).
 * Mike's session or the chat lane only; a card that is not in Triage is 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireTriageOwner(auth);
    const { id } = await params;
    return NextResponse.json(await cardOr404(id));
  } catch (error) {
    return handleApiError(error);
  }
}

const bodySchema = z
  .object({
    kind: z.enum(TRIAGE_KINDS).nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => v.kind !== undefined || v.project_id !== undefined, { message: 'Send kind, project_id, or both.' });

/**
 * PATCH /api/tasks/:id/triage   { kind?: project_setup|task|project_addition|reusable_tool|rule_proposal|question_only|null, project_id?: uuid|null }
 * Sets what the card is and, for a project card, which project it sets up (the card takes the project's client and site). Triage cards
 * only; Mike's session or the chat lane only (403 for everyone else). Returns the card.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireTriageOwner(auth);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const task = await prisma.task.findFirst({ where: { id, is_deleted: false }, select: { id: true, status: true } });
    if (!task || task.status !== 'triage') throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
    const data: Record<string, unknown> = {};
    if (body.kind !== undefined) data.triage_kind = body.kind;
    if (body.project_id !== undefined) {
      if (body.project_id === null) data.project_id = null;
      else {
        const p = await prisma.project.findFirst({ where: { id: body.project_id, is_deleted: false }, select: { id: true, client_id: true, site_id: true } });
        if (!p) throw new ApiError('That project does not exist.', 404, 'project_missing');
        data.project_id = p.id;
        data.client_id = p.client_id;
        if (p.site_id) data.site_id = p.site_id;
      }
    }
    await prisma.task.update({ where: { id }, data: data as never });
    return NextResponse.json(await cardOr404(id));
  } catch (error) {
    return handleApiError(error);
  }
}
