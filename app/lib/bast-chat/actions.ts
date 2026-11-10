/**
 * Bast chat: the record of what the chat changed, the proposals Mike taps, and Undo (plan v2 sections 1, 2, 4.2, 6).
 *
 * The one guard. A chat change that would start an unattended Bast session on the machine, change what a queued
 * one reads, or show something to a client, does not happen: it is stored as a proposal (`storeProposal`) that
 * Mike confirms with one tap (`releaseAction`). Whether a change "reaches" is decided by the pure module
 * `worker-reach.ts`; everything around the tap and Undo lives here, so that no order of other changes gets round it:
 *
 * - `storeProposal` stores one `proposed` row with the validated plan, the reach result and its fingerprint, and a
 *   card the server writes from the records (what Bast will start or read, the text, the chat-changed flag, what
 *   the client will see, two buttons). It writes nothing else.
 * - `releaseAction` (the tap) claims the row (one winner), re-reads everything, recomputes the reach with origin
 *   `tap` and compares `reachFingerprint()` with the stored one. Any difference, a plan that no longer validates,
 *   or a compare-and-set miss marks the proposal dead ("Changed since. Open the task.") with nothing written.
 *   Otherwise the plan is applied as the OWNER (a session actor), through `patchTask` with `expect` set from the
 *   values stored at proposal time, or through the operation's own `apply`.
 * - `undoAction` puts back what a server-written record changed. It runs the reach check on the state Undo would
 *   restore (rule R6): a hit becomes a new proposal with the same tap rules; otherwise the restore is written as
 *   the owner through `patchTask` (or the operation's `undo`) with a compare-and-set. A later applied chat change on
 *   the same target must be undone first.
 * - `undoSince` walks the chat's applied changes after a point, newest first, through `undoAction`.
 * - Every undo, release, decline, failed tap and Undo-turned-proposal adds one system status event to the
 *   conversation (`appendChatNote` in events.ts), so the chat hears of it on its next turn.
 *
 * Non-task operations (home, comment, email ask, wait, project) plug in through the registry below
 * (`ChatOperation`, `registerChatOperation`). The task kind is shipped here (`taskOperation`).
 *
 * The daily reservation (`reserveWrite`) wraps every chat-lane write and proposal exactly once. Owner taps and owner
 * Undo are the owner acting and are not counted. Reader-facing sentences are plain and short, written by the server.
 */
import { z } from 'zod';
import type { BastChatAction, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { serializeRichText } from '@/lib/api/blocknote';
import { canTransitionTaskStatus } from '@/lib/calculations/status';
import { patchTask, type PatchTaskExpect } from '@/lib/services/task-patch';
import { cleanLine } from './card-context';
import { getSettings } from './settings';
import { assertWriteAllowed, reserveWrite } from './usage';
import { isChatUuid } from './worker-kit';
import { appendChatNote, type ChatNoteCode } from './events';
import { BAST_USER_ID, BOT_USER_IDS } from './gate-mirror';
import {
  checkTaskChange,
  checkUndo,
  reachFingerprint,
  type BlockerRef,
  type ClientShowHit,
  type CommentAuthorKind,
  type ReachHit,
  type ReachOrigin,
  type ReachResult,
  type ReachTask,
  type ReachTaskWithDependents,
  type TaskChange,
} from './worker-reach';

type Db = PrismaClient;
type Json = Prisma.InputJsonValue;

const CHAT_TAG = 'from-chat';
const OWNER_TZ = 'America/New_York';

export const UNDO_WINDOW_HOURS = 24;
export const CHANGED_SINCE_TEXT = 'Changed since. Open the task.';
export const LATER_FIRST_TEXT = 'Undo the later change to this first.';
export const UNDO_PENDING_TEXT = 'That Undo is waiting for your tap.';
export const NOT_WAITING_TEXT = 'That is not waiting for a decision.';
export const CANNOT_UNDO_TEXT = "That can't be undone.";
export const UNDO_TRANSITION_TEXT = "That can't be put back from here. Open the task.";
export const REFUSED_FIELD_TEXT = 'That field is changed on the task page, not here.';
/** v1 names, kept for task-record.ts (S1-C4 widens it to every field in TASK_RECORD_FIELDS). */
export const TASK_FIELDS = ['status', 'title', 'arc_id', 'assignee_id'] as const;
/** v1: recorded beside a status change. Undo ignores `completed_at` now: patchTask sets it from the status. */
export const RESTORE_EXTRA_FIELDS = ['due_date', 'completed_at'] as const;
export const ACTION_TOOLS = ['create_task', 'update_task', 'add_to_arc', 'remove_from_arc', 'propose_handoff'] as const;
const TASK_STATUSES = ['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'] as const;

// ---------------------------------------------------------------------------------------------
// The record format (before and after) of a task change
// ---------------------------------------------------------------------------------------------

/**
 * Every task field a server-written record may carry, by its PATCH body name (plan 1.2). task-record.ts writes
 * `before` and `after` with exactly the keys that changed, each value as the database holds it:
 * - dates as ISO strings (`due_date`), `description` and `notes` as the stored text, `requirements` as stored;
 * - `tags` as the full list; `blocked_by_ids` as the full sorted list of blocker ids (not a connect or disconnect).
 * Undo restores `before[k]` for every `k` in `after`, only when the task still holds `after[k]` for each.
 * A record with any other key cannot be undone (the parse fails, and Undo answers "That can't be undone.").
 */
export const TASK_RECORD_FIELDS = [
  'status', 'title', 'description', 'requirements', 'notes', 'assignee_id', 'project_id', 'client_id', 'site_id',
  'arc_id', 'tags', 'energy_estimate', 'mystery_factor', 'battery_impact', 'due_date', 'promised_to', 'priority',
  'is_focus', 'blocked_by_ids', 'needs_review', 'approved', 'client_visible',
] as const;

const uuidN = z.string().uuid().nullable();
const fieldsSchema = z
  .object({
    status: z.enum(TASK_STATUSES),
    title: z.string().min(1).max(500).refine((s) => s.trim().length > 0),
    description: z.string().max(400_000).nullable(),
    requirements: z.array(z.unknown()).nullable(),
    notes: z.string().max(400_000).nullable(),
    assignee_id: uuidN,
    project_id: uuidN,
    client_id: uuidN,
    site_id: uuidN,
    arc_id: uuidN,
    tags: z.array(z.string().max(50)).max(200),
    energy_estimate: z.number().int().min(1).max(8).nullable(),
    mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']),
    battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']),
    due_date: z.string().datetime().nullable(),
    promised_to: z.string().max(200).nullable(),
    priority: z.number().int().min(1).max(5),
    is_focus: z.boolean(),
    blocked_by_ids: z.array(z.string().uuid()).max(500),
    needs_review: z.boolean(),
    approved: z.boolean(),
    client_visible: z.boolean(),
    completed_at: z.string().datetime().nullable(),
  })
  .partial()
  .strict();
export type TaskFields = z.infer<typeof fieldsSchema>;

/** The parsed fields of a stored record, or null when it does not parse (then it cannot be undone). */
function recordFields(v: unknown): TaskFields | null {
  if (v === null || v === undefined) return {};
  const p = fieldsSchema.safeParse(v);
  return p.success ? p.data : null;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const STATUS_WORDS: Record<string, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  review: 'review',
  done: 'done',
  blocked: 'blocked',
  abandoned: 'abandoned',
};
const PROJECT_STATUS_WORDS: Record<string, string> = {
  quote: 'quote',
  queue: 'the queue',
  ready: 'ready',
  in_progress: 'in progress',
  review: 'review',
  done: 'done',
  suspended: 'suspended',
  cancelled: 'cancelled',
};
const bad = (message: string, code = 'bad_action') => new ApiError(message, 400, code);
const conflict = (message: string, code: string) => new ApiError(message, 409, code);

/** A title for a line: cut at a word boundary with three full stops when over 60 characters. */
export function shortTitle(title: string | null | undefined, max = 60): string {
  const t = cleanLine(title ?? 'Untitled', 500);
  if (t.length <= max) return t;
  const room = t.slice(0, max - 3);
  const sp = room.lastIndexOf(' ');
  return `${(sp >= 15 ? room.slice(0, sp) : room).replace(/[\s.,;:]+$/, '')}...`;
}
const quoted = (title: string | null | undefined) => `"${shortTitle(title)}"`;
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Text cut at a word with three full stops past `max` characters. */
export function cutAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max - 3);
  const sp = room.lastIndexOf(' ');
  return `${(sp >= Math.floor(max / 4) ? room.slice(0, sp) : room).replace(/[\s.,;:]+$/, '')}...`;
}

/** Plain text of a stored rich-text field (a BlockNote JSON string or array), or of a plain string. */
export function plainText(value: unknown): string {
  if (value === null || value === undefined) return '';
  let v: unknown = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s.startsWith('[')) return s;
    try {
      v = JSON.parse(s);
    } catch {
      return s;
    }
  }
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const o = node as { text?: unknown; content?: unknown; children?: unknown };
      if (typeof o.text === 'string') out.push(o.text);
      if (o.content !== undefined) walk(o.content);
      if (o.children !== undefined) walk(o.children);
      out.push(' ');
    }
  };
  walk(v);
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** The first `n` checklist lines of a stored requirements list (items, and items inside sections). */
function checklistLines(req: unknown, n = 3): string[] {
  if (!Array.isArray(req)) return [];
  const lines: string[] = [];
  for (const e of req) {
    if (!e || typeof e !== 'object') continue;
    const o = e as { type?: unknown; text?: unknown; items?: unknown };
    if (o.type === 'section' && Array.isArray(o.items)) {
      for (const it of o.items) if (it && typeof (it as { text?: unknown }).text === 'string') lines.push((it as { text: string }).text);
    } else if (typeof o.text === 'string') lines.push(o.text);
  }
  return lines.slice(0, n).map((l) => cutAtWord(cleanLine(l, 300), 80)).filter(Boolean);
}

const NBSP = /[\u00a0\u202f]/g;

/** "today at 5:00 PM", "tomorrow at 9:00 AM", "Friday at 5:00 PM", "Nov 20 at 5:00 PM", in Mike's time zone. */
export function whenWords(d: Date, now: Date = new Date(), tz = OWNER_TZ): string {
  const ymd = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const days = Math.round((Date.parse(ymd(d)) - Date.parse(ymd(now))) / 86_400_000);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d).replace(NBSP, ' ');
  let day: string;
  if (days === 0) day = 'today';
  else if (days === 1) day = 'tomorrow';
  else if (days === -1) day = 'yesterday';
  else if (days > 1 && days < 7) day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
  else day = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(d).replace(NBSP, ' ');
  return `${day} at ${time}`;
}

