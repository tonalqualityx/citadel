/**
 * Home screen Slice 8a: the open waits on one project that someone else holds, with who holds
 * each in words. Read only. A wait that lands on the signed-in owner is one of his items and
 * is left out here (it comes through selectHome).
 */

import type { PrismaClient } from '@prisma/client';
import { OPEN_FOR_BLOCKS } from '@/lib/waits/load-blocks';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { resolveWaitOwner } from '@/lib/waits/sweeper';
import { displayText } from '../copy';
import type { RawProjectStep } from '../types';
import type { HomeProjectWait } from './types';

export async function loadProjectWaits(db: PrismaClient, projectId: string, userId: string): Promise<HomeProjectWait[]> {
  const rows = await db.wait.findMany({
    where: { project_id: projectId, state: { in: [...OPEN_FOR_BLOCKS] } },
    include: {
      owner_user: { select: { name: true } },
      owner_contact: { select: { name: true, email: true } },
      owner_function: { select: { name: true } },
    },
    orderBy: { started_at: 'asc' },
  });
  const lookups = prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]);
  const out: HomeProjectWait[] = [];
  for (const w of rows) {
    let who: string | null = null;
    if (w.owner_contact) {
      who = `${displayText(w.owner_contact.name) || w.owner_contact.email} (client)`;
    } else {
      const owner = await resolveWaitOwner(w, lookups);
      if (owner.user_id === userId) continue; // his own: it is one of his items
      if (w.owner_user) who = displayText(w.owner_user.name);
      else if (w.owner_function) who = displayText(w.owner_function.name);
      else {
        const u = await db.user.findUnique({ where: { id: owner.user_id }, select: { name: true } });
        who = u ? displayText(u.name) : null;
      }
    }
    if (!who) continue;
    out.push({ who, since: w.started_at.toISOString(), title: displayText(w.title) });
  }
  return out;
}

/**
 * Slice 8b: the in-progress projects whose next step is `userId`'s, written by Bast or by him. Read only. The clock is the newest
 * updated_at among the project's tasks (the step itself is rewritten nightly, so it says nothing about how quiet the project is).
 */
export async function loadProjectSteps(db: PrismaClient, userId: string): Promise<RawProjectStep[]> {
  const projects = await db.project.findMany({
    where: {
      status: 'in_progress',
      next_step_owner_id: userId,
      next_step_source: { in: ['bast', 'mike'] },
      next_step_text: { not: null },
    },
    select: {
      id: true,
      name: true,
      next_step_text: true,
      next_step_source: true,
      next_step_at: true,
      updated_at: true,
      client: { select: { id: true, name: true, status: true } },
    },
    orderBy: { id: 'asc' },
  });
  const usable = projects.filter((p) => (p.next_step_text ?? '').trim() !== '' && (p.next_step_source === 'bast' || p.next_step_source === 'mike'));
  if (usable.length === 0) return [];
  const last = await db.task.groupBy({
    by: ['project_id'],
    where: { project_id: { in: usable.map((p) => p.id) }, is_deleted: false },
    _max: { updated_at: true },
  });
  const lastBy = new Map(last.map((r) => [r.project_id, r._max.updated_at]));
  return usable.map((p) => ({
    project_id: p.id,
    project_name: p.name,
    client: { id: p.client.id, name: p.client.name, status: p.client.status },
    text: p.next_step_text as string,
    source: p.next_step_source as 'bast' | 'mike',
    step_at: p.next_step_at,
    last_activity_at: lastBy.get(p.id) ?? p.updated_at,
  }));
}
