/**
 * Dev fixture seed for Clarity Phase 3 (The Oracle Face) Playwright coverage: one arc with
 * tasks across every board column (+ a blocked task, rendered as a chip not a column) for
 * the arc-board drag e2e, plus a couple of Today picks for the day the e2e actually runs
 * against so the Today section has something to render. Phase 3b adds one fixture
 * calendar_event (real, non-30-minute duration) for that same day so the e2e screenshot
 * always shows a red-family meeting block regardless of whatever real Google Calendar data
 * has (or hasn't) been synced into this dev DB.
 *
 * Idempotent: the arc is found-or-created by a fixed demo name; its tasks and today_picks
 * are deleted and recreated on every run. Local dev only — this seeds whatever
 * DATABASE_URL points at; never point it at prod.
 *
 * Clarity Phase 4a baseline fix: this used to stamp today_picks/calendar_events with the
 * raw UTC calendar date, but Phase 3d moved GET /api/today's "today" resolution to the
 * REQUESTING USER's own zone (UserPreference.timezone -> CITADEL_DISPLAY_TZ ->
 * America/New_York — see lib/services/user-timezone.ts). The seed script was never
 * updated to match, so any run landing in the UTC-vs-ET gap (roughly 8pm-midnight ET,
 * when the UTC calendar date has already rolled over but the admin's ET date hasn't)
 * seeded picks for "tomorrow" while the API asked for "today" — an empty Today section
 * and a failing e2e, discovered baselining Phase 4a at ~10pm ET. Fixed by resolving the
 * same way the API does: the seed admin's own UserPreference.timezone (inline
 * Intl.DateTimeFormat zoned-date logic, mirroring lib/utils/time.ts's
 * getZonedDateString — kept inline rather than imported so this script stays
 * dependency-free of path-aliased app code, same as its Prisma-only sibling scripts).
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase3-fixtures.ts
 */
import { PrismaClient, TaskStatus, TodayPickType } from '@prisma/client';

const prisma = new PrismaClient();

const ARC_NAME = 'E2E Clarity Phase 3 Arc (demo)';
const ADMIN_EMAIL = 'admin@indelible.agency';
const DEFAULT_DISPLAY_TIMEZONE = 'America/New_York';

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

  console.log('Clarity Phase 3 fixtures: upserting demo arc...');
  let arc = await prisma.arc.findFirst({ where: { name: ARC_NAME } });
  if (!arc) {
    arc = await prisma.arc.create({ data: { name: ARC_NAME, description: 'Playwright e2e fixture arc' } });
  }

  // Recreate this arc's tasks fresh every run (idempotent).
  await prisma.task.deleteMany({ where: { arc_id: arc.id } });

  const taskSpecs: Array<{ title: string; status: TaskStatus }> = [
    { title: 'E2E: not started task', status: TaskStatus.not_started },
    { title: 'E2E: in progress task', status: TaskStatus.in_progress },
    { title: 'E2E: review task', status: TaskStatus.review },
    { title: 'E2E: done task', status: TaskStatus.done },
    { title: 'E2E: blocked task (chip, not a column)', status: TaskStatus.blocked },
  ];

  for (const spec of taskSpecs) {
    await prisma.task.create({
      data: {
        title: spec.title,
        status: spec.status,
        arc_id: arc.id,
        assignee_id: admin.id,
        created_by_id: admin.id,
        needs_review: false,
      },
    });
  }
  console.log(`  created ${taskSpecs.length} demo tasks on arc ${arc.id}`);

  // Today picks for whatever day it is in the admin's resolved zone — matching
  // GET /api/today's own resolution exactly, not raw UTC (see the file-header note).
  const dateStr = getZonedDateString(new Date(), adminTimezone);
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  await prisma.todayPick.deleteMany({ where: { label: { startsWith: 'E2E:' } } });
  await prisma.todayPick.deleteMany({ where: { arc_id: arc.id } });

  await prisma.todayPick.create({
    data: { date, item_type: TodayPickType.arc, arc_id: arc.id, sort: 0 },
  });
  await prisma.todayPick.create({
    data: { date, item_type: TodayPickType.note, label: 'E2E: quick note pick', sort: 1 },
  });
  console.log(`  created 2 today_picks for ${dateStr}`);

  // Clarity Phase 3b — one fixture calendar_event for the e2e day, a real 90-minute
  // duration (deliberately NOT 30 minutes, proving the old assumed-duration path is gone),
  // so the red-family meeting block always renders in the screenshot.
  const EVENT_ID = 'e2e-clarity-phase3b-fixture-meeting';
  await prisma.calendarEvent.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.calendarEvent.create({
    data: {
      event_id: EVENT_ID,
      title: 'E2E: fixture meeting (red block)',
      starts_at: new Date(`${dateStr}T14:00:00.000Z`),
      ends_at: new Date(`${dateStr}T15:30:00.000Z`), // 90 real minutes
      all_day: false,
    },
  });
  console.log(`  created 1 calendar_event fixture for ${dateStr}`);

  console.log(`Done. Arc id: ${arc.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