type NameDb = Pick<Prisma.TransactionClient, 'user'> & Partial<Pick<Prisma.TransactionClient, 'project' | 'client' | 'site' | 'task'>>;

async function firstNameOf(db: Pick<Prisma.TransactionClient, 'user'>, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id }, select: { name: true, is_active: true } });
  if (!u) return null;
  return cleanLine(u.name.split(/\s+/)[0] ?? '', 40) || null;
}
async function nameOf(db: NameDb, kind: 'project' | 'client' | 'site', id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const delegate = db[kind] as unknown as { findUnique?: (a: unknown) => Promise<{ name?: string } | null> } | undefined;
  if (!delegate?.findUnique) return null;
  const r = await delegate.findUnique({ where: { id }, select: { name: true } });
  return r?.name ? cleanLine(r.name, 80) : null;
}
async function titlesOf(db: NameDb, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = db.task ? await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }) : [];
  return ids.map((id) => quoted(rows.find((r) => r.id === id)?.title ?? 'a task'));
}
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---------------------------------------------------------------------------------------------
// appliedSummary: the line for every field (plan 1.2) and every operation (plan 2)
// ---------------------------------------------------------------------------------------------

/**
 * The line for an applied task write, built only from validated values and the real task. One sentence per
 * changed field, in a fixed order. `db` needs `user`; `project`, `client`, `site` and `task` (for names and
 * blocker titles) are used when present.
 */
export async function appliedSummary(
  db: NameDb,
  task: { title: string },
  before: TaskFields,
  after: TaskFields,
  ownerId: string,
  now: Date = new Date(),
): Promise<string> {
  const parts: string[] = [];
  const has = (k: keyof TaskFields) => k in after && after[k] !== undefined;
  if (has('title')) parts.push(`Renamed ${quoted(before.title)} to ${quoted(after.title)}.`);
  const t = quoted(task.title);
  if (has('status')) {
    const s = after.status as string;
    const from = before.status;
    if (s === 'done') parts.push(`Marked ${t} done.`);
    else if (s === 'abandoned') parts.push(`Let ${t} go.`);
    else if ((from === 'done' || from === 'abandoned') && (s === 'not_started' || s === 'in_progress')) parts.push(`Reopened ${t}, ${STATUS_WORDS[s]}.`);
    else parts.push(`Moved ${t} to ${STATUS_WORDS[s] ?? 'a new status'}.`);
  }
  if ('arc_id' in after) parts.push(after.arc_id ? `Moved ${t} into an arc.` : `Took ${t} out of its arc.`);
  if ('assignee_id' in after) {
    const to = after.assignee_id ?? null;
    if (to === ownerId) {
      if (before.assignee_id) parts.push(`Took ${t} back from ${(await firstNameOf(db, before.assignee_id)) ?? 'someone'}.`);
      else parts.push(`Assigned ${t} to you.`);
    } else if (to) parts.push(`Gave ${t} to ${(await firstNameOf(db, to)) ?? 'someone'}.`);
    else parts.push(`${t} is on nobody now.`);
  }
  if ('description' in after) parts.push(after.description ? `Rewrote the description on ${t}.` : `Cleared the description on ${t}.`);
  if ('requirements' in after) parts.push(after.requirements && after.requirements.length > 0 ? `Rewrote the checklist on ${t}.` : `Cleared the checklist on ${t}.`);
  if ('notes' in after) parts.push(after.notes ? `Changed the notes on ${t}.` : `Cleared the notes on ${t}.`);
  if ('project_id' in after) {
    const n = await nameOf(db, 'project', after.project_id);
    parts.push(after.project_id ? `Moved ${t} to the ${n ?? 'other'} project.` : `Took ${t} out of its project.`);
  } else if ('client_id' in after) {
    const n = await nameOf(db, 'client', after.client_id);
    parts.push(after.client_id ? `${t} is for ${n ?? 'another client'} now.` : `Took the client off ${t}.`);
  }
  if ('site_id' in after) {
    const n = await nameOf(db, 'site', after.site_id);
    parts.push(after.site_id ? `Set the site on ${t} to ${n ?? 'another site'}.` : `Took the site off ${t}.`);
  }
  if ('tags' in after) {
    const was = before.tags ?? [];
    const now2 = after.tags ?? [];
    const added = now2.filter((x) => !was.includes(x)).map((x) => cleanLine(x, 50));
    const removed = was.filter((x) => !now2.includes(x)).map((x) => cleanLine(x, 50));
    if (added.length) parts.push(`Added the tag${added.length > 1 ? 's' : ''} ${andList(added)} to ${t}.`);
    if (removed.length) parts.push(`Took the tag${removed.length > 1 ? 's' : ''} ${andList(removed)} off ${t}.`);
  }
  if ('energy_estimate' in after || 'mystery_factor' in after || 'battery_impact' in after) parts.push(`Changed the time estimate on ${t}.`);
  if ('due_date' in after) {
    if (after.due_date) {
      const promised = 'promised_to' in after ? after.promised_to : undefined;
      parts.push(`Due ${whenWords(new Date(after.due_date), now)} for ${t}${promised ? `, promised to ${cleanLine(promised, 60)}` : ''}.`);
    } else parts.push(`Took the date off ${t}.`);
  }
  if ('promised_to' in after && !(after.due_date && 'due_date' in after)) {
    parts.push(after.promised_to ? `${t} is promised to ${cleanLine(after.promised_to, 60)} now.` : `${t} is not promised to anyone now.`);
  }
  if ('priority' in after && typeof after.priority === 'number') {
    const up = typeof before.priority === 'number' ? after.priority < before.priority : after.priority <= 2;
    parts.push(`Moved ${t} ${up ? 'up' : 'down'} in the team's lists.`);
  }
  if ('is_focus' in after) parts.push(after.is_focus ? `Marked ${t} as a focus.` : `Took the focus off ${t}.`);
  if ('blocked_by_ids' in after) {
    const was = before.blocked_by_ids ?? [];
    const nowIds = after.blocked_by_ids ?? [];
    const added = await titlesOf(db, nowIds.filter((x) => !was.includes(x)));
    const removed = await titlesOf(db, was.filter((x) => !nowIds.includes(x)));
    if (added.length) parts.push(`${t} is waiting on ${andList(added)} now.`);
    if (removed.length) parts.push(`${t} is no longer waiting on ${andList(removed)}.`);
  }
  if ('needs_review' in after) parts.push(after.needs_review ? `${t} needs a review now.` : `${t} no longer needs a review.`);
  if ('approved' in after) parts.push(after.approved ? `Approved ${t}.` : `Took the approval off ${t}.`);
  if ('client_visible' in after) parts.push(after.client_visible ? `Shared ${t} with the client.` : `Stopped sharing ${t} with the client.`);
  return cleanLine(parts.join(' '), 300);
}

/** What an operation did, for `opSummary`. Titles and names come from the rows the op read, never the worker. */
export type OpLine =
  | { op: 'home_act'; action: 'not_now'; title: string; until: Date | null }
  | { op: 'home_act'; action: 'not_emergency'; title: string; security?: boolean }
  | { op: 'home_act'; action: 'matters_more' | 'pin' | 'stop' | 'done_pin' | 'arc_add' | 'arc_remove'; title: string }
  | { op: 'home_act'; action: 'arc_reorder' | 'lighter' }
  | { op: 'home_act'; action: 'swap'; title: string }
  | { op: 'task_comment'; task_title: string; hidden?: boolean }
  | { op: 'email_ask_state'; subject: string; state: 'handled' | 'dismissed' | 'open'; draft_kept?: boolean }
  | { op: 'wait_change'; action: 'redate' | 'extend'; title: string; due: Date }
  | { op: 'wait_change'; action: 'pause' | 'resume' | 'complete' | 'cancel'; title: string }
  | { op: 'wait_change'; action: 'reassign'; title: string; to_name: string }
  | { op: 'project_status'; name: string; status: string };

/** The line for an applied operation (plan 2.1 and section 6). */
export function opSummary(o: OpLine, now: Date = new Date()): string {
  let s = '';
  switch (o.op) {
    case 'home_act': {
      switch (o.action) {
        case 'not_now':
          s = o.until ? `${quoted(o.title)}: not now, back ${whenWords(o.until, now)}.` : `${quoted(o.title)}: not now. It stays out of view until you bring it back.`;
          break;
        case 'not_emergency':
          s = o.security ? `${quoted(o.title)} is a security item: taken out of Needs you now.` : `${quoted(o.title)}: not an emergency.`;
          break;
        case 'matters_more':
          s = `${quoted(o.title)}: moved up on your screen.`;
          break;
        case 'pin':
          s = `Working on ${quoted(o.title)} now.`;
          break;
        case 'stop':
          s = `Stopped working on ${quoted(o.title)}.`;
          break;
        case 'done_pin':
          s = `Finished working on ${quoted(o.title)}.`;
          break;
        case 'arc_add':
          s = `Added ${quoted(o.title)} to today.`;
          break;
        case 'arc_remove':
          s = `Took ${quoted(o.title)} off today.`;
          break;
        case 'arc_reorder':
          s = "Reordered today's steps.";
          break;
        case 'swap':
          s = `Swapped today to ${quoted(o.title)}.`;
          break;
        case 'lighter':
          s = 'Made today lighter.';
          break;
      }
      break;
    }
    case 'task_comment':
      s = o.hidden ? `Hid the note on ${quoted(o.task_title)}.` : `Added a note to ${quoted(o.task_title)}.`;
      break;
    case 'email_ask_state':
      s = o.state === 'handled' ? `${quoted(o.subject)}: marked handled.` : o.state === 'dismissed' ? `${quoted(o.subject)}: marked no reply needed.` : o.draft_kept === false ? `${quoted(o.subject)}: open again. The draft marker and link it had are not restored.` : `${quoted(o.subject)}: open again.`;
      break;
    case 'wait_change':
      switch (o.action) {
        case 'redate':
        case 'extend':
          s = `${quoted(o.title)} now comes due ${whenWords(o.due, now)}.`;
          break;
        case 'pause':
          s = `Paused ${quoted(o.title)}.`;
          break;
        case 'resume':
          s = `Resumed ${quoted(o.title)}.`;
          break;
        case 'complete':
          s = `Marked ${quoted(o.title)} done.`;
          break;
        case 'cancel':
          s = `${quoted(o.title)} is no longer needed.`;
          break;
        case 'reassign':
          s = `${quoted(o.title)} is on ${cleanLine(o.to_name, 40)} now.`;
          break;
      }
      break;
    case 'project_status':
      s = `Moved the ${cleanLine(o.name, 80)} project to ${PROJECT_STATUS_WORDS[o.status] ?? 'a new status'}.`;
      break;
  }
  return cleanLine(s, 300);
}

