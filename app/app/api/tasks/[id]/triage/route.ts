import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireTriageEditor, requireTriageOwner } from '@/lib/tasks/triage-auth';
import { TRIAGE_KINDS } from '@/lib/tasks/triage-kind';
import { loadCards } from '@/lib/tasks/triage-card';
import { isDoxLane } from '@/lib/dox/guard';
import { actorOf, recordTriageChange } from '@/lib/tasks/triage-rev';
import { isTriageDeskLane, guardDeskTriagePatch } from '@/lib/triage-desk/guard';
import { recordSessionChange } from '@/lib/triage-desk/changes';
import { estimatePatchForKind } from '@/lib/tasks/triage-estimate';
import { mayReadDeal } from '@/lib/deals/access';

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
    // Dox reads a Triage card (its dates especially) and can never sort one: only GET lets it in. The triage desk reads it too and edits it below.
    if (!isDoxLane(auth) && !isTriageDeskLane(auth)) requireTriageOwner(auth);
    const { id } = await params;
    const card = await cardOr404(id);
    // The deal's items carry prices: Dox sees them only inside its project binding (the same rule as the deal read on the project routes).
    if (isDoxLane(auth) && card.project?.deal_detail && !(await mayReadDeal(auth, _request.headers, { projectId: card.project.project_id }))) {
      return NextResponse.json({ ...card, project: { ...card.project, deal_detail: null } });
    }
    return NextResponse.json(card);
  } catch (error) {
    return handleApiError(error);
  }
}

/** A calendar day, YYYY-MM-DD and a real date. Stored at noon UTC so it reads as the same day in every US zone. */
const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v), { message: 'That is not a real date.' });

const bodySchema = z
  .object({
    kind: z.enum(TRIAGE_KINDS).nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
    /** A project card's target start and launch dates, YYYY-MM-DD, or null to clear. They are the linked project's start_date and target_date. */
    target_start_date: dayString.nullable().optional(),
    target_launch_date: dayString.nullable().optional(),
  })
  .strict()
  .refine((v) => v.kind !== undefined || v.project_id !== undefined || v.target_start_date !== undefined || v.target_launch_date !== undefined, {
    message: 'Send kind, project_id, a target date, or any of them.',
  });

/**
 * PATCH /api/tasks/:id/triage   { kind?: project_setup|task|project_addition|reusable_tool|rule_proposal|question_only|null, project_id?: uuid|null, target_start_date?: YYYY-MM-DD|null, target_launch_date?: YYYY-MM-DD|null }
 * The two dates are the linked project's start_date and target_date; they need a project card (kind project_setup) with a project.
 * Sets what the card is and, for a project card, which project it sets up (the card takes the new project's client and site, even when it has no site; unlinking clears both). Triage cards
 * only; Mike's session or the chat lane only (403 for everyone else). Returns the card.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireTriageEditor(auth);
    const { id } = await params;
    const rawBody = await request.json();
    const body = bodySchema.parse(rawBody);
    const task = await prisma.task.findFirst({ where: { id, is_deleted: false }, select: { id: true, status: true, project_id: true, triage_kind: true, estimated_minutes: true, energy_estimate: true, mystery_factor: true, battery_impact: true, tags: true } });
    if (!task || task.status !== 'triage') throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
    // The triage desk may not change the dates of a project the portal shows.
    await guardDeskTriagePatch(auth, rawBody, task.project_id);
    const data: Record<string, unknown> = {};
    if (body.kind !== undefined) {
      data.triage_kind = body.kind;
      // A project setup card defaults to one hour (never over an estimate that is set; a defaulted hour goes when the kind moves away).
      const est = estimatePatchForKind(task.triage_kind, body.kind, { estimated_minutes: task.estimated_minutes, energy_estimate: task.energy_estimate, mystery_factor: task.mystery_factor, battery_impact: task.battery_impact, tags: task.tags });
      if (est) {
        Object.assign(data, est);
      }
    }
    if (body.project_id !== undefined) {
      if (body.project_id === null) {
        // Unlinking clears what the link set, so the card never keeps a project's client or site.
        data.project_id = null;
        data.client_id = null;
        data.site_id = null;
      } else {
        const p = await prisma.project.findFirst({ where: { id: body.project_id, is_deleted: false }, select: { id: true, client_id: true, site_id: true } });
        if (!p) throw new ApiError('That project does not exist.', 404, 'project_missing');
        data.project_id = p.id;
        data.client_id = p.client_id;
        // Always the new project's site, including none: the card must not keep the old project's site.
        data.site_id = p.site_id ?? null;
      }
    }
    // The dates live on the project (start_date, target_date). Only a project card, linked to a project, takes them.
    const datesGiven = body.target_start_date !== undefined || body.target_launch_date !== undefined;
    let dateProject: string | null = null;
    if (datesGiven) {
      const kind = body.kind !== undefined ? body.kind : task.triage_kind;
      dateProject = body.project_id !== undefined ? body.project_id : task.project_id;
      if (kind !== 'project_setup') throw new ApiError('Target dates are for a project card (kind project_setup).', 400, 'not_project_card');
      if (!dateProject) throw new ApiError('Link the card to a project first, then set its dates.', 409, 'no_project');
    }
    const actor = await actorOf(auth);
    const changed: string[] = [];
    if (body.kind !== undefined) changed.push('Kind');
    if (body.project_id !== undefined) changed.push('Project link');
    if (datesGiven) changed.push('Dates');
    const noon = (v: string | null | undefined) => (v ? new Date(`${v}T12:00:00Z`) : null);
    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: data as never });
      if (datesGiven && dateProject) {
        await tx.project.update({
          where: { id: dateProject },
          data: {
            ...(body.target_start_date !== undefined ? { start_date: noon(body.target_start_date) } : {}),
            ...(body.target_launch_date !== undefined ? { target_date: noon(body.target_launch_date) } : {}),
          },
        });
      }
      await recordTriageChange(tx, id, 'card', `${changed.join(' and ')} ${changed.length > 1 ? 'changed' : body.kind !== undefined ? 'set' : 'changed'} by ${actor.by}`, actor);
    });
    if (isTriageDeskLane(auth)) {
      const said = [
        body.kind !== undefined ? `set the kind to ${body.kind ?? 'not sorted'}` : null,
        body.project_id !== undefined ? (body.project_id === null ? 'unlinked the project' : 'linked a project') : null,
        body.target_start_date !== undefined ? `set the start date to ${body.target_start_date ?? 'none'}` : null,
        body.target_launch_date !== undefined ? `set the launch date to ${body.target_launch_date ?? 'none'}` : null,
      ].filter(Boolean);
      await recordSessionChange(auth.userId, id, said.join('; '));
    }
    return NextResponse.json(await cardOr404(id));
  } catch (error) {
    return handleApiError(error);
  }
}
