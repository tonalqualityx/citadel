import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { loadWorkerTrackedSession, patchDirectionAsWorker } from '@/lib/design/worker-context';

const schema = z.object({ patch: z.record(z.string(), z.unknown()), base_version: z.number().int().min(0).max(10_000).optional() }).strict();

// PATCH /api/design/worker/sessions/:id/art-direction (SPEC 5.1): `{patch, base_version?}`, a JSON merge patch on the open
// draft, validated like the designer route. 409 direction_signed on a signed version, 409 version_moved on a stale base.
// This module has no sign and no revise handler: the worker can never freeze or reopen a direction.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const { track } = await loadWorkerTrackedSession(id);
    const input = await workerBody(request, schema);
    return NextResponse.json({ direction: await patchDirectionAsWorker(track.id, input) });
  } catch (error) {
    return handleApiError(error);
  }
}