// ---------------------------------------------------------------------------------------------
// The view the panel reads
// ---------------------------------------------------------------------------------------------

/** Which buttons a card carries. `bast_resteer` is a `bast_start` proposal whose hits only change what Bast reads. */
export type CardKind = 'bast_start' | 'bast_resteer' | 'client_show';
export const CARD_BUTTONS: Record<CardKind, { yes: string; no: string }> = {
  bast_start: { yes: 'Hand to Bast', no: 'Keep it' },
  bast_resteer: { yes: 'Let Bast re-read it', no: 'Leave it' },
  client_show: { yes: 'Share it', no: 'Keep it private' },
};
/** The line a dead proposal shows, with no buttons (plan section 6). */
export const FAILED_CARD_TEXT = "That didn't go through. Changed since. Open the task.";

/** One task Bast will start or read differently, as the card shows it. */
export interface CardRead {
  task_id: string;
  title: string;
  status: string | null;
  site: string | null;
  client: string | null;
  sop: string | null;
  /** The first part of the description, cut at a word. */
  excerpt: string | null;
  /** The first three checklist lines. */
  checklist: string[];
  /** What this change writes on that task, in plain words. */
  writes: string[];
  /** What the chat itself changed on that task in the last day, in plain words ("description", "a comment"). */
  chat_changed: string[];
  /** "Changed from this chat in the last day: description, a comment." or null. */
  chat_changed_line: string | null;
}

export interface ProposalCard {
  kind: CardKind;
  /** One question, "Hand "Menu proof" to Bast?". */
  title: string;
  /** Why it starts, what it re-steers, what Undo puts back. Plain sentences. */
  lines: string[];
  reads: CardRead[];
  /** What the client will see (client_show), else empty. */
  client: string[];
  buttons: { yes: string; no: string };
  /** The plain clause ("hand "Menu proof" to Bast"), used in status lines. */
  clause: string;
}

export interface ActionView {
  id: string;
  conversation_id: string;
  event_seq: number | null;
  tool: string;
  target_type: string;
  target_id: string;
  summary: string;
  /** applied, proposed, released, declined, undone, failed. */
  status: string;
  can_undo: boolean;
  undo_until: Date | null;
  proposed_assignee_id: string | null;
  created_at: Date;
  /** bast_start or client_show for a proposal (v2), else null. */
  proposal_kind: string | null;
  /** The tap card of a proposal (v2), kept on the row after it is resolved; null for anything else. */
  card: ProposalCard | null;
  /** For a failed proposal: the plain refusal. */
  error: string | null;
}

interface StoredReach {
  v: 2;
  fingerprint: string;
  starts: { rule: string; task_id: string | null; wait_id?: string; fields: string[] }[];
  shows: { rule: string; task_id?: string; project_id?: string }[];
  card: ProposalCard;
}
function storedReachOf(a: Pick<BastChatAction, 'reach'>): StoredReach | null {
  const r = a.reach as unknown as StoredReach | null;
  if (!r || typeof r !== 'object' || r.v !== 2 || typeof r.fingerprint !== 'string') return null;
  return r;
}

