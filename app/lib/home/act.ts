/**
 * Home screen Slice 1: the home-only actions behind POST /api/home/act and /api/home/undo
 * (plan task H7).
 *
 * Shape:
 * - planAct() is a pure reducer: a HomeActRequest plus the current state in, the writes and
 *   the undo record out. It throws HomeActError (an ApiError with a code) for the 409s.
 * - runHomeAct() reads, plans and writes inside ONE prisma.$transaction. The writes touch only
 *   home_item_state, home_day and home_actions, always with the caller's user id. No shared
 *   record (task, arc, wait, email ask) is ever read for writing or written here.
 * - runHomeUndo() reverses the stored before-state of one of the caller's own action rows,
 *   once, within the undo window, in one transaction.
 *
 * Undo records: `before` holds the old value of exactly the fields the action changed, and
 * `after` holds the new values. Undo puts back only those fields. A home_item_state row that
 * did not exist before the action is deleted on undo only when every field on it is back at
 * its default, so undo never removes anything the action did not create.
 *
 * Every sentence returned to the reader is plain and short. Stored text (item titles, group
 * labels) is never put into a message.
 */

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { groupKeySchema, itemKeySchema } from './item-key';
import { ARC_STEP_KEYS_MAX, LEFT_OFF_NOTE_MAX, NOT_NOW, UNDO_WINDOW_HOURS } from './rules';
import { loadHomeInputs } from './load';
import { selectHome } from './select';
import { dayForGroup, type ProposedDay } from './today';
import {
  appendHomeAction,
  dateString,
  findPinnedItemState,
  getHomeAction,
  getHomeDay,
  getItemState,
  loadItemStates,
  markHomeActionUndone,
  updateHomeDay,
  upsertItemState,
  type HomeDayPatch,
  type HomeDb,
  type HomeItemStatePatch,
} from './state';
import type {
  HomeActErrorCode,
  HomeActRequest,
  HomeActResponse,
  HomeUndoResponse,
  RawHomeDay,
  RawItemState,
} from './types';

// ============================================================================
// Request schema
// ============================================================================

const RECORDED_IDS = [
  'done',
  'do_now',
  'open_task',
  'let_it_go',
  'approve_all',
  'open_session',
  'approve_wait',
  'complete_wait',
  'open_wait',
  'open_draft',
  'open_thread',
  'no_reply_needed',
  'handled',
] as const;

/** Strict objects: an unknown field (such as a user id) is a 400, never ignored. */
export const homeActSchema: z.ZodType<HomeActRequest> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('not_now'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('matters_more'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('not_emergency'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('pin'), item_key: itemKeySchema, switch: z.boolean().optional() }).strict(),
  z
    .object({
      action: z.literal('stop'),
      item_key: itemKeySchema,
      note: z.string().max(LEFT_OFF_NOTE_MAX).nullable(),
    })
    .strict(),
  z.object({ action: z.literal('done_pin'), item_key: itemKeySchema }).strict(),
  z
    .object({
      action: z.literal('arc_add'),
      item_key: itemKeySchema,
      group_key: groupKeySchema,
      origin: z.enum(['in_view', 'search', 'created']),
    })
    .strict(),
  z.object({ action: z.literal('arc_remove'), item_key: itemKeySchema, group_key: groupKeySchema }).strict(),
  z
    .object({
      action: z.literal('arc_reorder'),
      group_key: groupKeySchema,
      step_keys: z.array(itemKeySchema).max(ARC_STEP_KEYS_MAX),
    })
    .strict(),
  z.object({ action: z.literal('swap'), to_group_key: groupKeySchema }).strict(),
  z.object({ action: z.literal('lighter'), to_group_key: groupKeySchema }).strict(),
  z
    .object({
      action: z.literal('record'),
      item_key: itemKeySchema,
      did: z.enum(RECORDED_IDS),
      undo: z.boolean().optional(),
    })
    .strict(),
]);

export const homeUndoSchema = z.object({ action_id: z.string().uuid() }).strict();

// ============================================================================
// Errors and sentences
// ============================================================================

export const PIN_CONFLICT_TEXT = 'Switch to this one? The other goes back to its place.';

const ERROR_TEXT: Record<HomeActErrorCode, string> = {
  pin_conflict: PIN_CONFLICT_TEXT,
  stale_day: "Today's list changed. Refresh and try again.",
  already_in_arc: "That one is already on today's list.",
  not_in_arc: "That one is not on today's list.",
  unknown_group: 'That group is not available today.',
  undo_expired: 'It is too late to undo that.',
  undo_used: 'That was already undone.',
  not_undoable: "That can't be undone.",
  not_found: 'That action was not found.',
};

