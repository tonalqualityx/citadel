/**
 * Rate and spend caps (phase C spec 9.3), counted in the database so a restart changes nothing.
 * Chat starts and message rates are phase B's (thread.ts, file-request.ts); this module holds the
 * engine's own: jobs per conversation, contact and client, and spend from EngineRun.cost_usd
 * (the API-equivalent figure).
 */
import { prisma } from '@/lib/db/prisma';

export const CAPS = {
  jobs_per_conversation: 30,
  jobs_per_contact_day: 40,
  jobs_per_client_day: 60,
  spend_per_client_day_usd: 3,
} as const;

export type CapReason = 'conversation_jobs' | 'contact_jobs' | 'client_jobs' | 'client_spend' | 'overall_spend';
export type CapResult = { ok: true } | { ok: false; reason: CapReason };

const DAY_MS = 24 * 60 * 60 * 1000;

/** A day is the last 24 hours: a restart, a deploy or midnight changes nothing. */
export function daySince(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}

export async function spendSince(since: Date, clientId?: string): Promise<number> {
  const agg = await prisma.engineRun.aggregate({
    where: { created_at: { gte: since }, ...(clientId ? { job: { client_id: clientId } } : {}) },
    _sum: { cost_usd: true },
  });
  return Number(agg._sum.cost_usd ?? 0);
}

export async function dailyCapUsd(): Promise<number> {
  const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { portal_chat_daily_cap_usd: true } });
  return s ? Number(s.portal_chat_daily_cap_usd) : 30;
}

/**
 * Whether a new job may be queued for this conversation, contact and client. The first failing cap
 * names the reason: a conversation over its job cap hands off; a spend cap runs tree mode.
 */
export async function checkCaps(input: { conversationId?: string | null; contactId: string; clientId: string; now?: Date }): Promise<CapResult> {
  const now = input.now ?? new Date();
  const since = daySince(now);

  if (input.conversationId) {
    const convo = await prisma.chatConversation.findUnique({ where: { id: input.conversationId }, select: { jobs_count: true } });
    if (convo && convo.jobs_count >= CAPS.jobs_per_conversation) return { ok: false, reason: 'conversation_jobs' };
  }
  const [contactJobs, clientJobs] = await Promise.all([
    prisma.engineJob.count({ where: { contact_id: input.contactId, queued_at: { gte: since } } }),
    prisma.engineJob.count({ where: { client_id: input.clientId, queued_at: { gte: since } } }),
  ]);
  if (contactJobs >= CAPS.jobs_per_contact_day) return { ok: false, reason: 'contact_jobs' };
  if (clientJobs >= CAPS.jobs_per_client_day) return { ok: false, reason: 'client_jobs' };

  const [clientSpend, overallSpend, cap] = await Promise.all([spendSince(since, input.clientId), spendSince(since), dailyCapUsd()]);
  if (clientSpend >= CAPS.spend_per_client_day_usd) return { ok: false, reason: 'client_spend' };
  if (overallSpend >= cap) return { ok: false, reason: 'overall_spend' };
  return { ok: true };
}
