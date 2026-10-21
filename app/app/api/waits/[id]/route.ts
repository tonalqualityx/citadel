import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { resolveWaitOwner, type WaitRow } from '@/lib/waits/sweeper';
import { serializeWait } from '@/lib/waits/serialize';
import {
  extendWait,
  needsHuman,
  pauseWait,
  reassignWait,
  redateWait,
  resolveByPerson,
  resumeWait,
  standInWait,
} from '@/lib/waits/actions';

const reason = z.string().min(1).max(500);
const source = z.enum(['user', 'ritual']).optional();

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause'), until: z.string().datetime({ offset: true }), reason: reason.optional(), source }),
  z.object({ action: z.literal('resume'), reason: reason.optional(), source }),
  z.object({
    action: z.literal('extend'),
    business_days: z.number().int().min(1).max(15).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    reason,
    source,
  }),
  // The ritual's "re-date with a reason": a reason is required and logged.
  z.object({ action: z.literal('redate'), due_at: z.string().datetime({ offset: true }), reason, source }),
  z.object({
    action: z.literal('reassign'),
    owner_user_id: z.string().uuid().nullable().optional(),
    owner_function_id: z.string().uuid().nullable().optional(),
    reason: reason.optional(),
    source,
  }),
  z.object({ action: z.literal('stand_in'), stand_in_user_id: z.string().uuid().nullable(), reason: reason.optional(), source }),
  z.object({ action: z.literal('needs_human'), note: z.string().min(1).max(2000), source }),
  z.object({
    action: z.literal('resolve'),
    resolution: z.enum(['approved', 'completed', 'cancelled', 'sent', 'booked', 'signed', 'declined']),
    reason: reason.optional(),
    source,
  }),
]);

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError('Wait not found', 404);
  const w = await prisma.wait.findUnique({ where: { id } });
  if (!w) throw new ApiError('Wait not found', 404);
  return w;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const w = await load(id);
    const events = await prisma.waitEvent.findMany({ where: { wait_id: id }, orderBy: { created_at: 'asc' }, take: 200 });
    const resolved = await resolveWaitOwner(w, prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]));
    return NextResponse.json({
      ...serializeWait(w, resolved),
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        from_due_at: e.from_due_at ? e.from_due_at.toISOString() : null,
        to_due_at: e.to_due_at ? e.to_due_at.toISOString() : null,
        from_state: e.from_state,
        to_state: e.to_state,
        reason: e.reason,
        source: e.source,
        actor_user_id: e.actor_user_id,
        created_at: e.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/waits/:id: one action per call (pause, resume, extend, redate, reassign,
 * stand_in, needs_human, resolve). Every action writes a WaitEvent. A wait is never deleted.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const w = await load(id);
    const store = prismaSweepStore(prisma);
    const now = new Date();
    const common = { now, source: (body.source ?? 'user') as 'user' | 'ritual', actor_user_id: auth.userId };

    if (['done', 'expired'].includes(w.state) && body.action !== 'resolve') {
      throw new ApiError(`The wait is already ${w.state}.`, 409);
    }

    let next: WaitRow = w;
    switch (body.action) {
      case 'pause':
        if (new Date(body.until).getTime() <= now.getTime()) throw new ApiError('until must be in the future', 400);
        next = await pauseWait(store, w, { ...common, until: new Date(body.until), reason: body.reason });
        break;
      case 'resume':
        if (w.state !== 'paused') throw new ApiError('The wait is not paused.', 409);
        next = await resumeWait(store, w, { ...common, reason: body.reason });
        break;
      case 'extend': {
        if (!body.business_days && !body.until) throw new ApiError('Give business_days or until.', 400);
        const r = await extendWait(store, w, {
          ...common,
          reason: body.reason,
          business_days: body.business_days,
          until: body.until ? new Date(body.until) : undefined,
        });
        next = r.wait;
        if (!r.ok) {
          return NextResponse.json(
            { error: `Not extended (${r.code}). ${r.code === 'cap' ? 'The wait now needs a person.' : ''}`.trim(), code: r.code, wait: serializeWait(next) },
            { status: 409 }
          );
        }
        break;
      }
      case 'redate':
        next = await redateWait(store, w, { ...common, due_at: new Date(body.due_at), reason: body.reason });
        break;
      case 'reassign':
        next = await reassignWait(store, w, {
          ...common,
          owner_user_id: body.owner_user_id,
          owner_function_id: body.owner_function_id,
          reason: body.reason,
        });
        break;
      case 'stand_in':
        next = await standInWait(store, w, { ...common, stand_in_user_id: body.stand_in_user_id, reason: body.reason });
        break;
      case 'needs_human':
        next = await needsHuman(store, w, { ...common, note: body.note });
        break;
      case 'resolve':
        next = await resolveByPerson(store, w, body.resolution, { ...common, reason: body.reason });
        break;
    }
    const resolved = await resolveWaitOwner(next, prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]));
    return NextResponse.json(serializeWait(next, resolved));
  } catch (error) {
    return handleApiError(error);
  }
}
