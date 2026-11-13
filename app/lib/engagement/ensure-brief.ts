/**
 * Make sure a project has its Dox brief (EngagementBrief, one per project). Created with the default cadence `auto`, owner_mode `dry` and no
 * allowed actions; an existing brief is returned untouched (nothing here edits cadence or mode). Two creators at once: the unique project_id
 * makes the second read the first. Used by Release (a released card linked to a project), by the Dox lane's brief route and by the route that
 * starts a project for a released card. Returns null when the project does not exist or is deleted.
 */
import type { EngagementBrief, PrismaClient } from '@prisma/client';

export const DEFAULT_BRIEF_CADENCE = 'auto';
export const DEFAULT_BRIEF_MODE = 'dry';

type BriefDb = Pick<PrismaClient, 'project' | 'engagementBrief'>;

export async function ensureProjectBrief(db: BriefDb, projectId: string, createdById: string | null): Promise<{ brief: EngagementBrief; created: boolean } | null> {
  const existing = await db.engagementBrief.findUnique({ where: { project_id: projectId } });
  if (existing) return { brief: existing, created: false };
  const project = await db.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { id: true, name: true, client_id: true } });
  if (!project) return null;
  try {
    const brief = await db.engagementBrief.create({
      data: {
        client_id: project.client_id,
        project_id: project.id,
        label: project.name.slice(0, 120),
        cadence: DEFAULT_BRIEF_CADENCE,
        owner_mode: DEFAULT_BRIEF_MODE,
        allowed_actions: [],
        created_by_id: createdById,
      },
    });
    return { brief, created: true };
  } catch (e) {
    const again = await db.engagementBrief.findUnique({ where: { project_id: projectId } });
    if (again) return { brief: again, created: false };
    throw e;
  }
}
