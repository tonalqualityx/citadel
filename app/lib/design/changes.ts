/**
 * Designer Portal: change decisions and restore (design 7.1 PATCH changes/:id, POST sessions/:id/restore).
 */
import { z } from 'zod';
import type { DesignChange, DesignSession, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { appendDesignerEvent } from './events';
import { createCommand } from './commands';
import type { DesignActor } from './helpers';

export const decideChangeSchema = z.object({
  decision: z.enum(['accepted', 'denied']),
  note: z.string().max(4000).optional(),
});
export type DecideChangeBody = z.infer<typeof decideChangeSchema>;

export const restoreSchema = z.object({ to_sha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'to_sha must be a commit sha') });

function assertOpen(session: Pick<DesignSession, 'status'>): void {
  if (session.status === 'closed' || session.status === 'abandoned') throw new ApiError('This session is closed', 409, 'session_closed');
}

/**
 * accepted | denied (+ note). A denial also writes a designer `text` event ("Denied: <summary>. <note>") so
 * the worker sees it as context; the event's client_ref is `deny:<change id>`, so a repeat is a no-op.
 */
export async function decideChange(
  actor: DesignActor,
  change: DesignChange,
  session: Pick<DesignSession, 'id' | 'status'>,
  input: DecideChangeBody,
  db: PrismaClient = defaultDb,
): Promise<DesignChange> {
  assertOpen(session);
  const note = input.note?.trim() ? input.note.trim() : null;
  if (input.decision === 'denied' && change.decision !== 'denied') {
    const text = `Denied: ${change.summary}.${note ? ` ${note}` : ''}`.slice(0, 8000);
    await appendDesignerEvent({ sessionId: session.id, authorId: actor.userId, kind: 'text', payload: { text }, clientRef: `deny:${change.id}` }, db);
  }
  return db.designChange.update({
    where: { id: change.id },
    data: { decision: input.decision, designer_note: note, decided_at: new Date(), decided_by_id: actor.userId },
  });
}

/** `to_sha` must be a DesignChange.commit_sha of this session, or its base_sha. Writes DesignCommand(restore). */
export async function requestRestore(
  actor: DesignActor,
  session: DesignSession,
  toSha: string,
  db: PrismaClient = defaultDb,
): Promise<{ command_id: string }> {
  assertOpen(session);
  if (session.status === 'publishing') throw new ApiError('A publish is running; restore after it finishes', 409, 'publish_in_progress');
  const sha = toSha.toLowerCase();
  const known =
    (session.base_sha && session.base_sha.toLowerCase() === sha) ||
    (await db.designChange.findFirst({ where: { session_id: session.id, commit_sha: { equals: sha, mode: 'insensitive' } }, select: { id: true } }));
  if (!known) throw new ApiError('That version does not belong to this session', 400, 'unknown_sha');
  const { command } = await createCommand({ sessionId: session.id, verb: 'restore', payload: { to_sha: sha }, createdById: actor.userId }, db);
  return { command_id: command.id };
}
