/**
 * Loads the data the ritual blocks need and hands it to the pure selectors. Used by
 * GET /api/waits/mine and by the Work view's hook through that route.
 */

import type { PrismaClient } from '@prisma/client';
import { fetchAdminSoon } from '@/lib/oracle/admin-soon';
import { endOfZonedDay } from './business-days';
import { MIKE_USER_ID, prismaOwnerLookups } from './owner';
import {
  buildRitualBlocks,
  DUE_WINDOW_DAYS,
  type AdminCandidate,
  type RitualBlocks,
  type TaskCandidate,
  type WaitCandidate,
} from './ritual-blocks';
import { resolveWaitOwner } from './sweeper';

export const OPEN_FOR_BLOCKS = ['waiting', 'needs_human', 'blocked_by_switch'] as const;

export async function loadWaitCandidates(db: PrismaClient): Promise<WaitCandidate[]> {
  const rows = await db.wait.findMany({
    where: { state: { in: [...OPEN_FOR_BLOCKS] } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { due_at: 'asc' },
  });
  const lookups = prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]);
  const out: WaitCandidate[] = [];
  for (const w of rows) {
    const owner = await resolveWaitOwner(w, lookups);
    out.push({
      id: w.id,
      kind: w.kind,
      state: w.state,
      title: w.title,
      due_at: w.due_at,
      blocks_client: w.blocks_client,
      client_waiting_since: w.client_waiting_since,
      nag_level: w.nag_level,
      project_id: w.project_id,
      task_id: w.task_id,
      approval_request_id: w.approval_request_id,
      client: w.client,
      resolved_user_id: owner.user_id,
    });
  }
  return out;
}

export async function loadRitualBlocks(db: PrismaClient, userId: string, now = new Date()): Promise<RitualBlocks> {
  const mikeId = userId || MIKE_USER_ID;
  const limit = endOfZonedDay(new Date(now.getTime() + DUE_WINDOW_DAYS * 86_400_000));
  const [waits, tasks, admin] = await Promise.all([
    loadWaitCandidates(db),
    db.task.findMany({
      where: {
        is_deleted: false,
        assignee_id: mikeId,
        status: { notIn: ['done', 'abandoned'] },
        due_date: { not: null, lte: limit },
      },
      select: { id: true, title: true, due_date: true, promised_to: true, client: { select: { id: true, name: true } } },
      orderBy: { due_date: 'asc' },
      take: 100,
    }),
    fetchAdminSoon(mikeId),
  ]);
  const taskCandidates: TaskCandidate[] = tasks
    .filter((t): t is typeof t & { due_date: Date } => !!t.due_date)
    .map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, promised_to: t.promised_to, client: t.client }));
  const adminCandidates: AdminCandidate[] = admin.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    due_date: t.due_date ? new Date(t.due_date).toISOString() : null,
    client: t.client,
  }));
  return buildRitualBlocks({ waits, tasks: taskCandidates, admin: adminCandidates, mikeId, now });
}
