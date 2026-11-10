/**
 * Bast chat: daily usage and the caps. One BastChatUsage row per owner per Eastern day.
 *
 * Messages (`turns`) are counted when Citadel accepts a send, so the daemon must not count them again. Task
 * changes (`writes`) are counted by the server, once per successful chat-lane write on the task routes and once per handoff proposal. Cost is added from the daemon's
 * cost events. The refusals are one plain line each and a 429.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { ChatSettings } from './settings';

type UsageDb = Pick<PrismaClient, 'bastChatUsage'> | Pick<Prisma.TransactionClient, 'bastChatUsage'>;

export const MESSAGE_CAP_TEXT = "Today's message limit is reached. It resets at midnight.";
export const WRITE_CAP_TEXT = "Today's limit on task changes is reached. It resets at midnight.";
export const COST_CAP_TEXT = "Today's chat budget is spent. It resets at midnight.";
const CAP_TZ = 'America/New_York';

export interface DayUsage {
  turns: number;
  writes: number;
  cost_usd: number;
}

/** The Eastern calendar date of `now`, as a UTC-midnight Date (the value of a `@db.Date` column). */
export function easternDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CAP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

export async function getUsage(ownerId: string, now: Date = new Date(), db: UsageDb = defaultDb): Promise<DayUsage> {
  const r = await db.bastChatUsage.findUnique({ where: { owner_id_day: { owner_id: ownerId, day: easternDay(now) } } });
  return { turns: r?.turns ?? 0, writes: r?.writes ?? 0, cost_usd: r ? Number(r.cost_usd.toString()) : 0 };
}

export interface UsageLeft {
  turns_left: number;
  writes_left: number;
  usd_left: number;
}

export function usageLeft(settings: ChatSettings, used: DayUsage): UsageLeft {
  return {
    turns_left: Math.max(0, settings.daily_turn_cap - used.turns),
    writes_left: Math.max(0, settings.daily_write_cap - used.writes),
    usd_left: Math.max(0, Math.round((settings.daily_cost_cap_usd - used.cost_usd) * 10000) / 10000),
  };
}

/** 429 with a plain line when a new message is not allowed today (message count first, then cost). */
export async function assertCanSend(ownerId: string, settings: ChatSettings, now: Date = new Date(), db: UsageDb = defaultDb): Promise<void> {
  const used = await getUsage(ownerId, now, db);
  if (used.turns >= settings.daily_turn_cap) throw new ApiError(MESSAGE_CAP_TEXT, 429, 'daily_cap', 'daily_messages');
  if (used.cost_usd >= settings.daily_cost_cap_usd) throw new ApiError(COST_CAP_TEXT, 429, 'daily_cap', 'daily_cost');
}

/** 429 with a plain line when no more task changes are allowed today. */
export async function assertWriteAllowed(ownerId: string, settings: ChatSettings, now: Date = new Date(), db: UsageDb = defaultDb): Promise<void> {
  const used = await getUsage(ownerId, now, db);
  if (used.writes >= settings.daily_write_cap) throw new ApiError(WRITE_CAP_TEXT, 429, 'daily_cap', 'daily_writes');
}

/** Add to today's row (created on first use). */
export async function bumpUsage(
  ownerId: string,
  delta: { turns?: number; writes?: number; cost_usd?: number },
  now: Date = new Date(),
  db: UsageDb = defaultDb,
): Promise<void> {
  const day = easternDay(now);
  const turns = delta.turns ?? 0;
  const writes = delta.writes ?? 0;
  const cost = delta.cost_usd ?? 0;
  await db.bastChatUsage.upsert({
    where: { owner_id_day: { owner_id: ownerId, day } },
    create: { owner_id: ownerId, day, turns, writes, cost_usd: cost },
    update: { turns: { increment: turns }, writes: { increment: writes }, cost_usd: { increment: cost } },
  });
}
