import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// Portal v2 phase 1 — client account home. Fixtures come from
// scripts/seed-portal-v2-phase1-fixtures.ts (a populated client + a deliberately empty client).
//
// Unlike every other e2e spec in this suite, this one does NOT use the shared admin
// storageState — the client portal has its own, entirely separate auth cookie (`client_session`),
// issued by a magic-link flow that's already covered end-to-end at the unit level
// (lib/services/__tests__/client-auth.test.ts, app/api/portal/login/**/__tests__). Rather than
// re-driving a real email-link redemption here (no test inbox in this suite), the fixture seed
// writes a PortalSession row with a known, fixed session_token and this spec injects it directly
// as the browser cookie via context.addCookies — the same "seed the credential" approach the
// admin-side globalSetup takes with the UI login, just at the cookie layer instead of the UI
// layer since there's no portal login form to submit against in a headless run.
const APP_ROOT = path.resolve(__dirname, '..', '..');

// Must match scripts/seed-portal-v2-phase1-fixtures.ts's exported constants exactly.
const FIXTURE_SESSION_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');
const FIXTURE_EMPTY_SESSION_TOKEN = 'e2e-portal-v2-phase1-fixture-empty-session-token-'.padEnd(128, 'b');

test.beforeAll(() => {
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-portal-v2-phase1-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
});

async function loginAs(context: import('@playwright/test').BrowserContext, sessionToken: string) {
  await context.addCookies([
    {
      name: 'client_session',
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

// Serial, not parallel: every test in this file shares the SAME fixture rows (fixed client/task/
// session-token names, re-seeded in beforeAll), and the "approve" test mutates them. Running in
// parallel (this config's fullyParallel default) races the re-seed against a concurrently-running
// test's assertions — the same class of contention `oracle-phase4a-email.spec.ts` documents for
// shared fixtures/state in this suite.
test.describe.configure({ mode: 'serial' });

test.describe('Portal v2 phase 1 — /portal/home', () => {
  test('renders pending approvals, projects, billing, stats, and activity for a populated client', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/home');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Welcome back,', { exact: false })).toBeVisible();

    // Pending approvals — the fixture article and task.
    await expect(page.getByText('E2E: Q3 Recap (portal fixture)')).toBeVisible();
    await expect(page.getByText('E2E: Homepage refresh (portal fixture)')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View preview' })).toBeVisible();

    // Active project + open balance.
    await expect(page.getByText('E2E: Site relaunch (portal fixture)')).toBeVisible();
    await expect(page.getByText('$1,500')).toBeVisible();

    // Stats tile (leads headline + site tile).
    await expect(page.getByText('14 leads', { exact: false })).toBeVisible();
    await expect(page.getByText('E2E Portal Fixture Site')).toBeVisible();

    // Recent activity — the completed task and the published article.
    await expect(page.getByText('E2E: Fixed broken link (portal fixture)')).toBeVisible();
    await expect(page.getByText('E2E: New Blog Post (portal fixture)')).toBeVisible();

    await context.close();
  });

  test('shows quiet placeholders (no fake data) for a client with nothing pending and no stats', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_EMPTY_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/home');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Nothing is waiting on your review right now.', { exact: false })).toBeVisible();
    await expect(page.getByText('No stats yet', { exact: false })).toBeVisible();
    await expect(page.getByText('No active projects right now.')).toBeVisible();
    await expect(page.getByText('Nothing outstanding right now.')).toBeVisible();

    await context.close();
  });

  test('approving a pending task via the session flow moves it out of the pending list', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/home');
    await page.waitForLoadState('networkidle');

    const taskCard = page.getByText('E2E: Homepage refresh (portal fixture)').locator('..').locator('..');
    await expect(taskCard.getByRole('button', { name: 'Approve' })).toBeVisible();
    await taskCard.getByRole('button', { name: 'Approve' }).click();

    // The page refetches after a successful approve — the task drops out of "waiting on your
    // review" (it's no longer client_approved_at: null) and shows up in Recent activity instead.
    // (The plain title text is NOT a safe "gone" signal on its own — it legitimately reappears
    // in the activity feed as "You approved: <title>".)
    await expect(page.getByRole('button', { name: 'Approve' })).toBeHidden({ timeout: 10000 });
    await expect(
      page.getByText(/You approved: E2E: Homepage refresh \(portal fixture\)/)
    ).toBeVisible();

    await context.close();
  });

  test('redirects to /portal/login when there is no session', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/portal/home');
    await page.waitForURL(/\/portal\/login/, { timeout: 10000 });

    await context.close();
  });
});

// Portal MVP A5: Needs-from-you heading, project page, history and booking. Same fixtures; the
// populated client's owner session sees the fixture project and its completed task and article.
test.describe('Portal MVP A5 - project page, history, booking', () => {
  test('home leads with Needs from you and links each project to its page', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/home');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Needs from you' })).toBeVisible();

    await page.getByRole('link', { name: /E2E: Site relaunch \(portal fixture\)/ }).click();
    await page.waitForURL(/\/portal\/projects\//);
    await expect(page.getByRole('heading', { name: 'E2E: Site relaunch (portal fixture)' })).toBeVisible();
    await expect(page.getByText('What we need from you')).toBeVisible();

    await context.close();
  });

  test('project page answers with a not-found message for an id the person cannot see', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/projects/00000000-0000-4000-8000-000000000000');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('We could not find that project')).toBeVisible();

    await context.close();
  });

  test('history lists completed work and published articles', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/history');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E: Fixed broken link (portal fixture)')).toBeVisible();
    await expect(page.getByText('E2E: New Blog Post (portal fixture)')).toBeVisible();

    await context.close();
  });

  test('book a meeting shows the three meeting types', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, FIXTURE_SESSION_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/book');
    await page.waitForLoadState('networkidle');
    for (const name of ['Consult', 'Marketing', 'Questions']) {
      await expect(page.getByRole('radio', { name: new RegExp(name) })).toBeVisible();
    }
    // A type with no booking URL yet falls back to the support email line.
    await page.getByRole('radio', { name: /Consult/ }).click();
    await expect(page.getByText('Online booking for this kind of meeting is not ready yet.', { exact: false })).toBeVisible();

    await context.close();
  });
});
