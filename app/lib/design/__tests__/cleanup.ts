/**
 * Integration teardown for the designer portal: deleteMany the design tables in FK order (v2 children, events, pins,
 * changes, assets, commands, publishes, budgets, sessions, tracks, notes; SPEC 3.2) BEFORE tasks, projects and sites, which the sessions
 * restrict. Scoped to the given ids so parallel fixtures on the shared scratch database are left alone.
 */
import { prisma } from '@/lib/db/prisma';

export async function cleanupDesign(scope: { taskIds?: string[]; siteIds?: string[]; userIds?: string[]; clientIds?: string[] }): Promise<void> {
  const or = [
    ...(scope.taskIds?.length ? [{ task_id: { in: scope.taskIds } }] : []),
    ...(scope.siteIds?.length ? [{ site_id: { in: scope.siteIds } }] : []),
    ...(scope.userIds?.length ? [{ designer_id: { in: scope.userIds } }] : []),
  ];
  if (or.length === 0) return;
  const sessionRows = await prisma.designSession.findMany({ where: { OR: or }, select: { id: true, track_id: true } });
  const ids = sessionRows.map((s) => s.id);
  const bySession = { session_id: { in: ids } };
  // v2 (SPEC 3.2): tracks of the scoped sites plus any track a scoped session points at
  const trackIds = (
    await prisma.designTrack.findMany({
      where: { OR: [{ site_id: { in: scope.siteIds ?? [] } }, { id: { in: sessionRows.flatMap((s) => (s.track_id ? [s.track_id] : [])) } }] },
      select: { id: true },
    })
  ).map((t) => t.id);
  const byTrack = { track_id: { in: trackIds } };
  await prisma.designEdit.deleteMany({ where: bySession });
  await prisma.designMarkup.deleteMany({ where: { reference: byTrack } });
  await prisma.designBriefReaction.deleteMany({ where: { brief: byTrack } });
  await prisma.designPageReview.deleteMany({ where: byTrack });
  await prisma.designImport.deleteMany({ where: byTrack });
  await prisma.designJob.deleteMany({ where: byTrack });
  await prisma.designBrief.deleteMany({ where: byTrack });
  await prisma.designReference.deleteMany({ where: byTrack });
  await prisma.designArtDirection.deleteMany({ where: byTrack });
  await prisma.designTrackAsset.deleteMany({ where: byTrack });
  await prisma.designEvent.deleteMany({ where: bySession });
  await prisma.designPin.deleteMany({ where: bySession });
  await prisma.designChange.deleteMany({ where: bySession });
  await prisma.designAsset.deleteMany({ where: bySession });
  await prisma.designCommand.deleteMany({ where: bySession });
  await prisma.designPublish.deleteMany({ where: bySession });
  if (scope.userIds?.length) await prisma.designBudget.deleteMany({ where: { user_id: { in: scope.userIds } } });
  await prisma.designSession.deleteMany({ where: { id: { in: ids } } });
  await prisma.designTrack.deleteMany({ where: { id: { in: trackIds } } });
  const noteOr = [
    ...(scope.siteIds?.length ? [{ site_id: { in: scope.siteIds } }] : []),
    ...(scope.clientIds?.length ? [{ client_id: { in: scope.clientIds } }] : []),
  ];
  if (noteOr.length) await prisma.designNote.deleteMany({ where: { OR: noteOr } });
}
