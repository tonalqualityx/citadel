import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { jobView, reportJob, type JobAction } from '@/lib/design/track-jobs';

const common = { runner_id: z.string().min(1).max(100).optional() };
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('renew'), ...common }).strict(),
  z.object({
    action: z.literal('done'), ...common, result: z.record(z.string(), z.unknown()).optional(),
    cost_usd: z.number().min(0).max(100000).optional(), log_asset_id: z.string().uuid().optional(),
  }).strict(),
  z.object({
    action: z.literal('failed'), ...common, error: z.string().max(8000).optional(),
    cost_usd: z.number().min(0).max(100000).optional(), log_asset_id: z.string().uuid().optional(),
  }).strict(),
]);

// PATCH /api/design/runner/jobs/:id {action: renew | done | failed, ...} (SPEC 6.1a). A `done` for a job that adopts a
// branch is 409 adopt_pending: it closes when its adopt command completes.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTrackRunner();
    const id = idParam((await params).id, 'Job not found');
    const b = await workerBody(request, schema, 512 * 1024);
    const job = await reportJob(id, b as JobAction & { runner_id?: string }, auth.userId);
    return NextResponse.json({ job: jobView(job) });
  } catch (error) {
    return handleApiError(error);
  }
}
