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
