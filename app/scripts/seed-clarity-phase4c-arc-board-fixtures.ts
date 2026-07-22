/**
 * Dev fixture seed for Clarity Phase 4c (arc board header enrichment) Playwright coverage:
 *   - one arc with:
 *     - a not_started task, assigned, with an estimate (peek/drag/assignee-chip fixture)
 *     - an in_progress task, UNASSIGNED, with an estimate (unassigned-chip fixture)
 *     - a done task with a large estimate (proves estimated_minutes_total excludes it)
 *     - estimate_override_minutes reset to null every run (the estimate-override e2e sets
 *       it itself, through the UI, and must start from "no override" every time)
 *   - one OracleSession linked via arc_id, status=waiting, needs_attention=true, with a
 *     remote_url (session panel: title + live-status chip + Respond + waiting-since line)
 *
 * Idempotent: the arc is found-or-created by a fixed demo name; its tasks/session are
 * deleted and recreated on every run — same pattern as
 * scripts/seed-clarity-phase3-fixtures.ts. Local dev only — this seeds whatever
 * DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-clarity-phase4c-arc-board-fixtures.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, OracleSource, OracleSessionStatus } from '@prisma/client';

const prisma = new PrismaClient();

// No /oracle/arcs list page exists (the board is only ever reached via a Today pick's
// "Arc" link or the task-peek drawer's arc link, neither of which this fixture arc has) —
// write the id out so the e2e spec can navigate to /oracle/arcs/{id} directly instead of
// scraping this script's stdout.
const FIXTURE_IDS_PATH = path.join(__dirname, '..', 'test-results', 'clarity-phase4c', 'fixture-ids.json');

const ARC_NAME = 'E2E Clarity Phase 4c Arc (demo)';
const ADMIN_EMAIL = 'admin@indelible.agency';
const MACHINE_NAME = 'reshi-workstation';
const SESSION_EXTERNAL_ID = 'e2e-clarity-phase4c-arc-session';
const ASSIGNED_TASK_TITLE = 'E2E: assigned task (Clarity Phase 4c fixture)';
const UNASSIGNED_TASK_TITLE = 'E2E: unassigned task (Clarity Phase 4c fixture)';
const DONE_TASK_TITLE = 'E2E: done task, large estimate excluded (Clarity Phase 4c fixture)';

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }

  console.log('Clarity Phase 4c fixtures: upserting demo arc...');
  let arc = await prisma.arc.findFirst({ where: { name: ARC_NAME } });
  if (!arc) {
    arc = await prisma.arc.create({ data: { name: ARC_NAME, description: 'Playwright e2e fixture arc' } });
  }
  // Reset the estimate override every run — the estimate-override e2e sets it itself,
  // through the UI, and must always start from "no override, computed sum shown".
  arc = await prisma.arc.update({ where: { id: arc.id }, data: { estimate_override_minutes: null } });

  await prisma.task.deleteMany({ where: { arc_id: arc.id } });
  await prisma.task.create({
    data: {
      title: ASSIGNED_TASK_TITLE,
      status: 'not_started',
      arc_id: arc.id,
      assignee_id: admin.id,
      created_by_id: admin.id,
      needs_review: false,
      estimated_minutes: 30,
    },
  });
  await prisma.task.create({
    data: {
      title: UNASSIGNED_TASK_TITLE,
      status: 'in_progress',
      arc_id: arc.id,
      assignee_id: null,
      created_by_id: admin.id,
      needs_review: false,
      estimated_minutes: 60,
    },
  });
  await prisma.task.create({
    data: {
      title: DONE_TASK_TITLE,
      status: 'done',
      arc_id: arc.id,
      assignee_id: admin.id,
      created_by_id: admin.id,
      needs_review: false,
      estimated_minutes: 500,
    },
  });
  console.log(`  created 3 demo tasks on arc ${arc.id} (open total should be 30 + 60 = 90 minutes)`);

  console.log('Clarity Phase 4c fixtures: upserting demo machine + linked session...');
  const machine = await prisma.oracleMachine.upsert({
    where: { name: MACHINE_NAME },
    update: { last_heartbeat_at: new Date() },
    create: { name: MACHINE_NAME, hostname: 'reshi-workstation.local', last_heartbeat_at: new Date() },
  });

  await prisma.oracleSession.deleteMany({ where: { external_id: SESSION_EXTERNAL_ID } });
  const session = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: SESSION_EXTERNAL_ID,
      title: 'E2E: arc-linked session (fixture)',
      status: OracleSessionStatus.waiting,
      needs_attention: true,
      attention_reason: 'Fixture: waiting on Reshi.',
      started_at: new Date(Date.now() - 90 * 60_000),
      last_event_at: new Date(Date.now() - 12 * 60_000),
      remote_url: 'https://claude.ai/code/session_e2e_clarity_phase4c',
      arc_id: arc.id,
    },
  });
  console.log(`  created linked session ${session.id} (arc_id=${arc.id}, needs_attention, waiting ~12m)`);

  fs.mkdirSync(path.dirname(FIXTURE_IDS_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_IDS_PATH, JSON.stringify({ arcId: arc.id }, null, 2));

  console.log(`Done. Arc id: ${arc.id}`);
}

main()
  .catch((e) => {
    console.error('Clarity Phase 4c fixture seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
