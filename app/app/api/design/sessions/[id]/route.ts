import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { projectChange, projectPin, projectSession, projectSessionTask, workerView } from '@/lib/design/projections';
import { onPresence } from '@/lib/design/presence';
import { authActor, type IdParams } from '@/lib/design/route-kit';

// GET /api/design/sessions/:id (design 7.1): the full workspace load. Designer (own), admin, pm (read).
export async function GET(_request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'read' });

    const [task, site, pins, changes, state] = await Promise.all([
      prisma.task.findUnique({ where: { id: session.task_id }, select: { id: true, title: true, description: true, requirements: true } }),
      prisma.site.findUnique({ where: { id: session.site_id }, select: { name: true } }),
      prisma.designPin.findMany({ where: { session_id: session.id, status: { not: 'discarded' } }, orderBy: { created_at: 'asc' } }),
      prisma.designChange.findMany({ where: { session_id: session.id }, orderBy: { created_at: 'asc' } }),
      prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { last_heartbeat_at: true, paused: true } }),
    ]);

    // W2.7 hook: workspace open starts or resumes the automatic timer (no-op until then).
    await onPresence(session, true, actor);

    return NextResponse.json({
      session: projectSession(session),
      task: task ? projectSessionTask(task) : null,
      site: { name: site?.name ?? '' },
      pins: pins.map(projectPin),
      changes: changes.map(projectChange),
      worker: { ...workerView(state), last_heartbeat_at: state?.last_heartbeat_at ?? null },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
