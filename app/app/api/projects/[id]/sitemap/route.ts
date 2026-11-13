import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { isDoxLane, requireProjectInPlay } from '@/lib/dox/guard';
import { requireTriageOwner } from '@/lib/tasks/triage-auth';
import { actorOf } from '@/lib/tasks/triage-rev';
import { applySitemapPatch, assertSitemapOpen, recordSitemapChanges, sitemapPatchSchema } from '@/lib/projects/sitemap';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/projects/:id/sitemap   { add?: [{name, page_type?, needs_design?, notes?}], change?: [{id, name?, page_type?, needs_design?, notes?}], drop?: [id], source?: {kind, label, quote?, dated?} }
 * Item-level sitemap edits on a project in any status but done or cancelled: pages not named are left exactly as they are. Mike's session, the
 * chat lane, or Dox inside his binding (x-dox-project header, the project live, an open pass). A dropped page deletes only its own row: no task or other
 * row holds a page id, and the open tasks that name the page stay (the reply says how many). One change line per page lands on the project's setup
 * card(s), with the optional source. The client portal showing the project does not matter here.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    if (isDoxLane(auth)) await requireProjectInPlay(request.headers, id);
    else requireTriageOwner(auth);
    const body = sitemapPatchSchema.parse(await request.json());
    const project = await prisma.project.findFirst({ where: { id, is_deleted: false }, select: { id: true, status: true } });
    if (!project) throw new ApiError('Project not found', 404);
    assertSitemapOpen(project.status);
    const actor = await actorOf(auth);
    const result = await prisma.$transaction(async (tx) => {
      const r = await applySitemapPatch(tx, id, body);
      await recordSitemapChanges(tx, id, r.lines, actor, body.source);
      return r;
    });
    return NextResponse.json({ ...result, changed: result.lines.map((l) => l.line) });
  } catch (error) {
    return handleApiError(error);
  }
}
