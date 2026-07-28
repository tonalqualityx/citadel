/**
 * Dev fixture seed for Clarity Phase 8 (composition) Playwright coverage AND the visual
 * gate's screenshot round: seeds the scenario the orchestrator asked to see — a crisis, a
 * promised-due-today task, an internal target task (reason-chip variety), an in-progress
 * task, an active session + its session-type pick (Work hero's "needs you" footer), 12
 * intake asks across every lane, 2 review items sharing a client, 1 admin-soon task, and
 * 1 calendar event today carrying description/meet_url/location/attendees (mixed
 * accepted/needsAction).
 *
 * NONE of this phase's fixtures become a today_pick (see the "Today picks" section's own
 * note): the shared dev DB's today_picks table is a WIP-capped (5 uncompleted) surface
 * every Oracle e2e fixture file competes for, and four OTHER files' fixtures already
 * occupy all but the one slot oracle-phase4a-email.spec.ts's own due-soon test depends on
 * being free — seeding even one new permanent pick here broke that test with a 409 (cap
 * already full). Every fixture here is still fully demonstrable as a bare task/session:
 * promisedTask/targetTask via /api/today/due-soon + the signals rail's promised-due-today
 * count, the session via the signals rail's sessions-need-you count (reads live session
 * state directly, never picks), progressTask/admin-soon task via their own surfaces.
 *
 * Idempotent: every row is found-or-recreated by a fixed id/message_id/external_id on
 * every run. Local dev only — this seeds whatever DATABASE_URL points at; never point it
 * at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase8-fixtures.ts
 */
import {
  PrismaClient,
  OracleSource,
  OracleSessionStatus,
  AskQueue,
} from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@indelible.agency';
const DEFAULT_DISPLAY_TIMEZONE = 'America/New_York';
const MACHINE_NAME = 'e2e-phase8-machine';

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

