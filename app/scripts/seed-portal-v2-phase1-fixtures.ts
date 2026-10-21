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
 * Portal phase B slice 1 adds to the populated client (for the request-intake placement matrix):
 *  - a second site ("E2E Portal Fixture Site Two");
 *  - an OPEN, unlocked build on the first site, and an open build with scope locked on the second;
 *  - an active client-wide charter (the retainer).
 * Run with `--inspect <intake_id>` to print the filed request's tags and placement as one JSON
 * line instead of seeding (the Playwright spec reads it; Playwright has no database access).
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
export const FIXTURE_MEMBER_SESSION_TOKEN = 'e2e-portal-b1-fixture-member-session-token-'.padEnd(128, 'c');
export const FIXTURE_VIEWER_SESSION_TOKEN = 'e2e-portal-b1-fixture-viewer-session-token-'.padEnd(128, 'd');
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

export const SECOND_SITE_NAME = 'E2E Portal Fixture Site Two';
export const OPEN_BUILD_NAME = 'E2E: Open build (portal fixture)';
export const LOCKED_BUILD_NAME = 'E2E: Locked build (portal fixture)';
export const CHARTER_NAME = 'E2E: Marketing retainer (portal fixture)';

/** Second site, an open build, a locked build and an active charter (portal phase B slice 1). */
async function seedRequestFixtures(clientId: string, siteId: string) {
  const site2 = await findOrCreateSite(clientId, SECOND_SITE_NAME);

  // Find-or-update, never delete: requests filed by earlier e2e runs point at these projects.
  async function upsertBuild(name: string, siteId: string, locked: boolean) {
    const existing = await prisma.project.findFirst({ where: { name, client_id: clientId } });
    const data = {
      site_id: siteId,
      status: 'in_progress' as const,
      is_deleted: false,
      scope_locked: locked,
      scope_locked_at: locked ? new Date() : null,
    };
    if (existing) return prisma.project.update({ where: { id: existing.id }, data });
    return prisma.project.create({ data: { name, client_id: clientId, ...data } });
  }
  await upsertBuild(OPEN_BUILD_NAME, siteId, false);
  await upsertBuild(LOCKED_BUILD_NAME, site2.id, true);

  // Two more people on the client (a member and a viewer), each with a fixed session. Request
  // rate limits are per person, so the e2e spec spreads its filings across them. A viewer may
  // request too (spec 6.3), which the UI test relies on.
  for (const [email, name, role, token] of [
    ['member@e2e-portal-fixture.example', 'Mia Member', 'member', FIXTURE_MEMBER_SESSION_TOKEN],
    ['viewer@e2e-portal-fixture.example', 'Vic Viewer', 'viewer', FIXTURE_VIEWER_SESSION_TOKEN],
  ] as const) {
    const c = await prisma.clientContact.upsert({
      where: { client_id_email: { client_id: clientId, email } },
      create: { client_id: clientId, name, email, portal_role: role, can_initiate_work: role === 'member' },
      update: { name, portal_role: role, is_deleted: false },
    });
    await prisma.portalSession.deleteMany({ where: { session_token: token } });
    await prisma.portalSession.create({
      data: {
        token_type: 'client_session',
        entity_id: clientId,
        contact_id: c.id,
        session_token: token,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        consumed_at: new Date(),
        action: 'login',
        ip_address: '127.0.0.1',
      },
    });
  }

  // Requests filed by earlier runs would eat the per-person rate limit and the daily emergency
  // limit. Retire them without deleting: free the source_ref prefix the limits count on.
  // The daily emergency limit counts the emergency tag, so retire that too.
  await prisma.$executeRaw`UPDATE tasks SET source_ref = 'e2e-archived:' || id::text, is_deleted = true,
      tags = array_remove(tags, 'emergency')
    WHERE client_id = ${clientId}::uuid AND source_ref LIKE 'portal-intake:%'`;

  const owner = (await prisma.user.findFirst({ where: { email: 'bast@becomeindelible.com' } })) ?? (await prisma.user.findFirst());
  if (!owner) {
    console.log('  (no user found: skipping the charter fixture)');
    return;
  }
  const existing = await prisma.charter.findFirst({ where: { name: CHARTER_NAME, client_id: clientId } });
  const data = {
    status: 'active' as const,
    is_deleted: false,
    site_id: null,
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    end_date: null,
  };
  if (existing) await prisma.charter.update({ where: { id: existing.id }, data });
  else {
    await prisma.charter.create({
      data: { name: CHARTER_NAME, client_id: clientId, billing_period: 'monthly', created_by_id: owner.id, ...data },
    });
  }
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
      portal_role: 'owner',
    },
    update: { name: 'Jane Fixture', is_primary: true, portal_role: 'owner', can_initiate_work: true },
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
      requested_by_contact_id: contact.id,
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

  await seedRequestFixtures(client.id, site.id);

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

async function inspect(intakeId: string) {
  const task = await prisma.task.findFirst({
    where: { source_ref: `portal-intake:${intakeId}` },
    select: {
      id: true,
      title: true,
      client_title: true,
      priority: true,
      tags: true,
      is_retainer_work: true,
      is_support: true,
      project: { select: { name: true } },
      charter: { select: { name: true } },
      site: { select: { name: true } },
      client_intake: true,
    },
  });
  const waits = task ? await prisma.wait.findMany({ where: { task_id: task.id }, select: { template_key: true, state: true } }) : [];
  console.log(JSON.stringify({ task, waits }));
}

async function main() {
  const at = process.argv.indexOf('--inspect');
  if (at !== -1) {
    await inspect(process.argv[at + 1]);
    return;
  }
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
