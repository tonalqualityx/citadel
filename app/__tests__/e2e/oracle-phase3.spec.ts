import { test, expect } from '@playwright/test';

// Clarity Phase 3 — The Oracle Face. Fixtures come from
// scripts/seed-clarity-phase3-fixtures.ts (one demo arc with a task in every board column
// + a blocked task, plus two Today picks for today's UTC date). One sequential test per
// Mike's rate-limit note in oracle-fleet.spec.ts (auth is rate-limited to 10 req/min) —
// desktop layout, no-overflow, arc board drag, then a second small test for mobile.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase3';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
}

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('Oracle Phase 3 — desktop layout, arc board drag-move, screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  await page.goto('/oracle');
  await expect(page.getByTestId('oracle-header')).toBeVisible();
  await expect(page.getByTestId('today-section')).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Today section renders the seeded arc pick + note pick. (The arc pick's label also
  // appears a second time as a time-shape focus block — that's the layout logic working
  // as designed, so these assertions are scoped to the pick-card list specifically.)
  const todayList = page.getByTestId('today-list');
  await expect(todayList).toBeVisible();
  await expect(todayList.getByText('E2E Clarity Phase 3 Arc (demo)')).toBeVisible();
  await expect(todayList.getByText('E2E: quick note pick')).toBeVisible();

  // Time-shape track renders (even with an empty/near-empty calendar day, the component
  // itself must mount).
  await expect(page.getByTestId('time-shape')).toBeVisible();

  // --- corrected section-to-bucket mapping (fixtures from scripts/seed-oracle-fixtures.ts,
  // already resident in this dev DB alongside our Phase 3 fixtures) ---
  // In Motion = WORKING bucket ONLY: a running session belongs here.
  const inMotion = page.getByTestId('in-motion-section');
  await expect(inMotion).toBeVisible();
  await expect(inMotion.getByText('oracle-phase1-visualizer (Task A)')).toBeVisible();

  // Docked = IDLE bucket: an idle (parked) session belongs here, NOT in In Motion.
  const docked = page.getByTestId('docked-section');
  await expect(docked).toBeVisible();
  await expect(docked.getByText('msr-carwash-acquisition')).toBeVisible();
  await expect(inMotion.getByText('msr-carwash-acquisition')).toHaveCount(0);

  // Legacy hook-flagged needs_attention session (no manifest ask) belongs in Needs
  // Reshi's Answer column as a compact "session · legacy" card with Respond — NOT in
  // Docked, and NOT under its own warning-bordered SessionCard.
  const needsReshi = page.getByTestId('needs-reshi-section');
  await expect(needsReshi).toBeVisible();
  const answerColumn = page.getByTestId('needs-reshi-column-answer');
  const legacyCard = answerColumn.locator('[data-testid="ask-card"][data-source-label="session · legacy"]');
  await expect(legacyCard.filter({ hasText: 'grantibly-wright-b1' })).toBeVisible();
  await expect(legacyCard.getByRole('link', { name: /respond/i })).toBeVisible();
  await expect(docked.getByText('grantibly-wright-b1')).toHaveCount(0);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-oracle.png`, fullPage: true });

  // --- navigate to the arc board via the seeded pick's "Arc" primary action ---
  const arcCard = page.getByTestId('today-pick-card').filter({ hasText: 'E2E Clarity Phase 3 Arc (demo)' });
  await expect(arcCard).toBeVisible();
  await arcCard.getByRole('link', { name: 'Arc' }).click();
  await expect(page).toHaveURL(/\/oracle\/arcs\/.+/);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('arc-column-not_started')).toBeVisible();
  await expect(page.getByTestId('arc-column-in_progress')).toBeVisible();
  await expect(page.getByTestId('arc-column-review')).toBeVisible();
  await expect(page.getByTestId('arc-column-done')).toBeVisible();
  await expect(page.getByTestId('arc-progress-bar')).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-before-drag.png`, fullPage: true });

  // --- drag "E2E: not started task" from Not started into In progress ---
  const sourceCard = page
    .getByTestId('arc-column-not_started')
    .getByText('E2E: not started task', { exact: false });
  const targetColumn = page.getByTestId('arc-column-in_progress');

  const sourceBox = await sourceCard.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not resolve bounding boxes for the drag fixture — seed data missing?');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit's PointerSensor needs to clear its activation-distance constraint (5px)
  // before it starts tracking a drag — a handful of intermediate steps well past that.
  await page.mouse.move(startX + 20, startY, { steps: 5 });
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  // Persisted via the existing task PATCH endpoint; React Query invalidates the arc
  // detail query on success, so the card should reflow into In progress without a reload.
  await expect(
    page.getByTestId('arc-column-in_progress').getByText('E2E: not started task', { exact: false })
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByTestId('arc-column-not_started').getByText('E2E: not started task', { exact: false })
  ).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-after-drag.png`, fullPage: true });

  // Reload to confirm the move actually PERSISTED server-side, not just an optimistic
  // client-only reorder.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByTestId('arc-column-in_progress').getByText('E2E: not started task', { exact: false })
  ).toBeVisible();

  // Blocked task renders as a chip, not its own column.
  await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-testid^="arc-column-"]')).toHaveCount(4);
});

test('Oracle Phase 3 — mobile layout, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('oracle-header')).toBeVisible();
  await expect(page.getByTestId('today-section')).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-oracle.png`, fullPage: true });
});
