import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { applyWaitEvent, eventSchema } from '@/lib/waits/events';

const bodySchema = z.union([eventSchema, z.object({ events: z.array(eventSchema).min(1).max(100) })]);

/**
 * POST /api/waits/events: the inbound-placement contract (W6). One event or {events: [...]}.
 * Kinds: place, stop, extend, needs_human. Idempotent on event_id: a replay changes nothing and
 * returns duplicate: true. Extensions stop at two per wait or 15 business days; the next one
 * becomes needs_human. A selector with no chain, thread or contact selects nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = bodySchema.parse(await request.json());
    const list = 'events' in body ? body.events : [body];
    const store = prismaSweepStore(prisma);
    const results = [];
    for (const ev of list) results.push(await applyWaitEvent(store, ev));
    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
