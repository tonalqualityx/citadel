/**
 * Dev fixture seed for Clarity Phase 3 (The Oracle Face) Playwright coverage: one arc with
 * tasks across every board column (+ a blocked task, rendered as a chip not a column) for
 * the arc-board drag e2e, plus a couple of Today picks for the day the e2e actually runs
 * against so the Today section has something to render.
 *
 * Idempotent: the arc is found-or-created by a fixed demo name; its tasks and today_picks
 * are deleted and recreated on every run. Local dev only — this seeds whatever
 * DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase3-fixtures.ts
 */
import { PrismaClient, TaskStatus, TodayPickType } from '@prisma/client';

const prisma = new PrismaClient();

const ARC_NAME = 'E2E Clarity Phase 3 Arc (demo)';
const ADMIN_EMAIL = 'admin@indelible.agency';

function todayUTCDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }

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

  // Today picks for whatever UTC day the e2e run actually executes on.
  const dateStr = todayUTCDateString();
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
