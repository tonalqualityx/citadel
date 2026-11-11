/**
 * Home screen Slice 6b: the database side of the Slack lines to Mike.
 *
 * Writes only the owner's home_emergency_watch rows. It never writes a Task, EmailAsk or Notification row and never posts
 * anything: it hands lines to the machine (a claim) and records what the machine says it posted (an ack).
 * Tracking (first sight, cleared, acted) runs on every home-watch POST whatever the switch says; lines need
 * home_keeper_settings.emergency_slack and a request that says it can post (`caps: ["slack"]`).
 */

import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { loadHomeInputs } from '../load';
import { selectHome } from '../select';
import { loadItemStates, type HomeDb } from '../state';
import { parseSiteItemKey } from './site';
import {
  MAX_LINES_PER_RUN,
  RELAND_AFTER_MS,
  lineDay,
  parseLineId,
  planLines,
  type LineKind,
  type WatchItem,
  type WatchState,
} from './watch';

export const ACK_MAX_IDS = 20;

export const ackBodySchema = z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(ACK_MAX_IDS) }).strict();
export type AckBody = z.infer<typeof ackBodySchema>;

export interface WireLine {
  id: string;
  kind: LineKind;
  text: string;
}

/** The owner's switch. A missing row means off. */
export async function loadEmergencySlack(db: HomeDb, ownerId: string): Promise<boolean> {
  const row = await db.homeKeeperSettings.findUnique({ where: { user_id: ownerId }, select: { emergency_slack: true } });
  return row?.emergency_slack === true;
}

/** Everything in Needs you now for the owner, as the planner reads it. Reads only. */
export async function loadWatchItems(db: PrismaClient, ownerId: string, now: Date, timezone: string): Promise<WatchItem[]> {
  const [raw, states] = await Promise.all([loadHomeInputs(db, ownerId, now, { timezone }), loadItemStates(db, ownerId)]);
  const sel = selectHome({ raw, states, now });
  const siteIds = sel.sections.needs_you_now.map((i) => parseSiteItemKey(i.key)).filter((x): x is string => !!x);
  const escalated = siteIds.length
    ? new Set(
        (
          await db.homeSiteIncident.findMany({
            where: { user_id: ownerId, source: 'kuma', closed_at: null, watchdog_escalated: true, site_id: { in: siteIds } },
            select: { site_id: true },
          })
        ).map((r) => r.site_id)
      )
    : new Set<string>();
  return sel.sections.needs_you_now.map((item) => {
    const cand = sel.byKey.get(item.key);
    const siteId = parseSiteItemKey(item.key);
    return {
      key: item.key,
      title: item.title,
      why: item.why_now,
      lifeline: cand?.rule === 'lifeline',
      hard_date: cand?.hardDate ?? null,
      watchdog_escalated: !!siteId && escalated.has(siteId),
    };
  });
}

const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

type Row = Awaited<ReturnType<HomeDb['homeEmergencyWatch']['findMany']>>[number];

function toState(r: Row): WatchState {
  return {
    id: r.id,
    item_key: r.item_key,
    first_seen_at: r.first_seen_at,
    cleared_at: r.cleared_at,
    acted_at: r.acted_at,
    slack_first_claimed_at: r.slack_first_claimed_at,
    slack_first_claims: r.slack_first_claims,
    slack_first_at: r.slack_first_at,
    slack_again_claimed_at: r.slack_again_claimed_at,
    slack_again_claims: r.slack_again_claims,
    slack_again_at: r.slack_again_at,
    lifeline_line_on: dayOf(r.lifeline_line_on),
    lifeline_claim_on: dayOf(r.lifeline_claim_on),
    lifeline_claimed_at: r.lifeline_claimed_at,
    lifeline_claims: r.lifeline_claims,
  };
}

/** The owner's tracked rows that are still in Needs you now, by item key. */
async function loadStates(db: HomeDb, ownerId: string, keys: readonly string[]): Promise<Map<string, WatchState>> {
  if (keys.length === 0) return new Map();
  const rows = await db.homeEmergencyWatch.findMany({ where: { user_id: ownerId, item_key: { in: [...keys] }, cleared_at: null } });
  return new Map(rows.map((r) => [r.item_key, toState(r)]));
}

/**
 * First sight, cleared and acted for the owner's Needs you now. Always runs. A new item gets a row; an item that left and
 * comes back after an hour is a new landing (its line counters restart, the lifeline day record stays); an item gone from the
 * list is marked cleared; a home action on an item since it landed marks it acted (no "still waiting" line for it).
 */
