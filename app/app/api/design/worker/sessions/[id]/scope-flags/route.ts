import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { createFollowupTask } from '@/lib/design/followups';

const schema = z
  .object({
    title: z.string().min(1).max(200),
    detail: z.string().max(4000).default(''),
    pin_ids: z.array(z.string().uuid()).max(30).default([]),
    asset_ids: z.array(z.string().uuid()).max(10).default([]),
    project_id: z.string().uuid().optional(),
    assign_to_designer: z.boolean().optional(),
  })
  .strict();

// flag_scope, re-purposed as a follow-up note (D5). The server builds the task; the lane creates no other kind.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const b = await workerBody(request, schema);
    const session = await prisma.designSession.findUnique({ where: { id }, select: { designer_id: true } });
    if (!session) throw new ApiError('Session not found', 404, 'not_found');
    const r = await createFollowupTask({
      sessionId: id, title: b.title, detail: b.detail, pinIds: b.pin_ids, assetIds: b.asset_ids, projectId: b.project_id ?? null,
      designerId: session.designer_id, assignToDesigner: b.assign_to_designer, createdById: auth.userId,
    });
    return NextResponse.json({ task_id: r.task_id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
