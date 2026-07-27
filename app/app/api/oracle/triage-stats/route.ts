import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { isOracleBot } from '@/lib/oracle/helpers';

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q11) — the triage visibility chip's
// backing store. Phase 4 wires the email classifier (machine-side) to POST the day's
// running auto-archived count here on each pass — this phase builds the surface + the
// endpoint only. POST is bot-only (same isOracleBot gate as /api/oracle/ingest); GET is
// any authed user (the header chip reads it).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(dateStr: string | null): Date {
  const raw = dateStr && DATE_RE.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
  return new Date(`${raw}T00:00:00.000Z`);
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const date = parseDateParam(searchParams.get('date'));

    const stat = await prisma.triageStat.findUnique({ where: { date } });

    return NextResponse.json({
      date: date.toISOString().slice(0, 10),
      archived_count: stat?.archived_count ?? 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const postSchema = z.object({
  date: z.string().regex(DATE_RE).optional(),
  archived_count: z.number().int().min(0),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!isOracleBot(auth)) {
      throw new ApiError('Forbidden', 403);
    }

    const body = await request.json();
    const data = postSchema.parse(body);
    const date = parseDateParam(data.date ?? null);

    const stat = await prisma.triageStat.upsert({
      where: { date },
      create: { date, archived_count: data.archived_count },
      update: { archived_count: data.archived_count },
    });

    return NextResponse.json({
      date: stat.date.toISOString().slice(0, 10),
      archived_count: stat.archived_count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