export function actionView(a: BastChatAction, now: Date = new Date()): ActionView {
  const r = storedReachOf(a);
  return {
    id: a.id,
    conversation_id: a.conversation_id,
    event_seq: a.event_seq,
    tool: a.tool,
    target_type: a.target_type,
    target_id: a.target_id,
    summary: a.summary,
    status: a.status,
    can_undo: a.status === 'applied' && !!a.undo_until && a.undo_until.getTime() > now.getTime(),
    undo_until: a.undo_until,
    proposed_assignee_id: a.proposed_assignee_id,
    created_at: a.created_at,
    proposal_kind: a.proposal_kind ?? null,
    card: r?.card ?? null,
    error: a.status === 'failed' ? (a.error ?? CHANGED_SINCE_TEXT) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The operation registry
// ---------------------------------------------------------------------------------------------

/** What every operation function gets. `actor` (the owner's session) is set for apply and undo only. */
export interface OpContext {
  db: Db;
  ownerId: string;
  now: Date;
  actor?: AuthPayload;
}
export type OpApplyContext = OpContext & { actor: AuthPayload };

/** Card words an operation supplies (the task kind writes its own). */
export interface OpCopy {
  /** "move the VCDP project to ready", lower case, no full stop. */
  clause: string;
  /** Extra lines for the card (why it starts, the date a wait files its task). */
  why?: string[];
  /** What the client will see, for a client show. */
  client_lines?: string[];
}

/**
 * The result of preparing an apply or an undo: the reach on the CURRENT rows, and `expect`, a snapshot of those
 * same rows that `apply` or `undo` compares and sets on. Take the snapshot in the same read as the reach input (or
 * before it), never after, so the write lands only on the state the reach was judged on.
 */
export interface PreparedOp {
  reach: ReachResult;
  expect: Json;
  copy: OpCopy;
}

export type OpOutcome = { ok: true } | { ok: false; reason: 'changed_since' | 'invalid'; message?: string };

/**
 * One kind of change the chat can make, known to the proposal, tap and Undo code. The task kind is `taskOperation`
 * (name `task`, target type `task`). The ops builder (S1-C6) implements one per op of POST /worker/ops and calls
 * `registerChatOperation` for each at module load, and the routes that tap or undo must import that module.
 *
 * - `name`: the op name stored in a proposal's plan (`plan.op`). Unique.
 * - `target_type`: the `target_type` of this op's applied records. Undo finds the op by it. Unique.
 * - `validate(raw)`: strict parse of the stored input. Throw on anything not valid now; the tap then kills the
 *   proposal. Never trust a stored plan without it.
 * - `targetId(input)`: the record id the op changes (the proposal's `target_id`).
 * - `prepare(ctx, input, origin)`: load every row the reach check needs, run it (`checkOp`, `checkComment`, or the
 *   task checks) with `origin` ('chat' at proposal time, 'tap' at the tap), and return `{reach, expect, copy}`.
 *   The tap compares `reachFingerprint(reach)` with the stored one, so load the same fields every time.
 * - `apply(ctx, input, expect)`: write as the owner (`ctx.actor`), as one compare-and-set on `expect`. A miss is
 *   `{ok:false, reason:'changed_since'}`; input that no longer validates is `{ok:false, reason:'invalid'}`.
 *   Writes no chat record (the proposal row becomes `released`).
 * - `prepareUndo(ctx, record)`: for an applied record of this op, the reach of the state Undo would restore
 *   (origin 'undo'), with `expect`. Throw an ApiError 409 when it cannot be undone now (changed since).
 * - `undo(ctx, record, expect)`: write the restore as the owner, compare-and-set on `expect`. Never deletes.
 */
export interface ChatOperation<I = unknown> {
  readonly name: string;
  readonly target_type: string;
  validate(raw: unknown): I;
  targetId(input: I): string;
  prepare(ctx: OpContext, input: I, origin: ReachOrigin): Promise<PreparedOp>;
  apply(ctx: OpApplyContext, input: I, expect: unknown): Promise<OpOutcome>;
  prepareUndo(ctx: OpContext, record: BastChatAction): Promise<PreparedOp>;
  undo(ctx: OpApplyContext, record: BastChatAction, expect: unknown): Promise<OpOutcome>;
}

const OPS_BY_NAME = new Map<string, ChatOperation<unknown>>();
const OPS_BY_TARGET = new Map<string, ChatOperation<unknown>>();

/** Add an operation. Throws when its name or target type is taken by another operation. */
export function registerChatOperation<I>(op: ChatOperation<I>): void {
  const byName = OPS_BY_NAME.get(op.name);
  const byTarget = OPS_BY_TARGET.get(op.target_type);
  if (byName === (op as unknown as ChatOperation<unknown>) && byTarget === byName) return;
  if (byName || byTarget) throw new Error(`bast-chat: operation ${op.name} or target ${op.target_type} is already registered`);
  OPS_BY_NAME.set(op.name, op as unknown as ChatOperation<unknown>);
  OPS_BY_TARGET.set(op.target_type, op as unknown as ChatOperation<unknown>);
}
export function getChatOperation(name: string): ChatOperation<unknown> | null {
  return OPS_BY_NAME.get(name) ?? null;
}
export function chatOperationForTarget(targetType: string): ChatOperation<unknown> | null {
  return OPS_BY_TARGET.get(targetType) ?? null;
}

// ---------------------------------------------------------------------------------------------
// The task kind: loading what the reach check needs
// ---------------------------------------------------------------------------------------------

const BLOCKER_SELECT = {
  id: true,
  title: true,
  status: true,
  approved: true,
  project: { select: { dependencies_ordering_only: true } },
} as const;
const TASK_REACH_SCALARS = {
  id: true,
  title: true,
  status: true,
  assignee_id: true,
  tags: true,
  description: true,
  requirements: true,
  notes: true,
  site_id: true,
  project_id: true,
  client_id: true,
  sop_id: true,
  arc_id: true,
  needs_review: true,
  approved: true,
  client_approved_at: true,
  lease_until: true,
  client_visible: true,
  requested_by_contact_id: true,
  staging_preview_url: true,
  is_deleted: true,
  updated_at: true,
  priority: true,
  is_focus: true,
  due_date: true,
  promised_to: true,
  energy_estimate: true,
  mystery_factor: true,
  battery_impact: true,
  project: { select: { status: true, dependencies_ordering_only: true } },
  blocked_by: { where: { is_deleted: false }, select: BLOCKER_SELECT },
} as const;

type BlockerRow = { id: string; title: string; status: string; approved: boolean; project: { dependencies_ordering_only: boolean } | null };
type TaskReachRow = {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  tags: string[];
  description: string | null;
  requirements: unknown;
  notes: string | null;
  site_id: string | null;
  project_id: string | null;
  client_id: string | null;
  sop_id: string | null;
  arc_id: string | null;
  needs_review: boolean;
  approved: boolean;
  client_approved_at: Date | null;
  lease_until: Date | null;
  client_visible: boolean;
  requested_by_contact_id: string | null;
  staging_preview_url: string | null;
  is_deleted: boolean;
  updated_at: Date;
  priority: number;
  is_focus: boolean;
  due_date: Date | null;
  promised_to: string | null;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  project: { status: string; dependencies_ordering_only: boolean } | null;
  blocked_by: BlockerRow[];
  blocking?: TaskReachRow[];
};

const blockerRef = (b: BlockerRow, lastCommentId: string | null = null): BlockerRef => ({
  id: b.id,
  title: b.title,
  status: b.status,
  approved: b.approved,
  ordering_only: b.project ? b.project.dependencies_ordering_only : null,
  last_comment_id: lastCommentId,
});

type LastComment = { kind: CommentAuthorKind; id: string | null };

/**
 * The newest comment on a task, by created_at then id (the gate's tie rule). Every non-deleted comment counts,
 * internal and client ones too: the worker session reads the whole thread, so the tap re-checks all of it.
 */
async function lastComment(db: Db, taskId: string): Promise<LastComment> {
  const c = await db.comment.findFirst({
    where: { task_id: taskId, is_deleted: false },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: { id: true, user_id: true, author_contact_id: true },
  });
  if (!c) return { kind: 'none', id: null };
  if (c.author_contact_id) return { kind: 'client', id: c.id };
  if (c.user_id && BOT_USER_IDS.includes(c.user_id)) return { kind: 'bot', id: c.id };
  return { kind: 'human', id: c.id };
}

async function reachTaskOf(db: Db, row: TaskReachRow): Promise<ReachTask & Record<string, unknown>> {
  const last = await lastComment(db, row.id);
  const blockerLast = new Map<string, string | null>();
  for (const b of row.blocked_by ?? []) blockerLast.set(b.id, (await lastComment(db, b.id)).id);
  return toReachTask(row, last, blockerLast);
}

function toReachTask(row: TaskReachRow, last: LastComment, blockerLast: ReadonlyMap<string, string | null> = new Map()): ReachTask & Record<string, unknown> {
  return {
    id: row.id,
    assignee_id: row.assignee_id,
    status: row.status,
    tags: [...(row.tags ?? [])],
    title: row.title,
    description: row.description,
    requirements: row.requirements ?? null,
    notes: row.notes,
    site_id: row.site_id,
    project_id: row.project_id,
    client_id: row.client_id,
    sop_id: row.sop_id,
    arc_id: row.arc_id,
    needs_review: row.needs_review,
    approved: row.approved,
    client_approved_at: row.client_approved_at,
    lease_until: row.lease_until,
    last_comment_author: last.kind,
    last_comment_id: last.id,
    blocked_by: (row.blocked_by ?? []).map((b) => blockerRef(b, blockerLast.get(b.id) ?? null)),
    ordering_only: row.project ? row.project.dependencies_ordering_only : null,
    project_status: row.project?.status ?? null,
    client_visible: row.client_visible,
    requested_by_contact_id: row.requested_by_contact_id,
    staging_preview_url: row.staging_preview_url,
    priority: row.priority,
    is_focus: row.is_focus,
    due_date: row.due_date,
    promised_to: row.promised_to,
    energy_estimate: row.energy_estimate,
    mystery_factor: row.mystery_factor,
    battery_impact: row.battery_impact,
  };
}

/**
 * Everything `ReachTaskWithDependents` asks for, from one read of the task (amendment 10): the task's fields, its
 * blockers with their own status, approval and project rule, the tasks that wait on it (each with ITS blockers),
 * the last comment author of each, and the lease. Null when the task is missing or deleted. Use this loader for
 * every reach check on a task (the routes, Undo and the tap), so the fingerprints compare like with like.
 */
export async function loadReachTask(db: Db, taskId: string): Promise<{ reach: ReachTaskWithDependents; row: TaskReachRow } | null> {
  if (!isChatUuid(taskId)) return null;
  const row = (await db.task.findUnique({
    where: { id: taskId },
    select: { ...TASK_REACH_SCALARS, blocking: { where: { is_deleted: false }, select: TASK_REACH_SCALARS } },
  })) as unknown as TaskReachRow | null;
  if (!row || row.is_deleted) return null;
  const dependents: ReachTask[] = [];
  for (const d of row.blocking ?? []) dependents.push(await reachTaskOf(db, d));
  const reach: ReachTaskWithDependents = { ...(await reachTaskOf(db, row)), dependents };
  return { reach, row };
}

/** Keys a task plan may carry: the section 1.2 fields, by their PATCH body names. Everything else is refused. */
const taskPlanBodySchema = z
  .object({
    status: z.enum(TASK_STATUSES),
    title: z.string().min(1).max(500),
    description: z.string().max(400_000).nullable(),
    requirements: z.array(z.unknown()).nullable(),
    notes: z.string().max(400_000).nullable(),
    assignee_id: uuidN,
    project_id: uuidN,
    client_id: uuidN,
    site_id: uuidN,
    arc_id: uuidN,
    tags: z.array(z.string().max(50)).max(200),
    energy_estimate: z.number().int().min(1).max(8).nullable(),
    mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']),
    battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']),
    due_date: z.string().datetime().nullable(),
    promised_to: z.string().max(200).nullable(),
    priority: z.number().int().min(1).max(5),
    is_focus: z.boolean(),
    blocked_by_ids: z
      .object({ connect: z.array(z.string().uuid()).max(100).optional(), disconnect: z.array(z.string().uuid()).max(100).optional() })
      .strict(),
    needs_review: z.boolean(),
    approved: z.boolean(),
    client_visible: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'empty plan');
export type TaskPlanBody = z.infer<typeof taskPlanBodySchema>;

export const taskInputSchema = z.object({ task_id: z.string().uuid(), body: taskPlanBodySchema }).strict();
export type TaskInput = z.infer<typeof taskInputSchema>;

const taskExpectSchema = z
  .object({
    updated_at: z.string().datetime(),
    assignee_id: uuidN.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    title: z.string().optional(),
  })
  .strict();

/** Tags no plan may add, or remove (plan 1.2, ruling 6). */
const isApprovalTag = (t: string) => t === 'client-approved' || t.startsWith('cp:') || t.startsWith('preview-notified:') || t === CHAT_TAG;
const NEVER_REMOVE = ['security', 'security-report'];
function assertPlanTags(current: string[], next: string[] | undefined): void {
  if (!next) return;
  const added = next.filter((t) => !current.includes(t));
  const removed = current.filter((t) => !next.includes(t));
  if (added.some(isApprovalTag) || removed.some((t) => isApprovalTag(t) || NEVER_REMOVE.includes(t))) throw conflict(REFUSED_FIELD_TEXT, 'refused_tag');
}

const SIMPLE_CHANGE_KEYS = [
  'status', 'title', 'requirements', 'assignee_id', 'project_id', 'client_id', 'site_id', 'arc_id', 'tags', 'needs_review',
  'approved', 'client_visible', 'promised_to', 'priority', 'is_focus', 'energy_estimate', 'mystery_factor', 'battery_impact', 'due_date',
] as const;

/**
 * A plan body as the reach check's `TaskChange`, mirroring what patchTask will write: description and notes as
 * they will be stored, the client a new project brings, the approval a review switch-off clears, the blockers a
 * connect adds (with their status, approval and project rule).
 */
export async function taskChangeFromBody(db: Db, body: TaskPlanBody, row: { project_id: string | null }): Promise<TaskChange> {
  const c: TaskChange = {};
  const b = body as Record<string, unknown>;
  for (const k of SIMPLE_CHANGE_KEYS) if (b[k] !== undefined) (c as Record<string, unknown>)[k] = b[k];
  if (body.description !== undefined) c.description = serializeRichText(body.description);
  if (body.notes !== undefined) c.notes = serializeRichText(body.notes);
  if (body.project_id !== undefined && body.project_id !== row.project_id) {
    const p = body.project_id ? await db.project.findUnique({ where: { id: body.project_id }, select: { client_id: true, dependencies_ordering_only: true } }) : null;
    c.ordering_only_after = p ? p.dependencies_ordering_only : null;
    if (body.client_id === undefined && body.project_id) c.client_id = p?.client_id ?? null;
  }
  if (body.needs_review === false && body.approved === undefined) c.approved = false;
  const conn = body.blocked_by_ids?.connect ?? [];
  const disc = body.blocked_by_ids?.disconnect ?? [];
  if (conn.length > 0) {
    const rows = (await db.task.findMany({ where: { id: { in: conn } }, select: BLOCKER_SELECT })) as unknown as BlockerRow[];
    const refs: BlockerRef[] = [];
    for (const id of conn) {
      const r = rows.find((x) => x.id === id);
      refs.push(r ? blockerRef(r, (await lastComment(db, r.id)).id) : { id });
    }
    c.blocked_by_connect = refs;
  }
  if (disc.length > 0) c.blocked_by_disconnect = [...disc];
  return c;
}

/** The plain clause of a planned task change: "hand "Menu proof" to Bast". */
async function taskClause(db: Db, title: string, body: TaskPlanBody): Promise<string> {
  const t = quoted(title);
  if (body.assignee_id === BAST_USER_ID) return `hand ${t} to Bast`;
  if (typeof body.assignee_id === 'string') return `give ${t} to ${(await firstNameOf(db, body.assignee_id)) ?? 'someone'}`;
  if (body.status === 'done') return `mark ${t} done`;
  if (body.status === 'abandoned') return `let ${t} go`;
  if (body.status) return `move ${t} to ${STATUS_WORDS[body.status]}`;
  if (body.client_visible === true) return `share ${t} with the client`;
  if (body.approved === true) return `approve ${t}`;
  const words = bodyWords(body);
  return `change the ${andList(words.length ? words : ['details'])} on ${t}`;
}

const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  requirements: 'checklist',
  notes: 'notes',
  site_id: 'site',
  project_id: 'project',
  client_id: 'client',
  sop_id: 'SOP',
  arc_id: 'arc',
  tags: 'tags',
  status: 'status',
  assignee_id: 'person it is on',
  blocked_by_ids: 'tasks it waits on',
  blocked_by_connect: 'tasks it waits on',
  blocked_by_disconnect: 'tasks it waits on',
  needs_review: 'review',
  approved: 'approval',
  client_visible: 'sharing',
  due_date: 'date',
  promised_to: 'promise',
  priority: 'order',
  is_focus: 'focus',
  energy_estimate: 'estimate',
  mystery_factor: 'estimate',
  battery_impact: 'estimate',
  comments: 'thread',
};
/** The card's "Changes:" line reads on its own, so a few words differ from the clause's. */
const CARD_WRITE_WORDS: Record<string, string> = { assignee_id: 'who it is on' };
const bodyWords = (body: Record<string, unknown>) => [...new Set(Object.keys(body).map((k) => FIELD_WORDS[k] ?? 'details'))];

async function assertAssignable(db: Db, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const u = await db.user.findUnique({ where: { id }, select: { is_active: true } });
  if (!u || !u.is_active) throw conflict('That person is not available.', 'assignee_unavailable');
}

// ---------------------------------------------------------------------------------------------
// The task kind: Undo of a record
// ---------------------------------------------------------------------------------------------

type DbTimeish = Date | string | null | undefined;
const timeOf = (v: DbTimeish) => (v === null || v === undefined ? null : new Date(v).getTime());
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v instanceof Date ? v.toISOString() : (v ?? null));
}