/** An ApiError with one of the contract's codes (409, or 404 for not_found). */
export class HomeActError extends ApiError {
  constructor(code: HomeActErrorCode, message?: string) {
    super(message ?? ERROR_TEXT[code], code === 'not_found' ? 404 : 409, code);
    this.name = 'HomeActError';
  }
}

// ============================================================================
// Time in his zone
// ============================================================================

interface ZonedWall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function wallClock(date: Date, timeZone: string): ZonedWall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get('hour');
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: hour === 24 ? 0 : hour,
    mi: get('minute'),
    s: get('second'),
  };
}

function wallAsUtcMs(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
}

/** The UTC instant of y-m-d h:mi on the wall clock of the zone. */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  const nominal = Date.UTC(y, m - 1, d, h, mi);
  let guess = nominal;
  for (let i = 0; i < 3; i++) {
    guess = nominal - (wallAsUtcMs(new Date(guess), timeZone) - guess);
  }
  return new Date(guess);
}

/** 'YYYY-MM-DD' of the instant on his wall clock (the key of that day's home_day). */
export function zonedDateString(now: Date, timeZone: string): string {
  const w = wallClock(now, timeZone);
  return `${String(w.y).padStart(4, '0')}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Next business day at 9:00 on his wall clock: the first Monday to Friday after today.
 * Business days here are weekdays in his zone (the repo has no holiday calendar).
 */
export function nextBusinessDayMorning(now: Date, timeZone: string): { at: Date; daysAhead: number; weekday: string } {
  const w = wallClock(now, timeZone);
  let daysAhead = 0;
  let day: Date;
  do {
    daysAhead += 1;
    day = new Date(Date.UTC(w.y, w.m - 1, w.d + daysAhead));
  } while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), NOT_NOW.firstReturnHour, 0, timeZone);
  return { at, daysAhead, weekday: WEEKDAYS[day.getUTCDay()] };
}

// ============================================================================
// Before and after records
// ============================================================================

type StateFieldName = keyof HomeItemStatePatch;

const DATE_FIELDS: ReadonlySet<StateFieldName> = new Set<StateFieldName>([
  'view_at',
  'boosted_at',
  'not_emergency_at',
  'working_since',
  'arc_added_at',
  'arc_removed_at',
]);

/** Every field an action may change, with its default on a row that does not exist. */
const STATE_DEFAULTS: Required<Omit<HomeItemStatePatch, 'last_shown_at'>> = {
  park_count: 0,
  view_at: null,
  boosted_at: null,
  not_emergency_at: null,
  working_since: null,
  left_off_note: null,
  arc_added_at: null,
  arc_added_group: null,
  arc_removed_at: null,
  arc_removed_group: null,
};

type StateFields = Record<string, number | string | null>;

interface StateRecord {
  item_key: string;
  /** Before only: whether the row existed. */
  existed?: boolean;
  fields: StateFields;
}

type DayRecord =
  | { date: string; group_key: string; kind: 'add'; key: string }
  | { date: string; group_key: string; kind: 'remove'; key: string; index: number }
  | { date: string; group_key: string; kind: 'reorder'; steps: string[] }
  | { date: string; group_key: string; kind: 'rewrite'; snapshot: DaySnapshot };

interface DaySnapshot {
  group_key: string;
  group_label: string;
  arc_id: string | null;
  quick_item_keys: string[];
  step_item_keys: string[];
  sized_minutes: number | null;
  swapped_from_group: string | null;
  lighter_at: string | null;
}

interface UndoSide {
  states: StateRecord[];
  day?: DayRecord;
}

function toJsonValue(v: unknown): number | string | null {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined || v === null) return null;
  return v as number | string;
}

function snapshotDay(day: RawHomeDay): DaySnapshot {
  return {
    group_key: day.group_key,
    group_label: day.group_label,
    arc_id: day.arc_id,
    quick_item_keys: [...day.quick_item_keys],
    step_item_keys: [...day.step_item_keys],
    sized_minutes: day.sized_minutes,
    swapped_from_group: day.swapped_from_group,
    lighter_at: day.lighter_at ? day.lighter_at.toISOString() : null,
  };
}

// ============================================================================
// The reducer
// ============================================================================

export interface ActContext {
  now: Date;
  /** His IANA zone. */
  timezone: string;
  /** The item's current state row (for the request's item_key), or null. */
  state: RawItemState | null;
  /** The currently pinned item's row (any item), or null. */
  pinned: RawItemState | null;
  /** Today's home_day, or null when none was written yet. */
  day: RawHomeDay | null;
  /** For swap and lighter: the rewritten day from today.ts dayForGroup (null = unknown group). */
  targetDay?: ProposedDay | null;
}

interface StateWrite {
  item_key: string;
  patch: HomeItemStatePatch;
  /** The row before (null when there was none). */
  from: RawItemState | null;
}

export interface ActPlan {
  action: HomeActRequest['action'];
  item_key: string | null;
  stateWrites: StateWrite[];
  dayWrite: { date: string; patch: HomeDayPatch; before: DayRecord; after: DayRecord } | null;
  /** True for every action but record. */
  undoable: boolean;
  /** For record: what was logged. */
  recorded?: { did: string; undo: boolean };
  message: string | null;
}

function fieldsOf(patch: HomeItemStatePatch, from: RawItemState | null, side: 'before' | 'after'): StateFields {
  const out: StateFields = {};
  for (const key of Object.keys(patch) as StateFieldName[]) {
    if (key === 'last_shown_at') continue;
    if (side === 'after') {
      out[key] = toJsonValue(patch[key]);
    } else {
      const prior = from ? (from as unknown as Record<string, unknown>)[key] : (STATE_DEFAULTS as Record<string, unknown>)[key];
      out[key] = toJsonValue(prior);
    }
  }
  return out;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return false;
  return b.every((k) => set.has(k)) && new Set(b).size === b.length;
}

function requireDay(ctx: ActContext, groupKey: string): RawHomeDay {
  if (!ctx.day || ctx.day.group_key !== groupKey) throw new HomeActError('stale_day');
  return ctx.day;
}

/** Pure: what one request does. Throws HomeActError for a refused request. */
export function planAct(req: HomeActRequest, ctx: ActContext): ActPlan {
  const { now } = ctx;
  const base = { undoable: true, dayWrite: null as ActPlan['dayWrite'] };

  switch (req.action) {
    case 'not_now': {
      const count = ctx.state?.park_count ?? 0;
      if (count === 0) {
        const next = nextBusinessDayMorning(now, ctx.timezone);
        return {
          ...base,
          action: req.action,
          item_key: req.item_key,
          stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { park_count: 1, view_at: next.at } }],
          message: next.daysAhead === 1 ? 'Back tomorrow at 9:00.' : `Back ${next.weekday} at 9:00.`,
        };
      }
      if (count === 1) {
        const back = new Date(now.getTime() + NOT_NOW.secondReturnDays * 24 * 3600 * 1000);
        return {
          ...base,
          action: req.action,
          item_key: req.item_key,
          stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { park_count: 2, view_at: back } }],
          message: `Back in ${NOT_NOW.secondReturnDays} days.`,
        };
      }
      // Third tap and later: it stays in view, and the screen offers its real choices.
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [
          {
            item_key: req.item_key,
            from: ctx.state,
            patch: { park_count: Math.min(count + 1, NOT_NOW.choicesOnlyAtParkCount), view_at: null },
          },
        ],
        message: 'It stays here. Pick what to do with it.',
      };
    }

    case 'matters_more':
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { boosted_at: now } }],
        message: 'Moved up.',
      };

    case 'not_emergency':
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { not_emergency_at: now } }],
        message: 'Moved out of Needs you now.',
      };

    case 'pin': {
      const other = ctx.pinned && ctx.pinned.item_key !== req.item_key ? ctx.pinned : null;
      if (other && !req.switch) throw new HomeActError('pin_conflict');
      const writes: StateWrite[] = [];
      if (other) writes.push({ item_key: other.item_key, from: other, patch: { working_since: null } });
      // Pinning the item that is already pinned keeps its original time.
      writes.push({
        item_key: req.item_key,
        from: ctx.state,
        patch: { working_since: ctx.state?.working_since ?? now },
      });
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: writes,
        message: other ? 'Switched. The other goes back to its place.' : 'Working on this now.',
      };
    }

    case 'stop': {
      const note = req.note === null ? '' : req.note.trim();
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [
          {
            item_key: req.item_key,
            from: ctx.state,
            patch: { working_since: null, left_off_note: note === '' ? null : note },
          },
        ],
        message: note === '' ? 'Stopped for now.' : 'Stopped for now. Your note is saved.',
      };
    }

    case 'done_pin':
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { working_since: null } }],
        message: 'Cleared from working on.',
      };

    case 'arc_add': {
      const day = requireDay(ctx, req.group_key);
      if (day.step_item_keys.includes(req.item_key) || day.quick_item_keys.includes(req.item_key)) {
        throw new HomeActError('already_in_arc');
      }
      if (day.step_item_keys.length >= ARC_STEP_KEYS_MAX) {
        throw new ApiError('Today has too many steps already.', 400);
      }
      const patch: HomeItemStatePatch = { arc_added_at: now, arc_added_group: req.group_key };
      // A removal mark for this same group is lifted; a mark for another group stays.
      if (ctx.state?.arc_removed_group === req.group_key) {
        patch.arc_removed_at = null;
        patch.arc_removed_group = null;
      }
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch }],
        dayWrite: {
          date: day.date,
          patch: { step_item_keys: [...day.step_item_keys, req.item_key] },
          before: { date: day.date, group_key: day.group_key, kind: 'add', key: req.item_key },
          after: { date: day.date, group_key: day.group_key, kind: 'add', key: req.item_key },
        },
        message: "Added to today's list.",
      };
    }

    case 'arc_remove': {
      const day = requireDay(ctx, req.group_key);
      const index = day.step_item_keys.indexOf(req.item_key);
      if (index < 0) throw new HomeActError('not_in_arc');
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [
          {
            item_key: req.item_key,
            from: ctx.state,
            patch: {
              arc_removed_at: now,
              arc_removed_group: req.group_key,
              arc_added_at: null,
              arc_added_group: null,
            },
          },
        ],
        dayWrite: {
          date: day.date,
          patch: { step_item_keys: day.step_item_keys.filter((k) => k !== req.item_key) },
          before: { date: day.date, group_key: day.group_key, kind: 'remove', key: req.item_key, index },
          after: { date: day.date, group_key: day.group_key, kind: 'remove', key: req.item_key, index },
        },
        message: "Taken off today's list.",
      };
    }

    case 'arc_reorder': {
      const day = requireDay(ctx, req.group_key);
      if (!sameSet(day.step_item_keys, req.step_keys)) throw new HomeActError('stale_day');
      return {
        ...base,
        action: req.action,
        item_key: null,
        stateWrites: [],
        dayWrite: {
          date: day.date,
          patch: { step_item_keys: [...req.step_keys] },
          before: { date: day.date, group_key: day.group_key, kind: 'reorder', steps: [...day.step_item_keys] },
          after: { date: day.date, group_key: day.group_key, kind: 'reorder', steps: [...req.step_keys] },
        },
        message: 'Order saved.',
      };
    }

    case 'swap':
    case 'lighter': {
      const day = ctx.day;
      if (!day) throw new HomeActError('stale_day');
      const target = ctx.targetDay;
      if (!target) throw new HomeActError('unknown_group');
      const patch: HomeDayPatch = {
        group_key: target.group_key,
        group_label: target.group_label,
        arc_id: target.arc_id,
        quick_item_keys: [...target.quick_item_keys],
        step_item_keys: [...target.step_item_keys],
        sized_minutes: target.sized_minutes,
        ...(req.action === 'swap' ? { swapped_from_group: day.group_key } : { lighter_at: now }),
      };
      const afterDay: RawHomeDay = {
        ...day,
        group_key: target.group_key,
        group_label: target.group_label,
        arc_id: target.arc_id,
        quick_item_keys: target.quick_item_keys,
        step_item_keys: target.step_item_keys,
        sized_minutes: target.sized_minutes,
        swapped_from_group: req.action === 'swap' ? day.group_key : day.swapped_from_group,
        lighter_at: req.action === 'lighter' ? now : day.lighter_at,
      };
      return {
        ...base,
        action: req.action,
        item_key: null,
        stateWrites: [],
        dayWrite: {
          date: day.date,
          patch,
          before: { date: day.date, group_key: day.group_key, kind: 'rewrite', snapshot: snapshotDay(day) },
          after: { date: day.date, group_key: target.group_key, kind: 'rewrite', snapshot: snapshotDay(afterDay) },
        },
        message: req.action === 'swap' ? "Switched today's arc." : 'Made today lighter.',
      };
    }

    case 'record':
      return {
        action: req.action,
        item_key: req.item_key,
        stateWrites: [],
        dayWrite: null,
        undoable: false,
        recorded: { did: req.did, undo: req.undo === true },
        message: null,
      };
  }
}

// ============================================================================
// Running an action
// ============================================================================

export interface RunOptions {
  now: Date;
  timezone: string;
  /** 'YYYY-MM-DD' of today in his zone. */
  date: string;
}

/**
 * Swap and Lighter need today's candidates, which are read before the transaction (read only).
 * Returns the target day, null for an unknown group, or 'no_day' when no home_day exists yet.
 */
async function resolveTargetDay(
  db: PrismaClient,
  userId: string,
  req: Extract<HomeActRequest, { action: 'swap' | 'lighter' }>,
  opts: RunOptions
): Promise<ProposedDay | null | 'no_day'> {
  const day = await getHomeDay(db, userId, opts.date);
  if (!day) return 'no_day';
  const raw = await loadHomeInputs(db, userId, opts.now, { timezone: opts.timezone });
  const states = await loadItemStates(db, userId);
  const sel = selectHome({ raw, states, now: opts.now });
  return dayForGroup(sel, req.to_group_key, day, raw.calendar_events, opts.now);
}

/** Do one home-only action for `userId`. Throws HomeActError for a refused request. */
export async function runHomeAct(
  db: PrismaClient,
  userId: string,
  req: HomeActRequest,
  opts: RunOptions
): Promise<HomeActResponse> {
  let targetDay: ProposedDay | null | undefined;
  if (req.action === 'swap' || req.action === 'lighter') {
    const resolved = await resolveTargetDay(db, userId, req, opts);
    if (resolved === 'no_day') throw new HomeActError('stale_day');
    targetDay = resolved;
  }

  return db.$transaction(async (tx) => {
    const itemKey = 'item_key' in req ? req.item_key : null;
    const [state, pinned, day] = await Promise.all([
      itemKey ? getItemState(tx, userId, itemKey) : Promise.resolve(null),
      req.action === 'pin' ? findPinnedItemState(tx, userId) : Promise.resolve(null),
      req.action === 'arc_add' || req.action === 'arc_remove' || req.action === 'arc_reorder' || req.action === 'swap' || req.action === 'lighter'
        ? getHomeDay(tx, userId, opts.date)
        : Promise.resolve(null),
    ]);

    const plan = planAct(req, { now: opts.now, timezone: opts.timezone, state, pinned, day, targetDay });

    for (const w of plan.stateWrites) {
      await upsertItemState(tx, userId, w.item_key, w.patch);
    }
    if (plan.dayWrite) {
      const changed = await updateHomeDay(tx, userId, plan.dayWrite.date, plan.dayWrite.patch);
      if (changed === 0) throw new HomeActError('stale_day');
    }

    const undoUntil = plan.undoable ? new Date(opts.now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000) : null;
    let before: UndoSide | { recorded: { did: string; undo: boolean } };
    let after: UndoSide | { recorded: { did: string; undo: boolean } };
    if (plan.recorded) {
      before = { recorded: plan.recorded };
      after = { recorded: plan.recorded };
    } else {
      before = {
        states: plan.stateWrites.map((w) => ({
          item_key: w.item_key,
          existed: w.from !== null,
          fields: fieldsOf(w.patch, w.from, 'before'),
        })),
        ...(plan.dayWrite ? { day: plan.dayWrite.before } : {}),
      };
      after = {
        states: plan.stateWrites.map((w) => ({ item_key: w.item_key, fields: fieldsOf(w.patch, w.from, 'after') })),
        ...(plan.dayWrite ? { day: plan.dayWrite.after } : {}),
      };
    }

    const row = await appendHomeAction(tx, userId, {
      item_key: plan.item_key,
      action: plan.action,
      // A record row has nothing to reverse, so it stores no before-state.
      before: plan.recorded ? undefined : before,
      after,
      undo_until: undoUntil,
    });

    return {
      ok: true as const,
      action_id: row.id,
      undo_until: undoUntil ? undoUntil.toISOString() : null,
      item_key: plan.item_key,
      message: plan.message,
    };
  });
}

// ============================================================================
// Undo
// ============================================================================

function reviveField(name: string, v: unknown): number | string | Date | null {
  if (v === null || v === undefined) return null;
  if (DATE_FIELDS.has(name as StateFieldName)) return new Date(String(v));
  return v as number | string;
}

function isRestMark(row: RawItemState): boolean {
  return (
    row.park_count === 0 &&
    row.view_at === null &&
    row.boosted_at === null &&
    row.not_emergency_at === null &&
    row.working_since === null &&
    row.left_off_note === null &&
    row.arc_added_at === null &&
    row.arc_added_group === null &&
    row.arc_removed_at === null &&
    row.arc_removed_group === null &&
    row.last_shown_at === null
  );
}

function asSide(v: unknown): UndoSide | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<UndoSide>;
  if (!Array.isArray(o.states)) return null;
  return o as UndoSide;
}

async function undoStateRecord(db: HomeDb, userId: string, rec: StateRecord): Promise<void> {
  if (rec.existed === false) {
    // The action created this row. Put the fields back, then delete the row only when nothing
    // else is on it (a later action may have used it).
    const current = await getItemState(db, userId, rec.item_key);
    if (!current) return;
  }
  const patch: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(rec.fields)) patch[name] = reviveField(name, value);
  const row = await upsertItemState(db, userId, rec.item_key, patch as HomeItemStatePatch);
  if (rec.existed === false && isRestMark(row)) {
    await db.homeItemState.deleteMany({
      where: {
        user_id: userId,
        item_key: rec.item_key,
        park_count: 0,
        view_at: null,
        boosted_at: null,
        not_emergency_at: null,
        working_since: null,
        left_off_note: null,
        arc_added_at: null,
        arc_added_group: null,
        arc_removed_at: null,
        arc_removed_group: null,
        last_shown_at: null,
      },
    });
  }
}

/** Put one day change back. Returns false when the day is no longer what the action left. */
async function undoDayRecord(db: HomeDb, userId: string, before: DayRecord, after: DayRecord | undefined): Promise<boolean> {
  const day = await getHomeDay(db, userId, before.date);
  if (before.kind === 'rewrite') {
    const leftGroup = after?.group_key ?? before.group_key;
    if (!day || day.group_key !== leftGroup) return false;
    const s = before.snapshot;
    await updateHomeDay(db, userId, before.date, {
      group_key: s.group_key,
      group_label: s.group_label,
      arc_id: s.arc_id,
      quick_item_keys: s.quick_item_keys,
      step_item_keys: s.step_item_keys,
      sized_minutes: s.sized_minutes,
      swapped_from_group: s.swapped_from_group,
      lighter_at: s.lighter_at ? new Date(s.lighter_at) : null,
    });
    return true;
  }
  // Arc edits: change only the step, leave the rest of the day alone. A day that moved to another
  // group since has nothing of this edit left to put back.
  if (!day || day.group_key !== before.group_key) return true;
  let steps = [...day.step_item_keys];
  if (before.kind === 'add') {
    steps = steps.filter((k) => k !== before.key);
  } else if (before.kind === 'remove') {
    if (!steps.includes(before.key)) steps.splice(Math.min(before.index, steps.length), 0, before.key);
  } else {
    const order = before.steps.filter((k) => steps.includes(k));
    steps = [...order, ...steps.filter((k) => !order.includes(k))];
  }
  await updateHomeDay(db, userId, before.date, { step_item_keys: steps });
  return true;
}

/** Undo one of the caller's own home-only actions. Throws HomeActError when refused. */
export async function runHomeUndo(
  db: PrismaClient,
  userId: string,
  actionId: string,
  now: Date
): Promise<HomeUndoResponse> {
  return db.$transaction(async (tx) => {
    const row = await getHomeAction(tx, userId, actionId);
    if (!row) throw new HomeActError('not_found');
    if (row.undone_at) throw new HomeActError('undo_used');
    const before = asSide(row.before);
    const after = asSide(row.after);
    if (row.action === 'record' || !row.undo_until || !before) throw new HomeActError('not_undoable');
    if (row.undo_until.getTime() < now.getTime()) throw new HomeActError('undo_expired');

    // Check the day first so a refusal writes nothing.
    if (before.day?.kind === 'rewrite') {
      const day = await getHomeDay(tx, userId, before.day.date);
      const leftGroup = after?.day?.group_key ?? before.day.group_key;
      if (!day || day.group_key !== leftGroup) {
        throw new HomeActError('not_undoable', "Today's list changed since, so this can't be undone.");
      }
    }

    const marked = await markHomeActionUndone(tx, userId, actionId, now);
    if (!marked) throw new HomeActError('undo_used');

    for (const rec of before.states) await undoStateRecord(tx, userId, rec);
    if (before.day) await undoDayRecord(tx, userId, before.day, after?.day);

    return { ok: true as const, action_id: actionId, item_key: row.item_key };
  });
}

/** Re-exported so the routes need one import for date handling. */
export { dateString };
