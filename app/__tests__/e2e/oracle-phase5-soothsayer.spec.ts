import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Clarity Phase 5 — The Soothsayer + Needs Reshi rework, PLUS two coordinator-added
// arc-board features folded into this same phase before it froze ("+ Quest" quick-add,
// the back-to-Seeing-Stone link). Fixtures come from
// scripts/seed-clarity-phase5-fixtures.ts. Clarity Phase 4c replaced this file's own
// per-file beforeAll login with ONE shared admin login for the entire suite (Playwright
// globalSetup — see global-setup.ts), fixing the shared, IP-bucketed authRateLimit (10
// req/min) contention that kept recurring as more Oracle e2e files accumulated.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase5';
const APP_ROOT = path.resolve(__dirname, '..', '..');

const UNPLANNED_ARC_NAME = 'E2E: Clarity Phase 5 unplanned arc (assign-to-day)';
const SNOOZE_ARC_NAME = 'E2E: Clarity Phase 5 unplanned arc (snooze target)';
const ATTENTION_ARC_NAME = 'E2E: Clarity Phase 5 attention-linked arc';
const CLIENT_NAME = 'E2E Clarity Phase 5 Client';
const REVIEW_TASK_TITLE = 'E2E: Clarity Phase 5 review task (client group)';
const WAITING_ASK_TEXT = 'E2E: approve the Phase 5 rollout plan?';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase5-fixtures.ts',
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

test('Clarity Phase 5 — Soothsayer renders 7 day columns + the unplanned section, desktop screenshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle/soothsayer');
  await page.waitForLoadState('networkidle');

  const columns = page.getByTestId('soothsayer-day-columns');
  await expect(columns).toBeVisible({ timeout: 15000 });
  await expect(columns.getByTestId('soothsayer-day-column')).toHaveCount(7);

  const todayColumn = columns.locator('[data-testid="soothsayer-day-column"][data-is-today]');
  await expect(todayColumn).toHaveCount(1);
  await expect(todayColumn.getByText('Today')).toBeVisible();
  // The attention-linked arc was seeded with a today_pick — it should render in today's column.
  await expect(todayColumn.getByText(ATTENTION_ARC_NAME)).toBeVisible();

  const unplanned = page.getByTestId('soothsayer-unplanned-section');
  await expect(unplanned).toBeVisible();
  await expect(unplanned.getByTestId('unplanned-arc-row').filter({ hasText: UNPLANNED_ARC_NAME })).toBeVisible();
  await expect(unplanned.getByTestId('unplanned-session-row').filter({ hasText: 'E2E: unplanned live session' })).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-soothsayer.png`, fullPage: true });
});

test('Clarity Phase 5 — Soothsayer: assign an unplanned arc to a day, persists through reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle/soothsayer');
  await page.waitForLoadState('networkidle');

  const unplanned = page.getByTestId('soothsayer-unplanned-section');
  const arcRow = unplanned.getByTestId('unplanned-arc-row').filter({ hasText: UNPLANNED_ARC_NAME });
  await expect(arcRow).toBeVisible();

  // Assigns to the 3rd day column (2 days out), not Today — Today's 5-pick WIP cap is a
  // SHARED resource across every e2e file that seeds/adds a pick for "today" (phase3's own
  // 2 fixture picks + phase4b's board-drag pick + this file's own attention-arc pick already
  // account for 4 of the 5 slots); a future day starts empty and proves the same
  // assign-persists behavior without racing that shared budget.
  const columns = page.getByTestId('soothsayer-day-columns');
  const targetColumn = columns.getByTestId('soothsayer-day-column').nth(2);
  const targetDate = await targetColumn.getAttribute('data-date');
  await arcRow.getByLabel(`Assign ${UNPLANNED_ARC_NAME} to a day`).selectOption(targetDate!);

  // Disappears from "No day assigned" without a reload.
  await expect(unplanned.getByTestId('unplanned-arc-row').filter({ hasText: UNPLANNED_ARC_NAME })).toHaveCount(0, {
    timeout: 10000,
  });

  // Persisted server-side, not just optimistic — reload and confirm it now renders in that
  // exact day's column.
  await page.reload();
  await page.waitForLoadState('networkidle');
  const reloadedTargetColumn = page.locator(`[data-testid="soothsayer-day-column"][data-date="${targetDate}"]`);
  await expect(reloadedTargetColumn.getByText(UNPLANNED_ARC_NAME)).toBeVisible({ timeout: 10000 });
});

test('Clarity Phase 5 — Soothsayer: snoozing an arc hides it from No day assigned and shows it in Snoozed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle/soothsayer');
  await page.waitForLoadState('networkidle');

  const unplanned = page.getByTestId('soothsayer-unplanned-section');
  const arcRow = unplanned.getByTestId('unplanned-arc-row').filter({ hasText: SNOOZE_ARC_NAME });
  await expect(arcRow).toBeVisible();

  await arcRow.getByTestId('snooze-menu-trigger').click();
  await arcRow.getByTestId('snooze-option-1d').click();

  await expect(unplanned.getByTestId('unplanned-arc-row').filter({ hasText: SNOOZE_ARC_NAME })).toHaveCount(0, {
    timeout: 10000,
  });

  const snoozedToggle = page.getByRole('button', { name: /^snoozed/i });
  await expect(snoozedToggle).toBeVisible();
  await snoozedToggle.click();

  const snoozedRow = page
    .getByTestId('soothsayer-snoozed-list')
    .getByTestId('snoozed-arc-row')
    .filter({ hasText: SNOOZE_ARC_NAME });
  await expect(snoozedRow).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test('Clarity Phase 5 — Soothsayer: mobile, no horizontal overflow, screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle/soothsayer');
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('soothsayer-day-columns')).toBeVisible({ timeout: 15000 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-soothsayer.png`, fullPage: true });
});

