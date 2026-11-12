import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { parseTargetKey } from '@/lib/work/keys';
import { SESSION_ID_RE, SESSION_LANES, attachedByFor, requireWorkCaller } from '@/lib/work/route-auth';
import { DELIVERABLES_MAX, trackFromSession } from '@/lib/work/session-track';
import { mayOverride, trackedResponse } from '@/lib/work/tracked';

/**
 * Work stage E: POST /api/oracle/sessions/:id/track, the owner said yes to "Track this?" in the session.
 *
 * Body (strict): {title, project_target: project:<id> | null, deliverables: [...], create_anyway?}. Through the guard: when work already
 * carries this session, 200 {already_tracked: true, ...} and nothing is created. Otherwise a task assigned to the owner (a project when
 * there are several deliverables and the session's client is known) is made, with the session attached. A named live project takes the
 * deliverables as its tasks. 200 {result: tracked, target_key, name, href, project_id, task_ids, action_id}, or {skipped: "home_off"}.
 * 409 target_finished for a project that is finished, 409 no_client when a project is needed and no client is known. `create_anyway`
 * is honoured for the owner's own session only, never a machine lane. One Handled line with Undo (72 hours). The oracle lane, and
 * the owner's session.
 * Work stage F: optional estimated_minutes (0 to 1440, or null) and estimate_basis (what it was inferred from) store one mike_estimate clock row on
 * the new work; the answer carries clock_id and estimated_minutes. It is an estimate only: no time entry is made.
 */
const bodySchema = z
  .object({
    title: z.string().min(1).max(400),
    project_target: z.string().refine((k) => parseTargetKey(k) !== null, 'A project key is project:<id>').nullable(),
    deliverables: z.array(z.string().min(1).max(400)).max(DELIVERABLES_MAX),
    create_anyway: z.boolean().optional(),
    estimated_minutes: z.number().int().min(0).max(1440).nullable().optional(),
    estimate_basis: z.string().max(240).nullable().optional(),
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, SESSION_LANES);
    const { id } = await params;
    if (!SESSION_ID_RE.test(id)) throw new ApiError('Not found', 404, 'not_found');
    const body = bodySchema.parse(await request.json());
    const out = await trackFromSession(prisma, {
      ref: id,
      title: body.title,
      project_target: body.project_target,
      deliverables: body.deliverables,
      create_anyway: mayOverride(auth, body.create_anyway),
      estimated_minutes: body.estimated_minutes ?? null,
      estimate_basis: body.estimate_basis ?? null,
      attached_by: attachedByFor(auth),
    });
    if (out.result === 'already_tracked') return trackedResponse(prisma, out.handled, { kind: 'session', ref: id });
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
