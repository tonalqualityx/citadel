import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { heartbeatJob } from '@/lib/engine/queue';

// POST /api/engine/jobs/:id/heartbeat (portal phase C, engine scope)
// Extends the lease by 60 seconds, at most twice. 409 once the job is no longer claimed and live.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEngine();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const res = await heartbeatJob(id.data);
    if (!res.ok) {
      if (res.reason === 'not_found') throw new ApiError('Not found', 404);
      throw new ApiError(res.reason === 'limit' ? 'Lease already extended twice' : 'Job is not live', 409);
    }
    return NextResponse.json({ lease_until: res.lease_until });
  } catch (error) {
    return handleApiError(error);
  }
}
