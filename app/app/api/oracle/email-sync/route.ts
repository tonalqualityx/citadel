import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { notifyUrgentEmail } from '@/lib/services/notifications';
import { AskQueue, AskSeverity, EmailAskIntent, EmailMatchSource } from '@prisma/client';

// Clarity Phase 4a — email on the Seeing Stone. The staged, not-cron-wired classifier
// (~/.claude/tools/oracle/clarity/email-classifier.py) POSTs here for both mailboxes
// (mike@becomeindelible.com, mike@whoismikedion.com) after labeling/archiving via gog.
// Bearer auth via requireAuth() — same util as /api/session-tasks and
// /api/oracle/calendar-sync (cookie session OR API key, no bot-only restriction).
const MAX_ASKS = 200;

// z.coerce.date() (not the stricter z.string().datetime()) for the same reason as
// /api/oracle/calendar-sync's eventSchema — real Gmail timestamps arrive with a numeric
// UTC offset, not always a bare "Z" suffix.
const emailAskSchema = z.object({
  message_id: z.string().min(1).max(255),
  thread_id: z.string().max(255).optional().nullable(),
  account: z.string().min(1).max(255),
  from_name: z.string().max(255).optional().nullable(),
  from_email: z.string().min(1).max(255),
  subject: z.string().min(1).max(500),
  gist: z.string().optional().nullable(),
  queue: z.nativeEnum(AskQueue).optional().nullable(),
  severity: z.nativeEnum(AskSeverity).optional().nullable(),
  is_urgent: z.boolean().optional().default(false),
  deep_link: z.string().min(1).max(1000),
  received_at: z.coerce.date(),
  // Clarity Phase 6 — email lanes & calendar intents. All optional: absent = untouched on
  // an update (legacy classifier payloads that never send these stay byte-compatible —
  // see the conditional spread below, unlike the legacy fields above which always
  // overwrite). proposed_event_at uses z.coerce.date() for the same numeric-UTC-offset
  // reason as received_at/calendar-sync's eventSchema.
  intent: z.nativeEnum(EmailAskIntent).optional().nullable(),
  proposed_event_at: z.coerce.date().optional().nullable(),
  proposed_event_title: z.string().max(500).optional().nullable(),
  proposed_event_minutes: z.number().int().positive().optional().nullable(),
});

const emailSyncSchema = z.object({
  asks: z.array(emailAskSchema).min(1).max(MAX_ASKS),
});

const DEFAULT_ASSIGNEE_EMAIL = 'mike@becomeindelible.com';

// Projects a client's email can auto-match onto — mirrors the client-facing "in motion"
// statuses used elsewhere (see app/api/waiting-on-me/route.ts's notOnAQuoteOrQueueProject
// doc comment): quote/queue/done/suspended/cancelled projects never get an email
// auto-attached.
const AUTO_MATCH_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;

