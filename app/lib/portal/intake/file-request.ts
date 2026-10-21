/**
 * File a portal request as a Citadel task (portal phase B slice 1, spec sections 2.4 and 2.5).
 *
 * One transaction under `pg_advisory_xact_lock(hashtext(source_ref))`: a repeat with the same
 * intake_id returns the existing task and changes nothing. Rate limits are counted in the
 * database per person, so a restart does not reset them. The scope gate (quote) and the
 * emergency effects (priority 1, a critical notification to Mike, a two-hour clock) are decided
 * here and nowhere else.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { serializeRichText } from '@/lib/api/blocknote';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { projectAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { engagementOf } from '@/lib/portal/engagement';
import { requestState } from '@/lib/portal/status-labels';
import { onRequestFiled } from '@/lib/portal/waits';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { composeTask, sourceRefFor } from './compose';
import { classifyIntake } from './classify';
import { placeRequest, type PlacementCharter, type PlacementProject } from './placement';
import {
  NO_PERMISSION_MESSAGE,
  RATE_LIMIT_MESSAGE,
  validateAnswers,
  type AnswerInput,
  type IntakeType,
} from './tree';

export const LIMITS = {
  per_hour: 6,
  per_day: 20,
  emergencies_per_day: 3,
} as const;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface FileRequestBody {
  intake_id: string;
  type: IntakeType;
  site_id?: string | null;
  project_id?: string | null;
  chosen_project_id?: string | null;
  answers: AnswerInput[];
}

export interface FiledRequest {
  created: boolean;
  task: {
    id: string;
    client_title: string;
    state: { label: string; tone: string };
    engagement: { kind: string; label: string; href: string | null };
  };
  urgent: boolean;
}

const TASK_RESULT_SELECT = {
  id: true,
  title: true,
  client_title: true,
  status: true,
  tags: true,
  staging_preview_url: true,
  approved: true,
  client_approved_at: true,
  project_id: true,
  charter_id: true,
  assignee_id: true,
  client_id: true,
  site_id: true,
  project: { select: { id: true, name: true } },
  charter: { select: { id: true, charter_wares: { where: { is_active: true }, select: { ware: { select: { name: true } } } } } },
  site: { select: { id: true, name: true } },
} as const satisfies Prisma.TaskSelect;

type ResultRow = Prisma.TaskGetPayload<{ select: typeof TASK_RESULT_SELECT }>;

function shape(row: ResultRow, created: boolean, urgent: boolean): FiledRequest {
  const wares = (row.charter?.charter_wares ?? []).map((w) => w.ware?.name ?? '').filter(Boolean);
  return {
    created,
    urgent,
    task: {
      id: row.id,
      client_title: row.client_title ?? row.title,
      state: requestState(row),
      engagement: engagementOf({
        project_id: row.project_id,
        project: row.project,
        charter_id: row.charter_id,
        charter: row.charter ? { id: row.charter.id, ware_names: wares } : null,
        site: row.site,
      }),
    },
  };
}

export async function fileRequest(
  access: PortalAccess,
  contact: { id: string; name: string | null },
  body: FileRequestBody,
  opts: { now?: Date } = {}
): Promise<FiledRequest> {
  const now = opts.now ?? new Date();

  // Any client role may request; grant-only contacts may not (spec 6.3).
  if (access.revoked || access.role === 'none') throw new ApiError(NO_PERMISSION_MESSAGE, 403, 'no_permission');

  const checked = validateAnswers(body.type, body.answers);
  if (!checked.ok) throw new ApiError(checked.message, 400, 'bad_answers');

  const sourceRef = sourceRefFor(body.intake_id);
  const q1 = checked.answers.find((a) => a.key === 'q1')?.value ?? '';
  // The model slot runs before the transaction so no network call holds the lock. Off by default.
  const suggested = body.type === 'other' ? await classifyIntake(q1, { type: body.type }) : null;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceRef}))`;

    const existing = await tx.task.findFirst({ where: { source_ref: sourceRef, is_deleted: false }, select: TASK_RESULT_SELECT });
    if (existing) {
      if (existing.client_id !== access.clientId) throw new ApiError('Not found', 404);
      return { row: existing, created: false, emergencyEffects: false };
    }

    // Rate limits, per person, counted in the database.
    const personIds = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];
    const mine = { source: 'portal' as const, requested_by_contact_id: { in: personIds }, source_ref: { startsWith: 'portal-intake:' } };
    const [lastHour, lastDay] = await Promise.all([
      tx.task.count({ where: { ...mine, created_at: { gte: new Date(now.getTime() - HOUR) } } }),
      tx.task.count({ where: { ...mine, created_at: { gte: new Date(now.getTime() - DAY) } } }),
    ]);
    if (lastHour >= LIMITS.per_hour || lastDay >= LIMITS.per_day) {
      throw new ApiError(RATE_LIMIT_MESSAGE, 429, 'rate_limited');
    }
    let emergencyEffects = false;
    if (checked.urgent) {
      const today = await tx.task.count({
        where: { client_id: access.clientId, tags: { has: 'emergency' }, created_at: { gte: new Date(now.getTime() - DAY) } },
      });
      emergencyEffects = today < LIMITS.emergencies_per_day;
    }

    const [sites, projectRows, charterRows] = await Promise.all([
      tx.site.findMany({
        where: { client_id: access.clientId, is_deleted: false },
        select: {
          id: true,
          name: true,
          site_type: true,
          platform: true,
          maintenance_plan_id: true,
          hosting_plan_id: true,
          maintenance_assignee_id: true,
        },
      }),
      tx.project.findMany({
        where: projectAccessWhere(access),
        select: { id: true, name: true, site_id: true, status: true, scope_locked: true },
      }),
      tx.charter.findMany({
        where: { client_id: access.clientId, is_deleted: false, status: { in: ['active', 'paused'] } },
        select: { id: true, name: true, site_id: true, status: true, start_date: true, end_date: true, created_at: true },
      }),
    ]);
    const projects: PlacementProject[] = projectRows;
    const charters: PlacementCharter[] = charterRows;

    // Everything the browser names is re-checked against what this contact may see.
    let siteId = body.site_id ?? null;
    let chosenProjectId = body.chosen_project_id ?? null;
    if (body.project_id) {
      const p = projects.find((x) => x.id === body.project_id);
      if (!p) throw new ApiError('Not found', 404);
      if (p.site_id) {
        if (siteId && siteId !== p.site_id) throw new ApiError('That project is not on that site.', 400, 'bad_scope');
        siteId = p.site_id;
      }
      chosenProjectId = p.id;
    }
    if (siteId && !sites.some((s) => s.id === siteId)) throw new ApiError('Not found', 404);
    if (chosenProjectId && !projects.some((p) => p.id === chosenProjectId)) throw new ApiError('Not found', 404);
    const site = siteId ? sites.find((s) => s.id === siteId)! : null;

    const placement = placeRequest({
      type: body.type,
      site_id: siteId,
      chosen_project_id: chosenProjectId,
      site_has_plan: Boolean(site && (site.maintenance_plan_id || site.hosting_plan_id)),
      projects,
      charters,
      content_kind: checked.raw.q2?.choice ?? null,
      now,
    });
    if (!placement.ok) throw new ApiError('Please choose which project this is for.', 422, 'choose_project');

    const composed = composeTask({
      type: body.type,
      intake_id: body.intake_id,
      contact_name: contact.name?.trim() || 'a client contact',
      contact_id: access.contactId,
      answers: checked.answers,
      placement,
      client_id: access.clientId,
      site: site
        ? {
            id: site.id,
            is_wordpress: site.site_type === 'wordpress' || /wordpress/i.test(site.platform ?? ''),
            maintenance_assignee_id: site.maintenance_assignee_id,
          }
        : null,
      urgent: checked.urgent,
      emergency_effects: emergencyEffects,
      suggested_type: suggested,
    });

    const task = await tx.task.create({
      data: {
        title: composed.title,
        client_title: composed.client_title,
        description: serializeRichText(composed.description_markdown),
        priority: composed.priority,
        tags: composed.tags,
        assignee_id: composed.assignee_id,
        client_id: composed.client_id,
        site_id: composed.site_id,
        project_id: composed.project_id,
        charter_id: composed.charter_id,
        is_retainer_work: composed.is_retainer_work,
        is_support: composed.is_support,
        is_billable: false,
        source: 'portal',
        source_ref: composed.source_ref,
        requested_by_contact_id: composed.requested_by_contact_id,
        status: 'not_started',
        needs_review: false,
        promised_to: null,
        client_intake: composed.client_intake as Prisma.InputJsonValue,
        created_by_id: BAST_USER_ID,
      },
      select: TASK_RESULT_SELECT,
    });

    await onRequestFiled(
      tx,
      {
        id: task.id,
        client_title: composed.client_title,
        assignee_id: composed.assignee_id,
        client_id: composed.client_id,
        project_id: composed.project_id,
        charter_id: composed.charter_id,
        site_id: composed.site_id,
      },
      { intake_id: body.intake_id, quote: placement.quote, emergency: checked.urgent && emergencyEffects },
      now
    );

    return { row: task, created: true, emergencyEffects: checked.urgent && emergencyEffects };
  });

  // Alert after the commit: a failed Slack send must never lose the request.
  if (result.created && result.emergencyEffects) {
    try {
      await dispatchNotification({
        userId: MIKE_USER_ID,
        type: 'portal_emergency',
        title: `Urgent portal request: ${result.row.client_title ?? result.row.title}`,
        message: 'A client marked a request urgent in the portal. The task is the record.',
        entityType: 'task',
        entityId: result.row.id,
        priority: 'critical',
      });
    } catch (error) {
      console.error('portal emergency notification failed', error);
    }
  }

  return shape(result.row, result.created, checked.urgent);
}