test('Clarity Phase 5 — Seeing Stone: merged "Waiting on you" queue renders a declared ask with its type chip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const waitingColumn = page.getByTestId('needs-reshi-column-waiting');
  await expect(waitingColumn).toBeVisible({ timeout: 15000 });
  const waitingCard = waitingColumn.locator('[data-testid="ask-card"]').filter({ hasText: WAITING_ASK_TEXT });
  await expect(waitingCard).toBeVisible();
  await expect(waitingCard.getByTestId('ask-card-queue-type')).toHaveText(/decision/i);

  // Decide/Answer no longer exist as separate columns.
  await expect(page.getByTestId('needs-reshi-column-decide')).toHaveCount(0);
  await expect(page.getByTestId('needs-reshi-column-answer')).toHaveCount(0);
});

test('Clarity Phase 5 — Seeing Stone: Review groups by client, expanding shows the individual item', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const reviewColumn = page.getByTestId('needs-reshi-column-review');
  await expect(reviewColumn).toBeVisible({ timeout: 15000 });

  const clientGroup = reviewColumn.getByTestId('review-group-card').filter({ hasText: CLIENT_NAME });
  await expect(clientGroup).toBeVisible();
  // Collapsed by default — the individual item isn't reachable yet.
  await expect(clientGroup.locator('[data-testid="ask-card"]')).toHaveCount(0);

  await clientGroup.getByRole('button').first().click();
  const reviewItem = clientGroup.locator('[data-testid="ask-card"]').filter({ hasText: REVIEW_TASK_TITLE });
  await expect(reviewItem).toBeVisible();

  await assertNoHorizontalOverflow(page);
});

test('Clarity Phase 5 — Seeing Stone: attention dot appears on a linked arc\'s Today pick card, screenshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const arcPickCard = page.getByTestId('today-pick-card').filter({ hasText: ATTENTION_ARC_NAME });
  await expect(arcPickCard).toBeVisible({ timeout: 15000 });
  await expect(arcPickCard.getByTestId('arc-attention-dot')).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-seeing-stone-post-rework.png`, fullPage: true });
});

test('Clarity Phase 5 (coordinator addition) — arc board: back-to-Seeing-Stone link navigates to /oracle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const arcPickCard = page.getByTestId('today-pick-card').filter({ hasText: ATTENTION_ARC_NAME });
  await expect(arcPickCard).toBeVisible({ timeout: 15000 });
  await arcPickCard.getByRole('link', { name: 'Arc' }).click();
  await expect(page).toHaveURL(/\/oracle\/arcs\/.+/);
  await page.waitForLoadState('networkidle');

  const backLink = page.getByTestId('arc-board-back-link');
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveText(/Seeing Stone/);
  await backLink.click();
  await expect(page).toHaveURL(/\/oracle$/);
});

test('Clarity Phase 5 (coordinator addition) — arc board: add a quest via the board, persists through reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const arcPickCard = page.getByTestId('today-pick-card').filter({ hasText: ATTENTION_ARC_NAME });
  await expect(arcPickCard).toBeVisible({ timeout: 15000 });
  await arcPickCard.getByRole('link', { name: 'Arc' }).click();
  await expect(page).toHaveURL(/\/oracle\/arcs\/.+/);
  await page.waitForLoadState('networkidle');

  const questTitle = `E2E: quick-add quest ${Date.now()}`;
  await page.getByTestId('arc-board-add-quest-toggle').click();
  await page.getByTestId('arc-board-add-quest-title').fill(questTitle);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-add-quest.png`, fullPage: true });
  await page.getByTestId('arc-board-add-quest-form').getByRole('button', { name: /^save$/i }).click();

  // Appears in the To do (not_started) column without a page reload.
  const notStartedColumn = page.getByTestId('arc-column-not_started');
  await expect(notStartedColumn.getByText(questTitle)).toBeVisible({ timeout: 10000 });

  // Persisted server-side, not just optimistic.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('arc-column-not_started').getByText(questTitle)).toBeVisible({ timeout: 10000 });
});
