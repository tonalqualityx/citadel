import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { isLive } from '@/lib/engine/queue';
import { accessForJob, isReadKind, runRead } from '@/lib/engine/reads';

const uuid = z.string().uuid();

// GET /api/engine/jobs/:id/read/:kind (portal phase C, engine scope)
// The `citadel_read` tool: exactly what the portal shows the job's contact, from the portal's own
// loaders, under that contact's own access. Valid only while the job is claimed and unexpired.
// kind: requests | work_item (?task_id) | projects | project (?project_id) | retainer | history (?days) | reports | invoices | site_pages (?site_id, ?q)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    await requireEngine();
    const p = await params;
    const id = uuid.safeParse(p.id);
    if (!id.success) throw new ApiError('Not found', 404);
    if (!isReadKind(p.kind)) throw new ApiError('Unknown read kind', 400);

    const job = await prisma.engineJob.findUnique({ where: { id: id.data } });
    if (!job) throw new ApiError('Not found', 404);
    if (!isLive(job)) throw new ApiError('Job is not live', 409);

    const access = await accessForJob(job);
    if (!access) throw new ApiError('The contact has no access to this client', 403);

    const sp = new URL(request.url).searchParams;
    const taskId = sp.get('task_id');
    const projectId = sp.get('project_id');
    if (taskId && !uuid.safeParse(taskId).success) throw new ApiError('Invalid task_id', 400);
    if (projectId && !uuid.safeParse(projectId).success) throw new ApiError('Invalid project_id', 400);
    const siteId = sp.get('site_id');
    if (siteId && !uuid.safeParse(siteId).success) throw new ApiError('Invalid site_id', 400);
    const days = sp.get('days');
    const data = await runRead(access, p.kind, { task_id: taskId, project_id: projectId, days: days ? Number(days) : null, site_id: siteId, q: sp.get('q') });
    return NextResponse.json({ kind: p.kind, data });
  } catch (error) {
    return handleApiError(error);
  }
}
