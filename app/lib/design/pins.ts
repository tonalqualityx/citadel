/**
 * Designer Portal: pins and Apply (design 7.1 pins, PATCH pins/:id, apply; 7.3 ApplyPayload / PinPacket).
 * Route-free services: the routes only authenticate, parse and call these.
 */
import { z } from 'zod';
import type { DesignPin, DesignSession, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { appendDesignerEvent } from './events';
import { budgetStatus } from './budget';
import { createFollowupTask } from './followups';
import type { DesignActor } from './helpers';

export const MAX_PENDING_PINS = 100;
export const MAX_APPLY_PINS = 30;
export const MAX_APPLY_FILES = 10;

const nullableText = (max: number) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().max(max).nullish());

/** The shipped `dp:packet` (9.2) plus the tray note. Lenient where the shipped overlay is, strict on caps. */
export const pinBodySchema = z.object({
  type: z.literal('dp:packet').optional(),
  path: z.string().min(1).max(500).regex(/^\/(?!\/)\S*$/, 'path must start with a single /'),
  sha: nullableText(64),
  data_lib: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^[a-z0-9_-]{1,100}$/).nullish()),
  lib_stack: z.array(z.string().regex(/^[a-z0-9_-]{1,100}$/)).max(8).default([]),
  // the overlay slices to 60; the column holds 50
  data_shape: z.preprocess((v) => (v === '' ? null : v), z.string().max(60).nullish()).transform((v) => (v ? v.slice(0, 50) : null)),
  selector: z.string().min(1).max(500),
  tag: z.string().min(1).max(40),
  classes: z.array(z.string().max(60)).max(20).default([]),
  text_quote: nullableText(200),
  bbox: z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite().min(0), h: z.number().finite().min(0) }),
  viewport: z.object({ w: z.number().int().min(1).max(10000), h: z.number().int().min(1).max(10000) }),
  note: z.string().max(4000).optional(),
});
export type PinBody = z.infer<typeof pinBodySchema>;

type SessionLike = Pick<DesignSession, 'id' | 'status'>;

function assertOpen(session: SessionLike): void {
  if (session.status === 'closed' || session.status === 'abandoned') throw new ApiError('This session is closed', 409, 'session_closed');
}

export async function createPin(actor: DesignActor, session: SessionLike, input: PinBody, db: PrismaClient = defaultDb): Promise<DesignPin> {
  assertOpen(session);
  const pending = await db.designPin.count({ where: { session_id: session.id, status: 'pending' } });
  if (pending >= MAX_PENDING_PINS) throw new ApiError(`The tray holds at most ${MAX_PENDING_PINS} pins`, 409, 'tray_full');
  return db.designPin.create({
    data: {
      session_id: session.id,
      author_id: actor.userId,
      status: 'pending',
      note: input.note ?? '',
      page_path: input.path,
      data_lib: input.data_lib ?? null,
      lib_stack: input.lib_stack,
      data_shape: input.data_shape,
      selector: input.selector,
      tag: input.tag,
      classes: input.classes,
      text_quote: input.text_quote ?? null,
      bbox: input.bbox,
      viewport_width: input.viewport.w,
      viewport_height: input.viewport.h,
      preview_sha: input.sha ?? null,
    },
  });
}

export const patchPinSchema = z
  .object({
    note: z.string().max(4000).optional(),
    status: z.enum(['pending', 'discarded', 'followup']).optional(),
    followup_assign_to_me: z.boolean().optional(),
  })
  .refine((v) => v.note !== undefined || v.status !== undefined, { message: 'Nothing to change' });
export type PatchPinBody = z.infer<typeof patchPinSchema>;

/** The pin's own words as a follow-up title (the builder prefixes "Follow-up: " and caps it). */
function followupTitle(pin: DesignPin): string {
  const note = pin.note.replace(/\s+/g, ' ').trim();
  if (note) return note.slice(0, 150);
  return `${pin.data_lib ?? pin.tag ?? 'Element'} on ${pin.page_path}`.slice(0, 150);
}

/**
 * Only `pending` pins change (409 `pin_not_pending`). `followup` claims the pin first (compare and set), files
 * the follow-up task through the shared builder, then stores the task id; a failed filing puts the pin back.
 */
export async function patchPin(actor: DesignActor, pin: DesignPin, input: PatchPinBody, db: PrismaClient = defaultDb): Promise<DesignPin> {
  if (pin.status !== 'pending') throw new ApiError('Only a pending pin can change', 409, 'pin_not_pending');
  const data: Prisma.DesignPinUpdateManyMutationInput = {};
  if (input.note !== undefined) data.note = input.note;

  if (input.status === 'followup') {
    const claimed = await db.designPin.updateMany({ where: { id: pin.id, status: 'pending' }, data: { ...data, status: 'followup' } });
    if (claimed.count !== 1) throw new ApiError('Only a pending pin can change', 409, 'pin_not_pending');
    const note = input.note ?? pin.note;
    try {
      const { task_id } = await createFollowupTask(
        {
          sessionId: pin.session_id,
          designerId: actor.userId,
          title: followupTitle({ ...pin, note }),
          detail: [note, `Page: ${pin.page_path}`, `Element: ${pin.selector}`, pin.text_quote ? `Text: ${pin.text_quote}` : ''].filter(Boolean).join('\n'),
          pinIds: [pin.id],
          assetIds: pin.crop_asset_id ? [pin.crop_asset_id] : [],
          assignToDesigner: input.followup_assign_to_me === true,
        },
        db,
      );
      return await db.designPin.update({ where: { id: pin.id }, data: { followup_task_id: task_id } });
    } catch (err) {
      await db.designPin.updateMany({ where: { id: pin.id, status: 'followup', followup_task_id: null }, data: { status: 'pending' } });
      throw err;
    }
  }

  if (input.status) data.status = input.status;
  const res = await db.designPin.updateMany({ where: { id: pin.id, status: 'pending' }, data });
  if (res.count !== 1) throw new ApiError('Only a pending pin can change', 409, 'pin_not_pending');
  return db.designPin.findUniqueOrThrow({ where: { id: pin.id } });
}

