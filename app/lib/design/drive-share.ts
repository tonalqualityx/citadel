/**
 * Designer Portal D11: automatic Drive sharing. Citadel cannot call Google; it queues session-less DesignCommands
 * (`share_drive_folder`, `unshare_drive_folder`, payload {folder_id, email, role: 'writer'}) that the box daemon
 * executes with its Drive account. Queued when a designer is assigned to a project whose resolved folder (project
 * override, else client folder) is set, when an admin sets or changes a project or client folder while designers
 * are assigned, and (unshare) when a designer is unassigned or the folder is cleared or changed.
 *
 * A folder is unshared from a designer only when none of her other current assignments still resolve to it.
 * Idempotent: a second pending command for the same verb, folder and email is not created.
 */
import type { DesignCommand, DesignCommandVerb, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';

export const DRIVE_SHARE_ROLE = 'writer';
export type DriveShareVerb = Extract<DesignCommandVerb, 'share_drive_folder' | 'unshare_drive_folder'>;

type Db = PrismaClient;

/** Project override, else the client's folder, else null. */
export async function resolveProjectFolder(projectId: string, db: Db = defaultDb): Promise<string | null> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { drive_folder_id: true, client: { select: { drive_folder_id: true } } } });
  return p?.drive_folder_id || p?.client?.drive_folder_id || null;
}

/** Idempotent: returns the existing pending command for the same verb, folder and email instead of a duplicate. */
export async function queueDriveCommand(
  input: { verb: DriveShareVerb; folderId: string; email: string; createdById: string },
  db: Db = defaultDb,
): Promise<{ command: DesignCommand; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const payload = { folder_id: input.folderId, email, role: DRIVE_SHARE_ROLE };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`drive-share:${input.verb}:${input.folderId}:${email}`}))`;
    const existing = await tx.designCommand.findFirst({
      where: {
        verb: input.verb,
        status: 'pending',
        AND: [{ payload: { path: ['folder_id'], equals: input.folderId } }, { payload: { path: ['email'], equals: email } }],
      },
      orderBy: { created_at: 'asc' },
    });
    if (existing) return { command: existing, created: false };
    const command = await tx.designCommand.create({ data: { session_id: null, verb: input.verb, payload, created_by_id: input.createdById } });
    return { command, created: true };
  });
}

/** Every distinct folder the designer's current assignments resolve to. */
export async function designerFolders(userId: string, db: Db = defaultDb): Promise<Set<string>> {
  const rows = await db.projectTeamAssignment.findMany({
    where: { user_id: userId, project: { is_deleted: false } },
    select: { project: { select: { drive_folder_id: true, client: { select: { drive_folder_id: true } } } } },
  });
  const out = new Set<string>();
  for (const r of rows) {
    const f = r.project.drive_folder_id || r.project.client?.drive_folder_id;
    if (f) out.add(f);
  }
  return out;
}

async function activeDesigner(userId: string, db: Db) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, is_active: true } });
  return u && u.role === 'designer' ? u : null;
}

/** A designer was assigned to the project: share its resolved folder with her. Returns the commands queued (0 or 1). */
export async function shareForAssignedDesigner(projectId: string, userId: string, byUserId: string, db: Db = defaultDb): Promise<number> {
  const u = await activeDesigner(userId, db);
  if (!u || !u.is_active) return 0;
  const folder = await resolveProjectFolder(projectId, db);
  if (!folder) return 0;
  await queueDriveCommand({ verb: 'share_drive_folder', folderId: folder, email: u.email, createdById: byUserId }, db);
  return 1;
}

/**
 * A designer was taken off the project (call after the assignment is gone): unshare the project's folder unless one
 * of her remaining assignments still resolves to it. Returns the commands queued (0 or 1).
 */
export async function unshareForUnassignedDesigner(projectId: string, userId: string, byUserId: string, db: Db = defaultDb): Promise<number> {
  const u = await activeDesigner(userId, db);
  if (!u) return 0;
  const folder = await resolveProjectFolder(projectId, db);
  if (!folder) return 0;
  if ((await designerFolders(userId, db)).has(folder)) return 0;
  await queueDriveCommand({ verb: 'unshare_drive_folder', folderId: folder, email: u.email, createdById: byUserId }, db);
  return 1;
}

/**
 * A resolved folder changed for these projects (call after the update). For each designer assigned to any of them:
 * unshare the old folder (unless another assignment still resolves to it), share the new one.
 */
export async function reconcileFolderChange(
  projectIds: string[],
  oldFolder: string | null,
  newFolder: string | null,
  byUserId: string,
  db: Db = defaultDb,
): Promise<number> {
  if (oldFolder === newFolder || projectIds.length === 0) return 0;
  const rows = await db.projectTeamAssignment.findMany({
    where: { project_id: { in: projectIds }, user: { role: 'designer' } },
    select: { user_id: true },
  });
  let queued = 0;
  for (const userId of [...new Set(rows.map((r) => r.user_id))]) {
    const u = await activeDesigner(userId, db);
    if (!u) continue;
    if (oldFolder && !(await designerFolders(userId, db)).has(oldFolder)) {
      await queueDriveCommand({ verb: 'unshare_drive_folder', folderId: oldFolder, email: u.email, createdById: byUserId }, db);
      queued++;
    }
    if (newFolder && u.is_active) {
      await queueDriveCommand({ verb: 'share_drive_folder', folderId: newFolder, email: u.email, createdById: byUserId }, db);
      queued++;
    }
  }
  return queued;
}

/** Admin set or cleared a project's own folder; `before` is its resolved folder from before the update. */
export async function onProjectFolderChanged(projectId: string, before: string | null, byUserId: string, db: Db = defaultDb): Promise<number> {
  const after = await resolveProjectFolder(projectId, db);
  return reconcileFolderChange([projectId], before, after, byUserId, db);
}

/** Admin set or cleared a client's folder: affects its projects that have no override of their own. */
export async function onClientFolderChanged(clientId: string, oldClientFolder: string | null, newClientFolder: string | null, byUserId: string, db: Db = defaultDb): Promise<number> {
  const projects = await db.project.findMany({ where: { client_id: clientId, is_deleted: false, drive_folder_id: null }, select: { id: true } });
  return reconcileFolderChange(projects.map((p) => p.id), oldClientFolder, newClientFolder, byUserId, db);
}
