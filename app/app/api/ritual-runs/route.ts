import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { getZonedDateString } from '@/lib/utils/time';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { DEFAULT_RITUAL_KIND } from '@/lib/ritual-runs';

// Clarity Phase 7 (Seeing Stone Reckoning P2) — the ritual gate's backing store. Admin-only,
// same as the rest of the Oracle surface. `date` always resolves to the REQUESTING USER's
// own timezone when omitted (same resolution chain /api/today uses), never a plain UTC day.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(dateStr: string | null | undefined, timezone: string): Date {
  const raw = dateStr && DATE_RE.test(dateStr) ? dateStr : getZonedDateString(new Date(), timezone);
  return new Date(`${raw}T00:00:00.000Z`);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const timezone = await resolveUserTimezone(auth.userId);
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind') || DEFAULT_RITUAL_KIND;
    const date = parseDate(searchParams.get('date'), timezone);

    const run = await prisma.ritualRun.findUnique({
      where: { date_kind: { date, kind } },
    });

    return NextResponse.json({
      date: date.toISOString().slice(0, 10),
      kind,
      ran_at: run?.ran_at ?? null,
      bailed_at: run?.bailed_at ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const postSchema = z.object({
  date: z.string().regex(DATE_RE).optional(),
  kind: z.string().max(20).optional(),
  action: z.enum(['ran', 'bailed']),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = postSchema.parse(body);

    const timezone = await resolveUserTimezone(auth.userId);
    const date = parseDate(data.date, timezone);
    const kind = data.kind || DEFAULT_RITUAL_KIND;
    const now = new Date();

    // Idempotent upsert: repeat POSTs of the same action never create a duplicate row
    // (unique on date+kind) and never regress the other field — a bail doesn't get
    // clobbered by a later ran, and vice versa; each action only ever touches its own
    // timestamp.
    const run = await prisma.ritualRun.upsert({
      where: { date_kind: { date, kind } },
      create: {
        date,
        kind,
        ran_at: data.action === 'ran' ? now : null,
        bailed_at: data.action === 'bailed' ? now : null,
      },
      update: {
        ...(data.action === 'ran' && { ran_at: now }),
        ...(data.action === 'bailed' && { bailed_at: now }),
      },
    });

    return NextResponse.json({
      date: date.toISOString().slice(0, 10),
      kind,
      ran_at: run.ran_at,
      bailed_at: run.bailed_at,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
