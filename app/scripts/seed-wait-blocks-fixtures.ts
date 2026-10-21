/**
 * Dev fixture seed for the wait-record Work blocks (__tests__/e2e/oracle-wait-blocks.spec.ts):
 * a client with seven client-blocking waits on the admin (Blocking today shows five and "and 2
 * more"), two waits due later this week (Due this week), and, when any project exists, one of
 * the seven is a project approval so it sorts first.
 *
 * The waits are owned by the e2e admin by name (owner_user_id), because the production owner
 * rule resolves "empty" to Mike's real user id, which the e2e database does not have.
 *
 * Idempotent: every wait is keyed by idempotency_key and reset to a fresh waiting state on
 * every run (waits are never deleted). Local dev only: this seeds whatever DATABASE_URL points
 * at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-wait-blocks-fixtures.ts
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const ADMIN_EMAIL = 'admin@indelible.agency';
const CLIENT_NAME = 'E2E Wait Blocks Client';
const DAY = 86_400_000;

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) throw new Error(`Seed admin user ${ADMIN_EMAIL} not found. Run prisma/seed.ts first.`);

  let client = await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  if (!client) client = await prisma.client.create({ data: { name: CLIENT_NAME } });
  const project = await prisma.project.findFirst({ where: { is_deleted: false }, select: { id: true } });

  const now = Date.now();
  const rows: Array<{ key: string; data: Prisma.WaitUncheckedCreateInput }> = [];

  for (let i = 0; i < 7; i++) {
    const isProjectApproval = i === 6 && !!project;
    rows.push({
      key: `e2e-wait-blocks:blocking:${i}`,
      data: {
        kind: isProjectApproval ? 'approval' : 'handoff',
        template_key: isProjectApproval ? 'build.gate_mike' : 'handoff.generic',
        step: 1,
        title: isProjectApproval ? 'Approve the e2e sitemap' : `E2E client wait number ${i + 1}`,
        owner_user_id: admin.id,
        client_id: client.id,
        project_id: isProjectApproval ? project!.id : null,
        started_at: new Date(now - (10 - i) * DAY),
        duration_value: 2,
        duration_unit: 'business_days',
        due_at: new Date(now - DAY),
        blocks_client: true,
        client_waiting_since: new Date(now - (10 - i) * DAY),
        terminal_action: 'escalate',
        action_payload: { owner_role: 'mike' },
        idempotency_key: `e2e-wait-blocks:blocking:${i}`,
        created_by_automation: 'e2e',
      },
    });
  }
  for (let i = 0; i < 2; i++) {
    rows.push({
      key: `e2e-wait-blocks:week:${i}`,
      data: {
        kind: 'handoff',
        template_key: 'handoff.generic',
        step: 1,
        title: `E2E due this week number ${i + 1}`,
        owner_user_id: admin.id,
        client_id: null,
        started_at: new Date(now),
        duration_value: 3,
        duration_unit: 'calendar_days',
        due_at: new Date(now + (2 + i) * DAY),
        blocks_client: false,
        terminal_action: 'escalate',
        action_payload: { owner_role: 'mike' },
        idempotency_key: `e2e-wait-blocks:week:${i}`,
        created_by_automation: 'e2e',
      },
    });
  }

  for (const { key, data } of rows) {
    const existing = await prisma.wait.findUnique({ where: { idempotency_key: key } });
    if (existing) {
      await prisma.wait.update({
        where: { id: existing.id },
        data: {
          state: 'waiting',
          due_at: data.due_at,
          started_at: data.started_at,
          client_waiting_since: data.client_waiting_since ?? null,
          nag_level: 0,
          fired_at: null,
          claimed_at: null,
          resolved_at: null,
          resolution: null,
          title: data.title,
        },
      });
    } else {
      await prisma.wait.create({ data });
    }
  }
  console.log(`Seeded ${rows.length} wait fixtures for ${CLIENT_NAME}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
