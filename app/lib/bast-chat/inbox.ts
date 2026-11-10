/**
 * Bast chat: the worker inbox, in the shape `/home/mike/.claude/tools/bast-chat/src/types.ts` reads:
 * `{messages, stops, settings}`.
 *
 * - Waiting messages older than `stale_after_minutes` are never returned. `expireStaleMessages` sets
 *   `expired_at` on them and adds one status event each ("Not answered: ..."). It marks, never deletes.
 * - A stop is served once (and marked delivered) while its conversation is running.
 * - Messages carry only the validated card (kind and id, never the title).
 * - When the chat is switched off or has no owner, the arrays are empty and `settings.enabled` is false.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { allocateSeq, closeIdleConversations, EXPIRED_TEXT, STOP_CODE } from './events';
import { contextForWorker } from './card-context';
import { getSettings, MAX_TURNS_PER_ANSWER } from './settings';
import { getUsage, usageLeft } from './usage';

export const INBOX_MAX_MESSAGES = 50;

export interface InboxSettingsView {
  enabled: boolean;
  owner_user_id: string;
  model: string;
  effort: string;
  max_budget_usd: number;
  max_turns: number;
  idle_close_minutes: number;
  turns_left: number;
  writes_left: number;
  usd_left: number;
}

export interface InboxView {
  messages: { conversation_id: string; seq: number; client_ref?: string; text: string; context: { screen?: string; tile?: string; kind: string; id?: string } }[];
  stops: { conversation_id: string }[];
  settings: InboxSettingsView;
}

/** Mark waiting messages past the stale limit as expired and add the status event. Returns how many were expired. */
export async function expireStaleMessages(staleAfterMinutes: number, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMinutes * 60 * 1000);
  const stale = await db.bastChatEvent.findMany({
    where: { role: 'mike', delivered_at: null, expired_at: null, created_at: { lt: cutoff } },
    select: { conversation_id: true },
    take: 500,
  });
  const convIds = [...new Set(stale.map((s) => s.conversation_id))];
  let total = 0;
  for (const conversationId of convIds) {
    total += await db.$transaction(async (tx) => {
      // The row lock first, then read again: an ack that landed in between is not expired.
      const rows = await tx.bastChatEvent.findMany({
        where: { conversation_id: conversationId, role: 'mike', delivered_at: null, expired_at: null, created_at: { lt: cutoff } },
        orderBy: { seq: 'asc' },
        select: { seq: true },
      });
      if (rows.length === 0) return 0;
      const alloc = await allocateSeq(tx, conversationId, rows.length);
      await tx.bastChatEvent.updateMany({ where: { conversation_id: conversationId, role: 'mike', seq: { in: rows.map((r) => r.seq) }, delivered_at: null }, data: { expired_at: now } });
      await tx.bastChatEvent.createMany({
        data: rows.map((r, i) => ({ conversation_id: conversationId, seq: alloc.first + i, role: 'system' as const, kind: 'status' as const, payload: { code: 'expired', for_seq: r.seq, text: EXPIRED_TEXT } })),
      });
      const waiting = await tx.bastChatEvent.count({ where: { conversation_id: conversationId, role: 'mike', delivered_at: null, expired_at: null } });
      if (waiting === 0 && alloc.status === 'queued') await tx.bastChatConversation.update({ where: { id: conversationId }, data: { status: 'idle' } });
      return rows.length;
    });
  }
  return total;
}

export async function buildInbox(now: Date = new Date(), db: PrismaClient = defaultDb): Promise<InboxView> {
  const settings = await getSettings(db);
  const owner = settings.owner_user_id;
  const used = owner ? await getUsage(owner, now, db) : { turns: 0, writes: 0, cost_usd: 0 };
  const left = usageLeft(settings, used);
  const view: InboxSettingsView = {
    enabled: settings.enabled && !!owner,
    owner_user_id: owner ?? '',
    model: settings.model,
    effort: settings.effort,
    max_budget_usd: settings.turn_budget_usd,
    max_turns: MAX_TURNS_PER_ANSWER,
    idle_close_minutes: settings.idle_close_minutes,
    ...left,
  };
  if (!view.enabled) return { messages: [], stops: [], settings: view };

  await expireStaleMessages(settings.stale_after_minutes, now, db);
  await closeIdleConversations(now, db);

  const rows = await db.bastChatEvent.findMany({
    where: { role: 'mike', kind: 'text', delivered_at: null, expired_at: null, conversation: { status: { not: 'closed' }, owner_id: owner! } },
    orderBy: [{ created_at: 'asc' }, { seq: 'asc' }],
    take: INBOX_MAX_MESSAGES,
    select: { conversation_id: true, seq: true, client_ref: true, payload: true, context: true },
  });
  const messages = rows.map((r) => ({
    conversation_id: r.conversation_id,
    seq: r.seq,
    ...(r.client_ref ? { client_ref: r.client_ref } : {}),
    text: String((r.payload as { text?: unknown } | null)?.text ?? ''),
    context: contextForWorker(r.context),
  }));

  const stopRows = await db.bastChatEvent.findMany({
    where: { role: 'system', kind: 'status', delivered_at: null, payload: { path: ['code'], equals: STOP_CODE } },
    select: { conversation_id: true, seq: true, conversation: { select: { status: true } } },
    take: 50,
  });
  let stops: { conversation_id: string }[] = [];
  if (stopRows.length > 0) {
    await db.bastChatEvent.updateMany({
      where: { role: 'system', kind: 'status', delivered_at: null, payload: { path: ['code'], equals: STOP_CODE }, conversation_id: { in: stopRows.map((s) => s.conversation_id) } },
      data: { delivered_at: now },
    });
    stops = [...new Set(stopRows.filter((s) => s.conversation.status === 'running').map((s) => s.conversation_id))].map((conversation_id) => ({ conversation_id }));
  }
  return { messages, stops, settings: view };
}
