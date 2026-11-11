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
import { groupKeySchema, itemKeySchema, parseItemKey } from './item-key';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { ARC_STEP_KEYS_MAX, CLOSED_TASK_STATUSES, LEFT_OFF_NOTE_MAX, NOT_NOW, UNDO_WINDOW_HOURS } from './rules';
import { loadHomeInputs, loadSessionAsks } from './load';
import { ON_DAY_BAD_DAY, checkOnDay, dayToDate, onDayMessage, snoozeCountToday, snoozeInstant, snoozeMessage } from './on-day';
import { SESSION_CLEARED_MESSAGE, sessionAskHash } from './session-clear';
import { HANDS_PARKED_MESSAGE, RULE_ACTION } from './emergency/copy';
import { undoWeightRecord, weightRecords } from './learn/weights-store';
import { HANDS_ITEM_KEY, nextHandsMonday } from './emergency/hands';
import { clearOwedRequest, markOwed, OWED_ACTION, requestOwed, undoOwedMark, type OwedMarkValues } from './owed/rows';
import { KEEP_LEAD_MESSAGE, TREAT_AS_REPLY_MESSAGE } from './owed/copy';
import type { OwedRequestKind } from './owed/state';
import { requestBook, undoBook } from './owed/book';
import { BOOK_COPY, bookLine } from './owed/book-copy';
import { NO_FREE_SLOT } from './owed/slot';
import { selectHome } from './select';
import { proposalNo, proposalYes } from './reconcile/apply';
import { afterUndo, undoReconcileRecord } from './reconcile/undo';
import { HANDLED_MAIL } from '@/lib/work/copy';
import { ASK_REF_RE, INTAKE_CLOSE_ACTION, IntakeError, readIntakeCloseRecord, reopenAsk, undoIntakeClose } from '@/lib/work/intake';
import { readWorkCloseRecord, undoWorkClose, WORK_CLOSE_ACTION } from '@/lib/work/ask-closure';
import { readRecord } from './reconcile/records';
import { FINISHED_ACTION, FINISHED_KEEP_ACTION, finishedClose, finishedCloseOne, finishedKeep, readFinishedRecord, undoFinishedClose, undoFinishedKeep } from '@/lib/work/finished-store';
import { STEP_DONE_MESSAGE, stepTextToStore } from './projects/step';
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
  'open_site',
  'open_short',
  'no_reply_needed',
  'handled',
] as const;

/** Strict objects: an unknown field (such as a user id) is a 400, never ignored. */
export const homeActSchema: z.ZodType<HomeActRequest> = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bring_forward'), item_key: itemKeySchema }).strict(),
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
  // Slice 4a: ask Bast to draft into Gmail. There is deliberately no send action: nothing here can send mail.
  z.object({ action: z.literal('draft_now'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('needs_thought'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('go_with_that'), item_key: itemKeySchema }).strict(),
  // Slice 4c: a lead's clock. Letting a lead go is the screen's existing "No reply needed" on its asks, not an action here.
  z.object({ action: z.literal('keep_lead'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('treat_as_reply'), item_key: itemKeySchema }).strict(),
  // Slice 6a: park the Monday hands row. There is deliberately no action here that saves a "Not an emergency" rule: that is
  // POST /api/home/rule (browser session only), so the chat can never reach it.
  z.object({ action: z.literal('not_this_week'), item_key: itemKeySchema }).strict(),
  // Slice 4d: a private 30 minute block on his own calendar. The slot is picked here; the machine makes the event.
  z.object({ action: z.literal('book_block'), item_key: itemKeySchema }).strict(),
  // Slice 8b: I did this on a project next step. Writes only his home_item_state row; the project's refresh is the browser's own call.
  z.object({ action: z.literal('step_done'), item_key: itemKeySchema }).strict(),
  // Session card: clear the question a session parked on him. Writes only his home_item_state row; the session's own record is never touched.
  z.object({ action: z.literal('clear_session'), item_key: itemKeySchema }).strict(),
  // Slice 9a: a card from his sent mail. There is deliberately no track_it and no log_time here: they create a time entry, and the only
  // door that can is POST /api/home/reconcile (session only). proposal_yes on a Track it card answers 400 "Tap this on the home screen."
  z.object({ action: z.literal('proposal_yes'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('proposal_no'), item_key: itemKeySchema }).strict(),
  // Work stage G: the looks-finished card. Closing goes through the normal task status path; the three acts are the owner's own taps
  // (the chat may call them: it is his word). The ticked list is at most 100 keys.
  z.object({ action: z.literal('finished_close'), item_keys: z.array(itemKeySchema).min(1).max(100) }).strict(),
  z.object({ action: z.literal('finished_close_one'), item_key: itemKeySchema }).strict(),
  z.object({ action: z.literal('finished_keep'), item_key: itemKeySchema }).strict(),
  // Work stage B: Undo of a mail recorded as handled. The key is `ask:<EmailAsk id>` (not a home item key: it names one email).
  z.object({ action: z.literal('reopen_ask'), item_key: z.string().max(60).regex(ASK_REF_RE, 'Not a recorded email') }).strict(),
  // Do it on a day: park the item until the day he picked (his own rows only; the day is checked against today in his zone).
  // Snooze: a short park (15 minutes to 24 hours). Exactly one of until (an ISO instant) and hours (1 to 4).
  z
    .object({
      action: z.literal('snooze'),
      item_key: itemKeySchema,
      until: z.string().datetime({ offset: true }).optional(),
      hours: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    })
    .strict()
    .refine((v) => (v.until === undefined) !== (v.hours === undefined), { message: 'Send either until or hours.' }),
  z.object({ action: z.literal('on_day'), item_key: itemKeySchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ON_DAY_BAD_DAY) }).strict(),
]);

export const homeUndoSchema = z.object({ action_id: z.string().uuid(), wrong: z.literal(true).optional() }).strict();

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
  no_suggestion: 'Bast has no suggested answer for this one yet.',
  already_drafted: 'The draft is already in your Gmail. It stays there.',
  book_off: BOOK_COPY.off,
  book_not_ready: BOOK_COPY.notReady,
  already_booked: BOOK_COPY.alreadyBooked,
  no_free_slot: NO_FREE_SLOT,
};