/** Does the task as read still hold the recorded value of `k`? */
function holds(row: TaskReachRow, k: keyof TaskFields, v: unknown): boolean {
  switch (k) {
    case 'due_date':
      return timeOf(row.due_date) === timeOf(v as DbTimeish);
    case 'tags':
      return sameSet(row.tags ?? [], (v as string[]) ?? []);
    case 'blocked_by_ids':
      return sameSet((row.blocked_by ?? []).map((b) => b.id), (v as string[]) ?? []);
    case 'requirements':
      return sortedJson(row.requirements ?? null) === sortedJson(v ?? null);
    case 'completed_at':
      return true; // set by the status itself
    default:
      return ((row as unknown as Record<string, unknown>)[k] ?? null) === (v ?? null);
  }
}

interface TaskRestore {
  body: TaskPlanBody;
  compare: TaskFields;
  needsChatTag: boolean;
}

/** What Undo writes for a task record, from the server-written before and after only. Throws when it cannot. */
function taskRestoreFor(a: BastChatAction): TaskRestore {
  const after = recordFields(a.after);
  const before = recordFields(a.before);
  if (!after || !before) throw conflict(CANNOT_UNDO_TEXT, 'not_undoable');
  if (a.tool === 'create_task') {
    if (!after.status) throw conflict(CANNOT_UNDO_TEXT, 'not_undoable');
    const compare: TaskFields = { status: after.status, ...('assignee_id' in after ? { assignee_id: after.assignee_id } : {}) };
    return { body: { status: 'abandoned' }, compare, needsChatTag: true };
  }
  const keys = (Object.keys(after) as (keyof TaskFields)[]).filter((k) => k !== 'completed_at');
  if (keys.length === 0) throw conflict(CANNOT_UNDO_TEXT, 'not_undoable');
  const body: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in before)) throw conflict(CANNOT_UNDO_TEXT, 'not_undoable');
    if (k === 'blocked_by_ids') {
      const was = before.blocked_by_ids ?? [];
      const now = after.blocked_by_ids ?? [];
      const connect = was.filter((x) => !now.includes(x));
      const disconnect = now.filter((x) => !was.includes(x));
      body.blocked_by_ids = { ...(connect.length ? { connect } : {}), ...(disconnect.length ? { disconnect } : {}) };
    } else body[k] = before[k];
  }
  const parsed = taskPlanBodySchema.safeParse(body);
  if (!parsed.success) throw conflict(CANNOT_UNDO_TEXT, 'not_undoable');
  const compare = Object.fromEntries(keys.map((k) => [k, after[k]])) as TaskFields;
  return { body: parsed.data, compare, needsChatTag: false };
}

function patchOutcome(r: Awaited<ReturnType<typeof patchTask>>): OpOutcome {
  return r.ok ? { ok: true } : { ok: false, reason: 'changed_since' };
}
async function runPatch(ctx: OpApplyContext, id: string, body: TaskPlanBody, expect: PatchTaskExpect): Promise<OpOutcome> {
  try {
    return patchOutcome(await patchTask({ actor: ctx.actor, id, body: body as Record<string, unknown>, expect }));
  } catch (e) {
    if (e instanceof ApiError && e.statusCode < 500) return { ok: false, reason: 'invalid', message: e.message };
    if (e instanceof z.ZodError) return { ok: false, reason: 'invalid' };
    throw e;
  }
}

/** The task kind of `ChatOperation`: a task PATCH applied as the owner through `patchTask`, and its Undo. */
export const taskOperation: ChatOperation<TaskInput> = {
  name: 'task',
  target_type: 'task',
  validate: (raw) => taskInputSchema.parse(raw),
  targetId: (input) => input.task_id,
  async prepare(ctx, input, origin) {
    const loaded = await loadReachTask(ctx.db, input.task_id);
    if (!loaded) throw conflict(CHANGED_SINCE_TEXT, 'changed_since');
    assertPlanTags(loaded.row.tags ?? [], input.body.tags);
    await assertAssignable(ctx.db, input.body.assignee_id);
    const change = await taskChangeFromBody(ctx.db, input.body, loaded.row);
    const reach = checkTaskChange({ current: loaded.reach, change, now: ctx.now, origin });
    const r = loaded.row;
    return {
      reach,
      expect: { updated_at: r.updated_at.toISOString(), assignee_id: r.assignee_id, status: r.status, title: r.title },
      copy: { clause: await taskClause(ctx.db, r.title, input.body) },
    };
  },
  async apply(ctx, input, expect) {
    const e = taskExpectSchema.safeParse(expect);
    if (!e.success) return { ok: false, reason: 'invalid' };
    await assertAssignable(ctx.db, input.body.assignee_id);
    return runPatch(ctx, input.task_id, input.body, e.data as PatchTaskExpect);
  },
  async prepareUndo(ctx, record) {
    const restore = taskRestoreFor(record);
    const loaded = await loadReachTask(ctx.db, record.target_id);
    if (!loaded) throw conflict(CHANGED_SINCE_TEXT, 'changed_since');
    const row = loaded.row;
    for (const [k, v] of Object.entries(restore.compare)) {
      if (!holds(row, k as keyof TaskFields, v)) throw conflict(CHANGED_SINCE_TEXT, 'changed_since');
    }
    if (restore.needsChatTag && !(row.tags ?? []).includes(CHAT_TAG)) throw conflict(CHANGED_SINCE_TEXT, 'changed_since');
    const to = restore.body.status;
    if (to && !canTransitionTaskStatus(row.status as never, to as never)) throw conflict(UNDO_TRANSITION_TEXT, 'undo_transition');
    assertPlanTags(row.tags ?? [], restore.body.tags);
    await assertAssignable(ctx.db, restore.body.assignee_id);
    const change = await taskChangeFromBody(ctx.db, restore.body, row);
    const reach = checkUndo({ current: loaded.reach, restore: change, now: ctx.now });
    return { reach, expect: { updated_at: row.updated_at.toISOString() }, copy: { clause: `undo the change to ${quoted(row.title)}` } };
  },
  async undo(ctx, record, expect) {
    const e = taskExpectSchema.safeParse(expect);
    if (!e.success) return { ok: false, reason: 'invalid' };
    const restore = taskRestoreFor(record);
    // The values the record wrote join the compare-and-set where patchTask can take them; the rest were compared
    // on the read that `expect.updated_at` pins.
    const c = restore.compare;
    const cas: PatchTaskExpect = {
      updated_at: e.data.updated_at,
      ...(c.status !== undefined ? { status: c.status as PatchTaskExpect['status'] } : {}),
      ...(c.title !== undefined ? { title: c.title } : {}),
      ...('assignee_id' in c ? { assignee_id: c.assignee_id ?? null } : {}),
    };
    return runPatch(ctx, record.target_id, restore.body, cas);
  },
};
registerChatOperation(taskOperation);

function operationFor(name: string): ChatOperation<unknown> | null {
  return getChatOperation(name);
}
function operationForRecord(a: BastChatAction): ChatOperation<unknown> | null {
  return chatOperationForTarget(a.target_type);
}

// ---------------------------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------------------------

const START_RULES = ['hand_to_bast', 'create_for_bast', 'starts_bast_task', 'releases_dependent', 'wakes_delegate', 'wait_for_bast', 'unknown_field', 'unknown_status', 'unknown_op', 'missing_data'];

function viewLine(view: string | undefined): string {
  switch (view) {
    case 'eligible':
      return 'It is not started, so Bast starts on it.';
    case 'wake_stale_in_progress':
      return 'It is in progress with no session on it, so Bast picks it up.';
    case 'wake_parked_reply':
    case 'wake_review_reply':
      return 'A person wrote on it last, so Bast reads the thread and acts on it.';
    case 'wake_client_approved':
      return 'The client approved it, so Bast publishes it.';
    case 'in_progress_leased':
    case 'in_progress_cockpit':
      return 'Bast is on it now and reads the change.';
    default:
      return 'Bast holds it and reads it on its next pass.';
  }
}

async function chatChangedByTask(db: Db, ids: string[], now: Date): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const rows = await db.bastChatAction.findMany({
    where: { target_type: 'task', target_id: { in: ids }, status: 'applied', created_at: { gte: since } },
    select: { target_id: true, tool: true, after: true },
    take: 500,
  });
  const comments = await db.bastChatAction.findMany({
    where: { target_type: 'comment', status: 'applied', created_at: { gte: since } },
    select: { target_id: true, tool: true, after: true },
    take: 500,
  });
  const order = ['the whole task', 'title', 'description', 'checklist', 'notes', 'site', 'project', 'a comment'];
  const add = (id: string, w: string) => out.set(id, [...new Set([...(out.get(id) ?? []), w])]);
  for (const r of rows) {
    if (r.tool === 'create_task') add(r.target_id, 'the whole task');
    const keys = r.after && typeof r.after === 'object' ? Object.keys(r.after as object) : [];
    for (const k of keys) {
      const w = { title: 'title', description: 'description', requirements: 'checklist', notes: 'notes', site_id: 'site', project_id: 'project' }[k];
      if (w) add(r.target_id, w);
    }
  }
  for (const c of comments) {
    const tid = (c.after as { task_id?: unknown } | null)?.task_id;
    if (typeof tid === 'string' && ids.includes(tid)) add(tid, 'a comment');
  }
  for (const [k, v] of out) out.set(k, order.filter((w) => v.includes(w)));
  return out;
}

