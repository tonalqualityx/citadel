import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { abandonJob, activeConversationCount, claimNextJob, expireStaleJobs, JOB_TYPES } from '@/lib/engine/queue';
import { accessForJob } from '@/lib/engine/reads';
import { buildContext, buildToolScope } from '@/lib/portal/chat/context';

const bodySchema = z.object({ types: z.array(z.enum(JOB_TYPES)).max(4).optional() }).default({});

// POST /api/engine/claim (portal phase C, engine scope)
// The oldest fresh queued job, claimed with a 120 second lease, with the context bundle and the
// tool scope. 204 when there is nothing to do. X-Engine-Active is the number of conversations with
// a client message in the last 5 minutes: the runner's poll pace.
export async function POST(request: NextRequest) {
  try {
    await requireEngine();
    const raw = await request.text();
    const body = bodySchema.parse(raw.trim() ? JSON.parse(raw) : {});

    await expireStaleJobs();
    const job = await claimNextJob({ types: body.types });
    const active = String(await activeConversationCount());
    const headers = { 'X-Engine-Active': active };
    if (!job) return new NextResponse(null, { status: 204, headers });

    const access = await accessForJob(job);
    if (!access || !job.conversation_id || !job.client_id || !job.contact_id) {
      await abandonJob(job.id, 'no_access');
      return new NextResponse(null, { status: 204, headers });
    }
    const convo = await prisma.chatConversation.findUnique({ where: { id: job.conversation_id }, select: { site_id: true } });
    const context = await buildContext(access, job.conversation_id);
    const scope = await buildToolScope(access, { id: job.id, client_id: job.client_id, contact_id: job.contact_id }, convo?.site_id);
    return NextResponse.json(
      {
        job: {
          id: job.id,
          type: job.type,
          attempts: job.attempts,
          conversation_id: job.conversation_id,
          task_id: job.task_id,
          lease_until: job.lease_until,
          payload: job.payload,
        },
        context,
        scope,
      },
      { headers }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