/** What a tap on a thread asks of Bast, and the line Mike reads back. */
const OWED_TAPS = {
  draft_now: { kind: 'draft', message: 'Bast will draft this in the next few minutes.' },
  needs_thought: { kind: 'read', message: "Bast will write its read on this thread in the next few minutes." },
  go_with_that: { kind: 'go_with_that', message: 'Bast will redraft it along that line.' },
} as const satisfies Record<string, { kind: OwedRequestKind; message: string }>;
const UNDONE_DRAFT_TEXT = 'The draft is already in your Gmail. It stays there.';

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
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
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
  'keeper_hold_until',
  'read_hard_due_at',
  'dates_read_at',
  'card_summary_at',
  'parked_at',
  'step_done_at',
  'session_cleared_at',
  'on_day',
  'snoozed_until',
  'snooze_day',
]);

/** Every field an action may change, with its default on a row that does not exist. */
const STATE_DEFAULTS: Record<string, number | string | null> = {
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
  view_set_by: null,
  keeper_hold_until: null,
  read_hard_due_at: null,
  read_hard_due_source: null,
  dates_read_at: null,
  card_summary: null,
  card_checklist: null,
  card_summary_hash: null,
  card_summary_at: null,
  parked_at: null,
  step_done_at: null,
  step_done_text: null,
  session_cleared_at: null,
  session_cleared_hash: null,
  on_day: null,
  snoozed_until: null,
  snooze_count: 0,
  snooze_day: null,
};

/** A stored field value: a number, a string, null, or (card_checklist only) plain JSON. */
type FieldValue = number | string | null | object;
type StateFields = Record<string, FieldValue>;

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

/**
 * Slice 2c: a change outside the home screen's own rows, stored in the before and after sides of an action row
 * (the same record sits on both, so Undo can compare what the row holds now with what the action wrote).
 * - create: the keeper made an arc and linked these tasks to it.
 * - close: the keeper closed an arc; closed_at is the value it wrote.
 * - link: his add or remove on today's arc was copied onto one task's arc_id (to_arc_id null on a remove).
 */
export type ArcRecord =
  | { kind: 'create'; arc_id: string; client_id: string | null; project_id: string | null; task_ids: string[] }
  | { kind: 'close'; arc_id: string; closed_at: string }
  | { kind: 'link'; task_id: string; from_arc_id: string | null; to_arc_id: string | null };

/** Slice 4a: the request fields a tap on a thread replaced, so Undo can put them back while no run has served it. */
interface OwedRecord {
  item_key: string;
  kind: OwedRequestKind;
  before: { request_kind: string | null; requested_at: string | null };
}

/** Slice 4c: the lead marks a tap wrote, so Undo can put them back while they still hold what the tap wrote. */
interface OwedMarkRecord {
  item_key: string;
  before: OwedMarkValues;
  after: OwedMarkValues;
}

interface UndoSide {
  states: StateRecord[];
  owedMark?: OwedMarkRecord;
  day?: DayRecord;
  arcs?: ArcRecord[];
  owed?: OwedRecord;
  /** Slice 4d: a booking request, so Undo can clear it (before the event exists) or ask for that one event to be deleted. */
  book?: { item_key: string; who?: string; start?: string; end?: string };
}