// ---------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------

export const applyBodySchema = z.object({
  client_ref: z.string().uuid(),
  pin_ids: z.array(z.string().uuid()).min(1).max(MAX_APPLY_PINS).refine((ids) => new Set(ids).size === ids.length, { message: 'pin_ids must be unique' }),
  note: z.string().max(4000).optional(),
  files: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(300), mime: z.string().min(1).max(100) })).max(MAX_APPLY_FILES).optional(),
  allow_stale: z.boolean().optional(),
});
export type ApplyBody = z.infer<typeof applyBodySchema>;

export interface PinPacket {
  pin_id: string;
  note: string;
  path: string;
  sha: string | null;
  data_lib: string | null;
  lib_stack: string[];
  data_shape: string | null;
  selector: string;
  tag: string;
  classes: string[];
  text_quote: string | null;
  bbox: { x: number; y: number; w: number; h: number };
  viewport: { w: number; h: number };
  crop_asset_id?: string;
}

export interface ApplyPayload {
  note?: string;
  files?: { id: string; name: string; mime: string }[];
  preview_url: string;
  pins: PinPacket[];
}

export function toPinPacket(p: DesignPin): PinPacket {
  const b = (p.bbox ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    pin_id: p.id,
    note: p.note,
    path: p.page_path,
    sha: p.preview_sha,
    data_lib: p.data_lib,
    lib_stack: p.lib_stack,
    data_shape: p.data_shape,
    selector: p.selector,
    tag: p.tag ?? '',
    classes: p.classes,
    text_quote: p.text_quote,
    bbox: { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) },
    viewport: { w: p.viewport_width, h: p.viewport_height ?? 0 },
    ...(p.crop_asset_id ? { crop_asset_id: p.crop_asset_id } : {}),
  };
}

export class ApplyRefusal extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error ?? 'refused'));
  }
}

/**
 * POST /sessions/:id/apply. Order: repeat of the same client_ref (200) -> closed (409) -> budget (409
 * `budget_reached` with numbers) -> pins (404/409) -> stale (409 `stale_pins` unless allow_stale) -> claim the
 * pins (pending -> sent) -> one `apply` event whose payload is exactly ApplyPayload -> stamp apply_event_seq.
 * A failure after the claim puts the pins back to pending.
 */
export async function applyPins(
  actor: DesignActor,
  session: DesignSession,
  input: ApplyBody,
  db: PrismaClient = defaultDb,
): Promise<{ seq: number; duplicate: boolean; payload?: ApplyPayload }> {
  const repeat = await db.designEvent.findUnique({
    where: { session_id_client_ref: { session_id: session.id, client_ref: input.client_ref } },
    select: { seq: true },
  });
  if (repeat) return { seq: repeat.seq, duplicate: true };
  assertOpen(session);

  const status = await budgetStatus(session, new Date(), db);
  if (status.reached) {
    throw new ApplyRefusal(409, {
      error: status.reason === 'monthly_cap' ? 'The monthly budget is used up' : 'This session reached its budget',
      code: 'budget_reached',
      reason: status.reason,
      cost_usd: status.cost_usd,
      budget_usd: status.budget_usd,
      month_spend_usd: status.month_spend_usd,
      monthly_cap_usd: status.monthly_cap_usd,
    });
  }

  const found = await db.designPin.findMany({ where: { id: { in: input.pin_ids }, session_id: session.id } });
  if (found.length !== input.pin_ids.length) throw new ApiError('One or more pins were not found in this session', 404, 'pin_not_found');
  const byId = new Map(found.map((p) => [p.id, p]));
  const pins = input.pin_ids.map((id) => byId.get(id)!);
  if (pins.some((p) => p.status !== 'pending')) throw new ApiError('Only pending pins can be applied', 409, 'pin_not_pending');

  if (!input.allow_stale) {
    const stale = pins.filter((p) => p.preview_sha !== session.preview_sha).map((p) => p.id);
    if (stale.length > 0) {
      throw new ApplyRefusal(409, {
        error: 'The preview changed since these pins were taken',
        code: 'stale_pins',
        stale_pin_ids: stale,
        preview_sha: session.preview_sha,
      });
    }
  }
  if (!session.preview_url) throw new ApiError('The preview is not ready yet', 409, 'no_preview');

  const payload: ApplyPayload = {
    ...(input.note ? { note: input.note } : {}),
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
    preview_url: session.preview_url,
    pins: pins.map(toPinPacket),
  };

  await db.$transaction(async (tx) => {
    const res = await tx.designPin.updateMany({ where: { id: { in: input.pin_ids }, session_id: session.id, status: 'pending' }, data: { status: 'sent' } });
    if (res.count !== input.pin_ids.length) throw new ApiError('Only pending pins can be applied', 409, 'pin_not_pending');
  });

  try {
    const { seq, duplicate } = await appendDesignerEvent(
      { sessionId: session.id, authorId: actor.userId, kind: 'apply', payload: payload as unknown as Prisma.InputJsonValue, clientRef: input.client_ref },
      db,
    );
    if (!duplicate) await db.designPin.updateMany({ where: { id: { in: input.pin_ids } }, data: { apply_event_seq: seq } });
    return { seq, duplicate, payload };
  } catch (err) {
    await db.designPin.updateMany({ where: { id: { in: input.pin_ids }, status: 'sent', apply_event_seq: null }, data: { status: 'pending' } });
    throw err;
  }
}
