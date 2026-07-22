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
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const parsed = queryParamsSchema.parse({
      state: searchParams.get('state') ?? undefined,
      account: searchParams.get('account') ?? undefined,
    });

    const asks = await prisma.emailAsk.findMany({
      where: {
        ...(parsed.state !== undefined && { state: parsed.state }),
        ...(parsed.account !== undefined && { account: parsed.account }),
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
