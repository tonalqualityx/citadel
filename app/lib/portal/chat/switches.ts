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

/** The runner posts a heartbeat every 60 s; no heartbeat for 3 minutes is a real outage (cron restarts it every minute). */
export const RUNNER_ALIVE_MS = 3 * 60_000;

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
  /** The runner's own last heartbeat (idle or busy). */
  last_seen_at: Date | null;
  /** No runner heartbeat for 3 minutes, whatever the queue looks like. */
  dead: boolean;
}

/** Record that the runner is alive. Called by POST /api/engine/runner/heartbeat. */
export async function recordRunnerHeartbeat(now: Date = new Date()): Promise<Date> {
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', portal_chat_runner_seen_at: now },
    update: { portal_chat_runner_seen_at: now },
  });
  return now;
}

/**
 * Liveness is the runner's heartbeat, independent of claims: an idle runner with an empty queue is
 * alive, and the first message after a quiet night stays in model mode. Claims are reported for
 * information only.
 */
export async function runnerState(now: Date = new Date()): Promise<RunnerState> {
  const [settings, last] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { portal_chat_runner_seen_at: true } }),
    prisma.engineJob.findFirst({ where: { claimed_at: { not: null } }, orderBy: { claimed_at: 'desc' }, select: { claimed_at: true } }),
  ]);
  const seen = settings?.portal_chat_runner_seen_at ?? null;
  const dead = !seen || now.getTime() - seen.getTime() > RUNNER_ALIVE_MS;
  return { last_claim_at: last?.claimed_at ?? null, last_seen_at: seen, dead };
}

export type Unavailable = 'mode_off' | 'not_pilot' | 'site_off' | 'runner_down' | CapReason;
export type Availability = { available: true } | { available: false; reason: Unavailable };

/** The kill switches alone (mode, pilot, site): re-checked when a job is claimed, so turning chat off stops queued work. */
export async function chatSwitchesOn(input: { contactId: string; clientId: string; siteId?: string | null }): Promise<{ on: true } | { on: false; reason: 'mode_off' | 'not_pilot' | 'site_off' }> {
  const settings = await getChatSettings();
  if (settings.mode === 'off') return { on: false, reason: 'mode_off' };
  if (settings.mode === 'pilot' && !settings.pilot_contact_ids.includes(input.contactId)) return { on: false, reason: 'not_pilot' };
  const siteOk = input.siteId
    ? (await prisma.site.count({ where: { id: input.siteId, client_id: input.clientId, is_deleted: false, portal_chat_enabled: true } })) > 0
    : (await prisma.site.count({ where: { client_id: input.clientId, is_deleted: false, portal_chat_enabled: true } })) > 0;
  return siteOk ? { on: true } : { on: false, reason: 'site_off' };
}

export async function chatAvailability(input: {
  contactId: string;
  clientId: string;
  siteId?: string | null;
  conversationId?: string | null;
  now?: Date;
}): Promise<Availability> {
  const now = input.now ?? new Date();
  const sw = await chatSwitchesOn(input);
  if (!sw.on) return { available: false, reason: sw.reason };

  const caps = await checkCaps({ conversationId: input.conversationId, contactId: input.contactId, clientId: input.clientId, now });
  if (!caps.ok) return { available: false, reason: caps.reason };

  const runner = await runnerState(now);
  if (runner.dead) return { available: false, reason: 'runner_down' };
  return { available: true };
}
