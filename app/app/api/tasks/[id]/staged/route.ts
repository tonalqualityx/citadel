import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { canShareWithClient } from '@/lib/portal/share-reply';
import { markStaged, parseHttpUrl, STAGED_NOTE_MAX } from '@/lib/portal/go-live';

const bodySchema = z.object({
  preview_url: z.string().min(1).max(500),
  note: z.string().max(STAGED_NOTE_MAX).optional().nullable(),
});

// POST /api/tasks/:id/staged - the change is staged and waits for the client's yes.
// Sets status `review`, stores the preview url, posts the client-visible "ready for your review"
// line and sends the approval email to the portal requester. Worker/Bast or staff (pm, admin).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!canShareWithClient(auth)) throw new ApiError('Only the team leads can stage work for the client.', 403, 'forbidden');
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const result = await markStaged({
      taskId: id,
      authorId: auth.userId,
      previewUrl: parseHttpUrl('preview_url', body.preview_url),
      note: body.note ?? null,
      claimToken: request.headers.get('x-claim-token'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
