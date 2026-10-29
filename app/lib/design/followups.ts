/**
 * Designer Portal: the follow-up task builder (design 7.3 scope-flags, D5, and 7.1 pin status `followup`).
 * Shared by the worker's flag_scope route and the designer's "Belongs to another task" pin action.
 * The task is built by the server from a fixed shape: title "Follow-up: ...", status not_started, unassigned or
 * the designer, the session's project (or another project the designer is on), same client and site, tag
 * `design-followup`, source internal, a backlink to /design/s/<session>. NEVER the owner, NEVER `needs-mike`.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { assetsBelongToSession } from './assets';
import { isUuid } from './helpers';

export const FOLLOWUP_TAG = 'design-followup';
export const FOLLOWUP_TITLE_PREFIX = 'Follow-up: ';
export const MAX_FOLLOWUP_TITLE = 200;
export const MAX_FOLLOWUP_DETAIL = 4000;

export interface CreateFollowupInput {
  sessionId: string;
  title: string;
  detail?: string;
  pinIds?: string[];
  assetIds?: string[];
  projectId?: string | null;
  designerId: string;
  /** Assign to the designer (she asked). Default: unassigned. */
  assignToDesigner?: boolean;
  /** Who is recorded as creator. Default: the designer. */
  createdById?: string;
}

export async function createFollowupTask(input: CreateFollowupInput, db: PrismaClient = defaultDb): Promise<{ task_id: string; title: string }> {
  if (!isUuid(input.sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  const title = input.title.trim();
  if (!title || title.length > MAX_FOLLOWUP_TITLE) throw new ApiError('Title is required (max 200 characters)', 400, 'bad_title');
  const detail = (input.detail ?? '').trim();
  if (detail.length > MAX_FOLLOWUP_DETAIL) throw new ApiError('Detail is over 4000 characters', 400, 'bad_detail');
  const pinIds = [...new Set(input.pinIds ?? [])];
  const assetIds = [...new Set(input.assetIds ?? [])];

  return db.$transaction(async (tx) => {
    const session = await tx.designSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, site_id: true, project_id: true, task: { select: { client_id: true, project_id: true } } },
    });
    if (!session) throw new ApiError('Session not found', 404, 'not_found');

    // Project: the session's, or another the designer is assigned to.
    let projectId = session.project_id ?? session.task.project_id ?? null;
    if (input.projectId && input.projectId !== projectId) {
      if (!isUuid(input.projectId)) throw new ApiError('Unknown project', 400, 'bad_project');
      const onIt = await tx.projectTeamAssignment.count({ where: { project_id: input.projectId, user_id: input.designerId } });
      if (onIt === 0) throw new ApiError('You are not on that project', 400, 'bad_project');
      projectId = input.projectId;
    }
    const project = projectId ? await tx.project.findUnique({ where: { id: projectId }, select: { client_id: true } }) : null;
    const clientId = project?.client_id ?? session.task.client_id ?? null;

    if (pinIds.length > 0) {
      if (!pinIds.every(isUuid) || (await tx.designPin.count({ where: { session_id: session.id, id: { in: pinIds } } })) !== pinIds.length) {
        throw new ApiError('Pins must belong to this session', 400, 'bad_pins');
      }
    }
    if (!(await assetsBelongToSession(session.id, assetIds, tx))) throw new ApiError('Assets must belong to this session', 400, 'bad_assets');

    // Never the owner (the settings' owner_user_id), whoever asks.
    const settings = await tx.designPortalSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    const assignee = input.assignToDesigner && input.designerId !== settings?.owner_user_id ? input.designerId : null;

    const lines: string[] = [];
    if (detail) lines.push(detail, '');
    for (const a of assetIds) lines.push(`Screenshot: /api/design/sessions/${session.id}/assets/${a}`);
    lines.push(`Filed from design session: /design/s/${session.id}`);

    const task = await tx.task.create({
      data: {
        title: FOLLOWUP_TITLE_PREFIX + title,
        description: lines.join('\n'),
        status: 'not_started',
        project_id: projectId,
        client_id: clientId,
        site_id: session.site_id,
        assignee_id: assignee,
        tags: [FOLLOWUP_TAG],
        source: 'internal',
        created_by_id: input.createdById ?? input.designerId,
      },
      select: { id: true, title: true },
    });
    if (pinIds.length > 0) {
      await tx.designPin.updateMany({ where: { session_id: session.id, id: { in: pinIds } }, data: { status: 'followup', followup_task_id: task.id } });
    }
    return { task_id: task.id, title: task.title };
  });
}
