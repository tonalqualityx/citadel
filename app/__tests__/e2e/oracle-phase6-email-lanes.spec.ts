import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Clarity Phase 6 — email lanes & calendar intents. Fixtures come from
// scripts/seed-clarity-phase6-lane-fixtures.ts: one open+non-urgent email_ask per lane
// (general/meeting/sales) — the meeting one carries a HIGH-CONFIDENCE proposed_event_at (2
// real hours out), the ONLY ask in the DB whose Add-to-calendar button should ever appear.
// Meeting/sales lanes are exclusively populated by this fixture (no other seed script sets
// `intent`); the general lane may also carry other phases' fixtures (their asks default to
// null intent = general), so general-lane assertions here stay message-filtered rather than
// count-exact, same discipline oracle-phase4a-email.spec.ts already uses for the shared
// intake surface.
//
// Auth is rate-limited to 10 req/min (see lib/api/rate-limit.ts's authRateLimit) — this
// suite uses the ONE shared admin login from Playwright's globalSetup (see
// global-setup.ts's own header), same as every other Oracle e2e file since Phase 4c.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase6';
const APP_ROOT = path.resolve(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

function reseed() {
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase6-lane-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
}

test.beforeAll(async () => {
  // Playwright's default outputDir cleanup can wipe this directory between runs — recreate
  // it defensively before writing any screenshot into it.
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  reseed();
});

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('Clarity Phase 6 — trigger chip shows three lane counts, drawer groups Meeting/Sales/General, screenshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const trigger = page.getByTestId('intake-drawer-trigger');
  await expect(trigger).toBeVisible({ timeout: 15000 });
  // General lane may carry other fixtures too (see this file's header note) — assert the
  // meeting/sales counts exactly (exclusively ours) and that the general emoji is present
  // with at least our one seeded item, rather than an exact total.
  await expect(trigger).toHaveText(/📬 \d+/);
  await expect(trigger).toHaveText(/🤝 1/);
  await expect(trigger).toHaveText(/💰 1/);

  await trigger.click();
  const drawer = page.getByTestId('intake-drawer');
  await expect(drawer).toHaveAttribute('data-state', 'open');

  // Lane headers render in Meeting, Sales, General order, each only when non-empty.
  const cardsContainer = page.getByTestId('intake-cards');
  const laneHeadings = cardsContainer.locator('h3');
  await expect(laneHeadings).toHaveText(['Meeting', 'Sales', 'General']);

  const meetingLane = page.getByTestId('intake-lane-meeting');
  const salesLane = page.getByTestId('intake-lane-sales');
  const generalLane = page.getByTestId('intake-lane-general');
  await expect(meetingLane).toBeVisible();
  await expect(salesLane).toBeVisible();
  await expect(generalLane).toBeVisible();

  const meetingCard = meetingLane.getByTestId('intake-card').filter({
    hasText: 'E2E: Can we meet Thursday? (Clarity Phase 6 fixture)',
  });
  const salesCard = salesLane.getByTestId('intake-card').filter({
    hasText: 'E2E: Interested in your services (Clarity Phase 6 fixture)',
  });
  const generalCard = generalLane.getByTestId('intake-card').filter({
    hasText: 'E2E: General lane question (Clarity Phase 6 fixture)',
  });
  await expect(meetingCard).toBeVisible();
  await expect(salesCard).toBeVisible();
  await expect(generalCard).toBeVisible();

  // Sales cards use lead-flavored copy.
  await expect(salesCard.getByRole('button', { name: /^create lead quest$/i })).toBeVisible();
  await expect(salesCard.getByRole('button', { name: /create lead quest \+ open/i })).toBeVisible();
  // General card keeps the plain copy.
  await expect(generalCard.getByRole('button', { name: /^create$/i })).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-oracle-intake-three-lanes.png`, fullPage: true });
});

test('Clarity Phase 6 — Add to calendar appears ONLY on the meeting ask with a parsed date, click flips to queued', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('intake-drawer-trigger').click();
  const drawer = page.getByTestId('intake-drawer');
  await expect(drawer).toHaveAttribute('data-state', 'open');

  const meetingCard = page
    .getByTestId('intake-lane-meeting')
    .getByTestId('intake-card')
    .filter({ hasText: 'E2E: Can we meet Thursday? (Clarity Phase 6 fixture)' });
  await expect(meetingCard).toBeVisible();

  // Prominent parsed time + the button — only this card has proposed_event_at set.
  await expect(meetingCard.getByTestId('meeting-proposed-time')).toHaveText(/📅 .+ · .+ (AM|PM) · 45m/);
  const addButton = meetingCard.getByTestId('add-to-calendar-button');
  await expect(addButton).toBeVisible();

  // Neither the sales nor the general card (no proposed_event_at at all) shows any
  // calendar affordance — never a disabled button, no affordance whatsoever.
  const salesCard = page
    .getByTestId('intake-lane-sales')
    .getByTestId('intake-card')
    .filter({ hasText: 'E2E: Interested in your services (Clarity Phase 6 fixture)' });
  const generalCard = page
    .getByTestId('intake-lane-general')
    .getByTestId('intake-card')
    .filter({ hasText: 'E2E: General lane question (Clarity Phase 6 fixture)' });
  await expect(salesCard.getByTestId('meeting-event-block')).toHaveCount(0);
  await expect(generalCard.getByTestId('meeting-event-block')).toHaveCount(0);

  await addButton.click();

  // PATCH calendar_requested=true invalidates waiting-on-me; the button becomes the
  // "queued for calendar" label, not a disabled button.
  await expect(meetingCard.getByTestId('calendar-queued-label')).toHaveText('queued for calendar ⏳', {
    timeout: 10000,
  });
  await expect(meetingCard.getByTestId('add-to-calendar-button')).toHaveCount(0);
});

test('Clarity Phase 6 — mobile: lanes stack, chip counts stay visible, no horizontal overflow, screenshot', async ({
  page,
}) => {
  // Re-seed: the previous test flipped the meeting fixture's calendar_requested to true —
  // bring it back to the clean 'add' state for this independent mobile check.
  reseed();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const trigger = page.getByTestId('intake-drawer-trigger');
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await expect(trigger).toHaveText(/🤝 1/);
  await expect(trigger).toHaveText(/💰 1/);

  await trigger.click();
  await expect(page.getByTestId('intake-drawer')).toHaveAttribute('data-state', 'open');

  const meetingLane = page.getByTestId('intake-lane-meeting');
  const salesLane = page.getByTestId('intake-lane-sales');
  const generalLane = page.getByTestId('intake-lane-general');
  await expect(meetingLane).toBeVisible();
  await expect(salesLane).toBeVisible();
  await expect(generalLane).toBeVisible();

  // Stacked, not side-by-side: the Sales lane's top sits below the Meeting lane's bottom.
  const meetingBox = await meetingLane.boundingBox();
  const salesBox = await salesLane.boundingBox();
  expect(meetingBox).not.toBeNull();
  expect(salesBox).not.toBeNull();
  expect(salesBox!.y).toBeGreaterThanOrEqual(meetingBox!.y + meetingBox!.height - 1);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-oracle-intake-three-lanes.png`, fullPage: true });
});
