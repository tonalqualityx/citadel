import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireHomeUser } from '@/lib/home/gate';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { parseTargetKey } from '@/lib/work/keys';
import { loadClockSummary } from '@/lib/work/clocks';
import { resolveUserTimezone } from '@/lib/services/user-timezone';

/**
 * Work stage F: GET /api/work/:target_key/clocks, the two lines the owner sees on a project drawer or a task card.
 * `target_key` is `project:<uuid>` or `task:<uuid>`. His browser session only (requireHomeUser refuses every API key, so no machine lane
 * and no client surface can read it). Read only. 200 {target_key, month_start, mike: {...} | null, bast: {...} | null}.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const auth = await requireHomeUser();
    const key = decodeURIComponent((await params).key);
    const t = parseTargetKey(key);
    if (!t) throw new ApiError('A target key is project:<id> or task:<id>.', 400, 'bad_target');
    const exists = t.type === 'task' ? await prisma.task.findUnique({ where: { id: t.id }, select: { id: true } }) : await prisma.project.findUnique({ where: { id: t.id }, select: { id: true } });
    if (!exists) throw new ApiError('That project or task does not exist.', 404, 'target_missing');
    const zone = await resolveUserTimezone(auth.userId);
    const out = await loadClockSummary(prisma, `${t.type}:${t.id}`, new Date(), zone);
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
