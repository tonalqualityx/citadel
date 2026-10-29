import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { isUuid } from '@/lib/design/helpers';
import { onProjectFolderChanged, resolveProjectFolder } from '@/lib/design/drive-share';
import { driveFolderBodySchema } from '@/lib/design/client-files';
import { authActor, body, guardMutation, requireAdmin, requireSessionVia, type IdParams } from '@/lib/design/route-kit';

// GET /api/design/admin/projects/:id (W6.9): read-only twin of PATCH so the admin form can show the current folder id.
// Admin, signed-in session. Answers { id, drive_folder_id }.
export async function GET(request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor();
    requireSessionVia(actor);
    requireAdmin(actor);
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Project not found', 404, 'not_found');
    const row = await prisma.project.findUnique({ where: { id }, select: { id: true, is_deleted: true, drive_folder_id: true } });
    if (!row || row.is_deleted) throw new ApiError('Project not found', 404, 'not_found');
    return NextResponse.json({ id: row.id, drive_folder_id: row.drive_folder_id });
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/design/admin/projects/:id (design 7.2, D11): the ONLY writer of project.drive_folder_id.
// Admin, signed-in session. { drive_folder_id: string | null } (null clears).
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    requireSessionVia(actor);
    requireAdmin(actor);
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Project not found', 404, 'not_found');
    const existing = await prisma.project.findUnique({ where: { id }, select: { id: true, is_deleted: true } });
    if (!existing || existing.is_deleted) throw new ApiError('Project not found', 404, 'not_found');
    const input = await body(request, driveFolderBodySchema, 4096);
    const before = await resolveProjectFolder(id);
    const row = await prisma.project.update({ where: { id }, data: { drive_folder_id: input.drive_folder_id }, select: { id: true, drive_folder_id: true } });
    // D11: designers assigned to the project get the new folder shared, the old one unshared.
    await onProjectFolderChanged(id, before, actor.userId);
    return NextResponse.json({ project: { id: row.id, drive_folder_id: row.drive_folder_id } });
  } catch (error) {
    return handleApiError(error);
  }
}
