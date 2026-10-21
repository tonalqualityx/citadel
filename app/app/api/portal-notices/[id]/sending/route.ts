import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { claimNotice } from '@/lib/portal/notices';

// PUT /api/portal-notices/:id/sending (portal phase B slice 2)
// The sender's claim, called BEFORE the email is handed to gog: queued -> sending, and
// send_attempt_at stamped. Mirrors PUT /api/approval-requests/:id/sending with two differences:
//  - The claim re-checks the notice under the same advisory lock the queue uses. If every reply was
//    withdrawn in the hold, or the recipient no longer has access to the request, the notice is
//    cancelled and the claim answers 409 so the sender skips it.
//  - The answer carries to_email, subject and body as they stand NOW. The sender sends those, never
//    the copy from its earlier list call: a reply folded in after the list is in this body.
// A notice not claimed here is never sent, and one that is not 'queued' answers 409.
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const claim = await claimNotice(id);
    if (!claim.ok) {
      if (claim.reason === 'not_found') throw new ApiError('Notice not found', 404);
      const why: Record<string, string> = {
        not_queued: 'Notice is not queued (another sender took it, or it was cancelled). Cannot claim it for sending.',
        withdrawn: 'Every reply in this notice was withdrawn during the hold. It is cancelled.',
        no_access: 'The recipient no longer has access to this request. The notice is cancelled.',
      };
      throw new ApiError(why[claim.reason], 409, claim.reason);
    }
    const n = claim.notice;
    return NextResponse.json({
      id: n.id,
      status: n.status,
      send_attempt_at: n.send_attempt_at,
      to_email: n.to_email,
      subject: n.subject,
      body: n.body,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
