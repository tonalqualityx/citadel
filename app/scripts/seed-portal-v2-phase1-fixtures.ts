/**
 * Dev fixture seed for Portal v2 phase 1 (client account home) Playwright coverage.
 *
 * Two clients:
 *  - "E2E Portal Client (fixture)" — fully populated: a pending task (awaiting client approval,
 *    with a staging preview), a pending in_review article with a comment thread, an active
 *    project, a triggered (unbilled) milestone, a completed task + a published article (for the
 *    activity feed), and a site stats snapshot. Its session_token is FIXTURE_SESSION_TOKEN — the
 *    spec injects this directly as the `client_session` cookie (no real magic-link redemption
 *    needed for e2e; the API/unit tests already cover the login flow itself).
 *  - "E2E Portal Client Empty (fixture)" — deliberately bare: no pending anything, no stats.
 *    Exercises the quiet-placeholder states. Session token: FIXTURE_EMPTY_SESSION_TOKEN.
 *
 * Idempotent: each fixture is found-or-recreated by a fixed name/token on every run. Local dev
 * only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-portal-v2-phase1-fixtures.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const FIXTURE_SESSION_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');
export const FIXTURE_EMPTY_SESSION_TOKEN = 'e2e-portal-v2-phase1-fixture-empty-session-token-'.padEnd(128, 'b');

const CLIENT_NAME = 'E2E Portal Client (fixture)';
const EMPTY_CLIENT_NAME = 'E2E Portal Client Empty (fixture)';

async function findOrCreateClient(name: string) {
  const existing = await prisma.client.findFirst({ where: { name } });
  if (existing) {
    return prisma.client.update({ where: { id: existing.id }, data: { is_deleted: false } });
  }
  return prisma.client.create({ data: { name, type: 'direct', status: 'active' } });
}

async function findOrCreateSite(clientId: string, name: string) {
  const existing = await prisma.site.findFirst({ where: { client_id: clientId, name } });
  if (existing) return existing;
  return prisma.site.create({ data: { name, client_id: clientId, url: 'https://e2e-portal-fixture.example' } });
}

async function findOrCreateRun(clientId: string, siteId: string, title: string) {
  const existing = await prisma.troubadorRun.findFirst({ where: { title } });
  if (existing) return existing;
  return prisma.troubadorRun.create({ data: { title, client_id: clientId, site_id: siteId, stage: 'in_production' } });
}

async function seedPopulatedClient() {
  const client = await findOrCreateClient(CLIENT_NAME);

  const contact = await prisma.clientContact.upsert({
    where: { client_id_email: { client_id: client.id, email: 'contact@e2e-portal-fixture.example' } },
    create: {
      client_id: client.id,
      name: 'Jane Fixture',
      email: 'contact@e2e-portal-fixture.example',
      is_primary: true,
      can_initiate_work: true,
    },
    update: { name: 'Jane Fixture', is_primary: true },
  });

  const site = await findOrCreateSite(client.id, 'E2E Portal Fixture Site');

  // Reset the session row to a known, fixed token every run (idempotent injection target).
  await prisma.portalSession.deleteMany({ where: { session_token: FIXTURE_SESSION_TOKEN } });
  await prisma.portalSession.create({
    data: {
      token_type: 'client_session',
      entity_id: client.id,
      contact_id: contact.id,
      session_token: FIXTURE_SESSION_TOKEN,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      consumed_at: new Date(),
      action: 'login',
      ip_address: '127.0.0.1',
    },
  });

  // Pending task — awaiting the client's own approval, with a staging preview.
  await prisma.task.deleteMany({ where: { title: 'E2E: Homepage refresh (portal fixture)' } });
  await prisma.task.create({
    data: {
      title: 'E2E: Homepage refresh (portal fixture)',
      status: 'review',
      client_id: client.id,
      site_id: site.id,
      staging_preview_url: 'https://staging.e2e-portal-fixture.example',
      energy_estimate: 3,
    },
  });

  // Completed task — feeds the activity feed.
  await prisma.task.deleteMany({ where: { title: 'E2E: Fixed broken link (portal fixture)' } });
  await prisma.task.create({
    data: {
      title: 'E2E: Fixed broken link (portal fixture)',
      status: 'done',
      client_id: client.id,
      site_id: site.id,
      completed_at: new Date(),
      client_approved_at: new Date(),
    },
  });

  // Active project.
  await prisma.project.deleteMany({ where: { name: 'E2E: Site relaunch (portal fixture)' } });
  const project = await prisma.project.create({
    data: { name: 'E2E: Site relaunch (portal fixture)', client_id: client.id, status: 'in_progress' },
  });

  // Triggered (unbilled) milestone — feeds the open-balance summary.
  await prisma.milestone.deleteMany({ where: { name: 'E2E: Phase 1 complete (portal fixture)' } });
  await prisma.milestone.create({
    data: {
      name: 'E2E: Phase 1 complete (portal fixture)',
      project_id: project.id,
      billing_amount: 1500,
      billing_status: 'triggered',
    },
  });

  // In-review article with a comment thread — needs a TroubadorRun parent.
  const run = await findOrCreateRun(client.id, site.id, 'E2E: Portal fixture run');

  await prisma.article.deleteMany({ where: { run_id: run.id, slug: 'e2e-portal-fixture-in-review' } });
  const article = await prisma.article.create({
    data: {
      run_id: run.id,
      client_id: client.id,
      site_id: site.id,
      slug: 'e2e-portal-fixture-in-review',
      title: 'E2E: Q3 Recap (portal fixture)',
      status: 'in_review',
      body: 'This is the fixture article body for Playwright coverage.',
    },
  });

  const bast = await prisma.user.findFirst({ where: { email: 'bast@becomeindelible.com' } });
  if (bast) {
    await prisma.articleComment.deleteMany({ where: { article_id: article.id } });
    await prisma.articleComment.create({
      data: { article_id: article.id, user_id: bast.id, content: 'Ready for your review.' },
    });
  }

  // Published article — feeds the activity feed.
  await prisma.article.deleteMany({ where: { run_id: run.id, slug: 'e2e-portal-fixture-published' } });
  await prisma.article.create({
    data: {
      run_id: run.id,
      client_id: client.id,
      site_id: site.id,
      slug: 'e2e-portal-fixture-published',
      title: 'E2E: New Blog Post (portal fixture)',
      status: 'published',
      body: 'Published fixture body.',
      published_url: 'https://e2e-portal-fixture.example/blog/new-post',
    },
  });

  // Stats snapshot.
  await prisma.siteStatsSnapshot.deleteMany({ where: { site_id: site.id } });
  await prisma.siteStatsSnapshot.create({
    data: {
      site_id: site.id,
      period: 'month',
      captured_at: new Date(),
      source: 'e2e-fixture',
      payload: {
        leads: { count: 14, change_pct: 0.12 },
        traffic: { sessions: 820, change_pct: 0.03 },
        rankings: { tracked_keywords: 24, top3_count: 5 },
        uptime_pct: 99.98,
      },
    },
  });

  console.log(`  populated client fixture ready (client_id=${client.id})`);
}

async function seedEmptyClient() {
  const client = await findOrCreateClient(EMPTY_CLIENT_NAME);

  const contact = await prisma.clientContact.upsert({
    where: { client_id_email: { client_id: client.id, email: 'contact@e2e-portal-empty-fixture.example' } },
    create: {
      client_id: client.id,
      name: 'Sam Empty',
      email: 'contact@e2e-portal-empty-fixture.example',
      is_primary: true,
    },
    update: { name: 'Sam Empty' },
  });

  await prisma.portalSession.deleteMany({ where: { session_token: FIXTURE_EMPTY_SESSION_TOKEN } });
  await prisma.portalSession.create({
    data: {
      token_type: 'client_session',
      entity_id: client.id,
      contact_id: contact.id,
      session_token: FIXTURE_EMPTY_SESSION_TOKEN,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      consumed_at: new Date(),
      action: 'login',
      ip_address: '127.0.0.1',
    },
  });

  console.log(`  empty client fixture ready (client_id=${client.id})`);
}

async function main() {
  console.log('Portal v2 phase 1 fixtures: seeding populated client...');
  await seedPopulatedClient();
  console.log('Portal v2 phase 1 fixtures: seeding empty client...');
  await seedEmptyClient();
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
