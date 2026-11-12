import { prisma } from '@/lib/db/prisma';

/**
 * A task in triage is parked for Mike: anyone who is not an owner (every role except pm and admin: tech, designer, and any role added later) is told nothing about it, not even its title.
 * Guarded here, under every notification entry point, so no caller can step around it.
 */
export async function suppressedForTriage(userId: string, entityType?: string | null, entityId?: string | null): Promise<boolean> {
  if (entityType !== 'task' || !entityId) return false;
  const [task, user] = await Promise.all([
    prisma.task.findUnique({ where: { id: entityId }, select: { status: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  return task?.status === 'triage' && user?.role !== undefined && user.role !== 'pm' && user.role !== 'admin';
}
