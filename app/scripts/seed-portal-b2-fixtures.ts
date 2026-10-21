/**
 * Dev fixture seed for portal phase B slice 2 (threads, retainer and projects pages).
 * Run AFTER scripts/seed-portal-v2-phase1-fixtures.ts: it adds to the populated client that script
 * creates.
 *
 *  - a client-visible request filed by the owner, not started (the thread's task);
 *  - the retainer fixture charter gets a client_label and an allowance (budget_hours), an open
 *    client-visible charter task, a staged unapproved marketing-plan task, and a published
 *    ClientReport;
 *  - `--inspect-thread <task_id>` prints the task's comments, notices and waits as one JSON line
 *    (Playwright has no database access); `--mint-link` prints a fresh single-use sign-in token for the fixture owner; `--cleanup` retires the fixture tasks (the staged plan would
 *    otherwise show up as a second "View preview" on the slice 1 home spec); `--reset-thread` clears the thread task's comments,
 *    notices and waits so the spec starts clean.
 *
 * Idempotent. Local dev only: this writes to whatever DATABASE_URL points at.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const THREAD_TASK_TITLE = 'E2E: Thread request (portal fixture)';
export const THREAD_TASK_CLIENT_TITLE = 'Site change: Update the opening hours';
export const CHARTER_NAME = 'E2E: Marketing retainer (portal fixture)';
export const CHARTER_CLIENT_LABEL = 'E2E Growth plan';
export const CHARTER_OPEN_TASK = 'E2E: Retainer open item (portal fixture)';
export const CHARTER_PLAN_TASK = 'E2E: November marketing plan (portal fixture)';
export const APPROVAL_TOKEN = 'e2e-b2-approval-page-token';
export const APPROVAL_TASK_TITLE = 'E2E: Homepage refresh (portal fixture)';
export const REPORT_URL = 'https://reports.e2e-portal-fixture.example/october';

async function seed() {
  const client = await prisma.client.findFirst({ where: { name: 'E2E Portal Client (fixture)' } });
  if (!client) throw new Error('Run seed-portal-v2-phase1-fixtures.ts first.');
  const owner = await prisma.clientContact.findFirstOrThrow({ where: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } });
  const site = await prisma.site.findFirstOrThrow({ where: { client_id: client.id, name: 'E2E Portal Fixture Site' } });
  const charter = await prisma.charter.findFirstOrThrow({ where: { client_id: client.id, name: CHARTER_NAME } });

  let thread = await prisma.task.findFirst({ where: { title: THREAD_TASK_TITLE, client_id: client.id } });
  const threadData = {
    client_title: THREAD_TASK_CLIENT_TITLE,
    status: 'not_started' as const,
    is_deleted: false,
    site_id: site.id,
    requested_by_contact_id: owner.id,
    source: 'portal' as const,
    tags: ['portal-chat'],
    staging_preview_url: null,
    client_approved_at: null,
  };
  thread = thread
    ? await prisma.task.update({ where: { id: thread.id }, data: threadData })
    : await prisma.task.create({ data: { title: THREAD_TASK_TITLE, client_id: client.id, ...threadData } });

  // The retainer card: a client label, an allowance, an open item, a staged plan, a report.
  await prisma.charter.update({
    where: { id: charter.id },
    data: { client_label: CHARTER_CLIENT_LABEL, budget_hours: 10, billing_period: 'monthly', status: 'active' },
  });
  for (const [title, data] of [
    [CHARTER_OPEN_TASK, { status: 'in_progress' as const, tags: [] as string[], staging_preview_url: null }],
    [CHARTER_PLAN_TASK, { status: 'review' as const, tags: ['marketing-plan'], staging_preview_url: 'https://staging.e2e-portal-fixture.example/plan' }],
  ] as const) {
    const existing = await prisma.task.findFirst({ where: { title, client_id: client.id } });
    const base = { client_title: null, is_deleted: false, charter_id: charter.id, client_id: client.id, client_visible: true, approved: false, client_approved_at: null, ...data };
    if (existing) await prisma.task.update({ where: { id: existing.id }, data: base as Prisma.TaskUncheckedUpdateInput });
    else await prisma.task.create({ data: { title, ...base } as Prisma.TaskUncheckedCreateInput });
  }
  await prisma.clientReport.upsert({
    where: { url: REPORT_URL },
    create: {
      client_id: client.id,
      charter_id: charter.id,
      period: '2026-10',
      title: 'October report',
      headline: 'Calls from the site went up this month.',
      url: REPORT_URL,
      published_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    update: { published_at: new Date(Date.now() - 24 * 60 * 60 * 1000), charter_id: charter.id },
  });
  // The staged homepage task gets an approval-page token, so the spec can open the token page.
  await prisma.task.updateMany({
    where: { title: APPROVAL_TASK_TITLE, client_id: client.id },
    data: { portal_token: APPROVAL_TOKEN, portal_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), requested_by_contact_id: owner.id },
  });
  console.log(JSON.stringify({ thread_task_id: thread.id, client_id: client.id }));
}

/** Retire this slice's fixture tasks so the slice 1 specs see the same client they always did. */
/** A single-use sign-in link for the fixture owner, as the emailed one would be (no mail is sent). */
async function mintLink() {
  const client = await prisma.client.findFirstOrThrow({ where: { name: 'E2E Portal Client (fixture)' } });
  const owner = await prisma.clientContact.findFirstOrThrow({ where: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } });
  const token = randomBytes(64).toString('hex');
  await prisma.portalSession.create({
    data: {
      token_type: 'client_session',
      entity_id: client.id,
      contact_id: owner.id,
      magic_token_hash: createHash('sha256').update(token).digest('hex'),
      magic_token_expires_at: new Date(Date.now() + 15 * 60 * 1000),
      ip_address: '127.0.0.1',
      action: 'request',
    },
  });
  console.log(JSON.stringify({ token }));
}

