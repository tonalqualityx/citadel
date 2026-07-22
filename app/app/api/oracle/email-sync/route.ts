import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { notifyUrgentEmail } from '@/lib/services/notifications';
import { AskQueue, AskSeverity } from '@prisma/client';

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
});

const emailSyncSchema = z.object({
  asks: z.array(emailAskSchema).min(1).max(MAX_ASKS),
});

const DEFAULT_ASSIGNEE_EMAIL = 'mike@becomeindelible.com';

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
        },
      });
      upserted++;

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
