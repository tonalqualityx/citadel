import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeBrief } from '@/lib/engagement/serialize';
import { z } from 'zod';
import { CADENCES, OWNER_MODES, REPORT_FIELDS, reportPatchShape } from '@/lib/engagement/brief';
import { isChatLane } from '@/lib/tasks/questions';
import { guardDoxBriefReportPatch, isDoxLane } from '@/lib/dox/guard';
import type { Prisma } from '@prisma/client';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { isMikeOwnKey } from '@/lib/services/task-patch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/engagement-briefs/[id]. pm or admin. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const row = await prisma.engagementBrief.findUnique({ where: { id } });
    if (!row) throw new ApiError('Brief not found', 404);
    return NextResponse.json(serializeBrief(row, row.project_id ? await prisma.project.findUnique({ where: { id: row.project_id }, select: { status: true } }) : null));
  } catch (error) {
    return handleApiError(error);
  }
}

const patchSchema = z
  .object({ cadence: z.enum(CADENCES).optional(), owner_mode: z.enum(OWNER_MODES).optional(), ...reportPatchShape })
  .strict()
  .refine((b) => b.cadence !== undefined || b.owner_mode !== undefined || REPORT_FIELDS.some((k) => b[k] !== undefined), {
    message: 'Send cadence, owner_mode, a report field, or any of them.',
  });

/**
 * PATCH /api/engagement-briefs/[id]: change how often a brief's project is swept (`cadence`), whether Dox only records (`dry`), acts (`live`) or
 * stays away (`off`) (`owner_mode`), and the client report fields (`report_cadence` none|weekly|every_2_weeks|monthly, `report_day` mon..sun,
 * `report_to` emails, `report_source`). The owner's own signed-in session, the owner's own un-laned key or the owner's chat lane set any of them; with no `report_source` they are
 * recorded as Mike's. The Dox lane sets the three report fields only, with a quoted source (lib/dox/guard.ts guardDoxBriefReportPatch); it is refused
 * `cadence` and `owner_mode`. Bumps `version`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const dox = isDoxLane(auth);
    // Mike's own un-laned key (his standalone work sessions) counts as the owner here (Mike, 2026-11-14: sessions must be able to make these changes).
    const owner = (auth.via !== 'api_key' && auth.userId === MIKE_USER_ID) || isMikeOwnKey(auth);
    if (!dox && !owner && !isChatLane(auth)) throw new ApiError('Only the owner and the owner\'s chat change a brief\'s mode, cadence or client report.', 403, 'brief_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const raw = await request.json();
    const existing = await prisma.engagementBrief.findUnique({ where: { id } });
    if (!existing) throw new ApiError('Brief not found', 404);
    let body: z.infer<typeof patchSchema>;
    if (dox) {
      body = patchSchema.parse(await guardDoxBriefReportPatch(auth, request.headers, raw, existing));
    } else {
      body = patchSchema.parse(raw);
    }
    const touchesReport = REPORT_FIELDS.some((k) => body[k] !== undefined);
    const nextCadence = body.report_cadence ?? existing.report_cadence;
    const nextDay = body.report_day !== undefined ? body.report_day : existing.report_day;
    if (touchesReport && nextCadence !== 'none' && !nextDay) throw new ApiError('A client report needs a day (report_day).', 422, 'report_day_required');
    const now = new Date();
    const source = touchesReport
      ? { ...(body.report_source ?? { kind: 'mike', label: "Mike's words" }), at: now.toISOString(), by: auth.userId }
      : undefined;
    const row = await prisma.engagementBrief.update({
      where: { id },
      data: {
        ...(body.cadence !== undefined ? { cadence: body.cadence } : {}),
        ...(body.owner_mode !== undefined ? { owner_mode: body.owner_mode } : {}),
        ...(body.report_cadence !== undefined ? { report_cadence: body.report_cadence } : {}),
        ...(body.report_day !== undefined ? { report_day: body.report_day } : {}),
        ...(body.report_to !== undefined ? { report_to: body.report_to } : {}),
        ...(source ? { report_source: source as Prisma.InputJsonValue } : {}),
        version: { increment: 1 },
      },
    });
    const project = row.project_id ? await prisma.project.findUnique({ where: { id: row.project_id }, select: { status: true } }) : null;
    return NextResponse.json(serializeBrief(row, project));
  } catch (error) {
    return handleApiError(error);
  }
}
