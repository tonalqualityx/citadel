import { prisma } from '@/lib/db/prisma';

/**
 * A task in triage is parked for Mike: a contractor (role tech) is told nothing about it, not even its title.
 * Guarded here, under every notification entry point, so no caller can step around it.
 */
export async function suppressedForTriage(userId: string, entityType?: string | null, entityId?: string | null): Promise<boolean> {
  if (entityType !== 'task' || !entityId) return false;
  const [task, user] = await Promise.all([
    prisma.task.findUnique({ where: { id: entityId }, select: { status: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  return task?.status === 'triage' && user?.role === 'tech';
}
