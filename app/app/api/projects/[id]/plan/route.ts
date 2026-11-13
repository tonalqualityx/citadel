import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { assertCanReadPlan } from '@/lib/tasks/plan';

/**
 * GET /api/projects/:id/plan
 * Where a project's plan lives: the setup card (the Triage card that became the project's setup task) and a link to its Plan tab, with how many
 * plan lines it holds. The plan itself is read with GET /api/tasks/:setup_card_id/plan. 404 when the project has no setup card, or the caller may not
 * read its plan (the same rule as the plan: designers never, contractors after release only, the card's owner while in Triage).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const card = await prisma.task.findFirst({
      where: { project_id: id, triage_kind: 'project_setup', is_deleted: false },
      orderBy: { created_at: 'asc' },
      select: { id: true, title: true, status: true },
    });
    if (!card) throw new ApiError('No plan for this project.', 404);
    assertCanReadPlan(card, auth);
    const lines = await prisma.taskPlanItem.count({ where: { task_id: card.id } });
    return NextResponse.json({ task_id: card.id, title: card.title, status: card.status, href: `/tasks/${card.id}?tab=plan`, plan_lines: lines });
  } catch (error) {
    return handleApiError(error);
  }
}
