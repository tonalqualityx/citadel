import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadCards } from '@/lib/tasks/triage-card';
import { requireTriageOwner } from '@/lib/tasks/triage-auth';
import { actorOf, recordTriageChange } from '@/lib/tasks/triage-rev';

const line = (max: number) => z.string().trim().max(max);
const bodySchema = z
  .object({
    phases: z
      .array(
        z
          .object({ name: z.string().trim().min(1).max(100), summary: line(400).nullable().optional(), mike_part: line(400).nullable().optional(), icon: z.string().max(50).nullable().optional() })
          .strict(),
      )
      .max(20)
      .optional(),
    pages: z
      .array(
        z
          .object({ name: z.string().trim().min(1).max(255), page_type: z.string().trim().max(50).nullable().optional(), needs_design: z.boolean().optional(), notes: line(2000).nullable().optional() })
          .strict(),
      )
      .max(80)
      .optional(),
  })
  .strict()
  .refine((v) => v.phases !== undefined || v.pages !== undefined, { message: 'Send phases, pages, or both.' });

/**
 * PUT /api/tasks/:id/triage/shape   { phases?: [{name, summary?, mike_part?, icon?}], pages?: [{name, page_type?, needs_design?, notes?}] }
 * The chat drafts the shape of a project before release: replaces the phases and/or the sitemap of the project this Triage card is linked
 * to. Only while that project is still in `queue` (a live project is never reshaped from here) and only while no task sits in a phase
 * (phases with tasks are never dropped). A list that is sent replaces the old one; a list that is left out is untouched.
 * Mike's session or the chat lane only. Returns the card.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireTriageOwner(auth);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const task = await prisma.task.findFirst({ where: { id, is_deleted: false }, select: { id: true, status: true, project: { select: { id: true, status: true } } } });
    if (!task || task.status !== 'triage') throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
    if (!task.project) throw new ApiError('Link the card to its project first.', 409, 'no_project');
    if (task.project.status !== 'queue') throw new ApiError('Only a project still in the queue can be reshaped from its card.', 409, 'project_not_queue');
    const projectId = task.project.id;
    const actor = await actorOf(auth);
    await prisma.$transaction(async (tx) => {
      if (body.phases) {
        const withTasks = await tx.projectPhase.count({ where: { project_id: projectId, tasks: { some: {} } } });
        if (withTasks > 0) throw new ApiError('Some phases already have tasks, so the shape cannot be replaced.', 409, 'phases_have_tasks');
        await tx.projectPhase.deleteMany({ where: { project_id: projectId } });
        await tx.projectPhase.createMany({
          data: body.phases.map((p, i) => ({ project_id: projectId, name: p.name, icon: p.icon ?? null, summary: p.summary || null, mike_part: p.mike_part || null, sort_order: i })),
        });
      }
      if (body.pages) {
        await tx.projectPage.deleteMany({ where: { project_id: projectId } });
        await tx.projectPage.createMany({
          data: body.pages.map((p, i) => ({ project_id: projectId, name: p.name, page_type: p.page_type || null, needs_design: p.needs_design ?? false, notes: p.notes || null, sort_order: i })),
        });
      }
      const parts = [body.phases ? 'Shape' : null, body.pages ? 'Sitemap' : null].filter(Boolean).join(' and ');
      await recordTriageChange(tx, id, 'shape', `${parts} changed by ${actor.by}`, actor);
    });
    const [card] = await loadCards(prisma, [id]);
    return NextResponse.json(card);
  } catch (error) {
    return handleApiError(error);
  }
}
