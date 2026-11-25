/**
 * Initiative rules shared by the routes: the schemas, the include shape, the caps, activation, and the stored health.
 * Caps are API rules, not database constraints (design.md 2).
 */
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { MAX_ACTIVE, MAX_NUMBERS, NUMBER_DIRECTIONS, NUMBER_UNITS, computeInitiativeHealth, type HealthCheckIn, type HealthNumber } from './health';

export const INITIATIVE_INCLUDE = {
  numbers: { orderBy: { position: 'asc' as const } },
  check_ins: { orderBy: { created_at: 'desc' as const }, take: 1 },
};

const dateString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Must be a date (YYYY-MM-DD or ISO-8601)' });

export const numberCreateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  unit: z.enum(NUMBER_UNITS),
  direction: z.enum(NUMBER_DIRECTIONS),
  baseline_value: z.number().optional().nullable(),
  baseline_at: dateString.optional().nullable(),
  target_value: z.number(),
  target_by: dateString,
  source: z.string().trim().min(1).max(40).default('manual'),
  position: z.number().int().min(0).optional(),
});

export const numberUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  unit: z.enum(NUMBER_UNITS).optional(),
  direction: z.enum(NUMBER_DIRECTIONS).optional(),
  baseline_value: z.number().optional().nullable(),
  baseline_at: dateString.optional().nullable(),
  target_value: z.number().optional(),
  target_by: dateString.optional(),
  source: z.string().trim().min(1).max(40).optional(),
  position: z.number().int().min(0).optional(),
});

export const STATUS_VALUES = ['proposed', 'active', 'paused', 'done', 'stopped'] as const;
export const HEALTH_VALUES = ['on_track', 'behind', 'unchecked'] as const;

const initiativeFields = {
  name: z.string().trim().min(1).max(120),
  bet: z.string(),
  nightmare: z.string().optional().nullable(),
  prevention: z.string().optional().nullable(),
  repair: z.string().optional().nullable(),
  cost_of_waiting: z.string().optional().nullable(),
  stop_condition: z.string().optional().nullable(),
  check_date: dateString.optional().nullable(),
  check_every_days: z.number().int().min(1).max(3650).optional().nullable(),
  next_decision: z.string().max(300).optional().nullable(),
  status: z.enum(STATUS_VALUES),
  health_reason: z.string().max(200).optional().nullable(),
  owner_id: z.string().uuid(),
  client_id: z.string().uuid().optional().nullable(),
  sort_order: z.number().int(),
  closed_reason: z.string().optional().nullable(),
};

export const initiativeCreateSchema = z.object({
  ...initiativeFields,
  bet: initiativeFields.bet.default(''),
  status: initiativeFields.status.optional(),
  owner_id: initiativeFields.owner_id.optional(),
  sort_order: initiativeFields.sort_order.optional(),
  numbers: z.array(numberCreateSchema).optional(),
});

export const initiativeUpdateSchema = z.object({
  ...initiativeFields,
  name: initiativeFields.name.optional(),
  bet: initiativeFields.bet.optional(),
  status: initiativeFields.status.optional(),
  owner_id: initiativeFields.owner_id.optional(),
  sort_order: initiativeFields.sort_order.optional(),
});

export const readingSchema = z.object({
  number_id: z.string().uuid(),
  value: z.number(),
  read_at: dateString.optional(),
  source: z.string().trim().min(1).max(40).default('manual'),
});

export const checkInSchema = z.object({
  health: z.enum(HEALTH_VALUES),
  note: z.string().max(300).optional().nullable(),
});

export function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : new Date(v);
}

/** Mike owns an initiative unless the request names someone else (design.md 2.1: "Mike by default"). */
export const DEFAULT_OWNER_EMAIL = 'mike@becomeindelible.com';

export async function defaultOwnerId(fallback: string): Promise<string> {
  const mike = await prisma.user.findUnique({ where: { email: DEFAULT_OWNER_EMAIL }, select: { id: true } });
  return mike?.id ?? fallback;
}

