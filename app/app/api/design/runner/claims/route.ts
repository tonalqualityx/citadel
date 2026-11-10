import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { workerBody } from '@/lib/design/worker-kit';
import { claimJob, jobView } from '@/lib/design/track-jobs';
import { loadTrack } from '@/lib/design/track-core';
import { trackView } from '@/lib/design/track-runner';
import { prisma } from '@/lib/db/prisma';

const KINDS = [
  'provision', 'research', 'capture', 'process_upload', 'brief', 'wireframe', 'home_build', 'rest_build', 'module',
  'bulk_import', 'launch_readiness', 'client_brief_email', 'client_review_email', 'fact_fix',
] as const;
const schema = z.object({ runner_id: z.string().min(1).max(100), kinds: z.array(z.enum(KINDS)).max(KINDS.length).optional() }).strict();

// POST /api/design/runner/claims {runner_id, kinds?} (SPEC 6.1a): 200 with the oldest claimable job, 204 when none.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireTrackRunner();
    const b = await workerBody(request, schema, 8 * 1024);
    const job = await claimJob({ userId: auth.userId, runnerId: b.runner_id, kinds: b.kinds });
    if (!job) return new NextResponse(null, { status: 204 });
    const track = await loadTrack(prisma, job.track_id);
    return NextResponse.json({ job: jobView(job), track: trackView(track) });
  } catch (error) {
    return handleApiError(error);
  }
}
