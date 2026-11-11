/**
 * Home screen Slice 10a: the meeting drawer's own reads. Read only. Context for the primary
 * client (live projects and recent done ones, their resource links, the latest published
 * report, the newest email from an attendee or the client, the newest meeting record, Drive
 * folder ids) and the lead's accord. The drawer route runs this after the match.
 */

import type { PrismaClient } from '@prisma/client';
import { LIVE_PROJECT_STATUSES, CAL } from './rules';
import type { EventMatch } from './match';
import type { DrawerContext } from './drawer';
import { EMPTY_CONTEXT } from './drawer';

type Db = Pick<PrismaClient, 'project' | 'resourceLink' | 'clientReport' | 'emailAsk' | 'accord' | 'meeting' | 'client' | 'homeOwedThread'>;

export async function loadDrawerContext(
  db: Db,
  args: { userId: string; now: Date; eventId: string; kind: string; match: EventMatch },
): Promise<DrawerContext> {
  const { match, now } = args;
  const clientId = match.client?.id ?? null;
  const emails = match.people.map((p) => p.email);
  const cutoff = new Date(now.getTime() - CAL.reportDoneDays * 86_400_000);

  const projects = clientId
    ? await db.project.findMany({
        where: {
          client_id: clientId,
          is_deleted: false,
          OR: [{ status: { in: [...LIVE_PROJECT_STATUSES] } }, { status: 'done', updated_at: { gte: cutoff } }],
        },
        select: { id: true, name: true, status: true, updated_at: true, drive_folder_id: true },
        orderBy: { updated_at: 'desc' },
      })
    : [];
  const projectIds = projects.map((p) => p.id);

  const [resourceLinks, latestReport, lastAsk, accord, meeting, client, answer] = await Promise.all([
    projectIds.length
      ? db.resourceLink.findMany({ where: { project_id: { in: projectIds }, is_deleted: false }, select: { project_id: true, name: true, url: true, created_at: true } })
      : Promise.resolve([]),
    clientId
      ? db.clientReport.findFirst({ where: { client_id: clientId, published_at: { not: null } }, orderBy: { published_at: 'desc' }, select: { period: true, url: true, published_at: true } })
      : Promise.resolve(null),
    emails.length || clientId
      ? db.emailAsk.findFirst({
          where: {
            OR: [
              ...emails.map((e) => ({ from_email: { equals: e, mode: 'insensitive' as const } })),
              ...(emails.length === 0 && clientId ? [{ client_id: clientId }] : []),
            ],
          },
          orderBy: { received_at: 'desc' },
          select: { from_name: true, from_email: true, subject: true, deep_link: true, received_at: true },
        })
      : Promise.resolve(null),
    match.lead ? db.accord.findFirst({ where: { id: match.lead.id, is_deleted: false }, select: { id: true, name: true } }) : Promise.resolve(null),
    clientId
      ? db.meeting.findFirst({
          where: { client_id: clientId, is_deleted: false, OR: [{ summary: { not: null } }, { transcript_url: { not: null } }] },
          orderBy: { meeting_date: 'desc' },
          select: { id: true, meeting_date: true },
        })
      : Promise.resolve(null),
    clientId ? db.client.findFirst({ where: { id: clientId }, select: { drive_folder_id: true } }) : Promise.resolve(null),
    args.kind === 'answer'
      ? db.homeOwedThread.findFirst({ where: { user_id: args.userId, booked_event_id: args.eventId }, select: { thread_key: true } })
      : Promise.resolve(null),
  ]);

  // With no attendee on file for the client the newest email is the client's own; with attendees it is theirs.
  let ask = lastAsk;
  if (!ask && emails.length > 0 && clientId) {
    ask = await db.emailAsk.findFirst({ where: { client_id: clientId }, orderBy: { received_at: 'desc' }, select: { from_name: true, from_email: true, subject: true, deep_link: true, received_at: true } });
  }

  return {
    ...EMPTY_CONTEXT,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      live: (LIVE_PROJECT_STATUSES as readonly string[]).includes(p.status),
      updated_at: p.updated_at,
      drive_folder_id: p.drive_folder_id,
    })),
    resourceLinks,
    latestReport,
    lastAsk: ask,
    accord,
    meeting,
    clientDriveId: client?.drive_folder_id ?? null,
    answerThreadKey: answer?.thread_key ?? null,
  };
}
