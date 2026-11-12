import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { SESSION_LANES, requireWorkCaller } from '@/lib/work/route-auth';
import { restoreStaleClear, runStaleClear } from '@/lib/work/stale-asks';

/**
 * Work stage E: POST /api/oracle/sessions/stale-asks, the one-time clear of old parked session questions (and its restore).
 * An addition to the plan's route list: the plan's clear is machine side (manifest.py clear-stale); this is the server side of it.
 *
 * Body (strict), one of:
 *   {dry: boolean, older_than_days?: 7 to 365}   clear. With dry: counts and 10 sample titles, writes NOTHING. Without: writes the ledger,
 *                                                 the owner's cleared marks and one Handled line with Undo, once per question.
 *   {restore: "<run key>", dry?: boolean}        bring the questions of that run back (no time limit), only where the owner's mark is
 *                                                 still the one the clear wrote.
 * Never cleared: client_blocking, launch_blocking, anything security-tagged, a session that is still live, a question newer than the
 * cutoff. The session's own record is never touched. 200 with the counts, or {skipped: "home_off"}. The oracle lane, and the owner's
 * session. Nothing is sent.
 */
const clearSchema = z.object({ dry: z.boolean(), older_than_days: z.number().int().min(7).max(365).optional() }).strict();
const restoreSchema = z.object({ restore: z.string().regex(/^stale-asks-\d{4}-\d{2}-\d{2}$/), dry: z.boolean().optional() }).strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, SESSION_LANES);
    const raw = (await request.json()) as unknown;
    const now = new Date();
    if (raw && typeof raw === 'object' && 'restore' in raw) {
      const body = restoreSchema.parse(raw);
      return NextResponse.json(await restoreStaleClear(prisma, { run_key: body.restore, dry: body.dry === true, now }));
    }
    const body = clearSchema.parse(raw);
    return NextResponse.json(await runStaleClear(prisma, { dry: body.dry, older_than_days: body.older_than_days, now }));
  } catch (error) {
    return handleApiError(error);
  }
}
