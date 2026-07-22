/**
 * Dev fixture seed for Clarity Phase 4a (email on the Seeing Stone) Playwright coverage:
 * one open+urgent email_ask (crisis strip), one open+non-urgent email_ask (intake drawer),
 * and one due-soon task (due-soon row at the foot of Today) — assignee is the same admin
 * user the e2e logs in as, due 3 real hours from whenever this script runs (a rolling
 * window, not a calendar-day fixture — see lib/email-asks.ts's isDueSoon and the header
 * note on scripts/seed-clarity-phase3-fixtures.ts about the UTC-vs-zoned-date trap this
 * phase's own baselining hit).
 *
 * Idempotent: each fixture is found-or-recreated by a fixed message_id / title on every
 * run. Local dev only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase4a-email-fixtures.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@indelible.agency';
const URGENT_MESSAGE_ID = 'e2e-clarity-phase4a-fixture-urgent';
const INTAKE_MESSAGE_ID = 'e2e-clarity-phase4a-fixture-intake';
const DUE_SOON_TASK_TITLE = 'E2E: due-soon task (Clarity Phase 4a fixture)';

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }

  const now = new Date();

  console.log('Clarity Phase 4a fixtures: upserting email_asks...');
  await prisma.emailAsk.upsert({
    where: { message_id: URGENT_MESSAGE_ID },
    create: {
      message_id: URGENT_MESSAGE_ID,
      thread_id: URGENT_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Jane Client',
      from_email: 'jane@e2e-fixture-client.example',
      subject: 'E2E: Site is down (fixture)',
      gist: 'Client reports the production site is returning 500s.',
      queue: 'do',
      severity: 'client_blocking',
      is_urgent: true,
      state: 'open',
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-urgent',
      received_at: now,
    },
    update: {
      is_urgent: true,
      state: 'open',
      subject: 'E2E: Site is down (fixture)',
      received_at: now,
      task_id: null,
    },
  });

  await prisma.emailAsk.upsert({
    where: { message_id: INTAKE_MESSAGE_ID },
    create: {
      message_id: INTAKE_MESSAGE_ID,
      thread_id: INTAKE_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Sam Prospect',
      from_email: 'sam@e2e-fixture-prospect.example',
      subject: 'E2E: Question about the proposal (fixture)',
      gist: 'Prospect asking about payment terms in the proposal.',
      queue: 'answer',
      severity: 'internal',
      is_urgent: false,
      state: 'open',
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-intake',
      received_at: now,
    },
    update: {
      is_urgent: false,
      state: 'open',
      subject: 'E2E: Question about the proposal (fixture)',
      received_at: now,
      task_id: null,
    },
  });
  console.log('  upserted 1 urgent (crisis) + 1 non-urgent (intake) email_ask');

  console.log('Clarity Phase 4a fixtures: upserting due-soon task...');
  // Defensive cleanup: a today_pick(item_type=task) whose task_id has gone null can only
  // mean its underlying task was deleted out from under it (task_id has no other way to
  // become null — see lib/today-picks.ts's XOR-ref validation, which requires it non-null
  // at creation). That happens here on every re-seed below deleting the prior run's fixture
  // task; if the e2e's own add-to-Today->cleanup cycle got interrupted mid-run, the orphan
  // is invisible clutter that silently counts toward the WIP cap (5) until something 409s
  // for a reason nobody can see on screen. Prune it before it can do that.
  await prisma.todayPick.deleteMany({ where: { item_type: 'task', task_id: null } });
  await prisma.task.deleteMany({ where: { title: DUE_SOON_TASK_TITLE } });
  await prisma.task.create({
    data: {
      title: DUE_SOON_TASK_TITLE,
      status: 'not_started',
      assignee_id: admin.id,
      created_by_id: admin.id,
      // 3 real hours from whenever this seed runs — well inside the rolling 24h due-soon
      // window regardless of wall-clock date/timezone at run time.
      due_date: new Date(now.getTime() + 3 * 60 * 60 * 1000),
      needs_review: false,
    },
  });
  console.log('  created 1 due-soon task');

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
