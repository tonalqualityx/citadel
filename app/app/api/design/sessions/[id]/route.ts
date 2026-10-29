import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { latestLibIndex, projectChange, projectPin, projectSession, projectSessionTask, workerView } from '@/lib/design/projections';
import { onPresence } from '@/lib/design/presence';
import { authActor, type IdParams } from '@/lib/design/route-kit';

// GET /api/design/sessions/:id (design 7.1): the full workspace load. Designer (own), admin, pm (read).
export async function GET(_request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor({ operator: 'publish' }); // read-only for an operator-publish key
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'read' });

    const [task, site, pins, changes, state, libIndexEvent] = await Promise.all([
      prisma.task.findUnique({ where: { id: session.task_id }, select: { id: true, title: true, description: true, requirements: true } }),
      prisma.site.findUnique({ where: { id: session.site_id }, select: { name: true } }),
      prisma.designPin.findMany({ where: { session_id: session.id, status: { not: 'discarded' } }, orderBy: { created_at: 'asc' } }),
      prisma.designChange.findMany({ where: { session_id: session.id }, orderBy: { created_at: 'asc' } }),
      prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { last_heartbeat_at: true, paused: true } }),
      prisma.designEvent.findFirst({ where: { session_id: session.id, kind: 'lib_index' }, orderBy: { seq: 'desc' }, select: { payload: true } }),
    ]);
    const libIndex = latestLibIndex(libIndexEvent?.payload);

    // W2.7 hook: workspace open starts or resumes the automatic timer. An operator key is not a person in the
    // workspace: it never starts or keeps a timer.
    if (!actor.operator) await onPresence(session, true, actor);

    return NextResponse.json({
      session: projectSession(session),
      task: task ? projectSessionTask(task) : null,
      site: { name: site?.name ?? '' },
      pins: pins.map((p) => projectPin(p, libIndex)),
      changes: changes.map(projectChange),
      worker: { ...workerView(state), last_heartbeat_at: state?.last_heartbeat_at ?? null },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
