import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';
import { EmailAskState, Prisma } from '@prisma/client';

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
  // Work stage B: the asks he put back with Undo (decided_by=mike), newest decision first, for the classifier's calibration examples. Subject and reason only are read machine-side.
  decided_by: z.enum(['mike']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // Paging and search (2026-11-18, the chat's owed-email list): skip this many of the newest first;
  // `from` matches the sender's name or address, `subject` needs every word in the subject (any case),
  // and received_after (on or after) / received_before (strictly before) bound received_at. A date
  // with no time is midnight UTC.
  offset: z.coerce.number().int().min(0).max(100000).optional(),
  from: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  received_after: z.coerce.date().optional(),
  received_before: z.coerce.date().optional(),
});

/** The words of a subject search, at most 8, each matched anywhere in the subject. */
function subjectWords(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, 8);
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const parsed = queryParamsSchema.parse({
      state: searchParams.get('state') ?? undefined,
      account: searchParams.get('account') ?? undefined,
      calendar_requested: searchParams.get('calendar_requested') ?? undefined,
      decided_by: searchParams.get('decided_by') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      subject: searchParams.get('subject') ?? undefined,
      received_after: searchParams.get('received_after') ?? undefined,
      received_before: searchParams.get('received_before') ?? undefined,
    });

    const received: Prisma.DateTimeFilter = {
      ...(parsed.received_after !== undefined && { gte: parsed.received_after }),
      ...(parsed.received_before !== undefined && { lt: parsed.received_before }),
    };
    const words = parsed.subject !== undefined ? subjectWords(parsed.subject) : [];
    const where: Prisma.EmailAskWhereInput = {
      ...(parsed.state !== undefined && { state: parsed.state }),
      ...(parsed.account !== undefined && { account: parsed.account }),
      ...(parsed.calendar_requested === 'true' && { calendar_requested: true }),
      ...(parsed.decided_by !== undefined && { decided_by: parsed.decided_by }),
      ...(Object.keys(received).length > 0 && { received_at: received }),
      ...(parsed.from !== undefined && {
        OR: [
          { from_name: { contains: parsed.from, mode: 'insensitive' } },
          { from_email: { contains: parsed.from, mode: 'insensitive' } },
        ],
      }),
      ...(words.length > 0 && { AND: words.map((w) => ({ subject: { contains: w, mode: 'insensitive' as const } })) }),
    };
    const paged = parsed.limit !== undefined || parsed.offset !== undefined;

    const asks = await prisma.emailAsk.findMany({
      where,
      // A page needs a stable order, so ties on received_at break by id.
      orderBy: paged ? [{ received_at: 'desc' }, { id: 'desc' }] : { received_at: 'desc' },
      ...(parsed.limit !== undefined && { take: parsed.limit }),
      ...(parsed.offset !== undefined && parsed.offset > 0 && { skip: parsed.offset }),
    });
    // total is every matching ask, not just this page; offset and returned say where the page sits.
    const total = paged ? await prisma.emailAsk.count({ where }) : asks.length;
    const offset = parsed.offset ?? 0;

    return NextResponse.json({
      asks: asks.map(formatEmailAskResponse),
      meta: { total, offset, returned: asks.length, remaining: Math.max(0, total - offset - asks.length) },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