// Oracle Projects Tab Phase 2 — sender -> ClientContact -> Client -> exactly-one-eligible-
// project auto-matcher, run after every upsert for any row whose match_source isn't
// 'mike' (Mike's own explicit ruling via POST /api/email-asks/{id}/attach is never
// touched by this pass, at any point — checked before doing any other work below).
//
// Judgment call: "never downgrade an existing 'auto' match... unless the contact mapping
// changed" is read as "unless the resolved CLIENT changed" — a project that stops being
// the client's one eligible in-progress project (it shipped, got cancelled, whatever)
// does NOT undo a previously-correct auto match; only a genuine change in which client
// the sender's contact record now belongs to does.
async function autoMatchEmailAsk(row: {
  id: string;
  from_email: string;
  client_id: string | null;
  project_id: string | null;
  match_source: EmailMatchSource | null;
}): Promise<void> {
  if (row.match_source === 'mike') return; // Mike's ruling is never overwritten

  const contacts = await prisma.clientContact.findMany({
    where: { email: { equals: row.from_email, mode: 'insensitive' }, is_deleted: false },
    select: { client_id: true },
  });
  const distinctClientIds = Array.from(new Set(contacts.map((c) => c.client_id)));

  // No contact resolves for this sender at all — leave client_id/project_id/match_source
  // exactly as they are (nothing to update).
  if (distinctClientIds.length === 0) return;

  const resolvedClientId = distinctClientIds.length === 1 ? distinctClientIds[0] : null;

  if (row.match_source === 'auto' && row.client_id === resolvedClientId) {
    // Same client as the existing auto match — never downgrade on a re-sync just
    // because the project-eligibility count moved.
    return;
  }

  if (distinctClientIds.length !== 1) {
    // The sender's contact record spans more than one client — ambiguous, can't pick.
    // LOW-11: no-op once the row is already exactly this shape (an unmatched ask
    // re-syncs every ~15 min otherwise, issuing an identical write forever).
    if (row.client_id === null && row.project_id === null && row.match_source === EmailMatchSource.unmatched) return;
    await prisma.emailAsk.update({
      where: { id: row.id },
      data: { client_id: null, project_id: null, match_source: EmailMatchSource.unmatched },
    });
    return;
  }

  const eligibleProjects = await prisma.project.findMany({
    where: {
      client_id: resolvedClientId!,
      type: 'project',
      status: { in: [...AUTO_MATCH_PROJECT_STATUSES] },
      is_deleted: false,
    },
    select: { id: true },
  });

  if (eligibleProjects.length === 1) {
    const nextProjectId = eligibleProjects[0].id;
    // LOW-11: no-op if unchanged.
    if (
      row.client_id === resolvedClientId &&
      row.project_id === nextProjectId &&
      row.match_source === EmailMatchSource.auto
    ) {
      return;
    }
    await prisma.emailAsk.update({
      where: { id: row.id },
      data: { client_id: resolvedClientId, project_id: nextProjectId, match_source: EmailMatchSource.auto },
    });
  } else {
    // LOW-11: no-op if unchanged.
    if (
      row.client_id === resolvedClientId &&
      row.project_id === null &&
      row.match_source === EmailMatchSource.unmatched
    ) {
      return;
    }
    await prisma.emailAsk.update({
      where: { id: row.id },
      data: { client_id: resolvedClientId, project_id: null, match_source: EmailMatchSource.unmatched },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const data = emailSyncSchema.parse(body);

    let upserted = 0;
    let created = 0;
    let notifiedUrgent = 0;

    for (const ask of data.asks) {
      const existing = await prisma.emailAsk.findUnique({
        where: { message_id: ask.message_id },
        select: { id: true, is_urgent: true },
      });

      // Clarity Phase 6 fields: absent (undefined) means "untouched" — a legacy classifier
      // payload that never sends intent/proposed_event_* leaves those columns exactly as
      // they were (create: defaults to the column's own null/false; update: no-op via the
      // conditional spread), unlike the pre-existing fields above which always overwrite.
      const phase6Fields = {
        ...(ask.intent !== undefined && { intent: ask.intent }),
        ...(ask.proposed_event_at !== undefined && { proposed_event_at: ask.proposed_event_at }),
        ...(ask.proposed_event_title !== undefined && { proposed_event_title: ask.proposed_event_title }),
        ...(ask.proposed_event_minutes !== undefined && { proposed_event_minutes: ask.proposed_event_minutes }),
      };

      const row = await prisma.emailAsk.upsert({
        where: { message_id: ask.message_id },
        create: {
          message_id: ask.message_id,
          thread_id: ask.thread_id ?? null,
          account: ask.account,
          from_name: ask.from_name ?? null,
          from_email: ask.from_email,
          subject: ask.subject,
          gist: ask.gist ?? null,
          queue: ask.queue ?? null,
          severity: ask.severity ?? null,
          is_urgent: ask.is_urgent,
          deep_link: ask.deep_link,
          received_at: ask.received_at,
          ...phase6Fields,
        },
        update: {
          thread_id: ask.thread_id ?? null,
          account: ask.account,
          from_name: ask.from_name ?? null,
          from_email: ask.from_email,
          subject: ask.subject,
          gist: ask.gist ?? null,
          queue: ask.queue ?? null,
          severity: ask.severity ?? null,
          is_urgent: ask.is_urgent,
          deep_link: ask.deep_link,
          received_at: ask.received_at,
          ...phase6Fields,
        },
      });
      upserted++;

      // Oracle Projects Tab Phase 2 — client/project auto-match. Runs after every
      // upsert; a no-op for any row Mike has already ruled on by hand (match_source
      // 'mike', checked first thing inside autoMatchEmailAsk).
      await autoMatchEmailAsk({
        id: row.id,
        from_email: ask.from_email,
        client_id: row.client_id,
        project_id: row.project_id,
        match_source: row.match_source,
      });

      // Notification fires only when THIS call is what makes the ask urgent: a brand new
      // is_urgent row, or an existing row transitioning false/unset -> true. A re-sync of
      // an already-urgent ask (the classifier re-POSTs on every 15-min pass until it's
      // handled) never re-notifies.
      const isNewUrgent = !existing && row.is_urgent;
      const becameUrgent = existing && !existing.is_urgent && row.is_urgent;
      if (!existing) created++;

      if (isNewUrgent || becameUrgent) {
        const operator = await prisma.user.findUnique({
          where: { email: DEFAULT_ASSIGNEE_EMAIL, is_active: true },
        });
        if (operator) {
          await notifyUrgentEmail(
            operator.id,
            row.id,
            ask.from_name ? `${ask.from_name} <${ask.from_email}>` : ask.from_email,
            ask.subject
          );
          notifiedUrgent++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      upserted,
      created,
      updated: upserted - created,
      notified_urgent: notifiedUrgent,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