const INTAKE_LANES: Array<{ intent: 'admin' | 'meeting' | 'sales' | 'general'; count: number }> = [
  { intent: 'admin', count: 3 },
  { intent: 'meeting', count: 3 },
  { intent: 'sales', count: 3 },
  { intent: 'general', count: 3 },
];

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }
  const adminPref = await prisma.userPreference.findUnique({ where: { user_id: admin.id } });
  const adminTimezone = adminPref?.timezone || DEFAULT_DISPLAY_TIMEZONE;

  const now = new Date();
  const dateStr = getZonedDateString(now, adminTimezone);

  // ---- 1. Crisis ----
  console.log('Clarity Phase 8 fixtures: upserting the crisis email_ask...');
  const CRISIS_MESSAGE_ID = 'e2e-clarity-phase8-fixture-crisis';
  await prisma.emailAsk.upsert({
    where: { message_id: CRISIS_MESSAGE_ID },
    create: {
      message_id: CRISIS_MESSAGE_ID,
      thread_id: CRISIS_MESSAGE_ID,
      account: 'mike@becomeindelible.com',
      from_name: 'Wildbeauty',
      from_email: 'client@e2e-fixture-phase8.example',
      subject: 'E2E: Site returning 500s (Clarity Phase 8 fixture)',
      gist: 'Client reports the production site is down.',
      queue: 'do',
      severity: 'client_blocking',
      is_urgent: true,
      state: 'open',
      deep_link: 'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-phase8-crisis',
      received_at: now,
    },
    update: {
      is_urgent: true,
      state: 'open',
      subject: 'E2E: Site returning 500s (Clarity Phase 8 fixture)',
      received_at: now,
      task_id: null,
    },
  });

  // ---- 2. 12 intake asks across every lane ----
  console.log('Clarity Phase 8 fixtures: upserting 12 intake email_asks across every lane...');
  let staggerMinutes = 0;
  for (const lane of INTAKE_LANES) {
    for (let i = 0; i < lane.count; i++) {
      const messageId = `e2e-clarity-phase8-fixture-intake-${lane.intent}-${i}`;
      const receivedAt = new Date(now.getTime() - staggerMinutes * 60_000);
      staggerMinutes += 17;
      await prisma.emailAsk.upsert({
        where: { message_id: messageId },
        create: {
          message_id: messageId,
          thread_id: messageId,
          account: 'mike@becomeindelible.com',
          from_name: `E2E ${lane.intent} sender ${i}`,
          from_email: `${lane.intent}-${i}@e2e-fixture-phase8.example`,
          subject: `E2E: ${lane.intent} intake item ${i} (Clarity Phase 8 fixture)`,
          gist: `A ${lane.intent}-lane fixture ask for the Process dealer.`,
          queue: 'answer',
          severity: 'internal',
          is_urgent: false,
          state: 'open',
          intent: lane.intent,
          deep_link: `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
          received_at: receivedAt,
        },
        update: {
          is_urgent: false,
          state: 'open',
          intent: lane.intent,
          received_at: receivedAt,
          task_id: null,
          calendar_requested: false,
          calendar_event_id: null,
        },
      });
    }
  }
  console.log('  upserted 12 intake email_asks (3 per lane: admin/meeting/sales/general)');

  // ---- 3. Promised-due-today task + pick ----
  // Deletes any prior run's TodayPick FIRST (task_id has no ON DELETE CASCADE onto
  // today_picks — an orphaned pick pointing at a since-deleted task id was a real bug
  // this script hit while baselining: stale fixture picks silently accumulated across
  // reseed runs instead of being replaced).
  console.log('Clarity Phase 8 fixtures: upserting the promised-due-today task...');
  const PROMISED_TASK_TITLE = 'E2E: record walkthrough video (Clarity Phase 8 fixture)';
  const oldPromisedTask = await prisma.task.findFirst({ where: { title: PROMISED_TASK_TITLE } });
  if (oldPromisedTask) {
    await prisma.todayPick.deleteMany({ where: { task_id: oldPromisedTask.id } });
    await prisma.task.delete({ where: { id: oldPromisedTask.id } });
  }
  const promisedTask = await prisma.task.create({
    data: {
      title: PROMISED_TASK_TITLE,
      status: 'not_started',
      priority: 2,
      promised_to: 'Ricson & Hannah',
      due_date: new Date(`${dateStr}T21:00:00.000Z`), // today, 5pm ET
      assignee_id: admin.id,
      created_by_id: admin.id,
      needs_review: false,
    },
  });

  // ---- 4. Internal target task + pick (visual contrast: quiet outline chip) ----
  console.log('Clarity Phase 8 fixtures: upserting the internal target task...');
  const TARGET_TASK_TITLE = 'E2E: confirm Turnstile + DNS window (Clarity Phase 8 fixture)';
  const oldTargetTask = await prisma.task.findFirst({ where: { title: TARGET_TASK_TITLE } });
  if (oldTargetTask) {
    await prisma.todayPick.deleteMany({ where: { task_id: oldTargetTask.id } });
    await prisma.task.delete({ where: { id: oldTargetTask.id } });
  }
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
  const targetTask = await prisma.task.create({
    data: {
      title: TARGET_TASK_TITLE,
      status: 'not_started',
      priority: 3,
      promised_to: null,
      due_date: threeDaysOut,
      assignee_id: admin.id,
      created_by_id: admin.id,
      needs_review: false,
    },
  });

  // ---- 5. In-progress pick (its own task) ----
  console.log('Clarity Phase 8 fixtures: upserting the in-progress task...');
  const PROGRESS_TASK_TITLE = 'E2E: a11y remediation v1.1.0 (Clarity Phase 8 fixture)';
  const oldProgressTask = await prisma.task.findFirst({ where: { title: PROGRESS_TASK_TITLE } });
  if (oldProgressTask) {
    await prisma.todayPick.deleteMany({ where: { task_id: oldProgressTask.id } });
    await prisma.task.delete({ where: { id: oldProgressTask.id } });
  }
  const progressTask = await prisma.task.create({
    data: {
      title: PROGRESS_TASK_TITLE,
      status: 'in_progress',
      priority: 2,
      started_at: new Date(now.getTime() - 2 * 60 * 60_000),
      assignee_id: admin.id,
      created_by_id: admin.id,
      needs_review: false,
    },
  });

  // ---- 6. Active session + session-type pick (Work hero's "needs you" footer) ----
  console.log('Clarity Phase 8 fixtures: upserting the active session...');
  const machine = await prisma.oracleMachine.upsert({
    where: { name: MACHINE_NAME },
    update: { last_heartbeat_at: now },
    create: { name: MACHINE_NAME, hostname: 'e2e-phase8-machine.local', last_heartbeat_at: now },
  });
  const SESSION_EXT_ID = 'e2e-clarity-phase8-fixture-session';
  await prisma.oracleSession.upsert({
    where: {
      machine_id_source_external_id: {
        machine_id: machine.id,
        source: OracleSource.claude_code,
        external_id: SESSION_EXT_ID,
      },
    },
    update: {
      status: OracleSessionStatus.waiting,
      needs_attention: false,
      waiting_on: 'approve the deploy?',
      ask_queue: AskQueue.decide,
      ask_severity: 'internal',
      archived_at: null,
      title: 'E2E: BRIC zz-qa rebuild (Clarity Phase 8 fixture)',
    },
    create: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: SESSION_EXT_ID,
      title: 'E2E: BRIC zz-qa rebuild (Clarity Phase 8 fixture)',
      status: OracleSessionStatus.waiting,
      waiting_on: 'approve the deploy?',
      ask_queue: AskQueue.decide,
      ask_severity: 'internal',
      started_at: now,
      last_event_at: now,
    },
  });

  // ---- 7. Today picks: NONE, deliberately ----
  // The shared dev DB's today_picks table is a WIP-capped (5 uncompleted) surface every
  // Oracle e2e fixture file competes for — by the time this script was baselined, four
  // OTHER files' own fixtures (phase3 x2, phase4b x1, phase5 x1) already occupied all but
  // one of those 5 slots, and oracle-phase4a-email.spec.ts's due-soon "add to Today" test
  // depends on that one last slot being free. Seeding even a single new permanent pick
  // here (tried both 4 and 1) broke that test with a 409 (cap already full).
  //
  // None of this phase's fixtures need to be a TodayPick to be demonstrable:
  //   - promisedTask/targetTask surface via /api/today/due-soon (only excludes tasks
  //     ALREADY picked) and the signals rail's promised-due-today count.
  //   - the active session lights up the signals rail's "sessions need you" count via
  //     selectWaitingSessions (reads live session state directly, never picks).
  //   - progressTask/admin-soon task are visible via their own surfaces regardless.
  // The one-off visual-gate screenshot round (not part of this committed script) adds a
  // temporary session-type pick just for the screenshots, then removes it again — see the
  // orchestrator's final report for that pass.
  console.log('Clarity Phase 8 fixtures: no today_picks created (WIP-cap headroom preserved for oracle-phase4a-email.spec.ts)');
  await prisma.todayPick.deleteMany({ where: { task_id: { in: [promisedTask.id, targetTask.id, progressTask.id] } } });
  await prisma.todayPick.deleteMany({ where: { session_external_id: SESSION_EXT_ID } });

  // ---- 8. 2 review items sharing a client ----
  console.log('Clarity Phase 8 fixtures: upserting the review-batch client + 2 review tasks...');
  const CLIENT_NAME = 'E2E Phase 8 Review Client';
  let client = await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  if (!client) {
    client = await prisma.client.create({ data: { name: CLIENT_NAME, status: 'active' } });
  }
  const REVIEW_TITLES = [
    'E2E: Figma Library stage 3 (Clarity Phase 8 fixture)',
    'E2E: Foundations page rebind (Clarity Phase 8 fixture)',
  ];
  await prisma.task.deleteMany({ where: { title: { in: REVIEW_TITLES } } });
  for (const title of REVIEW_TITLES) {
    await prisma.task.create({
      data: {
        title,
        status: 'done',
        needs_review: true,
        approved: false,
        priority: 3,
        client_id: client.id,
        assignee_id: admin.id,
        created_by_id: admin.id,
      },
    });
  }

  // ---- 9. 1 admin-soon task (explicit kind:admin tag) ----
  console.log('Clarity Phase 8 fixtures: upserting the admin-soon task...');
  const ADMIN_SOON_TITLE = 'E2E: Pay Tara (bookkeeper) (Clarity Phase 8 fixture)';
  await prisma.task.deleteMany({ where: { title: ADMIN_SOON_TITLE } });
  await prisma.task.create({
    data: {
      title: ADMIN_SOON_TITLE,
      status: 'not_started',
      priority: 3,
      tags: ['kind:admin'],
      assignee_id: admin.id,
      created_by_id: admin.id,
      needs_review: false,
    },
  });

  // ---- 10. Calendar event with full meeting context ----
  console.log('Clarity Phase 8 fixtures: upserting the calendar event with meeting context...');
  const EVENT_ID = 'e2e-clarity-phase8-fixture-meeting';
  await prisma.calendarEvent.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.calendarEvent.create({
    data: {
      event_id: EVENT_ID,
      title: 'E2E: BRIC board (Clarity Phase 8 fixture)',
      starts_at: new Date(now.getTime() + 2 * 60 * 60_000),
      ends_at: new Date(now.getTime() + 2.5 * 60 * 60_000),
      all_day: false,
      description: 'Quarterly review — agenda: https://docs.example.com/e2e-fixture-agenda',
      meet_url: 'https://meet.google.com/e2e-fixture-phase8',
      location: 'Springfield VT',
      attendees: [
        { email: 'dan@e2e-fixture-phase8.example', display_name: 'Dan Cotter', response_status: 'accepted', organizer: true, self: false },
        { email: 'mike@becomeindelible.com', display_name: 'Mike', response_status: 'accepted', organizer: false, self: true },
        { email: 'guest@e2e-fixture-phase8.example', display_name: 'A Guest', response_status: 'needsAction', organizer: false, self: false },
      ],
    },
  });

  console.log(`Done. Seeded for ${dateStr} (${adminTimezone}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