/** Past the proposed draft (paused, done, stopped as well as active), an initiative keeps one to three numbers. */
export function assertHasNumber(status: string, numberCount: number) {
  if (status !== 'proposed' && numberCount < 1) {
    throw new ApiError('An initiative needs at least one number once it is past proposed', 422, 'number_required');
  }
}

/** At most three numbers per initiative. */
export function assertNumberRoom(existingCount: number, adding: number) {
  if (existingCount + adding > MAX_NUMBERS) {
    throw new ApiError(`An initiative has at most ${MAX_NUMBERS} numbers`, 409, 'number_cap');
  }
}

/** Activation needs a bet, at least one number, and a free slot of the five. `selfId` is excluded from the count. */
export async function assertCanActivate(opts: { bet: string | null | undefined; numberCount: number; selfId?: string }) {
  if (!opts.bet || !opts.bet.trim()) {
    throw new ApiError('An initiative needs a bet before it can be activated', 422, 'bet_required');
  }
  if (opts.numberCount < 1) {
    throw new ApiError('An initiative needs at least one number before it can be activated', 422, 'number_required');
  }
  const where = { status: 'active' as const, is_deleted: false, ...(opts.selfId ? { id: { not: opts.selfId } } : {}) };
  const activeCount = await prisma.initiative.count({ where });
  if (activeCount >= MAX_ACTIVE) {
    const active = await prisma.initiative.findMany({ where, select: { id: true, name: true }, orderBy: { sort_order: 'asc' } });
    const names = active.map((a: { name: string }) => a.name).join(', ');
    throw new ApiError(
      `${MAX_ACTIVE} initiatives are already active (${names}). Pause one first.`,
      409,
      'initiative_cap',
      undefined,
      { active },
    );
  }
}

/** The initiative a project, task or process change links to must exist and not be deleted. */
export async function assertInitiativeLinkable(initiativeId: string) {
  const found = await prisma.initiative.findFirst({ where: { id: initiativeId, is_deleted: false }, select: { id: true } });
  if (!found) throw new ApiError('Initiative not found', 404);
}

type FreshHealthInput = {
  id: string;
  check_date: Date | null;
  health: string;
  health_reason: string | null;
  numbers: HealthNumber[];
  check_ins: HealthCheckIn[];
};

/**
 * Health as of now, for a read. Health depends on the clock (a check date can pass with nothing written), so a stored
 * value can go stale between writes; a read recomputes it, stores it when it moved, and returns the fresh row.
 */
export async function withFreshHealth<T extends FreshHealthInput>(initiative: T, now: Date = new Date()): Promise<T> {
  const result = computeInitiativeHealth({
    check_date: initiative.check_date,
    numbers: initiative.numbers,
    latest_check_in: initiative.check_ins[0] ?? null,
    now,
  });
  if (result.health === initiative.health && result.health_reason === initiative.health_reason) return initiative;
  await prisma.initiative.update({
    where: { id: initiative.id },
    data: { health: result.health, health_reason: result.health_reason },
  });
  return { ...initiative, health: result.health, health_reason: result.health_reason };
}

/** Recompute and store health (design.md 2.2), returning the initiative in its response shape. */
export async function recomputeHealth(id: string, now: Date = new Date()) {
  const initiative = await prisma.initiative.findUnique({ where: { id }, include: INITIATIVE_INCLUDE });
  if (!initiative) throw new ApiError('Initiative not found', 404);
  const result = computeInitiativeHealth({
    check_date: initiative.check_date,
    numbers: initiative.numbers,
    latest_check_in: initiative.check_ins[0] ?? null,
    now,
  });
  return prisma.initiative.update({
    where: { id },
    data: { health: result.health, health_reason: result.health_reason },
    include: INITIATIVE_INCLUDE,
  });
}
