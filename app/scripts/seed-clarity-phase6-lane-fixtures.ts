/**
 * Dev fixture seed for Clarity Phase 6 (email lanes & calendar intents) Playwright coverage:
 * three open+non-urgent email_asks, one per lane (general/meeting/sales) — the meeting one
 * carries a HIGH-CONFIDENCE proposed_event_at (2 real hours from whenever this script runs,
 * a rolling window not a calendar-day fixture, same discipline as Phase 4a's due-soon
 * fixture — see lib/email-asks.ts's isDueSoon header note) so it's the ONLY ask in the DB
 * whose Add-to-calendar button should ever appear.
 *
 * Meeting/sales lanes are exclusively populated by THIS fixture (no other seed script sets
 * `intent`), so the e2e spec can assert exact meeting/sales lane counts; the general lane
 * may also contain other phases' fixtures (their asks all default to null intent = general),
 * so general-lane assertions stay loose (message-filtered, not count-exact) by design.
 *
 * Idempotent: each fixture is found-or-recreated by a fixed message_id on every run. Local
 * dev only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase6-lane-fixtures.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GENERAL_MESSAGE_ID = 'e2e-clarity-phase6-fixture-general';
const MEETING_MESSAGE_ID = 'e2e-clarity-phase6-fixture-meeting';
const SALES_MESSAGE_ID = 'e2e-clarity-phase6-fixture-sales';

async function main() {
  const now = new Date();

  console.log('Clarity Phase 6 fixtures: upserting general-lane email_ask...');
  await prisma.emailAsk.upsert({
    where: { message_id: GENERAL_MESSAGE_ID },
    create: {
      message_id: GENERAL_MESSAGE_ID,
      thread_id: GENERAL_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Sam Prospect',
      from_email: 'sam@e2e-fixture-phase6.example',
      subject: 'E2E: General lane question (Clarity Phase 6 fixture)',
      gist: 'A plain non-urgent question with no particular lane.',
      queue: 'answer',
      severity: 'internal',
      is_urgent: false,
      state: 'open',
      intent: 'general',
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-phase6-general',
      received_at: now,
    },
    update: {
      is_urgent: false,
      state: 'open',
      intent: 'general',
      subject: 'E2E: General lane question (Clarity Phase 6 fixture)',
      received_at: now,
      task_id: null,
      calendar_requested: false,
      calendar_event_id: null,
    },
  });

  console.log('Clarity Phase 6 fixtures: upserting meeting-lane email_ask (high-confidence parsed date)...');
  await prisma.emailAsk.upsert({
    where: { message_id: MEETING_MESSAGE_ID },
    create: {
      message_id: MEETING_MESSAGE_ID,
      thread_id: MEETING_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Jane Client',
      from_email: 'jane@e2e-fixture-phase6.example',
      subject: 'E2E: Can we meet Thursday? (Clarity Phase 6 fixture)',
      gist: 'Client proposing a 3:30pm call.',
      queue: 'answer',
      severity: 'internal',
      is_urgent: false,
      state: 'open',
      intent: 'meeting',
      // 2 real hours from whenever this seed runs — a rolling window, immune to
      // calendar-day/timezone drift the same way Phase 4a's due-soon fixture is.
      proposed_event_at: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      proposed_event_title: 'Call with Jane Client',
      proposed_event_minutes: 45,
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-phase6-meeting',
      received_at: now,
    },
    update: {
      is_urgent: false,
      state: 'open',
      intent: 'meeting',
      subject: 'E2E: Can we meet Thursday? (Clarity Phase 6 fixture)',
      proposed_event_at: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      proposed_event_title: 'Call with Jane Client',
      proposed_event_minutes: 45,
      received_at: now,
      task_id: null,
      // Reset every run so the e2e's own "click Add to calendar" test always starts from
      // the clean 'add' state, never a leftover 'queued'/'added' from a prior run.
      calendar_requested: false,
      calendar_event_id: null,
    },
  });

  console.log('Clarity Phase 6 fixtures: upserting sales-lane email_ask...');
  await prisma.emailAsk.upsert({
    where: { message_id: SALES_MESSAGE_ID },
    create: {
      message_id: SALES_MESSAGE_ID,
      thread_id: SALES_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Alex Lead',
      from_email: 'alex@e2e-fixture-phase6.example',
      subject: 'E2E: Interested in your services (Clarity Phase 6 fixture)',
      gist: 'A prospect asking about pricing.',
      queue: 'answer',
      severity: 'internal',
      is_urgent: false,
      state: 'open',
      intent: 'sales',
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-phase6-sales',
      received_at: now,
    },
    update: {
      is_urgent: false,
      state: 'open',
      intent: 'sales',
      subject: 'E2E: Interested in your services (Clarity Phase 6 fixture)',
      received_at: now,
      task_id: null,
      calendar_requested: false,
      calendar_event_id: null,
    },
  });

  console.log('  upserted 1 general + 1 meeting (with proposed_event_at) + 1 sales email_ask');
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
