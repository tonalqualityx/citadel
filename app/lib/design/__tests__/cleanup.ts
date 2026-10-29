/**
 * Integration teardown for the designer portal: deleteMany the design tables in FK order (events, pins,
 * changes, assets, commands, publishes, budgets, sessions) BEFORE tasks, projects and sites, which the sessions
 * restrict. Scoped to the given ids so parallel fixtures on the shared scratch database are left alone.
 */
import { prisma } from '@/lib/db/prisma';

export async function cleanupDesign(scope: { taskIds?: string[]; siteIds?: string[]; userIds?: string[] }): Promise<void> {
  const or = [
    ...(scope.taskIds?.length ? [{ task_id: { in: scope.taskIds } }] : []),
    ...(scope.siteIds?.length ? [{ site_id: { in: scope.siteIds } }] : []),
    ...(scope.userIds?.length ? [{ designer_id: { in: scope.userIds } }] : []),
  ];
  if (or.length === 0) return;
  const ids = (await prisma.designSession.findMany({ where: { OR: or }, select: { id: true } })).map((s) => s.id);
  const bySession = { session_id: { in: ids } };
  await prisma.designEvent.deleteMany({ where: bySession });
  await prisma.designPin.deleteMany({ where: bySession });
  await prisma.designChange.deleteMany({ where: bySession });
  await prisma.designAsset.deleteMany({ where: bySession });
  await prisma.designCommand.deleteMany({ where: bySession });
  await prisma.designPublish.deleteMany({ where: bySession });
  if (scope.userIds?.length) await prisma.designBudget.deleteMany({ where: { user_id: { in: scope.userIds } } });
  await prisma.designSession.deleteMany({ where: { id: { in: ids } } });
}
