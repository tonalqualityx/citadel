import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireWorker, workerBody } from '@/lib/design/worker-kit';
import { recordHeartbeat } from '@/lib/design/heartbeat';

const schema = z.object({
  version: z.string().max(40).optional(),
  sdk_version: z.string().max(40).optional(),
  paused: z.boolean().optional(),
  pause_reason: z.string().max(100).nullish(),
  configured_site_ids: z.array(z.string().uuid()).max(500),
  site_main_roles: z.record(z.string().uuid(), z.string().max(40)).optional(),
  site_live_urls: z.record(z.string().uuid(), z.string().url().max(500)).optional(),
  sessions: z.array(z.object({ id: z.string().uuid(), alive: z.boolean().optional(), status: z.string().max(30).optional() })).max(100).optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireWorker();
    return NextResponse.json(await recordHeartbeat(await workerBody(request, schema)));
  } catch (error) {
    return handleApiError(error);
  }
}
