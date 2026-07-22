/**
 * Dev fixture seed for Clarity Phase 4b (Quest Peek View) Playwright coverage:
 *   - one task in the Review queue shape (status=done, needs_review=true, approved=false)
 *     so it renders as an "Open review" AskCard in Needs Reshi's Review column.
 *   - one fresh task + a today_pick pointing at it (item_type=task, started_at/completed_at
 *     both null — the "To do" board column) for the Today board lens drag e2e (To do ->
 *     Doing -> Done, with reload persistence).
 *
 * Idempotent: both tasks are found-or-created by fixed titles; their today_pick (if any) is
 * deleted and recreated fresh every run so the board drag test always starts from "To do".
 * Zoned-date resolution mirrors scripts/seed-clarity-phase3-fixtures.ts (the admin's own
 * UserPreference.timezone, inlined to stay dependency-free of path-aliased app code).
 * Local dev only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase4b-peek-fixtures.ts
 */
import { PrismaClient, TodayPickType } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@indelible.agency';
const DEFAULT_DISPLAY_TIMEZONE = 'America/New_York';
const REVIEW_TASK_TITLE = 'E2E: review queue task (Clarity Phase 4b fixture)';
const BOARD_TASK_TITLE = 'E2E: board drag task (Clarity Phase 4b fixture)';
const INTAKE_ARCHIVE_MESSAGE_ID = 'e2e-clarity-phase4b-fixture-intake-archive';
const INTAKE_NOTE_MESSAGE_ID = 'e2e-clarity-phase4b-fixture-intake-note';

function getZonedDateString(date: Date, timezone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')!.value;
    const month = parts.find((p) => p.type === 'month')!.value;
    const day = parts.find((p) => p.type === 'day')!.value;
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }
  const adminPref = await prisma.userPreference.findUnique({ where: { user_id: admin.id } });
  const adminTimezone = adminPref?.timezone || DEFAULT_DISPLAY_TIMEZONE;

  console.log('Clarity Phase 4b fixtures: upserting review-queue task...');
  await prisma.task.deleteMany({ where: { title: REVIEW_TASK_TITLE } });
  const reviewTask = await prisma.task.create({
    data: {
      title: REVIEW_TASK_TITLE,
      status: 'done',
      needs_review: true,
      approved: false,
      priority: 2,
      assignee_id: admin.id,
      created_by_id: admin.id,
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      description: JSON.stringify([
        { type: 'paragraph', content: [{ type: 'text', text: 'Peek-drawer e2e fixture: confirm review flow renders in the drawer.' }] },
      ]),
    },
  });
  console.log(`  created review task ${reviewTask.id}`);

  console.log('Clarity Phase 4b fixtures: upserting Today board drag task...');
  // Delete the PICK before the task it points at — Task.today_picks relation is
  // onDelete: SetNull, so deleting the task first would orphan the pick (task_id -> null,
  // item_type stays 'task') instead of removing it, leaving a permanent "Untitled pick"
  // card behind on every re-run (the exact bug class Clarity Phase 4a's due-soon e2e
  // hit — see its own deviation #7). Also defensively prunes any already-orphaned
  // item_type=task/task_id=null picks from a prior run that predates this fix.
  const priorBoardTask = await prisma.task.findFirst({ where: { title: BOARD_TASK_TITLE } });
  if (priorBoardTask) {
    await prisma.todayPick.deleteMany({ where: { task_id: priorBoardTask.id } });
  }
  await prisma.todayPick.deleteMany({ where: { item_type: TodayPickType.task, task_id: null } });
  await prisma.task.deleteMany({ where: { title: BOARD_TASK_TITLE } });
  const boardTask = await prisma.task.create({
    data: {
      title: BOARD_TASK_TITLE,
      status: 'not_started',
      priority: 3,
      assignee_id: admin.id,
      created_by_id: admin.id,
    },
  });

  const dateStr = getZonedDateString(new Date(), adminTimezone);
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  // Fresh "To do" pick every run (both started_at/completed_at null) — the drag e2e always
  // starts from the same known state.
  await prisma.todayPick.deleteMany({ where: { task_id: boardTask.id } });
  const boardPick = await prisma.todayPick.create({
    data: {
      date,
      item_type: TodayPickType.task,
      task_id: boardTask.id,
      sort: 10, // after Phase 3's fixture picks, so it doesn't shift their positions
    },
  });
  console.log(`  created board task ${boardTask.id} + today_pick ${boardPick.id} for ${dateStr}`);

  console.log('Clarity Phase 4b fixtures: upserting intake email_ask fixtures...');
  const now = new Date();
  // Two separate fixture asks (not one reused for both tests) — the e2e file runs its
  // tests in `serial` mode within itself but each test must be independently re-runnable;
  // sharing one ask between the archive test (which moves it out of `open`) and the note
  // test (which needs to reload and still find it `open` with a persisted note) would make
  // the second test's outcome depend on the first having run in the same session.
  await prisma.emailAsk.upsert({
    where: { message_id: INTAKE_ARCHIVE_MESSAGE_ID },
    create: {
      message_id: INTAKE_ARCHIVE_MESSAGE_ID,
      thread_id: INTAKE_ARCHIVE_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Pat Vendor',
      from_email: 'pat@e2e-fixture-vendor.example',
      subject: 'E2E: intake archive fixture (Clarity Phase 4b)',
      gist: 'Vendor newsletter — archive candidate.',
      queue: 'answer',
      severity: 'internal',
      is_urgent: false,
      state: 'open',
      training_note: null,
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-4b-archive',
      received_at: now,
    },
    update: {
      is_urgent: false,
      state: 'open',
      training_note: null,
      subject: 'E2E: intake archive fixture (Clarity Phase 4b)',
      received_at: now,
      task_id: null,
    },
  });
  await prisma.emailAsk.upsert({
    where: { message_id: INTAKE_NOTE_MESSAGE_ID },
    create: {
      message_id: INTAKE_NOTE_MESSAGE_ID,
      thread_id: INTAKE_NOTE_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Sam Prospect',
      from_email: 'sam@e2e-fixture-4b.example',
      subject: 'E2E: intake note fixture (Clarity Phase 4b)',
      gist: 'Prospect question — calibration note candidate.',
      queue: 'answer',
      severity: 'internal',
      is_urgent: false,
      state: 'open',
      training_note: null,
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-4b-note',
      received_at: now,
    },
    update: {
      is_urgent: false,
      state: 'open',
      training_note: null,
      subject: 'E2E: intake note fixture (Clarity Phase 4b)',
      received_at: now,
      task_id: null,
    },
  });
  console.log('  upserted 2 intake email_ask fixtures (archive + note)');

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Clarity Phase 4b fixture seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
