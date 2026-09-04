/**
 * Dev fixture seed for the Oracle Projects Tab Phase 4 Playwright coverage
 * (__tests__/e2e/oracle-projects-tab.spec.ts). Explicit values, same style as
 * scripts/seed-clarity-phase3-fixtures.ts: one in-progress, type=project project with —
 *
 *   - a "decision" task: tagged needs-mike, status in_progress (an OPEN_TASK_STATUSES
 *     member — see lib/oracle/projects/blockers.ts), whose LAST comment is authored by
 *     the fixed Bast user id (BOT_USER_IDS / BAST_USER_ID in
 *     lib/oracle/projects/gate-constants.ts) — this is exactly what
 *     classifyDecisionAndClarification requires to emit a `decision` blocker, which is
 *     what makes the project stalled_on_mike (blockers.ts's mikeOwner() is a hardcoded
 *     constant, not derived from any seeded user, so this works regardless of which real
 *     admin id the local dev DB happens to have).
 *   - a "review" task: status done, needs_review true, approved false — a `review`
 *     blocker.
 *   - one parked_until ProjectNote — stamps Project.stale_muted_until to that note's
 *     until_date directly (mirrors lib/services/project-notes.ts's
 *     recomputeStaleMutedUntil for the single-note case; not imported here, same
 *     path-alias-free convention the Clarity Phase 3 seed script documents for its own
 *     inline timezone helper).
 *
 * The Bast user (BAST_USER_ID) doesn't exist in prisma/seed.ts's demo roster — Comment.
 * user_id is a real FK to User, so this script upserts a User row at that literal id the
 * first time it runs (idempotent: upsert, never re-created).
 *
 * Idempotent: the client/project are found-or-created by fixed demo names; the project's
 * tasks/comments/notes are deleted and recreated fresh on every run. Local dev only —
 * this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-oracle-projects-fixtures.ts
 */
import { PrismaClient, TaskStatus, ProjectStatus, ProjectType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CLIENT_NAME = 'E2E Oracle Projects Client (demo)';
const PROJECT_NAME = 'E2E Oracle Projects Tab Fixture Project';
const ADMIN_EMAIL = 'admin@indelible.agency';

// Mirrors lib/oracle/projects/gate-constants.ts exactly (BAST_USER_ID / a BOT_USER_IDS
// member) — this script intentionally does not import that path-aliased app module (see
// the Clarity Phase 3 seed script's own note on staying dependency-free), so the id is
// copied here verbatim instead.
const BAST_USER_ID = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';
const BAST_EMAIL = 'bast-e2e-fixture@becomeindelible.com';

const DECISION_TASK_TITLE = 'E2E: decide on the domain migration approach';
const REVIEW_TASK_TITLE = 'E2E: ship the contact form (needs review)';
const BAST_COMMENT_TEXT =
  'Bast: two viable domain migration paths, need your call before I proceed — DNS cutover this week, or wait for the SSL renewal window?';
const PARKED_NOTE_BODY = 'E2E: holding on the CMS migration until the client confirms their new host.';

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Seed admin user ${ADMIN_EMAIL} not found — run prisma/seed.ts first.`);
  }

  console.log('Oracle Projects Tab fixtures: upserting the fixture Bast user...');
  const passwordHash = await bcrypt.hash('e2e-fixture-not-a-real-login', 10);
  const bast = await prisma.user.upsert({
    where: { id: BAST_USER_ID },
    update: {},
    create: {
      id: BAST_USER_ID,
      email: BAST_EMAIL,
      password_hash: passwordHash,
      name: 'Bast',
      role: 'admin',
      is_active: true,
    },
  });

  console.log('Oracle Projects Tab fixtures: upserting demo client + project...');
  let client = await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  if (!client) {
    client = await prisma.client.create({ data: { name: CLIENT_NAME } });
  }

  let project = await prisma.project.findFirst({ where: { name: PROJECT_NAME, client_id: client.id } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        name: PROJECT_NAME,
        client_id: client.id,
        type: ProjectType.project,
        status: ProjectStatus.in_progress,
        created_by_id: admin.id,
      },
    });
  } else if (project.status !== ProjectStatus.in_progress) {
    project = await prisma.project.update({
      where: { id: project.id },
      data: { status: ProjectStatus.in_progress },
    });
  }

  // Recreate this project's fixture tasks/comments/notes fresh every run (idempotent).
  const existingTasks = await prisma.task.findMany({ where: { project_id: project.id } });
  const existingTaskIds = existingTasks.map((t) => t.id);
  if (existingTaskIds.length > 0) {
    await prisma.comment.deleteMany({ where: { task_id: { in: existingTaskIds } } });
  }
  await prisma.task.deleteMany({ where: { project_id: project.id } });
  await prisma.projectNote.deleteMany({ where: { project_id: project.id } });

  const decisionTask = await prisma.task.create({
    data: {
      title: DECISION_TASK_TITLE,
      status: TaskStatus.in_progress,
      project_id: project.id,
      client_id: client.id,
      tags: ['needs-mike'],
      needs_review: false,
      created_by_id: admin.id,
    },
  });
  await prisma.comment.create({
    data: {
      task_id: decisionTask.id,
      user_id: bast.id,
      content: BAST_COMMENT_TEXT,
      is_internal: false,
    },
  });
  console.log(`  created decision task ${decisionTask.id} with Bast's comment`);

  const reviewTask = await prisma.task.create({
    data: {
      title: REVIEW_TASK_TITLE,
      status: TaskStatus.done,
      project_id: project.id,
      client_id: client.id,
      needs_review: true,
      approved: false,
      created_by_id: admin.id,
    },
  });
  console.log(`  created review task ${reviewTask.id}`);

  const untilDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days out
  await prisma.projectNote.create({
    data: {
      project_id: project.id,
      user_id: admin.id,
      kind: 'parked_until',
      body: PARKED_NOTE_BODY,
      until_date: untilDate,
    },
  });
  // Single live parked_until note -> MAX(until_date) is just this note's own date. See
  // this file's header for why this is inlined rather than importing the real service.
  await prisma.project.update({ where: { id: project.id }, data: { stale_muted_until: untilDate } });
  console.log(`  created parked_until note, stale_muted_until = ${untilDate.toISOString()}`);

  console.log(`Done. Project id: ${project.id}, decision task: ${decisionTask.id}, review task: ${reviewTask.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
