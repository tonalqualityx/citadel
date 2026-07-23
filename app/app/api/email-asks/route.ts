import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';
import { EmailAskState } from '@prisma/client';

// Clarity Phase 4b — machine-side read for the (staged, not-cron-wired) classifier: fetch
// pending archive intents (state=archive_requested) so it can execute the actual Gmail
// archive on its next pass, plus a general list/filter surface for the same purpose later.
// Bearer auth via requireAuth() — same util as /api/oracle/email-sync and
// /api/session-tasks (cookie session OR API key, no bot-only restriction, no role gate —
// matches email-sync's own pattern for this same machine-side classifier).
const queryParamsSchema = z.object({
  state: z.nativeEnum(EmailAskState).optional(),
  account: z.string().min(1).max(255).optional(),
  // Clarity Phase 6 — the machine-side calendar executor's read: pending Add-to-calendar
  // requests it needs to act on. Only `true` is meaningful here (there's no un-request
  // action to filter for), so this deliberately doesn't accept `false`.
  calendar_requested: z.enum(['true']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const parsed = queryParamsSchema.parse({
      state: searchParams.get('state') ?? undefined,
      account: searchParams.get('account') ?? undefined,
      calendar_requested: searchParams.get('calendar_requested') ?? undefined,
    });

    const asks = await prisma.emailAsk.findMany({
      where: {
        ...(parsed.state !== undefined && { state: parsed.state }),
        ...(parsed.account !== undefined && { account: parsed.account }),
        ...(parsed.calendar_requested === 'true' && { calendar_requested: true }),
      },
      orderBy: { received_at: 'desc' },
    });

    return NextResponse.json({
      asks: asks.map(formatEmailAskResponse),
      meta: { total: asks.length },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