function toJsonValue(v: unknown): FieldValue {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined || v === null) return null;
  return v as FieldValue;
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
  /** For step_done: Project.next_step_text now, read inside the transaction (never taken from the request). */
  stepText?: string | null;
  /** For clear_session: the session's waiting_on now (the ask in view), read inside the transaction (never taken from the request). */
  sessionAsk?: string | null;
  /** For on_day: the item's hard, promised or lifeline end date (read before the transaction), or null. */
  hardDate?: Date | null;
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
  /** Snooze: Undo ends when the snooze does (never later than the usual window). */
  undoUntil?: Date;
  /** True for every action but record. */
  undoable: boolean;
  /** For record: what was logged. */
  recorded?: { did: string; undo: boolean };
  /** Slice 4a: the request this action makes of Bast on the thread (home_owed_thread request fields only). */
  owed?: { kind: OwedRequestKind };
  /** Slice 4c: lead marks written on his own home_owed_thread row (Keep it, Treat as a reply). */
  leadMark?: Partial<Record<'lead_clock_from' | 'keep_lead_at' | 'not_lead_at', Date | null>>;
  /** Slice 4d: Book 30 minutes (the slot is picked inside the transaction). */
  book?: true;
  message: string | null;
}

function fieldsOf(patch: HomeItemStatePatch, from: RawItemState | null, side: 'before' | 'after'): StateFields {
  const out: StateFields = {};
  for (const key of Object.keys(patch) as StateFieldName[]) {
    if (key === 'last_shown_at') continue;
    if (side === 'after') {
      out[key] = toJsonValue(patch[key]);
    } else {
      const prior = from ? (from as unknown as Record<string, unknown>)[key] : STATE_DEFAULTS[key];
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

/** Today's civil day in his zone as the parts dayToDate takes. */
function checkDayOf(now: Date, timeZone: string): { y: number; m: number; d: number } {
  const [y, m, d] = zonedDateString(now, timeZone).split('-').map(Number);
  return { y, m, d };
}

/** Pure: what one request does. Throws HomeActError for a refused request. */
export function planAct(req: HomeActRequest, ctx: ActContext): ActPlan {
  const { now } = ctx;
  const base = { undoable: true, dayWrite: null as ActPlan['dayWrite'] };

  switch (req.action) {
    case 'bring_forward':
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [
          { item_key: req.item_key, from: ctx.state, patch: { boosted_at: now, view_at: null, view_set_by: null } },
        ],
        message: 'Moved to the front of Next.',
      };

    case 'not_now': {
      const count = ctx.state?.park_count ?? 0;
      if (count === 0) {
        const next = nextBusinessDayMorning(now, ctx.timezone);
        return {
          ...base,
          action: req.action,
          item_key: req.item_key,
          stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { park_count: 1, view_at: next.at, view_set_by: 'user', parked_at: now, on_day: null, snoozed_until: null } }],
          message: next.daysAhead === 1 ? 'Back tomorrow at 9:00.' : `Back ${next.weekday} at 9:00.`,
        };
      }
      if (count === 1) {
        const back = new Date(now.getTime() + NOT_NOW.secondReturnDays * 24 * 3600 * 1000);
        return {
          ...base,
          action: req.action,
          item_key: req.item_key,
          stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { park_count: 2, view_at: back, view_set_by: 'user', parked_at: now, on_day: null, snoozed_until: null } }],
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
            patch: { park_count: Math.min(count + 1, NOT_NOW.choicesOnlyAtParkCount), view_at: null, view_set_by: 'user', on_day: null, snoozed_until: null },
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
      if (parseItemKey(req.item_key)?.kind === 'step') throw new ApiError('A project next step is not added to the arc.', 400);
      if (parseItemKey(req.item_key)?.kind === 'proposal') throw new ApiError('A card from your sent mail is not added to the arc.', 400);
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

    case 'draft_now':
    case 'needs_thought':
    case 'go_with_that': {
      if (parseItemKey(req.item_key)?.kind !== 'thread') throw new HomeActError('not_found', 'That is not an email thread.');
      const tap = OWED_TAPS[req.action];
      return { ...base, action: req.action, item_key: req.item_key, stateWrites: [], owed: { kind: tap.kind }, message: tap.message };
    }

    case 'not_this_week': {
      if (req.item_key !== HANDS_ITEM_KEY) throw new HomeActError('not_found', 'That is not the weekly hands row.');
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [
          { item_key: req.item_key, from: ctx.state, patch: { view_at: nextHandsMonday(now, ctx.timezone), view_set_by: 'user' } },
        ],
        message: HANDS_PARKED_MESSAGE,
      };
    }

    case 'step_done': {
      if (parseItemKey(req.item_key)?.kind !== 'step') throw new HomeActError('not_found', 'That is not a project next step.');
      if (ctx.stepText == null) throw new HomeActError('not_found', 'That project step is not yours any more.');
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { step_done_at: now, step_done_text: stepTextToStore(ctx.stepText) } }],
        message: STEP_DONE_MESSAGE,
      };
    }

    case 'clear_session': {
      if (parseItemKey(req.item_key)?.kind !== 'session') throw new HomeActError('not_found', 'That is not a session question.');
      if (ctx.sessionAsk == null) throw new HomeActError('not_found', 'That session has no question for you any more.');
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch: { session_cleared_at: now, session_cleared_hash: sessionAskHash(ctx.sessionAsk) } }],
        message: SESSION_CLEARED_MESSAGE,
      };
    }

    case 'snooze': {
      if (parseItemKey(req.item_key) === null || parseItemKey(req.item_key)?.kind === 'hands') throw new HomeActError('not_found', 'That item cannot be snoozed.');
      const until = snoozeInstant(req, now);
      const count = snoozeCountToday(ctx.state, now, ctx.timezone);
      // The same parking as on_day, on a short clock. It leaves Working on too. park_count, the weights and today's list rows are untouched:
      // the item comes back to its own place when the snooze ends.
      const patch: HomeItemStatePatch = {
        view_at: until,
        view_set_by: 'user',
        parked_at: now,
        snoozed_until: until,
        snooze_count: count,
        snooze_day: dayToDate(checkDayOf(now, ctx.timezone)),
        on_day: null,
      };
      if (ctx.state?.working_since) patch.working_since = null;
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch }],
        message: snoozeMessage(until, now, ctx.timezone, ctx.hardDate ?? null, count),
        undoUntil: new Date(Math.min(until.getTime(), now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000)),
      };
    }

    case 'on_day': {
      if (parseItemKey(req.item_key) === null || parseItemKey(req.item_key)?.kind === 'hands') throw new HomeActError('not_found', 'That item cannot be set for a day.');
      const today = zonedDateString(now, ctx.timezone);
      const picked = checkOnDay(req.date, today);
      const viewAt = zonedToUtc(picked.y, picked.m, picked.d, 0, 5, ctx.timezone);
      // It leaves Working on too (like Stop for now, without the note). park_count and the weights are not touched.
      const patch: HomeItemStatePatch = { view_at: viewAt, view_set_by: 'user', parked_at: now, on_day: dayToDate(picked), snoozed_until: null };
      if (ctx.state?.working_since) patch.working_since = null;
      // Today's list: the item leaves Quick and the steps (the day row only; no arc_removed marker, so it can come back on its day).
      let dayWrite: ActPlan['dayWrite'] = null;
      const day = ctx.day;
      if (day && (day.quick_item_keys.includes(req.item_key) || day.step_item_keys.includes(req.item_key))) {
        const afterDay: RawHomeDay = {
          ...day,
          quick_item_keys: day.quick_item_keys.filter((k) => k !== req.item_key),
          step_item_keys: day.step_item_keys.filter((k) => k !== req.item_key),
        };
        dayWrite = {
          date: day.date,
          patch: { quick_item_keys: afterDay.quick_item_keys, step_item_keys: afterDay.step_item_keys },
          before: { date: day.date, group_key: day.group_key, kind: 'rewrite', snapshot: snapshotDay(day) },
          after: { date: day.date, group_key: day.group_key, kind: 'rewrite', snapshot: snapshotDay(afterDay) },
        };
      }
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [{ item_key: req.item_key, from: ctx.state, patch }],
        dayWrite,
        message: onDayMessage(picked, today, ctx.hardDate ?? null),
      };
    }

    case 'keep_lead':
    case 'treat_as_reply': {
      if (parseItemKey(req.item_key)?.kind !== 'thread') throw new HomeActError('not_found', 'That is not an email thread.');
      const keep = req.action === 'keep_lead';
      return {
        ...base,
        action: req.action,
        item_key: req.item_key,
        stateWrites: [],
        leadMark: keep ? { lead_clock_from: now, keep_lead_at: now } : { not_lead_at: now },
        message: keep ? KEEP_LEAD_MESSAGE : TREAT_AS_REPLY_MESSAGE,
      };
    }

    case 'book_block': {
      if (parseItemKey(req.item_key)?.kind !== 'thread') throw new HomeActError('not_found', 'That is not an email thread.');
      return { ...base, action: req.action, item_key: req.item_key, stateWrites: [], book: true, message: null };
    }

    case 'proposal_yes':
    case 'proposal_no':
    case 'finished_close':
    case 'finished_close_one':
    case 'finished_keep':
    case 'reopen_ask':
      // Run by runHomeAct (lib/home/reconcile/apply.ts, lib/work/finished-store.ts), never planned here.
      throw new HomeActError('not_found', 'That is not a home change.');

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

