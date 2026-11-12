import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { parseTargetKey } from '@/lib/work/keys';
import { STATE_LANES, requireWorkCaller } from '@/lib/work/route-auth';
import { workState } from '@/lib/work/state';
import { resolveUserTimezone } from '@/lib/services/user-timezone';

/**
 * Work stage D: GET /api/work/:target_key/state, the one derived state of a project or a task and everything attached to it.
 * `target_key` is `project:<uuid>` or `task:<uuid>`. The owner's session, or the bast, oracle, bast-chat and porter lanes. Read only.
 * 200 {target_key, type, id, name, href, status, state, since, line, attached[], evidence[], live_session}; 404 when it does not exist.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, STATE_LANES);
    const key = decodeURIComponent((await params).key);
    if (!parseTargetKey(key)) throw new ApiError('A target key is project:<id> or task:<id>.', 400, 'bad_target');
    const zone = auth.role === 'admin' ? await resolveUserTimezone(auth.userId) : undefined;
    const report = await workState(prisma, key, { zone });
    if (!report) throw new ApiError('That project or task does not exist.', 404, 'target_missing');
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