export async function trackWatch(db: HomeDb, ownerId: string, items: readonly WatchItem[], now: Date): Promise<void> {
  const keys = items.map((i) => i.key);
  const existing = await db.homeEmergencyWatch.findMany({ where: { user_id: ownerId, item_key: { in: keys } } });
  const byKey = new Map(existing.map((r) => [r.item_key, r]));
  for (const it of items) {
    const row = byKey.get(it.key);
    if (!row) {
      await db.homeEmergencyWatch.upsert({
        where: { user_id_item_key: { user_id: ownerId, item_key: it.key } },
        create: { user_id: ownerId, item_key: it.key, first_seen_at: now },
        update: {},
      });
    } else if (row.cleared_at) {
      if (now.getTime() - row.cleared_at.getTime() >= RELAND_AFTER_MS) {
        await db.homeEmergencyWatch.update({
          where: { id: row.id },
          data: {
            first_seen_at: now,
            cleared_at: null,
            acted_at: null,
            slack_first_claimed_at: null,
            slack_first_claims: 0,
            slack_first_at: null,
            slack_again_claimed_at: null,
            slack_again_claims: 0,
            slack_again_at: null,
          },
        });
      } else {
        await db.homeEmergencyWatch.update({ where: { id: row.id }, data: { cleared_at: null } });
      }
    }
  }
  await db.homeEmergencyWatch.updateMany({
    where: { user_id: ownerId, cleared_at: null, item_key: { notIn: keys } },
    data: { cleared_at: now },
  });
  // acted: any home action (not the keeper's own lines) on the item since it landed
  const open = await db.homeEmergencyWatch.findMany({ where: { user_id: ownerId, cleared_at: null, acted_at: null } });
  if (open.length === 0) return;
  const actions = await db.homeAction.findMany({
    where: {
      user_id: ownerId,
      item_key: { in: open.map((r) => r.item_key) },
      source: { not: 'keeper' },
      created_at: { gte: new Date(Math.min(...open.map((r) => r.first_seen_at.getTime()))) },
    },
    select: { item_key: true, created_at: true },
  });
  for (const r of open) {
    if (actions.some((a) => a.item_key === r.item_key && a.created_at.getTime() >= r.first_seen_at.getTime())) {
      await db.homeEmergencyWatch.updateMany({ where: { id: r.id, acted_at: null }, data: { acted_at: now } });
    }
  }
}

/** Mark a planned line claimed, guarded on the counters the plan saw. Returns true when this call won the claim. */
async function claim(db: HomeDb, st: WatchState, kind: LineKind, now: Date, timeZone: string): Promise<boolean> {
  if (kind === 'first') {
    const r = await db.homeEmergencyWatch.updateMany({
      where: { id: st.id, slack_first_claims: st.slack_first_claims, slack_first_at: null },
      data: { slack_first_claimed_at: now, slack_first_claims: st.slack_first_claims + 1 },
    });
    return r.count === 1;
  }
  if (kind === 'again') {
    const r = await db.homeEmergencyWatch.updateMany({
      where: { id: st.id, slack_again_claims: st.slack_again_claims, slack_again_at: null },
      data: { slack_again_claimed_at: now, slack_again_claims: st.slack_again_claims + 1 },
    });
    return r.count === 1;
  }
  const today = lineDay(now, timeZone);
  const sameDay = st.lifeline_claim_on === today;
  const r = await db.homeEmergencyWatch.updateMany({
    where: {
      id: st.id,
      lifeline_claims: st.lifeline_claims,
      lifeline_claim_on: st.lifeline_claim_on ? dayDate(st.lifeline_claim_on) : null,
    },
    data: { lifeline_claim_on: dayDate(today), lifeline_claimed_at: now, lifeline_claims: sameDay ? st.lifeline_claims + 1 : 1 },
  });
  return r.count === 1;
}

/**
 * The lines to hand out now: plans against the tracked rows, then claims each (at most six). Call after trackWatch, only when
 * the switch is on and the request carries the "slack" cap.
 */
export async function claimLines(db: HomeDb, ownerId: string, items: readonly WatchItem[], now: Date, timeZone: string): Promise<WireLine[]> {
  const states = await loadStates(db, ownerId, items.map((i) => i.key));
  const planned = planLines({ items, states, now, timeZone });
  const out: WireLine[] = [];
  for (const p of planned) {
    if (out.length >= MAX_LINES_PER_RUN) break;
    const st = states.get(p.item_key);
    if (!st) continue;
    if (await claim(db, st, p.kind, now, timeZone)) out.push({ id: p.id, kind: p.kind, text: p.text });
  }
  return out;
}

/** What a real run would hand out right now, with nothing written. An untracked item gets a `new:<item key>` id. */
export async function previewLines(db: HomeDb, ownerId: string, items: readonly WatchItem[], now: Date, timeZone: string): Promise<WireLine[]> {
  const states = await loadStates(db, ownerId, items.map((i) => i.key));
  return planLines({ items, states, now, timeZone })
    .slice(0, MAX_LINES_PER_RUN)
    .map((p) => ({ id: p.id, kind: p.kind, text: p.text }));
}

/** Mark lines posted. Unknown, foreign or malformed ids are ignored. Returns how many rows changed. */
export async function ackLines(db: HomeDb, ownerId: string, ids: readonly string[], now: Date): Promise<{ acked: number; ignored: number }> {
  let acked = 0;
  for (const id of ids) {
    const p = parseLineId(id);
    if (!p) continue;
    let count = 0;
    if (p.kind === 'first') {
      count = (await db.homeEmergencyWatch.updateMany({ where: { id: p.row_id, user_id: ownerId, slack_first_at: null, slack_first_claims: { gt: 0 } }, data: { slack_first_at: now } })).count;
    } else if (p.kind === 'again') {
      count = (await db.homeEmergencyWatch.updateMany({ where: { id: p.row_id, user_id: ownerId, slack_again_at: null, slack_again_claims: { gt: 0 } }, data: { slack_again_at: now } })).count;
    } else {
      const row = await db.homeEmergencyWatch.findFirst({ where: { id: p.row_id, user_id: ownerId, lifeline_claim_on: { not: null } }, select: { lifeline_claim_on: true } });
      if (row?.lifeline_claim_on) {
        count = (await db.homeEmergencyWatch.updateMany({ where: { id: p.row_id, user_id: ownerId }, data: { lifeline_line_on: row.lifeline_claim_on } })).count;
      }
    }
    acked += count;
  }
  return { acked, ignored: ids.length - acked };
}
