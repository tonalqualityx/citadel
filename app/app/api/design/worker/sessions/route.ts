import { NextRequest, NextResponse } from 'next/server';
import type { DesignSessionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireWorker, workerSessionView } from '@/lib/design/worker-kit';
import { SESSION_STATUSES, isTerminalStatus } from '@/lib/design/sessions';

const LIVE = SESSION_STATUSES.filter((s) => !isTerminalStatus(s));

// Startup reconcile: the non-terminal sessions Citadel believes are live.
export async function GET(request: NextRequest) {
  try {
    await requireWorker();
    const raw = new URL(request.url).searchParams.get('status');
    let statuses: DesignSessionStatus[] = LIVE;
    if (raw) {
      const asked = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (asked.length === 0 || !asked.every((s) => (LIVE as string[]).includes(s))) {
        throw new ApiError('status must be a comma-separated list of non-terminal session statuses', 400, 'bad_status');
      }
      statuses = asked as DesignSessionStatus[];
    }
    const rows = await prisma.designSession.findMany({ where: { status: { in: statuses } }, orderBy: { created_at: 'asc' }, take: 500 });
    return NextResponse.json({ sessions: rows.map((s) => workerSessionView(s)) });
  } catch (error) {
    return handleApiError(error);
  }
}