async function cleanup() {
  await prisma.task.updateMany({ where: { title: APPROVAL_TASK_TITLE }, data: { portal_token: null, portal_token_expires_at: null } });
  await prisma.task.updateMany({
    where: { title: { in: [THREAD_TASK_TITLE, CHARTER_OPEN_TASK, CHARTER_PLAN_TASK] } },
    data: { is_deleted: true },
  });
}

async function resetThread(taskId: string) {
  await prisma.portalNotice.deleteMany({ where: { task_id: taskId } });
  await prisma.comment.deleteMany({ where: { task_id: taskId } });
  await prisma.wait.deleteMany({ where: { task_id: taskId } });
  await prisma.task.update({ where: { id: taskId }, data: { status: 'not_started', tags: ['portal-chat'] } });
}

async function inspectThread(taskId: string) {
  const [comments, notices, waits] = await Promise.all([
    prisma.comment.findMany({
      where: { task_id: taskId },
      orderBy: { created_at: 'asc' },
      select: { id: true, content: true, is_internal: true, client_visible: true, client_question: true, author_contact_id: true },
    }),
    prisma.portalNotice.findMany({ where: { task_id: taskId }, orderBy: { created_at: 'asc' }, select: { id: true, status: true, to_email: true, subject: true, body: true, comment_ids: true } }),
    prisma.wait.findMany({ where: { task_id: taskId }, orderBy: { created_at: 'asc' }, select: { template_key: true, state: true, resolution: true } }),
  ]);
  console.log(JSON.stringify({ comments, notices, waits }));
}

async function main() {
  const flag = (name: string) => {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
  };
  if (process.argv.includes('--cleanup')) return cleanup();
  if (process.argv.includes('--mint-link')) return mintLink();
  if (flag('--inspect-thread')) return inspectThread(flag('--inspect-thread')!);
  if (flag('--reset-thread')) return resetThread(flag('--reset-thread')!);
  await seed();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