async function namesById(db: Db, kind: 'site' | 'client' | 'sop', ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  if (kind === 'sop') {
    const rows = await db.sop.findMany({ where: { id: { in: want } }, select: { id: true, title: true } });
    return new Map(rows.map((r) => [r.id, cleanLine(r.title, 80)]));
  }
  const delegate = (kind === 'site' ? db.site : db.client) as unknown as { findMany: (a: unknown) => Promise<{ id: string; name: string }[]> };
  const rows = await delegate.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, cleanLine(r.name, 80)]));
}

/** The tap card, written by the server from the reach data and the records it names. */
async function buildCard(db: Db, reach: ReachResult, copy: OpCopy, now: Date): Promise<ProposalCard> {
  const reads = reach.reads;
  const ids = reads.map((r) => r.task_id);
  const [sites, clients, sops, changed] = await Promise.all([
    namesById(db, 'site', reads.map((r) => r.site_id)),
    namesById(db, 'client', reads.map((r) => r.client_id)),
    namesById(db, 'sop', reads.map((r) => r.sop_id)),
    chatChangedByTask(db, ids, now),
  ]);
  const cardReads: CardRead[] = reads.map((r) => {
    const cc = changed.get(r.task_id) ?? [];
    const text = plainText(r.description);
    return {
      task_id: r.task_id,
      title: cutAtWord(cleanLine(r.title ?? 'Untitled', 300), 120),
      status: r.status ? (STATUS_WORDS[r.status] ?? null) : null,
      site: r.site_id ? (sites.get(r.site_id) ?? null) : null,
      client: r.client_id ? (clients.get(r.client_id) ?? null) : null,
      sop: r.sop_id ? (sops.get(r.sop_id) ?? null) : null,
      excerpt: text ? cutAtWord(cleanLine(text, 2000), 200) : null,
      checklist: checklistLines(r.requirements),
      writes: [...new Set(r.changed.filter((f) => !f.startsWith('blocker:')).map((f) => CARD_WRITE_WORDS[f] ?? FIELD_WORDS[f] ?? 'details'))],
      chat_changed: cc,
      chat_changed_line: cc.length ? `Changed from this chat in the last day: ${cc.join(', ')}.` : null,
    };
  });
  const otherIds = [...new Set([...reach.starts.map((h) => h.task_id), ...reach.shows_client.map((c) => c.task_id ?? null)])].filter(
    (id): id is string => !!id && !ids.includes(id),
  );
  const others = otherIds.length ? await db.task.findMany({ where: { id: { in: otherIds } }, select: { id: true, title: true } }) : [];
  const titleOf = (id: string | null) => {
    const r = cardReads.find((x) => x.task_id === id) ?? others.find((x) => x.id === id);
    return r ? `"${shortTitle(r.title)}"` : 'a task';
  };
  const lines: string[] = [];
  const push = (l: string) => {
    if (!lines.includes(l)) lines.push(l);
  };
  const viaUndo = reach.starts.some((h) => h.via_undo) || reach.shows_client.some((h) => h.via_undo);
  const isStart = reach.starts.some((h) => START_RULES.includes(h.rule));
  const onlyDelegate = reach.starts.length > 0 && reach.starts.every((h) => h.rule === 'wakes_delegate');
  if (viaUndo && reach.starts.length > 0) {
    push(onlyDelegate ? "Undo makes Bast's worker read Sabeen's thread." : isStart ? 'Undo puts this back with Bast, so Bast starts on it.' : 'Undo changes what Bast reads.');
  }
  const released = reach.starts.filter((h) => h.rule === 'releases_dependent').map((h) => titleOf(h.task_id));
  if (released.length) push(`This lets Bast start: ${andList([...new Set(released)])}.`);
  for (const h of reach.starts as ReachHit[]) {
    switch (h.rule) {
      case 'hand_to_bast':
      case 'create_for_bast':
      case 'starts_bast_task':
        push(viewLine(h.view_after));
        break;
      case 'resteers_bast_task':
      case 'edits_held_bast_task':
        push('Bast will read the new text next time it picks this up.');
        break;
      case 'comment_on_bast_task':
        push('Bast reads the thread on its next pass.');
        break;
      case 'changes_blocker_text':
        push(`Bast's waiting task ${titleOf(h.task_id)} reads this text.`);
        break;
      case 'wakes_delegate':
      case 'edits_woken_delegate_task':
        push("Bast's worker will read Sabeen's thread.");
        break;
      case 'wait_for_bast':
        push(h.fields.includes('complete') ? 'Finishing this opens the next step of the wait, and it is Bast\'s.' : 'The wait will make a task for Bast when it comes due.');
        break;
      case 'releases_dependent':
        break;
      default:
        push('Citadel could not rule out that this starts Bast.');
    }
  }
  for (const l of copy.why ?? []) push(cleanLine(l, 300));
  const client: string[] = [];
  for (const c of reach.shows_client as ClientShowHit[]) {
    const t = c.task_id ? titleOf(c.task_id) : null;
    let l: string;
    if (c.rule === 'shares_task') l = `The client will see ${t ?? 'the task'} in their portal.`;
    else if (c.rule === 'moves_visible_task') l = `${t ?? 'The task'} shows in a client portal, and this moves it to another client or project.`;
    else if (c.rule === 'project_goes_live') l = 'The client will see the project in their portal.';
    else if (c.rule === 'wait_sends') l = 'Finishing this opens the next step of the wait, and that step sends to a client.';
    else l = 'Citadel could not rule out that the client sees this.';
    if (!client.includes(l)) client.push(l);
  }
  // The project's own line already says the project goes live; the op's copy would say the same thing again.
  const saysProjectLive = (reach.shows_client as ClientShowHit[]).some((c) => c.rule === 'project_goes_live');
  if (!saysProjectLive) for (const l of copy.client_lines ?? []) if (!client.includes(l)) client.push(cleanLine(l, 300));
  const kind: CardKind = reach.starts.length > 0 ? (isStart ? 'bast_start' : 'bast_resteer') : 'client_show';
  const clause = cleanLine(copy.clause, 200);
  return { kind, title: `${capFirst(clause)}?`, lines, reads: cardReads, client, buttons: CARD_BUTTONS[kind], clause };
}

function storedReach(reach: ReachResult, card: ProposalCard): StoredReach {
  return {
    v: 2,
    fingerprint: reachFingerprint(reach),
    starts: reach.starts.map((h) => ({ rule: h.rule, task_id: h.task_id, ...(h.wait_id ? { wait_id: h.wait_id } : {}), fields: h.fields })),
    shows: reach.shows_client.map((c) => ({ rule: c.rule, ...(c.task_id ? { task_id: c.task_id } : {}), ...(c.project_id ? { project_id: c.project_id } : {}) })),
    card,
  };
}

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

const planSchema = z.discriminatedUnion('kind', [
  z.object({ v: z.literal(2), kind: z.literal('apply'), op: z.string().min(1).max(40), input: z.unknown(), expect: z.unknown() }).strict(),
  z.object({ v: z.literal(2), kind: z.literal('undo'), op: z.string().min(1).max(40), undo_of: z.string().uuid(), expect: z.unknown() }).strict(),
]);
type StoredPlan = z.infer<typeof planSchema>;
const parsePlan = (v: unknown): StoredPlan | null => {
  const p = planSchema.safeParse(v);
  return p.success ? p.data : null;
};

// ---------------------------------------------------------------------------------------------
// storeProposal
// ---------------------------------------------------------------------------------------------

export interface StoreProposalInput {
  ownerId: string;
  conversationId: string;
  /** The tool the chat called (change_task, create_task, home_change, ...), stored as `tool`. */
  tool: string;
  /** The registered operation (`task` for a task PATCH) and its input, exactly what the tap will apply. */
  op: string;
  input: unknown;
  /** From `prepareOperation(...)` (or the op's own `prepare`) run on the same input, origin 'chat'. */
  prepared: PreparedOp;
  /**
   * Whether this call reserves today's write. True on the ops route (it reserves after the reach check). False on
   * the task routes, whose `guardChatTaskBody` already reserved this request's write. Never both.
   */
  reserve: boolean;
  /** Seq of the Mike message this answers, and of the action event, when known. */
  turnSeq?: number | null;
  eventSeq?: number | null;
  now?: Date;
  db?: Db;
}

export interface ProposalResult {
  /** The action id: send it back to the chat in `X-Bast-Chat-Action` with the 202. */
  id: string;
  status: 'proposed';
  proposal_kind: 'bast_start' | 'client_show';
  /** The plain line for the chat and the panel: what will start and why. */
  line: string;
  /** What the panel shows on the tap card. */
  card: ProposalCard;
}

/**
 * Store one proposal and write nothing else. The caller has run the reach check (through `prepareOperation`, so
 * the loader is the tap's) and it said `needs_tap`; the plan is the validated input. The row carries
 * `proposal_kind`, `plan` ({v, kind 'apply', op, input, expect}), `reach` ({v, fingerprint, starts, shows, card}),
 * the conversation, the target and `turn_seq`. Reserves today's write when `reserve` is true.
 */
export async function storeProposal(p: StoreProposalInput): Promise<ProposalResult> {
  return storeProposalRow({ ...p, plan: { v: 2, kind: 'apply', op: p.op, input: p.input, expect: p.prepared.expect } });
}

