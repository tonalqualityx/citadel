import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// Outbox listing for the Bast-machine drain (~/.claude/tools/citadel-mail/drain_outbox.py).
// pm/admin API key only. Unsent rows, oldest first, max 50.
export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const rows = await prisma.emailOutbox.findMany({
      where: { sent_at: null },
      orderBy: { created_at: 'asc' },
      take: 50,
      select: {
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
      },
    });

    return NextResponse.json({ items: rows });
  } catch (error) {
    return handleApiError(error);
  }
}
