/**
 * Attach or detach one project or one task to an initiative, and nothing else. The chat's narrow path: the project and
 * task PATCH routes take many other fields, so the chat lane never reaches them for this (design.md 2.3, "optional
 * attachments"). One initiative per item; attaching an item that already belongs to another initiative moves it.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { assertInitiativeLinkable } from './service';

/** Exactly one of project_id or task_id. */
export const attachBodySchema = z
  .object({ project_id: z.string().uuid().optional(), task_id: z.string().uuid().optional() })
  .strict()
  .refine((b) => (b.project_id ? 1 : 0) + (b.task_id ? 1 : 0) === 1, { message: 'Send exactly one of project_id or task_id' });

export type AttachBody = z.infer<typeof attachBodySchema>;

type Found = { kind: 'project' | 'task'; id: string; name: string; initiative_id: string | null };

async function findItem(body: AttachBody): Promise<Found> {
  if (body.project_id) {
    const p = await prisma.project.findFirst({ where: { id: body.project_id, is_deleted: false }, select: { id: true, name: true, initiative_id: true } });
    if (!p) throw new ApiError('Project not found', 404);
    return { kind: 'project', id: p.id, name: p.name, initiative_id: p.initiative_id };
  }
  const t = await prisma.task.findFirst({ where: { id: body.task_id!, is_deleted: false }, select: { id: true, title: true, initiative_id: true } });
  if (!t) throw new ApiError('Task not found', 404);
  return { kind: 'task', id: t.id, name: t.title, initiative_id: t.initiative_id };
}

async function setLink(item: Found, initiativeId: string | null) {
  if (item.kind === 'project') await prisma.project.update({ where: { id: item.id }, data: { initiative_id: initiativeId } });
  else await prisma.task.update({ where: { id: item.id }, data: { initiative_id: initiativeId } });
}

export async function attachItem(initiativeId: string, body: AttachBody) {
  await assertInitiativeLinkable(initiativeId);
  const item = await findItem(body);
  await setLink(item, initiativeId);
  return { attached: true, kind: item.kind, id: item.id, name: item.name, initiative_id: initiativeId, moved_from: item.initiative_id && item.initiative_id !== initiativeId ? item.initiative_id : null };
}

/** Clears the link only when it points at this initiative; any other state is a 409 so a stale call cannot unlink someone else's. */
export async function detachItem(initiativeId: string, body: AttachBody) {
  await assertInitiativeLinkable(initiativeId);
  const item = await findItem(body);
  if (item.initiative_id !== initiativeId) {
    throw new ApiError(item.initiative_id ? 'That item is attached to a different initiative' : 'That item is not attached to any initiative', 409, 'not_attached_here');
  }
  await setLink(item, null);
  return { attached: false, kind: item.kind, id: item.id, name: item.name, initiative_id: null };
}
