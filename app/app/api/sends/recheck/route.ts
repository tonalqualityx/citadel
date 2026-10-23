import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { parseGovern } from '@/lib/sends/govern';
import { decideSend } from '@/lib/sends/policy';
import { claimNotice, releaseNotice } from '@/lib/sends/recheck';

// release:true (with claim and claim_token) gives a claim back when the guarded send did not go out.
// probe:true leaves no 'Send dropped' comment (post-deploy probes). send_recheck_mode=off skips the check
// but NOT claims; turning claims off means reverting the deploy.
// POST: the send-time recheck for a send that does not go through the outbox (a worker's reply on the
// client's own email thread, a preview note). Body: { govern, claim?: 'live'|'preview', claim_token?: string }.
// Returns { ok, reason, severity, claimed? }. When `claim` is passed and the check passes, the notice is
// claimed in the same call: claimed:true means this caller is the first to tell the client, claimed:false
// means somebody else already did, and the caller must not send. `claim_token` is the preview url for
// claim 'preview'. pm/admin only.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = (await request.json().catch(() => null)) as { govern?: unknown; claim?: unknown; claim_token?: unknown; release?: unknown; probe?: unknown } | null;
    const govern = parseGovern(body?.govern);
    if (!govern) throw new ApiError('A valid govern block is required', 400, 'bad_govern');
    const claim = body?.claim;
    if (claim !== undefined && claim !== null && claim !== 'live' && claim !== 'preview') throw new ApiError("claim must be 'live' or 'preview'", 400, 'bad_claim');
    const token = typeof body?.claim_token === 'string' ? body.claim_token : null;
    if (claim === 'preview' && !token) throw new ApiError('claim_token (the preview url) is required for claim preview', 400, 'bad_claim');
    if (claim && !('task_id' in govern)) throw new ApiError('A claim needs a govern block with a task_id', 400, 'bad_claim');

    if (body?.release === true) {
      if (!claim || !('task_id' in govern)) throw new ApiError('release needs claim and a govern block with a task_id', 400, 'bad_claim');
      const released = await releaseNotice(govern.task_id, claim, token);
      return NextResponse.json({ ok: true, released });
    }

    const decision = await decideSend(govern, null, { probe: body?.probe === true });
    if (!decision.ok) {
      return NextResponse.json({ ok: false, reason: decision.reason, severity: decision.severity, mode: decision.mode, ...(claim ? { claimed: false } : {}) });
    }
    const out: Record<string, unknown> = { ok: true, mode: decision.mode };
    if (decision.would_drop) out.would_drop = decision.would_drop;
    if (claim && 'task_id' in govern) {
      const claimed = await claimNotice(govern.task_id, claim, token);
      out.claimed = claimed;
      if (!claimed) {
        out.ok = false;
        out.reason = 'already_notified';
        out.severity = 'definitive';
      }
    }
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
