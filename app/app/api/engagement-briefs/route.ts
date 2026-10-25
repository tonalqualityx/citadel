import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { briefInputSchema } from '@/lib/engagement/brief';
import { serializeBrief } from '@/lib/engagement/serialize';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/engagement-briefs: list briefs; ?project_id= or ?charter_id= narrows. pm or admin. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const sp = new URL(request.url).searchParams;
    const project = sp.get('project_id');
    const charter = sp.get('charter_id');
    if ((project && !UUID.test(project)) || (charter && !UUID.test(charter))) throw new ApiError('Bad id', 400);
    const rows = await prisma.engagementBrief.findMany({
      where: { ...(project ? { project_id: project } : {}), ...(charter ? { charter_id: charter } : {}) },
      orderBy: { created_at: 'asc' },
      take: 200,
    });
    return NextResponse.json({ briefs: rows.map(serializeBrief) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/engagement-briefs: create or replace the brief for a project or a charter. The unit is
 * the engagement (project_id, else charter_id), so a second PUT is an update and bumps `version`.
 * A brief the owner pass reads and can act on; pm or admin only.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const b = briefInputSchema.parse(await request.json());

    let clientId = b.client_id ?? null;
    if (b.project_id) {
      const p = await prisma.project.findUnique({ where: { id: b.project_id }, select: { client_id: true } });
      if (!p) throw new ApiError('Project not found', 404);
      clientId = p.client_id;
    }
    if (b.charter_id) {
      const c = await prisma.charter.findUnique({ where: { id: b.charter_id }, select: { client_id: true, is_deleted: true } });
      if (!c || c.is_deleted) throw new ApiError('Charter not found', 404);
      if (!clientId) clientId = c.client_id;
    }

    const where = b.project_id ? { project_id: b.project_id } : { charter_id: b.charter_id! };
    const existing = await prisma.engagementBrief.findUnique({ where });
    const data = {
      client_id: clientId,
      project_id: b.project_id ?? null,
      charter_id: b.charter_id ?? null,
      label: b.label,
      goal: b.goal ?? '',
      sources: (b.sources ?? []) as Prisma.InputJsonValue,
      scope: (b.scope ?? {}) as Prisma.InputJsonValue,
      allowed_actions: b.allowed_actions ?? [],
      release_owner_role: b.release_owner_role ?? 'pm',
      stall_rules: (b.stall_rules ?? {}) as Prisma.InputJsonValue,
      owner_mode: b.owner_mode ?? 'off',
      cadence: b.cadence ?? 'weekly',
    };
    const row = existing
      ? await prisma.engagementBrief.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
      : await prisma.engagementBrief.create({ data: { ...data, created_by_id: auth.userId } });
    return NextResponse.json(serializeBrief(row), { status: existing ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
