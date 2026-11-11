/**
 * The one place an EmailOutbox row is created (Fleet item 4). `govern` is required: every queued
 * message names the fact it reports, so the claim route can check it again at send time.
 * A grep test (lib/sends/__tests__/outbox-single-writer.test.ts) keeps it the only writer.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { OWED_REPLY_KIND, type Govern } from './govern';
import { owedSwitchOn } from './owed-reply';

export type OutboxDb = Prisma.TransactionClient | typeof prisma;

export interface OutboxInput {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  kind?: string;
  allow_external?: boolean;
  dedupe_key?: string | null;
  from_account?: string;
  reply_to?: string | null;
  reply_to_gmail_id?: string | null;
  task_id?: string | null;
  /** Home Slice 4b: not claimable before this (the 10-minute hold). Null or absent = no hold, as for every other kind. */
  send_after?: Date | null;
}

/** Create the row. Throws on a duplicate dedupe_key (P2002); callers decide what a duplicate means. */
export async function queueInOutbox(db: OutboxDb, input: OutboxInput, govern: Govern): Promise<{ id: string }> {
  if (!govern || typeof govern.intent !== 'string') throw new Error('queueInOutbox needs a govern block');
  await assertOwedReplyAllowed(db, input, govern);
  const data: Prisma.EmailOutboxUncheckedCreateInput = {
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? null,
    kind: input.kind ?? 'other',
    allow_external: input.allow_external ?? false,
    dedupe_key: input.dedupe_key ?? null,
    reply_to: input.reply_to ?? null,
    reply_to_gmail_id: input.reply_to_gmail_id ?? null,
    task_id: input.task_id ?? null,
    send_after: input.send_after ?? null,
    govern: govern as unknown as Prisma.InputJsonValue,
    ...(input.from_account ? { from_account: input.from_account } : {}),
  };
  return db.emailOutbox.create({ data, select: { id: true } });
}

/**
 * Home Slice 4b: an owed_reply row is Mike's own press, held, and only while his switch is on. The kind and the govern block
 * must agree, the hold must lie ahead, and the switch is read here, so no caller can queue one with the switch off (a missing
 * settings row is off). Other kinds pass untouched.
 */
async function assertOwedReplyAllowed(db: OutboxDb, input: OutboxInput, govern: Govern): Promise<void> {
  const owed = input.kind === OWED_REPLY_KIND;
  if (!owed && govern.intent !== 'owed_reply') return;
  if (!owed || govern.intent !== 'owed_reply') throw new Error('An owed_reply row needs kind owed_reply and an owed_reply govern block');
  if (!input.send_after || input.send_after.getTime() <= Date.now()) throw new Error('An owed_reply row needs a hold that lies ahead');
  if (!(await owedSwitchOn(db, govern.user_id))) throw new Error('send_off');
}
