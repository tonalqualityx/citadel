/**
 * Work stage A: the one rule for "is this email mine to answer".
 *
 * An ask linked to a task that is not deleted, whatever the task's status, is not the owner's to answer: the task
 * carries it (the task card shows it under "Email", and when the task finishes the ask closes). So it is never owed,
 * never queued for a draft, never a thread row and never an arc step. Every reader of open asks that builds one of
 * those goes through askIsMine; nothing else re-derives the rule.
 *
 * Two things stay the owner's even when linked: an urgent ask (it keeps its emergency path), and an ask whose task is
 * deleted or missing (the work is gone, so the email is his again).
 *
 * Pure: no database. The loader reads the linked tasks with linkedTaskFacts and hands the map in.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

/** What the rule needs to know about the task an ask points at. */
export interface LinkedTaskFacts {
  is_deleted: boolean;
  status?: string;
  tags?: readonly string[];
}

export interface AskLinkFacts {
  task_id: string | null;
  is_urgent?: boolean;
}

/** True when the ask is the owner's to answer (it may be owed); false when a live task carries it. */
export function askIsMine(ask: AskLinkFacts, taskById: ReadonlyMap<string, LinkedTaskFacts>): boolean {
  if (!ask.task_id) return true;
  if (ask.is_urgent === true) return true;
  const task = taskById.get(ask.task_id);
  if (!task || task.is_deleted) return true;
  return false;
}

/** The linked tasks' facts for a set of asks, one query. */
export async function linkedTaskFacts(
  db: PrismaClient | Prisma.TransactionClient,
  asks: readonly AskLinkFacts[],
): Promise<Map<string, LinkedTaskFacts>> {
  const ids = Array.from(new Set(asks.map((a) => a.task_id).filter((x): x is string => !!x)));
  if (ids.length === 0) return new Map();
  const rows = await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, is_deleted: true, status: true, tags: true } });
  return new Map(rows.map((r) => [r.id, { is_deleted: r.is_deleted, status: r.status, tags: r.tags }]));
}
