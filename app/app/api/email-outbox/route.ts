import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { OWED_REPLY_KIND } from '@/lib/sends/govern';

// Outbox listing for the Bast-machine drain (~/.claude/tools/citadel-mail/drain_outbox.py).
// pm/admin API key only. Unsent rows, oldest first, max 50.
//
// Home Slice 4b: the default listing never includes an owed_reply row (Mike's "Send the draft"; the courier drain sends
// as bast@ and must never see it). Only `?kind=owed_reply` lists them, and then only the rows whose 10-minute hold has ended.
const SELECT = {
  id: true,
  to: true,
  cc: true,
  subject: true,
  kind: true,
  from_account: true,
  allow_external: true,
  attempts: true,
  claimed_at: true,
  created_at: true,
  last_error: true,
  reply_to: true,
  task_id: true,
} as const;

export async function GET(request?: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const kind = request?.nextUrl?.searchParams.get('kind') ?? null;
    if (kind !== null && kind !== OWED_REPLY_KIND) throw new ApiError('kind may only be owed_reply', 400);

    if (kind === OWED_REPLY_KIND) {
      const rows = await prisma.emailOutbox.findMany({
        where: { sent_at: null, superseded_at: null, kind: OWED_REPLY_KIND, send_after: { lte: new Date() } },
        orderBy: { created_at: 'asc' },
        take: 50,
        select: { ...SELECT, send_after: true },
      });
      return NextResponse.json({ items: rows });
    }

    const rows = await prisma.emailOutbox.findMany({
      where: { sent_at: null, superseded_at: null },
      orderBy: { created_at: 'asc' },
      take: 50,
      select: SELECT,
    });
    let items = rows.filter((r) => r.kind !== OWED_REPLY_KIND);
    // A full page that lost rows to the filter: ask again with the exclusion in the query so a held owed row can never crowd out real mail.
    if (rows.length === 50 && items.length < rows.length) {
      items = await prisma.emailOutbox.findMany({
        where: { sent_at: null, superseded_at: null, kind: { not: OWED_REPLY_KIND } },
        orderBy: { created_at: 'asc' },
        take: 50,
        select: SELECT,
      });
    }
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