async function storeProposalRow(
  p: Omit<StoreProposalInput, 'input' | 'op'> & { op: string; input?: unknown; plan: StoredPlan; targetType?: string; targetId?: string; allowNoReach?: boolean },
): Promise<ProposalResult> {
  const db = p.db ?? defaultDb;
  const now = p.now ?? new Date();
  const op = operationFor(p.op);
  if (!op) throw new ApiError('That change is not known here.', 400, 'unknown_op');
  const reach = p.prepared.reach;
  if (!reach.needs_tap && !p.allowNoReach) throw new ApiError('That change does not need a tap.', 400, 'no_tap_needed');
  let targetType = p.targetType ?? op.target_type;
  let targetId = p.targetId;
  let proposedAssignee: string | null = null;
  if (p.plan.kind === 'apply') {
    const input = op.validate(p.input);
    targetId = targetId ?? op.targetId(input);
    targetType = op.target_type;
    const body = (input as { body?: { assignee_id?: unknown } }).body;
    if (op === (taskOperation as unknown as ChatOperation<unknown>) && typeof body?.assignee_id === 'string') proposedAssignee = body.assignee_id;
  }
  if (!targetId || !isChatUuid(targetId)) throw new ApiError('That change has no target.', 400, 'bad_target');
  const conv = await db.bastChatConversation.findUnique({ where: { id: p.conversationId }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== p.ownerId) throw new ApiError('Chat not found', 404, 'not_found');
  const card = await buildCard(db, reach, p.prepared.copy, now);
  const why = card.lines[0] ?? card.client[0] ?? '';
  const line = cleanLine(`Proposed: ${card.clause}.${why ? ` ${why}` : ''}`, 300);
  const kind: 'bast_start' | 'client_show' = reach.proposal_kind ?? 'bast_start';
  const settings = p.reserve ? await getSettings(db) : null;
  return db.$transaction(async (tx) => {
    if (settings) await reserveWrite(p.ownerId, settings.daily_write_cap, now, tx);
    const row = await tx.bastChatAction.create({
      data: {
        conversation_id: p.conversationId,
        event_seq: p.eventSeq ?? null,
        turn_seq: p.turnSeq ?? null,
        tool: cleanLine(p.tool, 40) || 'change_task',
        target_type: targetType,
        target_id: targetId!,
        summary: line,
        before: p.prepared.expect,
        after: p.plan.kind === 'apply' ? ((p.input ?? null) as Json) : undefined,
        proposed_assignee_id: proposedAssignee,
        status: 'proposed',
        undo_until: null,
        proposal_kind: kind,
        plan: p.plan as unknown as Json,
        reach: storedReach(reach, card) as unknown as Json,
      },
      select: { id: true },
    });
    return { id: row.id, status: 'proposed' as const, proposal_kind: kind, line, card };
  });
}

/** Run an operation's `prepare` (origin 'chat'): what the routes call before deciding to write or to propose. */
export async function prepareOperation(name: string, input: unknown, opts: { ownerId: string; now?: Date; db?: Db; origin?: ReachOrigin }): Promise<{ input: unknown; prepared: PreparedOp }> {
  const op = operationFor(name);
  if (!op) throw new ApiError('That change is not known here.', 400, 'unknown_op');
  const parsed = op.validate(input);
  const prepared = await op.prepare({ db: opts.db ?? defaultDb, ownerId: opts.ownerId, now: opts.now ?? new Date() }, parsed, opts.origin ?? 'chat');
  return { input: parsed, prepared };
}

// ---------------------------------------------------------------------------------------------
// The worker's v1 handoff record (POST /worker/actions)
// ---------------------------------------------------------------------------------------------

/**
 * The body of POST /worker/actions. Strict: an unknown key is a 400. The worker may only PROPOSE a handoff; the
 * other tools and statuses are still named here so a record of a change gets a plain refusal, not a schema error.
 * `summary`, `before`, `after` and `error` are accepted and ignored (never stored).
 */
export const recordActionSchema = z
  .object({
    conversation_id: z.string().uuid(),
    event_seq: z.number().int().positive().optional(),
    tool: z.enum(ACTION_TOOLS),
    target_id: z.string().uuid(),
    summary: z.string().max(600).optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    proposed_assignee_id: z.string().uuid().optional(),
    status: z.enum(['applied', 'proposed', 'failed']).default('proposed'),
    error: z.string().max(500).optional(),
  })
  .strict();
export type RecordActionInput = z.input<typeof recordActionSchema>;

export const WORKER_RECORD_REFUSED = 'The chat can only propose a handoff. Citadel records every change itself.';

/**
 * v1 path: a handoff proposal from the worker, and nothing else. The task must be the owner's right now and the
 * person one of the fixed handoff users. It is stored as a v2 proposal (task plan `{assignee_id}`, reach and card),
 * so its tap follows the same rules as every other. Applied, filed and failed records are a 400.
 */
export async function recordAction(
  raw: unknown,
  ownerId: string,
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<{ id: string; status: string; undo_until: Date | null }> {
  const input = recordActionSchema.parse(raw);
  if (input.status !== 'proposed' || input.tool !== 'propose_handoff') throw bad(WORKER_RECORD_REFUSED, 'record_refused');
  if (!input.proposed_assignee_id) throw bad('A proposal needs someone to hand it to', 'bad_proposal');
  const conv = await db.bastChatConversation.findUnique({ where: { id: input.conversation_id }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError('Chat not found', 404, 'not_found');
  const task = await db.task.findUnique({ where: { id: input.target_id }, select: { id: true, assignee_id: true, is_deleted: true } });
  if (!task || task.is_deleted) throw bad('That task does not exist.', 'task_missing');
  const settings = await getSettings(db);
  const who = input.proposed_assignee_id;
  if (!settings.handoff_user_ids.includes(who)) throw bad('A task can only be handed to Bast.', 'bad_handoff_target');
  if (task.assignee_id !== ownerId) throw bad('Only a task that is yours can be proposed for a handoff.', 'bad_handoff_task');
  if (!(await firstNameOf(db, who))) throw bad('That person is not available.', 'bad_handoff_target');
  const taskInput: TaskInput = { task_id: input.target_id, body: { assignee_id: who } };
  const prepared = await taskOperation.prepare({ db, ownerId, now }, taskInput, 'chat');
  const r = await storeProposalRow({
    ownerId,
    conversationId: input.conversation_id,
    tool: 'propose_handoff',
    op: 'task',
    input: taskInput,
    prepared,
    reserve: true,
    eventSeq: input.event_seq ?? null,
    plan: { v: 2, kind: 'apply', op: 'task', input: taskInput, expect: prepared.expect },
    allowNoReach: true,
    now,
    db,
  });
  return { id: r.id, status: r.status, undo_until: null };
}

/** Refuse the next write when today's write cap is used up (for the daemon's own check). */
export async function assertChatWriteAllowed(ownerId: string, now: Date = new Date(), db: Db = defaultDb): Promise<void> {
  await assertWriteAllowed(ownerId, await getSettings(db), now, db);
}

/** Every action of a conversation for the panel, newest last. */
export async function listActions(conversationId: string, now: Date = new Date(), db: Pick<PrismaClient, 'bastChatAction'> = defaultDb): Promise<ActionView[]> {
  const rows = await db.bastChatAction.findMany({ where: { conversation_id: conversationId }, orderBy: { created_at: 'asc' }, take: 200 });
  return rows.map((r) => actionView(r, now));
}

async function loadOwned(actionId: string, ownerId: string, db: Pick<Prisma.TransactionClient, 'bastChatAction' | 'bastChatConversation'>): Promise<BastChatAction> {
  if (!isChatUuid(actionId)) throw new ApiError('Not found', 404, 'not_found');
  const a = await db.bastChatAction.findUnique({ where: { id: actionId } });
  if (!a) throw new ApiError('Not found', 404, 'not_found');
  const conv = await db.bastChatConversation.findUnique({ where: { id: a.conversation_id }, select: { owner_id: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError('Not found', 404, 'not_found');
  return a;
}

/** The owner as a session actor, for writes through patchTask (never the chat lane, so its guard does not run). */
async function ownerActor(db: Db, ownerId: string): Promise<AuthPayload> {
  const u = await db.user.findUnique({ where: { id: ownerId }, select: { email: true } });
  return { userId: ownerId, email: u?.email ?? '', role: 'admin', via: 'session' };
}

async function noteAndSet(db: Db, a: BastChatAction, data: Prisma.BastChatActionUpdateInput, note: { code: ChatNoteCode; text: string }): Promise<BastChatAction> {
  return db.$transaction(async (tx) => {
    const row = await tx.bastChatAction.update({ where: { id: a.id }, data });
    await appendChatNote(tx, a.conversation_id, { code: note.code, text: note.text, action_id: a.id });
    return row;
  });
}

const clauseOf = (a: BastChatAction) => storedReachOf(a)?.card.clause ?? a.summary;

// ---------------------------------------------------------------------------------------------
// The tap
// ---------------------------------------------------------------------------------------------

/**
 * Carry out a proposal under the owner's session. Claims it first (one winner on a double tap; a declined, failed
 * or released proposal is a 409 "That is not waiting for a decision."). Then: the plan must still validate, the
 * reach recomputed now (origin 'tap') must have the stored fingerprint, and the write must hit its compare-and-set
 * on the values stored at proposal time. Any miss marks the proposal failed for good, writes nothing, tells the
 * chat, and answers 409 "Changed since. Open the task.". Owner taps are not counted against the daily limit.
 */
export async function releaseAction(actionId: string, actorId: string, now: Date = new Date(), db: Db = defaultDb): Promise<ActionView> {
  const a = await loadOwned(actionId, actorId, db);
  if (a.status !== 'proposed' || a.resolved_at) throw conflict(NOT_WAITING_TEXT, 'not_proposed');
  const plan = parsePlan(a.plan);
  const op = plan ? operationFor(plan.op) : null;
  if (plan && !op) throw conflict('That cannot be done right now. Try again later.', 'op_unavailable');
  const claim = await db.bastChatAction.updateMany({ where: { id: a.id, status: 'proposed', resolved_at: null }, data: { resolved_at: now, resolved_by_id: actorId } });
  if (claim.count !== 1) throw conflict(NOT_WAITING_TEXT, 'not_proposed');

  const dead = async (): Promise<never> => {
    await noteAndSet(db, a, { status: 'failed', error: CHANGED_SINCE_TEXT }, { code: 'action_failed', text: `Mike's tap did not go through, nothing changed: ${clauseOf(a)}. It changed since.` });
    throw conflict(CHANGED_SINCE_TEXT, 'changed_since');
  };
  const stored = storedReachOf(a);
  if (!plan || !op || !stored) return dead();
  const ctx: OpApplyContext = { db, ownerId: actorId, now, actor: await ownerActor(db, actorId) };
  let outcome: OpOutcome;
  let undone: BastChatAction | null = null;
  try {
    if (plan.kind === 'apply') {
      let input: unknown;
      try {
        input = op.validate(plan.input);
      } catch {
        return dead(); // the stored plan no longer validates
      }
      const prepared = await op.prepare(ctx, input, 'tap');
      if (reachFingerprint(prepared.reach) !== stored.fingerprint) return dead();
      outcome = await op.apply(ctx, input, plan.expect);
    } else {
      undone = await db.bastChatAction.findUnique({ where: { id: plan.undo_of } });
      if (!undone || undone.status !== 'applied' || undone.conversation_id !== a.conversation_id || operationForRecord(undone) !== op) return dead();
      const prepared = await op.prepareUndo(ctx, undone);
      if (reachFingerprint(prepared.reach) !== stored.fingerprint) return dead();
      outcome = await op.undo(ctx, undone, plan.expect);
    }
  } catch (e) {
    if (e instanceof ApiError && e.statusCode < 500) return dead();
    if (e instanceof z.ZodError) return dead();
    await db.bastChatAction.update({ where: { id: a.id }, data: { status: 'failed', error: 'That did not go through.' } });
    throw e;
  }
  if (!outcome.ok) return dead();
  if (undone) {
    await db.bastChatAction.updateMany({ where: { id: undone.id, status: 'applied' }, data: { status: 'undone', resolved_at: now, resolved_by_id: actorId } });
  }
  const row = await noteAndSet(db, a, { status: 'released', error: null }, { code: 'action_released', text: `Mike tapped yes, done: ${clauseOf(a)}.` });
  return actionView(row, now);
}

/** "Keep it": the proposal is declined and nothing else changes. */
export async function declineAction(actionId: string, actorId: string, now: Date = new Date(), db: Db = defaultDb): Promise<ActionView> {
  const a = await loadOwned(actionId, actorId, db);
  if (a.status !== 'proposed' || a.resolved_at) throw conflict(NOT_WAITING_TEXT, 'not_proposed');
  const claim = await db.bastChatAction.updateMany({ where: { id: a.id, status: 'proposed', resolved_at: null }, data: { status: 'declined', resolved_at: now, resolved_by_id: actorId } });
  if (claim.count !== 1) throw conflict(NOT_WAITING_TEXT, 'not_proposed');
  const row = await db.$transaction(async (tx) => {
    await appendChatNote(tx, a.conversation_id, { code: 'action_declined', text: `Mike said no, nothing changed: ${clauseOf(a)}.`, action_id: a.id });
    return tx.bastChatAction.findUniqueOrThrow({ where: { id: a.id } });
  });
  return actionView(row, now);
}

// ---------------------------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------------------------

export type UndoView = ActionView & { proposal?: ProposalResult };

/**
 * Undo an applied record, as the owner. 409 when it was already undone or is not an applied change, the window has
 * passed, an Undo of it already waits for a tap, a later applied chat change on the same target is still in place
 * ("Undo the later change to this first."), or the target no longer holds what the record wrote ("Changed since.
 * Open the task."). The restore is run through the reach check (R6): a hit stores a proposal with the same tap rules
 * and changes nothing (the record stays applied until that tap). Otherwise it is written through the operation
 * (patchTask for a task, so dependents reblock and the activity log runs) with a compare-and-set.
 */
export async function undoAction(actionId: string, actorId: string, now: Date = new Date(), db: Db = defaultDb): Promise<UndoView> {
  const a = await loadOwned(actionId, actorId, db);
  if (a.status === 'undone') throw conflict('That was already undone.', 'undo_used');
  if (a.status !== 'applied') throw conflict(CANNOT_UNDO_TEXT, 'not_undoable');
  if (!a.undo_until || a.undo_until.getTime() <= now.getTime()) throw conflict('It is too late to undo that.', 'undo_expired');
  const op = operationForRecord(a);
  if (!op) throw conflict("That can't be undone from here. Open it in Citadel.", 'not_undoable');
  const pending = await db.bastChatAction.findMany({
    where: { target_type: a.target_type, target_id: a.target_id, status: 'proposed' },
    select: { id: true, plan: true },
    take: 50,
  });
  if (pending.some((p) => (p.plan as { undo_of?: unknown } | null)?.undo_of === a.id)) throw conflict(UNDO_PENDING_TEXT, 'undo_pending');
  const later = await db.bastChatAction.findFirst({
    where: { target_type: a.target_type, target_id: a.target_id, status: 'applied', created_at: { gt: a.created_at }, id: { not: a.id } },
    select: { id: true },
  });
  if (later) throw conflict(LATER_FIRST_TEXT, 'later_change');

  const ctx: OpApplyContext = { db, ownerId: actorId, now, actor: await ownerActor(db, actorId) };
  const prepared = await op.prepareUndo(ctx, a);
  if (prepared.reach.needs_tap) {
    const proposal = await storeProposalRow({
      ownerId: actorId,
      conversationId: a.conversation_id,
      tool: a.tool,
      op: op.name,
      prepared,
      reserve: false,
      eventSeq: a.event_seq,
      turnSeq: a.turn_seq,
      plan: { v: 2, kind: 'undo', op: op.name, undo_of: a.id, expect: prepared.expect },
      targetType: a.target_type,
      targetId: a.target_id,
      now,
      db,
    });
    await db.$transaction((tx) => appendChatNote(tx, a.conversation_id, { code: 'undo_proposed', text: `Undo waits for Mike's tap, nothing changed yet: ${a.summary}`, action_id: a.id }));
    return { ...actionView(a, now), proposal };
  }
  const out = await op.undo(ctx, a, prepared.expect);
  if (!out.ok) throw conflict(out.reason === 'invalid' && out.message ? UNDO_TRANSITION_TEXT : CHANGED_SINCE_TEXT, 'changed_since');
  const row = await db.$transaction(async (tx) => {
    const r = await tx.bastChatAction.updateMany({ where: { id: a.id, status: 'applied' }, data: { status: 'undone', resolved_at: now, resolved_by_id: actorId } });
    if (r.count === 1) await appendChatNote(tx, a.conversation_id, { code: 'action_undone', text: `Mike undid this, it is back as it was: ${a.summary}`, action_id: a.id });
    return tx.bastChatAction.findUniqueOrThrow({ where: { id: a.id } });
  });
  return actionView(row, now);
}

// ---------------------------------------------------------------------------------------------
// Undo everything since
// ---------------------------------------------------------------------------------------------

export const undoSinceSchema = z
  .object({ since: z.string().datetime({ offset: true }).optional(), from_action_id: z.string().uuid().optional() })
  .strict()
  .refine((b) => (b.since === undefined) !== (b.from_action_id === undefined), 'Give a time or an action, not both.');
export type UndoSinceInput = z.infer<typeof undoSinceSchema>;

export interface UndoSinceLine {
  id: string;
  summary: string;
}
export interface UndoSinceResult {
  /** Undone, newest first. */
  undone: UndoSinceLine[];
  /** Undo would start or re-steer Bast or show the client: each is a tap card now (`proposal_id`). */
  proposed: (UndoSinceLine & { proposal_id: string })[];
  /** The first one that could not be undone for a reason that ends the walk (a change since, an error). */
  stopped: (UndoSinceLine & { reason: string }) | null;
  /** Skipped, each with its reason: older than the stop, past the 24 hour window, or blocked by a later change that can't be undone. */
  left: (UndoSinceLine & { reason: string })[];
  /** Chat proposals made since then that still wait for a tap (not touched). */
  waiting: UndoSinceLine[];
}

/**
 * "Undo everything since": the chat's applied changes at or after `since` (or from the action `from_action_id`,
 * that one included), newest first, each through `undoAction` with all its checks. Stops at the first that fails for
 * a reason that ends the walk and reports it. What became a proposal is listed and the walk goes on, and so does a
 * record blocked only by a later change that can never be undone: it is skipped (in `left`, with that reason).
 */
export async function undoSince(ownerId: string, raw: unknown, now: Date = new Date(), db: Db = defaultDb): Promise<UndoSinceResult> {
  const input = undoSinceSchema.parse(raw);
  let cutoff: Date;
  if (input.from_action_id) cutoff = (await loadOwned(input.from_action_id, ownerId, db)).created_at;
  else cutoff = new Date(input.since!);
  const convs = await db.bastChatConversation.findMany({ where: { owner_id: ownerId }, select: { id: true }, take: 1000 });
  const convIds = convs.map((c) => c.id);
  const result: UndoSinceResult = { undone: [], proposed: [], stopped: null, left: [], waiting: [] };
  if (convIds.length === 0) return result;
  const rows = await db.bastChatAction.findMany({
    where: { conversation_id: { in: convIds }, status: 'applied', created_at: { gte: cutoff } },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: 1000,
  });
  const line = (r: BastChatAction): UndoSinceLine => ({ id: r.id, summary: r.summary });
  for (const r of rows) {
    if (result.stopped) {
      result.left.push({ ...line(r), reason: 'Not tried: the walk stopped at a newer change.' });
      continue;
    }
    if (!r.undo_until || r.undo_until.getTime() <= now.getTime()) {
      result.left.push({ ...line(r), reason: 'It is too late to undo that.' });
      continue;
    }
    try {
      const v = await undoAction(r.id, ownerId, now, db);
      if (v.proposal) result.proposed.push({ ...line(r), proposal_id: v.proposal.id });
      else result.undone.push(line(r));
    } catch (e) {
      let reason = e instanceof ApiError && e.statusCode < 500 ? e.message : 'That did not go through.';
      if (e instanceof ApiError && e.code === 'later_change') {
        // A newer change to the same record is what blocks this one. Say which kind of block it is.
        const laterRows = await db.bastChatAction.findMany({
          where: { target_type: r.target_type, target_id: r.target_id, status: 'applied', created_at: { gt: r.created_at }, id: { not: r.id } },
          select: { id: true, undo_until: true },
          take: 50,
        });
        const proposedIds = new Set(result.proposed.map((p) => p.id));
        if (laterRows.some((l) => proposedIds.has(l.id))) {
          reason = 'A later change to this waits for your tap first.';
        } else if (laterRows.length > 0 && laterRows.every((l) => !l.undo_until || l.undo_until.getTime() <= now.getTime())) {
          // The later change can never be undone (a finished wait, say), so this one cannot either. Skip it; the older ones may still go.
          result.left.push({ ...line(r), reason: "A later change to this can't be undone." });
          continue;
        }
      }
      if (!(e instanceof ApiError)) console.error('bast-chat: undo since stopped on an error', e instanceof Error ? e.message : 'error');
      result.stopped = { ...line(r), reason };
    }
  }
  const open = await db.bastChatAction.findMany({
    where: { conversation_id: { in: convIds }, status: 'proposed', created_at: { gte: cutoff } },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  const madeHere = new Set(result.proposed.map((p) => p.proposal_id));
  result.waiting = open.filter((o) => !madeHere.has(o.id) && (o.plan as { kind?: unknown } | null)?.kind !== 'undo').map(line);
  return result;
}
