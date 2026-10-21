/**
 * The chat switches (phase C spec 9.1). Chat is available to a contact when ALL hold, checked when
 * each job is queued:
 *  - AppSettings.portal_chat_mode is `on`, or `pilot` and the contact is a pilot contact;
 *  - the conversation's site has portal_chat_enabled (before a site is chosen: any of the client's sites);
 *  - the caps in 9.3 are not hit;
 *  - the runner has claimed a job in the last 10 minutes, or nothing is waiting (a dead runner turns
 *    new conversations into tree mode at once, instead of after 60 seconds each).
 * Otherwise the surface runs tree mode. The Bast token may set the mode to `off`, never `on` or `pilot`.
 */
import type { PortalChatSwitch } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { checkCaps, type CapReason } from '@/lib/portal/chat/caps';

export const RUNNER_ALIVE_MS = 10 * 60_000;

export interface ChatSettings {
  mode: PortalChatSwitch;
  pilot_contact_ids: string[];
  daily_cap_usd: number;
}

export async function getChatSettings(): Promise<ChatSettings> {
  const s = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { portal_chat_mode: true, portal_chat_pilot_contact_ids: true, portal_chat_daily_cap_usd: true },
  });
  return {
    mode: s?.portal_chat_mode ?? 'off',
    pilot_contact_ids: s?.portal_chat_pilot_contact_ids ?? [],
    daily_cap_usd: s ? Number(s.portal_chat_daily_cap_usd) : 30,
  };
}

export async function updateChatSettings(patch: Partial<{ mode: PortalChatSwitch; pilot_contact_ids: string[]; daily_cap_usd: number }>): Promise<ChatSettings> {
  const data = {
    ...(patch.mode !== undefined ? { portal_chat_mode: patch.mode } : {}),
    ...(patch.pilot_contact_ids !== undefined ? { portal_chat_pilot_contact_ids: patch.pilot_contact_ids } : {}),
    ...(patch.daily_cap_usd !== undefined ? { portal_chat_daily_cap_usd: patch.daily_cap_usd } : {}),
  };
  await prisma.appSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
  return getChatSettings();
}

export interface RunnerState {
  last_claim_at: Date | null;
  /** No claim in the last 10 minutes while a job is waiting or went unclaimed. */
  dead: boolean;
}

export async function runnerState(now: Date = new Date()): Promise<RunnerState> {
  const since = new Date(now.getTime() - RUNNER_ALIVE_MS);
  const last = await prisma.engineJob.findFirst({ where: { claimed_at: { not: null } }, orderBy: { claimed_at: 'desc' }, select: { claimed_at: true } });
  const lastClaim = last?.claimed_at ?? null;
  if (lastClaim && lastClaim >= since) return { last_claim_at: lastClaim, dead: false };
  // No recent claim: dead only if work is stuck. A queued job, or one that expired unclaimed
  // within the window, means nobody is picking up. An empty queue is a quiet runner, not a dead one.
  const stuck = await prisma.engineJob.count({
    where: { OR: [{ status: 'queued' }, { status: 'expired', claimed_at: null, expired_at: { gte: since } }] },
  });
  return { last_claim_at: lastClaim, dead: stuck > 0 };
}

export type Unavailable = 'mode_off' | 'not_pilot' | 'site_off' | 'runner_down' | CapReason;
export type Availability = { available: true } | { available: false; reason: Unavailable };

export async function chatAvailability(input: {
  contactId: string;
  clientId: string;
  siteId?: string | null;
  conversationId?: string | null;
  now?: Date;
}): Promise<Availability> {
  const now = input.now ?? new Date();
  const settings = await getChatSettings();
  if (settings.mode === 'off') return { available: false, reason: 'mode_off' };
  if (settings.mode === 'pilot' && !settings.pilot_contact_ids.includes(input.contactId)) return { available: false, reason: 'not_pilot' };

  const siteOk = input.siteId
    ? (await prisma.site.count({ where: { id: input.siteId, client_id: input.clientId, is_deleted: false, portal_chat_enabled: true } })) > 0
    : (await prisma.site.count({ where: { client_id: input.clientId, is_deleted: false, portal_chat_enabled: true } })) > 0;
  if (!siteOk) return { available: false, reason: 'site_off' };

  const caps = await checkCaps({ conversationId: input.conversationId, contactId: input.contactId, clientId: input.clientId, now });
  if (!caps.ok) return { available: false, reason: caps.reason };

  const runner = await runnerState(now);
  if (runner.dead) return { available: false, reason: 'runner_down' };
  return { available: true };
}
