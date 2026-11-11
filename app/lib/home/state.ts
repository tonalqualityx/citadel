/**
 * Home screen Slice 1: reads and writes of the three home-only tables, always for one user.
 *
 * Every function takes the user id and puts `user_id` in every where clause (and in every
 * create), so nothing here can read or write another user's rows. Nothing here touches a
 * shared record. The write helpers take a `db` that is either the PrismaClient or a
 * transaction client, so act and undo can run a write and its home_actions row in one
 * `prisma.$transaction`.
 *
 * Dates: home_day.date is @db.Date. The contract (types.ts RawHomeDay) uses 'YYYY-MM-DD'
 * strings; dateOnly / dateString convert both ways at midnight UTC.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { RawHomeDay, RawItemState } from './types';

/** A PrismaClient or the client handed to a $transaction callback. */
export type HomeDb = PrismaClient | Prisma.TransactionClient;

// ============================================================================
// Date helpers
// ============================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' to the Date Prisma wants for a @db.Date column (midnight UTC). Throws on a bad string. */
export function dateOnly(date: string): Date {
  if (!DATE_RE.test(date)) throw new Error(`Invalid home date: ${date}`);
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid home date: ${date}`);
  }
  return d;
}

/** A @db.Date value back to 'YYYY-MM-DD'. */
export function dateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// home_item_state
// ============================================================================

const ITEM_STATE_SELECT = {
  item_key: true,
  park_count: true,
  view_at: true,
  boosted_at: true,
  not_emergency_at: true,
  working_since: true,
  left_off_note: true,
  arc_added_at: true,
  arc_added_group: true,
  arc_removed_at: true,
  arc_removed_group: true,
  first_seen_at: true,
  last_shown_at: true,
  view_set_by: true,
  keeper_hold_until: true,
  read_hard_due_at: true,
  read_hard_due_source: true,
  dates_read_at: true,
  card_summary: true,
  card_checklist: true,
  card_summary_hash: true,
  card_summary_at: true,
  parked_at: true,
  step_done_at: true,
  step_done_text: true,
} as const;

/** Every home_item_state row for the user. */
export async function loadItemStates(db: HomeDb, userId: string): Promise<RawItemState[]> {
  const rows = await db.homeItemState.findMany({
    where: { user_id: userId },
    select: ITEM_STATE_SELECT,
  });
  return rows;
}

/** One item's state row, or null when the user has never acted on it. */
export async function getItemState(db: HomeDb, userId: string, itemKey: string): Promise<RawItemState | null> {
  return db.homeItemState.findFirst({
    where: { user_id: userId, item_key: itemKey },
    select: ITEM_STATE_SELECT,
  });
}

/** The currently pinned item (working_since set), newest pin first, or null. */
export async function findPinnedItemState(db: HomeDb, userId: string): Promise<RawItemState | null> {
  return db.homeItemState.findFirst({
    where: { user_id: userId, working_since: { not: null } },
    orderBy: { working_since: 'desc' },
    select: ITEM_STATE_SELECT,
  });
}

/** The fields an act may change. Omit a field to leave it alone; pass null to clear it. */
export interface HomeItemStatePatch {
  park_count?: number;
  view_at?: Date | null;
  boosted_at?: Date | null;
  not_emergency_at?: Date | null;
  working_since?: Date | null;
  left_off_note?: string | null;
  arc_added_at?: Date | null;
  arc_added_group?: string | null;
  arc_removed_at?: Date | null;
  arc_removed_group?: string | null;
  last_shown_at?: Date | null;
  /** Slice 2: null or 'user' is his Not now; 'keeper' is the nightly sort. */
  view_set_by?: string | null;
  /** Slice 2: the keeper leaves the item alone until this time (set by an Undo of a keeper action). */
  keeper_hold_until?: Date | null;
  read_hard_due_at?: Date | null;
  read_hard_due_source?: string | null;
  dates_read_at?: Date | null;
  /** Slice 2b. */
  card_summary?: string | null;
  /** Slice 2b. JSON; null clears it (written as a database NULL). */
  card_checklist?: Prisma.InputJsonValue | null;
  card_summary_hash?: string | null;
  card_summary_at?: Date | null;
  /** Slice 4c: written by Not now. */
  parked_at?: Date | null;
  /** Slice 8b: "I did this" on a project next step. */
  step_done_at?: Date | null;
  step_done_text?: string | null;
}

/** A patch as Prisma wants it: a null card_checklist becomes a database NULL. */
function toData(patch: HomeItemStatePatch) {
  const { card_checklist, ...rest } = patch;
  if (card_checklist === undefined) return { ...rest };
  return { ...rest, card_checklist: card_checklist === null ? Prisma.DbNull : card_checklist };
}

/**
 * Create the row (first_seen_at defaults to now) or apply the patch to it. The unique key is
 * (user_id, item_key), so two racing first writes cannot make two rows.
 */
export async function upsertItemState(
  db: HomeDb,
  userId: string,
  itemKey: string,
  patch: HomeItemStatePatch
): Promise<RawItemState> {
  return db.homeItemState.upsert({
    where: { user_id_item_key: { user_id: userId, item_key: itemKey } },
    create: { user_id: userId, item_key: itemKey, ...toData(patch) },
    update: toData(patch),
    select: ITEM_STATE_SELECT,
  });
}

/**
 * Put one item back exactly as a stored before-state had it (undo). Writes every
 * undoable field, so a field that was null before is cleared again. keeper_hold_until and the
 * card_* fields are not restored: a hold is set by the Undo itself, and summaries are not an act. When the before-state is
 * null the row did not exist, so it is deleted.
 */
export async function restoreItemState(
  db: HomeDb,
  userId: string,
  itemKey: string,
  before: RawItemState | null
): Promise<void> {
  if (!before) {
    await db.homeItemState.deleteMany({ where: { user_id: userId, item_key: itemKey } });
    return;
  }
  const fields: HomeItemStatePatch = {
    park_count: before.park_count,
    view_at: before.view_at,
    boosted_at: before.boosted_at,
    not_emergency_at: before.not_emergency_at,
    working_since: before.working_since,
    left_off_note: before.left_off_note,
    arc_added_at: before.arc_added_at,
    arc_added_group: before.arc_added_group,
    arc_removed_at: before.arc_removed_at,
    arc_removed_group: before.arc_removed_group,
    // Slice 2: a before-state stored by Slice 1 has none of these, which reads as null.
    view_set_by: before.view_set_by ?? null,
    parked_at: before.parked_at ?? null,
    read_hard_due_at: before.read_hard_due_at ?? null,
    read_hard_due_source: before.read_hard_due_source ?? null,
    dates_read_at: before.dates_read_at ?? null,
    step_done_at: before.step_done_at ?? null,
    step_done_text: before.step_done_text ?? null,
  };
  await upsertItemState(db, userId, itemKey, fields);
}

// ============================================================================
// home_day
// ============================================================================

const DAY_SELECT = {
  id: true,
  date: true,
  group_key: true,
  group_label: true,
  arc_id: true,
  quick_item_keys: true,
  step_item_keys: true,
  sized_minutes: true,
  proposed_at: true,
  started_at: true,
  swapped_from_group: true,
  lighter_at: true,
} as const;

type DayRow = {
  id: string;
  date: Date;
  group_key: string;
  group_label: string;
  arc_id: string | null;
  quick_item_keys: string[];
  step_item_keys: string[];
  sized_minutes: number | null;
  proposed_at: Date;
  started_at: Date | null;
  swapped_from_group: string | null;
  lighter_at: Date | null;
};

function toRawDay(row: DayRow): RawHomeDay {
  return { ...row, date: dateString(row.date) };
}

/** Today's home_day row for the user, or null. */
export async function getHomeDay(db: HomeDb, userId: string, date: string): Promise<RawHomeDay | null> {
  const row = await db.homeDay.findFirst({
    where: { user_id: userId, date: dateOnly(date) },
    select: DAY_SELECT,
  });
  return row ? toRawDay(row) : null;
}

/** What a new day record is made of (everything but the ids, the date and the timestamps). */
export interface HomeDayCreateData {
  group_key: string;
  group_label: string;
  arc_id: string | null;
  quick_item_keys: string[];
  step_item_keys: string[];
  sized_minutes: number | null;
}

/**
 * Read the day's record; when there is none, build it with `build` (only called when needed)
 * and create it. A second request racing the first hits the (user_id, date) unique key
 * (P2002); it then re-reads and returns the winner's row, the same shape as
 * lib/services/today-rollover.ts. Returns the row and whether this call created it.
 */
export async function getOrCreateHomeDay(
  db: HomeDb,
  userId: string,
  date: string,
  build: () => HomeDayCreateData | Promise<HomeDayCreateData>
): Promise<{ day: RawHomeDay; created: boolean }> {
  const existing = await getHomeDay(db, userId, date);
  if (existing) return { day: existing, created: false };

  const data = await build();
  try {
    const row = await db.homeDay.create({
      data: {
        user_id: userId,
        date: dateOnly(date),
        group_key: data.group_key,
        group_label: data.group_label,
        arc_id: data.arc_id,
        quick_item_keys: data.quick_item_keys,
        step_item_keys: data.step_item_keys,
        sized_minutes: data.sized_minutes,
      },
      select: DAY_SELECT,
    });
    return { day: toRawDay(row), created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await getHomeDay(db, userId, date);
      if (winner) return { day: winner, created: false };
    }
    throw error;
  }
}

/** Fields an act may change on the day's record. */
export interface HomeDayPatch {
  group_key?: string;
  group_label?: string;
  arc_id?: string | null;
  quick_item_keys?: string[];
  step_item_keys?: string[];
  sized_minutes?: number | null;
  started_at?: Date | null;
  swapped_from_group?: string | null;
  lighter_at?: Date | null;
}

/** Apply a patch to the day's record. Returns how many rows changed (0 or 1). */
export async function updateHomeDay(db: HomeDb, userId: string, date: string, patch: HomeDayPatch): Promise<number> {
  const result = await db.homeDay.updateMany({
    where: { user_id: userId, date: dateOnly(date) },
    data: { ...patch },
  });
  return result.count;
}

// ============================================================================
// home_actions
// ============================================================================

export interface HomeActionInput {
  item_key: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  undo_until?: Date | null;
  /** Defaults to 'home' (the column's own default). */
  source?: string;
}

export interface RawHomeAction {
  id: string;
  item_key: string | null;
  action: string;
  before: unknown;
  after: unknown;
  undo_until: Date | null;
  undone_at: Date | null;
  source: string;
  created_at: Date;
}

const ACTION_SELECT = {
  id: true,
  item_key: true,
  action: true,
  before: true,
  after: true,
  undo_until: true,
  undone_at: true,
  source: true,
  created_at: true,
} as const;

/** A JSON column value: undefined and null are both left unset (stored as SQL null). */
function jsonValue(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return v as Prisma.InputJsonValue;
}

/** Append one row to home_actions. Rows are never updated except undone_at, never deleted. */
export async function appendHomeAction(db: HomeDb, userId: string, input: HomeActionInput): Promise<RawHomeAction> {
  return db.homeAction.create({
    data: {
      user_id: userId,
      item_key: input.item_key,
      action: input.action,
      before: jsonValue(input.before),
      after: jsonValue(input.after),
      undo_until: input.undo_until ?? null,
      ...(input.source ? { source: input.source } : {}),
    },
    select: ACTION_SELECT,
  });
}

/** One of the user's own action rows, or null (another user's id answers null too). */
export async function getHomeAction(db: HomeDb, userId: string, actionId: string): Promise<RawHomeAction | null> {
  return db.homeAction.findFirst({
    where: { id: actionId, user_id: userId },
    select: ACTION_SELECT,
  });
}

/**
 * Mark an action undone, only when it has not been already. Returns true when this call set
 * undone_at, false when the row was missing, someone else's, or already undone (so a double
 * undo cannot apply twice).
 */
export async function markHomeActionUndone(
  db: HomeDb,
  userId: string,
  actionId: string,
  now: Date
): Promise<boolean> {
  const result = await db.homeAction.updateMany({
    where: { id: actionId, user_id: userId, undone_at: null },
    data: { undone_at: now },
  });
  return result.count === 1;
}
