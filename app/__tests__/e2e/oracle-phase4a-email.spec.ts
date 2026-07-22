import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';

// Clarity Phase 4a — email on the Seeing Stone. Fixtures come from
// scripts/seed-clarity-phase4a-email-fixtures.ts (one open+urgent email_ask for the crisis
// strip, one open+non-urgent email_ask for the intake drawer, one due-soon task 3 real
// hours out for the due-soon row).
//
// Auth is rate-limited to 10 req/min (see lib/api/rate-limit.ts's authRateLimit, shared
// across every e2e spec file since it's IP-bucketed and Playwright's default config runs
// DIFFERENT spec files in parallel workers even when one file serializes its OWN tests —
// oracle-phase3.spec.ts's `mode: 'serial'` only serializes within that file). Running the
// full suite together pushed total concurrent logins over that limit and intermittently
// 401'd real logins. Fix: log in via the UI exactly ONCE in beforeAll, persist the
// resulting cookies as storageState, and reuse it across all four tests below — zero
// additional /api/auth/login calls from this file after the first.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase4a';
const APP_ROOT = path.resolve(__dirname, '..', '..');
const AUTH_STATE_PATH = `${SCREENSHOT_DIR}/.auth-state.json`;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE_PATH });

test.beforeAll(async ({ baseURL }) => {
  // Playwright's default outputDir cleanup can wipe this directory between runs — recreate
  // it defensively before writing storageState or any screenshot into it.
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase4a-email-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );

  const browser = await chromium.launch();
  // storageState explicitly undefined: @playwright/test's exported `chromium` auto-applies
  // this file's test.use({ storageState: AUTH_STATE_PATH }) to any newContext() call,
  // including this one — but THIS context is the one that logs in and CREATES that file,
  // so it must start with no storage state rather than trying to read a file that doesn't
  // exist yet.
  const context = await browser.newContext({ baseURL, storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
  await context.storageState({ path: AUTH_STATE_PATH });
  await browser.close();
});

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('Clarity Phase 4a — crisis strip renders with the seeded urgent ask, screenshot, then disappears on Handled', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const crisisStrip = page.getByTestId('crisis-strip');
  await expect(crisisStrip).toBeVisible();
  await expect(crisisStrip.getByText('E2E: Site is down (fixture)')).toBeVisible();
  await expect(crisisStrip.getByText(/From: Jane Client/)).toBeVisible();
  await expect(crisisStrip.getByText('Client reports the production site is returning 500s.')).toBeVisible();
  await expect(crisisStrip.getByText('client-blocking')).toBeVisible();

  const openEmailLink = crisisStrip.getByRole('link', { name: /open email/i });
  await expect(openEmailLink).toHaveAttribute(
    'href',
    'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-urgent'
  );
  await expect(openEmailLink).toHaveAttribute('target', '_blank');

  await assertNoHorizontalOverflow(page);
  // The one screenshot Bast's render review needs WITH the crisis strip visible.
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-oracle-crisis-visible.png`, fullPage: true });

  await crisisStrip.getByRole('button', { name: /handled/i }).click();

  // PATCH invalidates the waiting-on-me query; the strip re-fetches to empty and, per its
  // exception-based "zero pixels when calm" render rule, unmounts entirely.
  await expect(page.getByTestId('crisis-strip')).toHaveCount(0, { timeout: 10000 });
});

test('Clarity Phase 4a — intake drawer collapsed by default, expands to show the seeded ask', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const drawer = page.getByTestId('intake-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/📬 Intake · \d+/)).toBeVisible();
  await expect(page.getByTestId('intake-cards')).toHaveCount(0);

  await drawer.getByRole('button').click();

  const cards = page.getByTestId('intake-cards');
  await expect(cards).toBeVisible();
  const fixtureCard = cards.getByTestId('intake-card').filter({ hasText: 'E2E: Question about the proposal (fixture)' });
  await expect(fixtureCard).toBeVisible();
  await expect(fixtureCard.getByRole('link', { name: /open email/i })).toHaveAttribute(
    'href',
    'https://mail.google.com/mail/u/0/#inbox/e2e-fixture-intake'
  );
  await expect(fixtureCard.getByRole('button', { name: /^create$/i })).toBeVisible();
  await expect(fixtureCard.getByRole('button', { name: /create \+ open/i })).toBeVisible();
  await expect(fixtureCard.getByRole('button', { name: /dismiss/i })).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test('Clarity Phase 4a — due-soon row renders the fixture task, add-to-Today moves it into Today', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const dueSoonRow = page.getByTestId('due-soon-row');
  await expect(dueSoonRow).toBeVisible();
  const fixtureItem = dueSoonRow.getByTestId('due-soon-item').filter({
    hasText: 'E2E: due-soon task (Clarity Phase 4a fixture)',
  });
  await expect(fixtureItem).toBeVisible();

  await fixtureItem.getByRole('button', { name: /add.*to today/i }).click();

  // Add-to-Today invalidates BOTH the today picks list and the due-soon query (shared
  // 'today' key prefix) — the fixture disappears from due-soon and shows up in Today.
  await expect(
    page.getByTestId('due-soon-row').getByText('E2E: due-soon task (Clarity Phase 4a fixture)')
  ).toHaveCount(0, { timeout: 10000 });
  await expect(
    page.getByTestId('today-list').getByText('E2E: due-soon task (Clarity Phase 4a fixture)')
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);

  // Clean up the pick this test just created — otherwise every run of this test leaves
  // another uncompleted today_pick behind (the seed script recreates the underlying TASK
  // fresh each run, so re-running never dedupes against it), and enough accumulated runs
  // silently fill the WIP cap (5) and 409 a LATER run's add-to-Today click. Delete it via
  // the same authenticated cookies the page already carries.
  const picksResponse = await page.request.get('/api/today');
  const picksBody = await picksResponse.json();
  const createdPick = picksBody.picks.find(
    (p: { task?: { title?: string } }) => p.task?.title === 'E2E: due-soon task (Clarity Phase 4a fixture)'
  );
  if (createdPick) {
    await page.request.delete(`/api/today/${createdPick.id}`);
  }
});

test('Clarity Phase 4a — mobile: crisis strip full-width, never collapsed, no horizontal overflow', async ({
  page,
}) => {
  // Re-seed: the first test in this file marked the urgent fixture Handled, so re-run the
  // seed to bring it back to open+urgent for this independent mobile check.
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase4a-email-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const crisisStrip = page.getByTestId('crisis-strip');
  await expect(crisisStrip).toBeVisible();
  const box = await crisisStrip.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  // "Full-width" — the strip spans essentially the full content column, never a collapsed
  // summary line the way the intake drawer or Needs Reshi queues do on mobile.
  expect(box!.width).toBeGreaterThan((viewport!.width - 32) * 0.85);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-oracle-crisis-visible.png`, fullPage: true });
});
