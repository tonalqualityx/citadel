import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { cardForCaller } from '@/lib/deals/access';
import { loadCards } from '@/lib/tasks/triage-card';
import { isMikeOwnKey } from '@/lib/services/task-patch';
import { requireTriageEditor } from '@/lib/tasks/triage-auth';
import { actorOf, recordTriageChange, recordProjectChange } from '@/lib/tasks/triage-rev';
import { guardDeskShape } from '@/lib/triage-desk/guard';
import { isTriageDeskLaneValue } from '@/lib/triage-desk/identity';
import { assertSitemapOpen, mergePagesByName, recordSitemapChanges } from '@/lib/projects/sitemap';

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
 * to. In `queue` a list that is sent replaces the old one (phases with tasks are never dropped). On a project already under way, `pages` is merged by name
 * (see lib/projects/sitemap.ts) and `phases` is refused. A list that is left out is untouched.
 * Mike's session, his own un-laned API key or the chat lane only. Returns the card.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!isMikeOwnKey(auth)) requireTriageEditor(auth);
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const task = await prisma.task.findFirst({ where: { id, is_deleted: false }, select: { id: true, status: true, project: { select: { id: true, status: true } } } });
    if (!task || task.status !== 'triage') throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
    if (!task.project) throw new ApiError('Link the card to its project first.', 409, 'no_project');
    const projectId = task.project.id;
    const actor = await actorOf(auth);
    if (task.project.status !== 'queue') {
      // A project under way: the sent pages are merged by name (new added, same names updated, missing dropped); its phases are never redrawn here.
      if (body.phases) throw new ApiError("A project that is already under way keeps its phases; only its pages can be changed from here.", 409, 'project_not_queue');
      if (isTriageDeskLaneValue(auth.lane)) throw new ApiError('Only a project still in the queue can be reshaped by a session.', 409, 'project_not_queue');
      // An empty list on a project under way would drop every page; that is never what a merge by name means. Drop pages one by one through the project's sitemap route.
      if (body.pages && body.pages.length === 0) throw new ApiError('An empty page list would drop every page of a project that is under way. Drop pages by name instead.', 409, 'empty_pages_live');
      assertSitemapOpen(task.project.status);
      await prisma.$transaction(async (tx) => {
        const r = await mergePagesByName(tx, projectId, body.pages ?? []);
        await recordSitemapChanges(tx, projectId, r.lines, actor);
      });
      const [live] = await loadCards(prisma, [id]);
      return NextResponse.json(live ? await cardForCaller(auth, request.headers, live) : live);
    }
    await guardDeskShape(auth, projectId);
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
      await recordProjectChange(tx, projectId, `The project's ${parts.toLowerCase()} changed by ${actor.by}`, actor, id);
      await recordTriageChange(tx, id, 'shape', `${parts} redrawn by ${actor.by} (${[body.phases ? `${body.phases.length} phases` : null, body.pages ? `${body.pages.length} pages` : null].filter(Boolean).join(', ')})`, actor);
    });
    const [card] = await loadCards(prisma, [id]);
    return NextResponse.json(card ? await cardForCaller(auth, request.headers, card) : card);
  } catch (error) {
    return handleApiError(error);
  }
}
