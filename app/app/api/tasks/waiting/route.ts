import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { listWaiting } from '@/lib/tasks/waiting';

const querySchema = z.object({
  due: z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// GET /api/tasks/waiting?due=1 - open cards marked waiting on someone, soonest follow-up first (task 23cd54cf).
// due=1 keeps only the ones whose follow-up time has passed with no follow-up sent: the follow-up job's list.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const sp = new URL(request.url).searchParams;
    const q = querySchema.parse({ due: sp.get('due') ?? undefined, limit: sp.get('limit') ?? undefined });
    const tasks = await listWaiting({ due: q.due, limit: q.limit });
    return NextResponse.json({ tasks, total: tasks.length });
  } catch (error) {
    return handleApiError(error);
  }
}
