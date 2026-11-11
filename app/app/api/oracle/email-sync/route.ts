import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { notifyUrgentEmail } from '@/lib/services/notifications';
import { AskQueue, AskSeverity, EmailAskIntent, EmailMatchSource } from '@prisma/client';
import { normalizeRfc } from '@/lib/work/link-asks';
import { DISPOSITIONS, OWNERS, ownerOfAssignee, planSync, waitKeyFor, type DecisionOwner, type SyncExisting } from '@/lib/work/decision';
import { homeOwner } from '@/lib/work/ask-closure';
import { BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { buildWaitData } from '@/lib/waits/templates';
import { displayText } from '@/lib/home/copy';

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
  // Work stage A: the RFC Message-ID of this message and the RFC id of its conversation root (the classifier works both
  // out from the mail mirror). Optional; absent means untouched. Stored lowercased with no brackets.
  rfc_message_id: z.string().max(255).optional().nullable(),
  conversation_key: z.string().max(255).optional().nullable(),
  // Work stage B: the one intake decision for this message (the classifier's batch call, then its code floors). All optional; absent
  // means the ask is undecided (an old classifier), which behaves exactly as before. decided_by 'mike' can never be posted.
  disposition: z.enum(DISPOSITIONS).optional().nullable(),
  disposition_reason: z.string().max(200).optional().nullable(),
  owner: z.enum(OWNERS).optional().nullable(),
  decided_by: z.enum(['intake', 'bast', 'other_copy']).optional().nullable(),
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
    // Work stage B: owner only. Without the home owner on the home view every close would be silent, so no decision is stored.
    const homeOn = await homeOwner(prisma);
    const items: {
      message_id: string;
      id: string;
      disposition: string | null;
      adjusted?: string;
      prior?: { disposition: string | null; task_id: string | null };
    }[] = [];

    for (const ask of data.asks) {
      const existing = await prisma.emailAsk.findUnique({
        where: { message_id: ask.message_id },
        select: {
          id: true,
          is_urgent: true,
          disposition: true,
          decided_by: true,
          intent: true,
          task_id: true,
          state: true,
          closed_by: true,
          task: { select: { assignee_id: true } },
        },
      });

      // Work stage B: what the posted decision does to this row.
      const posted = ask.disposition ?? null;
      let plan: ReturnType<typeof planSync> | null = null;
      if (posted && homeOn) {
        const ex: SyncExisting | null = existing
          ? {
              disposition: existing.disposition,
              decided_by: existing.decided_by,
              intent: existing.intent,
              task_id: existing.task_id,
              state: existing.state,
              closed_by: existing.closed_by,
              is_urgent: existing.is_urgent,
              task_owner: existing.task ? (ownerOfAssignee(existing.task.assignee_id, homeOn.id, BOT_USER_IDS) as DecisionOwner) : null,
            }
          : null;
        plan = planSync(ex, { disposition: posted, reason: ask.disposition_reason ?? null, owner: ask.owner ?? null, is_urgent: ask.is_urgent, intent: ask.intent ?? null });
      }

      // Clarity Phase 6 fields: absent (undefined) means "untouched" — a legacy classifier
      // payload that never sends intent/proposed_event_* leaves those columns exactly as
      // they were (create: defaults to the column's own null/false; update: no-op via the
      // conditional spread), unlike the pre-existing fields above which always overwrite.
      const phase6Fields = {
        ...(ask.intent !== undefined && { intent: ask.intent }),
        ...(ask.proposed_event_at !== undefined && { proposed_event_at: ask.proposed_event_at }),
        ...(ask.proposed_event_title !== undefined && { proposed_event_title: ask.proposed_event_title }),
        ...(ask.proposed_event_minutes !== undefined && { proposed_event_minutes: ask.proposed_event_minutes }),
        // Work stage A: the keys, same rule (absent = untouched).
        ...(ask.rfc_message_id !== undefined && { rfc_message_id: normalizeRfc(ask.rfc_message_id) }),
        ...(ask.conversation_key !== undefined && { conversation_key: normalizeRfc(ask.conversation_key) }),
      };

      const decisionFields = { ...(plan?.fields ?? {}), ...(plan?.birth?.state === 'handled' ? { closed_at: new Date() } : {}) };
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
          ...(existing ? {} : decisionFields),
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
          ...(existing ? decisionFields : {}),
        },
      });
      upserted++;

      // Work stage B: a birth close of waiting_them opens exactly one mail.awaiting_reply wait for the conversation (idempotent).
      if (plan?.birth?.wait) {
        const data = buildWaitData({
          template_key: 'mail.awaiting_reply',
          subject: displayText(ask.subject),
          title: `Waiting on ${displayText(ask.from_name) || ask.from_email}: ${displayText(ask.subject)}`.slice(0, 300),
          started_at: ask.received_at,
          client_id: row.client_id,
          email_thread_id: ask.thread_id ?? null,
          email_account: ask.account,
          created_by_id: homeOn?.id ?? null,
          created_by_automation: 'intake',
          idempotency_key: waitKeyFor(normalizeRfc(ask.conversation_key), ask.message_id),
        });
        const store = prismaSweepStore(prisma);
        const { wait, created } = await store.insertIdempotent(data);
        if (created) {
          await store.addEvent({ wait_id: wait.id, kind: 'created', to_state: 'waiting', to_due_at: wait.due_at, reason: 'Opened by the intake decision: waiting on them.', source: 'api', actor_user_id: homeOn?.id ?? null });
        }
      }
      items.push({
        message_id: ask.message_id,
        id: row.id,
        disposition: plan?.disposition ?? row.disposition ?? null,
        ...(plan?.adjusted ? { adjusted: plan.adjusted } : {}),
        ...(plan?.prior ? { prior: plan.prior } : {}),
      });

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
      items,
      adjusted: items.filter((i) => i.adjusted).map((i) => ({ message_id: i.message_id, id: i.id, disposition: i.disposition, why: i.adjusted })),
      ...(homeOn ? {} : { skipped: 'home_off' as const }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
