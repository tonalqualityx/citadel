import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { canShareWithClient } from '@/lib/portal/share-reply';
import { checksSchema, shaSchema } from '@/lib/portal/receipts';
import { markLive, parseHttpUrl, SUMMARY_MAX } from '@/lib/portal/go-live';

const bodySchema = z.object({
  live_url: z.string().min(1).max(500),
  summary: z.string().max(SUMMARY_MAX).optional().nullable(),
  force: z.boolean().optional(),
  // Fleet item 5: the production build and the proof it was checked
  commit_sha: shaSchema.optional().nullable(),
  deploy_id: z.string().max(128).optional().nullable(),
  checks: checksSchema.optional(),
  live_check: z.record(z.string(), z.unknown()).optional().nullable(),
  force_reason: z.string().max(500).optional().nullable(),
});

// POST /api/tasks/:id/live - the client-approved change is live. Requires the client's approval
// (409 otherwise, unless force). Sets `done` + completed_at, posts the client-visible "this is
// live" line and sends the go-live email to the requester and anyone who wrote in the thread.
// Idempotent: a repeat call sends nothing. Worker/Bast or staff (pm, admin).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!canShareWithClient(auth)) throw new ApiError('Only the team leads can mark work live for the client.', 403, 'forbidden');
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const result = await markLive({
      taskId: id,
      authorId: auth.userId,
      liveUrl: parseHttpUrl('live_url', body.live_url),
      summary: body.summary ?? null,
      force: body.force === true,
      commitSha: body.commit_sha ?? null,
      deployId: body.deploy_id ?? null,
      checks: body.checks,
      liveCheck: body.live_check ?? null,
      forceReason: body.force_reason ?? null,
      callerRole: auth.role,
      claimToken: request.headers.get('x-claim-token'),
      claimCaller: { userId: auth.userId, role: auth.role, via: auth.via },
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
