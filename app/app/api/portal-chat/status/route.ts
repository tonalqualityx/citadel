import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { CAPS, daySince, spendSince } from '@/lib/portal/chat/caps';
import { getChatSettings, runnerState } from '@/lib/portal/chat/switches';

// GET /api/portal-chat/status (portal phase C; bot and admin)
// Mode, runner liveness (last claim), today's jobs and spend, and the caps. The portal-chat flag
// in flags.yaml calls this with the bot token.
export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const now = new Date();
    const since = daySince(now);
    const [settings, runner, grouped, spend] = await Promise.all([
      getChatSettings(),
      runnerState(now),
      prisma.engineJob.groupBy({ by: ['status'], where: { queued_at: { gte: since } }, _count: { _all: true } }),
      spendSince(since),
    ]);
    const jobs: Record<string, number> = { queued: 0, claimed: 0, done: 0, failed: 0, expired: 0 };
    for (const g of grouped) jobs[g.status] = g._count._all;
    return NextResponse.json({
      mode: settings.mode,
      pilot_contact_count: settings.pilot_contact_ids.length,
      runner: { last_seen_at: runner.last_seen_at, last_claim_at: runner.last_claim_at, dead: runner.dead },
      today: { jobs, spend_usd: Math.round(spend * 1e6) / 1e6 },
      caps: { daily_cap_usd: settings.daily_cap_usd, ...CAPS },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