/** For on_day: the item's hard, promised or lifeline end date as the screen reads it now (read only, before the transaction). */
async function resolveHardDate(db: PrismaClient, userId: string, itemKey: string, opts: RunOptions): Promise<Date | null> {
  const raw = await loadHomeInputs(db, userId, opts.now, { timezone: opts.timezone });
  const states = await loadItemStates(db, userId);
  const c = selectHome({ raw, states, now: opts.now }).byKey.get(itemKey);
  return c ? (c.hardDate ?? c.score.hardDate ?? null) : null;
}

const CLOSED_STATUSES = [...CLOSED_TASK_STATUSES];

/**
 * Slice 2c, arcs_link_tasks. Only for arc_add and arc_remove on a day whose group is a real arc. The switch is read
 * here, inside the transaction. Writes only a task assigned to `userId` (never another person's, never a bot's):
 * add sets arc_id when it is null, remove clears it only when it still equals the day's arc. Returns the records Undo needs.
 */
async function copyArcEditToTask(
  tx: HomeDb,
  userId: string,
  req: HomeActRequest,
  day: RawHomeDay | null
): Promise<ArcRecord[]> {
  if (req.action !== 'arc_add' && req.action !== 'arc_remove') return [];
  if (!day || !day.arc_id) return [];
  const parsed = parseItemKey(req.item_key);
  if (!parsed || parsed.kind !== 'task') return [];
  const settings = await tx.homeKeeperSettings.findUnique({ where: { user_id: userId }, select: { arcs_link_tasks: true } });
  if (settings?.arcs_link_tasks !== true) return [];
  if (req.action === 'arc_add') {
    const open = await tx.arc.findFirst({ where: { id: day.arc_id, closed_at: null }, select: { id: true } });
    if (!open) return [];
    const r = await tx.task.updateMany({
      where: { id: parsed.id, assignee_id: userId, arc_id: null, is_deleted: false, status: { notIn: CLOSED_STATUSES } },
      data: { arc_id: day.arc_id },
    });
    return r.count === 1 ? [{ kind: 'link', task_id: parsed.id, from_arc_id: null, to_arc_id: day.arc_id }] : [];
  }
  const r = await tx.task.updateMany({
    where: { id: parsed.id, assignee_id: userId, arc_id: day.arc_id, is_deleted: false },
    data: { arc_id: null },
  });
  return r.count === 1 ? [{ kind: 'link', task_id: parsed.id, from_arc_id: day.arc_id, to_arc_id: null }] : [];
}

