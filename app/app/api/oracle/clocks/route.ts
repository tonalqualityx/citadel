import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { CLOCK_LANES, requireWorkCaller } from '@/lib/work/route-auth';
import { clocksBodySchema, upsertClocks } from '@/lib/work/clocks';

/**
 * Work stage F: POST /api/oracle/clocks, the machine posts the two clocks.
 *
 * Body (strict): {rows: [...]}, at most 200. A row is {kind: mike_estimate | bast_run, target_key: project:<id> | task:<id> | null,
 * session_external_id, source: session | citadel-worker | workflow | track, started_at, ended_at, minutes, agent_minutes?, cost_usd?, model?,
 * basis?, dedupe_key}. Each row is judged alone and upserted by dedupe_key (a re-post updates the figures and keeps a tap's time-entry link).
 * 200 {result: saved, created, updated, refused: [{index, dedupe_key, reason}]}, or {result: skipped, skipped: "home_off"}.
 * This writes work_clock only. It never writes a time entry; only the owner's tap does (POST /api/home/reconcile, log_clock).
 * The oracle lane (or its unlaned service key) and the bast-chat lane, and the owner's session.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, CLOCK_LANES);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new ApiError('The request body must be JSON.', 400, 'bad_request');
    }
    const body = clocksBodySchema.parse(raw);
    const out = await upsertClocks(prisma, body.rows);
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
