import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Clarity Phase 4a — email on the Seeing Stone. Fixtures come from
// scripts/seed-clarity-phase4a-email-fixtures.ts (one open+urgent email_ask for the crisis
// strip, one open+non-urgent email_ask for the intake drawer, one due-soon task 3 real
// hours out for the due-soon row).
//
// Auth is rate-limited to 10 req/min (see lib/api/rate-limit.ts's authRateLimit, shared
// across every e2e spec file since it's IP-bucketed). Clarity Phase 4c replaced this
// file's own per-file beforeAll login with ONE shared admin login for the entire suite
// (Playwright globalSetup — see global-setup.ts's own header for the full contention
// story) — every spec file now just points storageState at that one shared file.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase4a';
const APP_ROOT = path.resolve(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeAll(async () => {
  // Playwright's default outputDir cleanup can wipe this directory between runs — recreate
  // it defensively before writing any screenshot into it.
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase4a-email-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
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
  // Generous timeout on this FIRST assertion specifically: under the full suite's 10
  // concurrent workers sharing one dev server process, the initial /oracle
  // compile+data-fetch can occasionally run past the 5s default — every assertion after
  // this one is on already-rendered content, so only this one needs the margin.
  await expect(crisisStrip).toBeVisible({ timeout: 15000 });
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

test('Clarity Phase 4a — intake trigger chip in the header opens a drawer showing the seeded ask', async ({ page }) => {
  // Clarity Phase 4b relocated Intake out of the main column into a compact header trigger
  // (top right, under the week capacity strip) that opens a slide-over drawer — this test
  // updated to match (was an in-page expandable section under Needs Reshi).
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const trigger = page.getByTestId('intake-drawer-trigger');
  await expect(trigger).toBeVisible({ timeout: 15000 });
  // Clarity Phase 6 replaced the single "📬 Intake · N" summary with a three-lane count
  // chip ("📬 N · 🤝 N · 💰 N", zero-count lanes hidden) — this fixture's own ask is
  // general-lane (no intent set), so at minimum the 📬 count is present. Loosely matched
  // (not an exact count) since other fixtures/seed scripts share this same intake surface.
  await expect(trigger).toHaveText(/📬\s*\d+/);
  // The drawer lazy-mounts on first open (see IntakeDrawer.tsx) — not in the DOM at all
  // beforehand, rather than present-but-closed.
  await expect(page.getByTestId('intake-drawer')).toHaveCount(0);

  await trigger.click();

  const drawer = page.getByTestId('intake-drawer');
  await expect(drawer).toHaveAttribute('data-state', 'open');
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
  await expect(fixtureCard.getByRole('button', { name: /^archive$/i })).toBeVisible();
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
  await expect(dueSoonRow).toBeVisible({ timeout: 15000 });
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
  await expect(crisisStrip).toBeVisible({ timeout: 15000 });
  const box = await crisisStrip.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  // "Full-width" — the strip spans essentially the full content column, never a collapsed
  // summary line the way the intake drawer or Needs Reshi queues do on mobile.
  expect(box!.width).toBeGreaterThan((viewport!.width - 32) * 0.85);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-oracle-crisis-visible.png`, fullPage: true });
});