/** Do one home-only action for `userId`. Throws HomeActError for a refused request. */
export async function runHomeAct(
  db: PrismaClient,
  userId: string,
  req: HomeActRequest,
  opts: RunOptions
): Promise<HomeActResponse> {
  // Slice 9a: a tap on a card from his sent mail (its own writers; see lib/home/reconcile/apply.ts).
  if (req.action === 'proposal_no') return proposalNo(db, userId, req.item_key, opts.now);
  // Work stage G: the looks-finished card's taps (their own writers; see lib/work/finished-store.ts).
  if (req.action === 'finished_close') return finishedClose(db, userId, req.item_keys, opts.now);
  if (req.action === 'finished_close_one') return finishedCloseOne(db, userId, req.item_key, opts.now);
  if (req.action === 'finished_keep') return finishedKeep(db, userId, req.item_key, opts.now);
  // Work stage B: Undo of a mail recorded as handled (lib/work/intake.ts). Reopens it as a reply he owes and holds it against re-closing.
  if (req.action === 'reopen_ask') {
    try {
      const r = await reopenAsk(db, userId, req.item_key, opts.now);
      return { ok: true as const, action_id: r.action_id, undo_until: null, item_key: req.item_key, message: HANDLED_MAIL.undone };
    } catch (e) {
      if (e instanceof IntakeError) throw new HomeActError(e.code === 'undo_expired' ? 'undo_expired' : 'not_found', e.message);
      throw e;
    }
  }
  if (req.action === 'proposal_yes') return proposalYes(db, userId, req.item_key, { now: opts.now, timezone: opts.timezone, allowTime: false, minutes: null });

  let targetDay: ProposedDay | null | undefined;
  if (req.action === 'swap' || req.action === 'lighter') {
    const resolved = await resolveTargetDay(db, userId, req, opts);
    if (resolved === 'no_day') throw new HomeActError('stale_day');
    targetDay = resolved;
  }

  let hardDate: Date | null = null;
  if (req.action === 'snooze') {
    snoozeInstant(req, opts.now); // a bad time is a 400 before anything is read
    hardDate = await resolveHardDate(db, userId, req.item_key, opts);
  }
  if (req.action === 'on_day') {
    checkOnDay(req.date, zonedDateString(opts.now, opts.timezone)); // a bad day is a 400 before anything is read
    hardDate = await resolveHardDate(db, userId, req.item_key, opts);
  }

  return db.$transaction(async (tx) => {
    const itemKey = 'item_key' in req ? req.item_key : null;
    const [state, pinned, day] = await Promise.all([
      itemKey ? getItemState(tx, userId, itemKey) : Promise.resolve(null),
      req.action === 'pin' ? findPinnedItemState(tx, userId) : Promise.resolve(null),
      req.action === 'on_day' || req.action === 'arc_add' || req.action === 'arc_remove' || req.action === 'arc_reorder' || req.action === 'swap' || req.action === 'lighter'
        ? getHomeDay(tx, userId, opts.date)
        : Promise.resolve(null),
    ]);

    // Slice 8b: the step text is read here, as the project holds it now, and only for a step that is his.
    let stepText: string | null = null;
    if (req.action === 'step_done') {
      const parsed = parseItemKey(req.item_key);
      if (parsed?.kind === 'step') {
        const project = await tx.project.findFirst({
          where: { id: parsed.project_id, status: 'in_progress', next_step_owner_id: userId, next_step_source: { in: ['bast', 'mike'] } },
          select: { next_step_text: true },
        });
        stepText = project?.next_step_text ?? null;
      }
    }

    // Session card: the ask is read here, as the session holds it now, and only when it is one he is shown (not already cleared).
    let sessionAsk: string | null = null;
    if (req.action === 'clear_session') {
      const parsed = parseItemKey(req.item_key);
      if (parsed?.kind === 'session') {
        const asks = await loadSessionAsks(tx as unknown as PrismaClient);
        sessionAsk = asks.find((a) => a.external_id === parsed.external_id)?.waiting_on ?? null;
      }
    }

    const plan = planAct(req, { now: opts.now, timezone: opts.timezone, state, pinned, day, targetDay, stepText, sessionAsk, hardDate });

    for (const w of plan.stateWrites) {
      await upsertItemState(tx, userId, w.item_key, w.patch);
    }
    if (plan.dayWrite) {
      const changed = await updateHomeDay(tx, userId, plan.dayWrite.date, plan.dayWrite.patch);
      if (changed === 0) throw new HomeActError('stale_day');
    }

    // Slice 4a: a tap on a thread. Only the request fields of his own owed row change; nothing is sent.
    let owedRecord: OwedRecord | undefined;
    if (plan.owed && plan.item_key) {
      const parsed = parseItemKey(plan.item_key);
      if (parsed?.kind === 'thread') {
        const open = await tx.emailAsk.findFirst({
          where: {
            account: parsed.account,
            state: 'open',
            OR: [{ thread_id: parsed.thread_id }, { thread_id: null, message_id: parsed.thread_id }],
          },
          select: { id: true },
        });
        if (!open) throw new HomeActError('not_found', 'That thread is not waiting on a reply any more.');
      }
      const res = await requestOwed(tx, userId, plan.item_key, plan.owed.kind, opts.now);
      if (!res.ok) throw new HomeActError(res.reason);
      owedRecord = { item_key: plan.item_key, kind: plan.owed.kind, before: res.before };
    }

    // Slice 4c: a lead mark. Only his own owed row changes; nothing is sent.
    let markRecord: OwedMarkRecord | undefined;
    if (plan.leadMark && plan.item_key) {
      const parsed = parseItemKey(plan.item_key);
      if (parsed?.kind === 'thread') {
        const open = await tx.emailAsk.findFirst({
          where: { account: parsed.account, state: 'open', OR: [{ thread_id: parsed.thread_id }, { thread_id: null, message_id: parsed.thread_id }] },
          select: { id: true },
        });
        if (!open) throw new HomeActError('not_found', 'That thread is not waiting on a reply any more.');
      }
      const res = await markOwed(tx, userId, plan.item_key, plan.leadMark);
      if (!res.ok) throw new HomeActError('not_found');
      markRecord = { item_key: plan.item_key, before: res.before, after: res.after };
    }

    // Slice 4d: Book 30 minutes. Only his own owed row changes (the request and the picked slot); nothing is sent or created here.
    let bookRecord: { item_key: string; who: string; start: string; end: string } | undefined;
    let bookMessage: string | null = null;
    if (plan.book && plan.item_key) {
      const parsed = parseItemKey(plan.item_key);
      if (parsed?.kind === 'thread') {
        const open = await tx.emailAsk.findFirst({
          where: { account: parsed.account, state: 'open', OR: [{ thread_id: parsed.thread_id }, { thread_id: null, message_id: parsed.thread_id }] },
          orderBy: { received_at: 'desc' },
          select: { from_name: true, from_email: true },
        });
        if (!open) throw new HomeActError('not_found', BOOK_COPY.noThread);
        const res = await requestBook(tx, userId, plan.item_key, opts.now, opts.timezone);
        if (!res.ok) throw new HomeActError(res.reason);
        const who = (open.from_name ?? '').replace(/["<>]/g, '').trim() || open.from_email.split('@')[0] || 'them';
        bookRecord = { item_key: plan.item_key, who, start: res.slot.start.toISOString(), end: res.slot.end.toISOString() };
        bookMessage = bookLine(who, res.slot.start, opts.timezone);
      }
    }

    // Slice 2c: with his switch on, an add or remove on today's real arc is copied onto his own task's arc_id.
    const arcLinks = await copyArcEditToTask(tx, userId, req, day);

    const undoUntil = plan.undoable ? (plan.undoUntil ?? new Date(opts.now.getTime() + UNDO_WINDOW_HOURS * 3600 * 1000)) : null;
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
        ...(arcLinks.length > 0 ? { arcs: arcLinks } : {}),
        ...(owedRecord ? { owed: owedRecord } : {}),
        ...(markRecord ? { owedMark: markRecord } : {}),
        ...(bookRecord ? { book: bookRecord } : {}),
      };
      after = {
        states: plan.stateWrites.map((w) => ({ item_key: w.item_key, fields: fieldsOf(w.patch, w.from, 'after') })),
        ...(plan.dayWrite ? { day: plan.dayWrite.after } : {}),
        ...(arcLinks.length > 0 ? { arcs: arcLinks } : {}),
        ...(owedRecord ? { owed: owedRecord } : {}),
        ...(markRecord ? { owedMark: markRecord } : {}),
        ...(bookRecord ? { book: bookRecord } : {}),
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
      message: plan.message ?? bookMessage,
    };
  });
}

// ============================================================================
// Undo
// ============================================================================

function reviveField(name: string, v: unknown): number | string | Date | object | null {
  if (v === null || v === undefined) return null;
  if (DATE_FIELDS.has(name as StateFieldName)) return new Date(String(v));
  return v as number | string | object;
}

/** The visible fields a keeper Undo puts back. The markers (dates_read_at, card_summary_hash) are never reverted. */
export const KEEPER_UNDO_FIELDS: readonly string[] = [
  'view_at',
  'view_set_by',
  'read_hard_due_at',
  'read_hard_due_source',
  'card_summary',
  'card_checklist',
];

/** How long a keeper Undo keeps the keeper away from the item. */
export const KEEPER_HOLD_DAYS = 30;

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * Undo of one keeper record: compare-and-set. A visible field goes back only when the row still
 * holds what the keeper wrote (the record's after value); a field Mike changed since is left alone.
 * Whatever happens, the item gets keeper_hold_until = now + 30 days so the next night skips it.
 */
async function undoKeeperRecord(
  db: HomeDb,
  userId: string,
  rec: StateRecord,
  afterFields: StateFields | undefined,
  now: Date
): Promise<void> {
  const hold = new Date(now.getTime() + KEEPER_HOLD_DAYS * 24 * 3600 * 1000);
  const current = await getItemState(db, userId, rec.item_key);
  const patch: Record<string, unknown> = { keeper_hold_until: hold };
  if (current && afterFields) {
    for (const name of KEEPER_UNDO_FIELDS) {
      if (!(name in rec.fields) || !(name in afterFields)) continue;
      const now_ = (current as unknown as Record<string, unknown>)[name];
      if (sameValue(now_, afterFields[name])) patch[name] = reviveField(name, rec.fields[name]);
    }
  }
  await upsertItemState(db, userId, rec.item_key, patch as HomeItemStatePatch);
}

/**
 * Undo of the arc records on one action. Compare-and-set throughout; nothing is ever deleted.
 * - create: closes the arc if it is still open (and no other human's open task sits on it), and unlinks only the
 *   recorded tasks that are still his and still point at it.
 * - close: reopens the arc only if closed_at still holds the value the keeper wrote.
 * - link: puts the task's arc_id back only if it still holds what the edit wrote and the task is still his.
 */
async function undoArcRecord(db: HomeDb, userId: string, rec: ArcRecord, now: Date): Promise<void> {
  if (rec.kind === 'create') {
    if (rec.task_ids.length > 0) {
      await db.task.updateMany({
        where: { id: { in: rec.task_ids }, arc_id: rec.arc_id, assignee_id: userId },
        data: { arc_id: null },
      });
    }
    const others = await db.task.count({
      where: {
        arc_id: rec.arc_id,
        is_deleted: false,
        status: { notIn: CLOSED_STATUSES },
        assignee_id: { notIn: [userId, ...BOT_USER_IDS] },
      },
    });
    if (others === 0) await db.arc.updateMany({ where: { id: rec.arc_id, closed_at: null }, data: { closed_at: now } });
    return;
  }
  if (rec.kind === 'close') {
    await db.arc.updateMany({ where: { id: rec.arc_id, closed_at: new Date(rec.closed_at) }, data: { closed_at: null } });
    return;
  }
  await db.task.updateMany({
    where: { id: rec.task_id, arc_id: rec.to_arc_id, assignee_id: userId },
    data: { arc_id: rec.from_arc_id },
  });
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
    row.last_shown_at === null &&
    (row.view_set_by ?? null) === null &&
    (row.keeper_hold_until ?? null) === null &&
    (row.read_hard_due_at ?? null) === null &&
    (row.dates_read_at ?? null) === null &&
    (row.card_summary ?? null) === null &&
    (row.parked_at ?? null) === null &&
    (row.step_done_at ?? null) === null &&
    (row.step_done_text ?? null) === null &&
    (row.session_cleared_at ?? null) === null &&
    (row.session_cleared_hash ?? null) === null &&
    (row.on_day ?? null) === null &&
    (row.snoozed_until ?? null) === null &&
    (row.snooze_count ?? 0) === 0 &&
    (row.snooze_day ?? null) === null
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
        view_set_by: null,
        keeper_hold_until: null,
        read_hard_due_at: null,
        dates_read_at: null,
        card_summary: null,
        parked_at: null,
        step_done_at: null,
        step_done_text: null,
        session_cleared_at: null,
        session_cleared_hash: null,
        on_day: null,
        snoozed_until: null,
        snooze_count: 0,
        snooze_day: null,
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
  const patch: { step_item_keys: string[]; quick_item_keys?: string[] } = { step_item_keys: steps };
  // An undone removal puts the item back as a step, so it must not also sit in Quick.
  if (before.kind === 'remove' && day.quick_item_keys.includes(before.key)) {
    patch.quick_item_keys = day.quick_item_keys.filter((k) => k !== before.key);
  }
  await updateHomeDay(db, userId, before.date, patch);
  return true;
}

/** Undo one of the caller's own home-only actions. Throws HomeActError when refused. */
export async function runHomeUndo(
  db: PrismaClient,
  userId: string,
  actionId: string,
  now: Date,
  opts: { wrong?: boolean } = {}
): Promise<HomeUndoResponse> {
  return db.$transaction(async (tx) => {
    const row = await getHomeAction(tx, userId, actionId);
    if (!row) throw new HomeActError('not_found');
    // Slice 9a: "This was wrong" exists only on a line the sent-mail reconciler wrote. Any other row is refused.
    if (opts.wrong && row.source !== 'reconcile') throw new HomeActError('not_undoable', 'That cannot be marked wrong.');
    if (row.undone_at) throw new HomeActError('undo_used');
    // Slice 4a: the keeper's "Drafted replies" line has no Undo; the drafts are his to keep or discard in Gmail.
    if (row.action === OWED_ACTION) throw new HomeActError('not_undoable', UNDONE_DRAFT_TEXT);
    // Slice 4b: a press on "Send the draft" is undone only on the home screen (POST /api/home/undo cancels the held send). Any other
    // caller of this function, the chat included, is refused.
    if (row.action === 'send_draft') throw new HomeActError('not_undoable', 'Undo that on the home screen.');
    // Slice 6a: a saved rule is undone through its own store (it retracts the Decision); the generic undo would leave it confirmed.
    if (row.action === RULE_ACTION) throw new HomeActError('not_undoable', 'A saved rule is removed from its own line under Handled for you.');
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

    // Slice 9a: a reconcile record (a note, Track it, Log time, a done, a wait). Compare-and-set; nothing is deleted. A 30 day hold follows.
    const rec = readRecord(row.before);
    let reconcileMessage: string | null = null;
    if (rec) {
      const out = await undoReconcileRecord(tx as unknown as PrismaClient, userId, rec, now);
      reconcileMessage = out.message;
      await afterUndo(tx as unknown as PrismaClient, userId, rec, now, opts.wrong === true);
    }

    // Work stage A: emails closed with their task (or by the one-time tidy). Reopens only asks still handled with the reason the
    // close wrote, then holds the task 30 days so nothing closes them again.
    if (row.action === WORK_CLOSE_ACTION) {
      const closeRec = readWorkCloseRecord(row.before);
      if (closeRec) await undoWorkClose(tx as unknown as PrismaClient, userId, closeRec, now);
    }

    // Work stage B: a batch of mail recorded as handled, or a booked meeting. Reopens exactly those asks (still handled with the reason the close wrote).
    if (row.action === INTAKE_CLOSE_ACTION) {
      const rec = readIntakeCloseRecord(row.before);
      if (rec) await undoIntakeClose(tx, rec);
    }

    // Work stage G: tasks closed from the looks-finished card, and a Not finished. Compare-and-set; anything changed since stays.
    if (row.action === FINISHED_ACTION) {
      const fin = readFinishedRecord(row.before);
      if (fin) await undoFinishedClose(tx, userId, fin, now);
    }
    if (row.action === FINISHED_KEEP_ACTION) {
      const keepId = (before as unknown as { finished_keep?: { item_id?: string } }).finished_keep?.item_id;
      if (keepId) await undoFinishedKeep(tx, userId, keepId);
    }

    // Slice 4a: a tap Undo clears only while no run has served it; after that the draft exists and stays.
    if (before.owed) {
      const cleared = await clearOwedRequest(tx, userId, before.owed.item_key, before.owed.kind, before.owed.before);
      if (!cleared) throw new HomeActError('not_undoable', UNDONE_DRAFT_TEXT);
    }

    // Slice 4d: before the event exists Undo clears the request; after, it asks the machine to delete that one event.
    if (before.book) await undoBook(tx, userId, before.book.item_key, now);

    if (before.owedMark) await undoOwedMark(tx, userId, before.owedMark.item_key, before.owedMark.before, before.owedMark.after);

    if (row.source === 'keeper') {
      for (const rec of before.states) {
        const afterRec = after?.states?.find((r) => r.item_key === rec.item_key);
        await undoKeeperRecord(tx, userId, rec, afterRec?.fields, now);
      }
    } else {
      for (const rec of before.states) await undoStateRecord(tx, userId, rec);
    }
    // Slice 7b: a learned weight (a Learned line, or a Put back). Compare-and-set; the key is held 30 days after a Learned undo.
    const weightsAfter = weightRecords(row.after);
    for (const rec of weightRecords(row.before)) {
      await undoWeightRecord(tx, userId, rec, weightsAfter.find((w) => w.evidence_key === rec.evidence_key), now);
    }
    if (before.day) await undoDayRecord(tx, userId, before.day, after?.day);
    for (const rec of before.arcs ?? []) await undoArcRecord(tx, userId, rec, now);

    return { ok: true as const, action_id: actionId, item_key: row.item_key, ...(reconcileMessage ? { message: reconcileMessage } : {}) };
  });
}

/** Re-exported so the routes need one import for date handling. */
export { dateString };
