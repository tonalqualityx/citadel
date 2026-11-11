/**
 * Home Slice 4b: the checks behind "Send the draft". An owed_reply outbox row is Mike's own press on a Bast draft,
 * held for 10 minutes. Everything here is a read, and none of it is subject to the send_recheck_mode switch: these
 * checks are always enforced.
 *
 * `owedSwitchOn` is the one reader of HomeKeeperSettings.owed_send for the send path. A missing settings row is off.
 *
 * `recheckOwedReply` is run by the claim route (and by recheckSend) and answers, in this order:
 *   send_off      the switch is off (or the user is not an active admin with the home screen on)
 *   no_press      no matching home_actions row of his press (the row was not made by his press)
 *   superseded    he pressed Undo
 *   held          before send_after (the 10-minute hold); a row with no send_after counts as no_press
 *   expired       the hold ended more than 6 hours ago; the thread has moved on
 *   already_replied  one of the mails it answers is no longer open
 */
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { OWED_REPLY_KIND, type Govern } from './govern';

export const OWED_SEND_ACTION = 'send_draft';
export const OWED_HOLD_MS = 10 * 60 * 1000;
export const OWED_EXPIRE_MS = 6 * 60 * 60 * 1000;

type Db = Prisma.TransactionClient | typeof prisma;
export type OwedGovern = Extract<Govern, { intent: 'owed_reply' }>;

export type OwedReason = 'send_off' | 'no_press' | 'superseded' | 'held' | 'expired' | 'already_replied';
export type OwedCheck = { ok: true } | { ok: false; reason: OwedReason };

/** Reasons that end the row for good (it is stamped superseded). The others (send_off, held) leave it waiting. */
export const OWED_FINAL_REASONS: readonly OwedReason[] = ['no_press', 'superseded', 'expired', 'already_replied'];

/** True only when this user has a settings row with owed_send set, and is an active admin with the home screen on. */
export async function owedSwitchOn(db: Db, userId: string): Promise<boolean> {
  const s = await db.homeKeeperSettings.findUnique({ where: { user_id: userId }, select: { owed_send: true } });
  if (s?.owed_send !== true) return false;
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, is_active: true } });
  if (!u || u.role !== 'admin' || !u.is_active) return false;
  const pref = await db.userPreference.findUnique({ where: { user_id: userId }, select: { home_view: true } });
  return pref?.home_view === 'home';
}

export function owedThreadKey(g: Pick<OwedGovern, 'account' | 'thread_id'>): string {
  return `thread:${g.account}:${g.thread_id}`;
}

/** Is the outbox row an owed reply by its kind or by its govern block? Either one makes the owed checks apply. */
export function isOwedRow(row: { kind?: string | null }, govern: Govern | null): boolean {
  return row.kind === OWED_REPLY_KIND || govern?.intent === 'owed_reply';
}

export async function recheckOwedReply(
  govern: Govern | null,
  row: { kind?: string | null; send_after?: Date | null } | null,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<OwedCheck> {
  if (!govern || govern.intent !== 'owed_reply') return { ok: false, reason: 'no_press' };
  if (row && row.kind !== OWED_REPLY_KIND) return { ok: false, reason: 'no_press' };

  if (!(await owedSwitchOn(db, govern.user_id))) return { ok: false, reason: 'send_off' };

  const action = await db.homeAction.findUnique({
    where: { id: govern.home_action_id },
    select: { action: true, source: true, user_id: true, undone_at: true, item_key: true, after: true },
  });
  const after = action?.after && typeof action.after === 'object' && !Array.isArray(action.after) ? (action.after as Record<string, unknown>) : null;
  if (
    !action ||
    action.action !== OWED_SEND_ACTION ||
    action.source !== 'home' ||
    action.user_id !== govern.user_id ||
    action.item_key !== owedThreadKey(govern) ||
    after?.draft_id !== govern.draft_id
  ) {
    return { ok: false, reason: 'no_press' };
  }
  if (action.undone_at) return { ok: false, reason: 'superseded' };

  if (row) {
    if (!row.send_after) return { ok: false, reason: 'no_press' };
    if (row.send_after.getTime() > now.getTime()) return { ok: false, reason: 'held' };
    if (now.getTime() - row.send_after.getTime() > OWED_EXPIRE_MS) return { ok: false, reason: 'expired' };
  }

  const open = await db.emailAsk.count({ where: { id: { in: govern.ask_ids }, state: 'open' } });
  if (open !== govern.ask_ids.length) return { ok: false, reason: 'already_replied' };
  return { ok: true };
}
