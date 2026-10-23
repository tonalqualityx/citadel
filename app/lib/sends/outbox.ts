/**
 * The one place an EmailOutbox row is created (Fleet item 4). `govern` is required: every queued
 * message names the fact it reports, so the claim route can check it again at send time.
 * A grep test (lib/sends/__tests__/outbox-single-writer.test.ts) keeps it the only writer.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { Govern } from './govern';

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
}

/** Create the row. Throws on a duplicate dedupe_key (P2002); callers decide what a duplicate means. */
export async function queueInOutbox(db: OutboxDb, input: OutboxInput, govern: Govern): Promise<{ id: string }> {
  if (!govern || typeof govern.intent !== 'string') throw new Error('queueInOutbox needs a govern block');
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
    govern: govern as unknown as Prisma.InputJsonValue,
    ...(input.from_account ? { from_account: input.from_account } : {}),
  };
  return db.emailOutbox.create({ data, select: { id: true } });
}
