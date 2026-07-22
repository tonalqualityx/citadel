import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';

// Clarity Phase 4b — Quest Peek View + Today board drag + relocated Intake. Mike's ruling:
// every quest/task-opening action on the Seeing Stone opens a slide-over peek drawer
// on-page instead of navigating away; the Today board lens gets a real persisted Doing
// column with drag-and-drop; Intake moves out of the main column into a compact header
// trigger that opens its own slide-over drawer. Fixtures come from
// scripts/seed-clarity-phase4b-peek-fixtures.ts (a Review-queue task, a fresh "To do"
// Today board task, and two intake email_ask fixtures for the Archive/note-persistence
// coverage). Auth is rate-limited to 10 req/min shared IP-wide across every e2e spec file
// (see oracle-phase4a-email.spec.ts's own note) — this file logs in via the UI exactly
// once in beforeAll and reuses the resulting storageState across every test.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase4b';
const APP_ROOT = path.resolve(__dirname, '..', '..');
const AUTH_STATE_PATH = `${SCREENSHOT_DIR}/.auth-state.json`;
const REVIEW_TASK_TITLE = 'E2E: review queue task (Clarity Phase 4b fixture)';
const BOARD_TASK_TITLE = 'E2E: board drag task (Clarity Phase 4b fixture)';
const INTAKE_ARCHIVE_SUBJECT = 'E2E: intake archive fixture (Clarity Phase 4b)';
const INTAKE_NOTE_SUBJECT = 'E2E: intake note fixture (Clarity Phase 4b)';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: AUTH_STATE_PATH });

test.beforeAll(async ({ baseURL }) => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase4b-peek-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );

  const browser = await chromium.launch();
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

async function dragTo(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator
) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not resolve bounding boxes for the drag — seed data missing?');
  }
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit's PointerSensor needs to clear its 5px activation-distance constraint first.
  await page.mouse.move(startX + 20, startY, { steps: 5 });
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

test('Clarity Phase 4b — Review card opens the quest peek on-page, Escape closes it, View in Fullscreen navigates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const reviewColumn = page.getByTestId('needs-reshi-column-review');
  await expect(reviewColumn).toBeVisible({ timeout: 15000 });
  const reviewCard = reviewColumn.locator('[data-testid="ask-card"]').filter({ hasText: REVIEW_TASK_TITLE });
  await expect(reviewCard).toBeVisible();

  await reviewCard.getByRole('button', { name: /open review/i }).click();

  // The peek renders as a dialog ON THIS PAGE — URL never changes.
  const peek = page.getByTestId('task-peek-drawer');
  await expect(peek).toBeVisible();
  await expect(peek.getByText(REVIEW_TASK_TITLE)).toBeVisible();
  await expect(page).toHaveURL(/\/oracle$/);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-oracle-peek-open.png`, fullPage: true });

  // Escape closes it. The drawer is forceMount + CSS-transform animated (never fully
  // unmounts, slides via `transform: translateX(100%)` — see globals.css's
  // `.drawer-content-right`), so "closed" is asserted via the state Radix stamps on the
  // element rather than DOM presence/generic visibility.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-peek-drawer')).toHaveAttribute('data-state', 'closed');
  await expect(page).toHaveURL(/\/oracle$/);

  // Reopen, then "View in Fullscreen" navigates deliberately to the quest's full page.
  await reviewCard.getByRole('button', { name: /open review/i }).click();
  await expect(page.getByTestId('task-peek-drawer')).toBeVisible();
  await page.getByRole('link', { name: /view in fullscreen/i }).click();
  await expect(page).toHaveURL(/\/tasks\/.+/);
});

test('Clarity Phase 4b — mobile: peek renders as a slide-over, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const reviewColumn = page.getByTestId('needs-reshi-column-review');
  await expect(reviewColumn).toBeVisible({ timeout: 15000 });
  // Mobile hard rule: queues collapse to counts, tap to expand.
  await reviewColumn.getByRole('button').first().click();
  const reviewCard = reviewColumn.locator('[data-testid="ask-card"]').filter({ hasText: REVIEW_TASK_TITLE });
  await expect(reviewCard).toBeVisible();

  await reviewCard.getByRole('button', { name: /open review/i }).click();
  const peek = page.getByTestId('task-peek-drawer');
  await expect(peek).toBeVisible();
  await expect(page).toHaveURL(/\/oracle$/);
  // Wait for the task fetch to resolve (not the loading spinner) before the review screenshot.
  await expect(peek.getByText(REVIEW_TASK_TITLE)).toBeVisible({ timeout: 10000 });

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-oracle-peek-open.png`, fullPage: true });

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-peek-drawer')).toHaveAttribute('data-state', 'closed');
});

test('Clarity Phase 4b — Today board lens: drag a pick To do -> Doing -> Done, persists across reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Board view' }).click();
  const board = page.getByTestId('today-board');
  await expect(board).toBeVisible();

  const todoColumn = page.getByTestId('today-board-column-todo');
  const doingColumn = page.getByTestId('today-board-column-doing');
  const doneColumn = page.getByTestId('today-board-column-done');

  const cardInTodo = todoColumn.getByText(BOARD_TASK_TITLE, { exact: false });
  await expect(cardInTodo).toBeVisible();

  // --- To do -> Doing ---
  await dragTo(page, cardInTodo, doingColumn);
  await expect(doingColumn.getByText(BOARD_TASK_TITLE, { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(todoColumn.getByText(BOARD_TASK_TITLE, { exact: false })).toHaveCount(0);

  // dnd-kit's default DragOverlay drop animation takes ~250ms to settle — wait it out so
  // the screenshot doesn't catch the ghost card mid-animation.
  await page.waitForTimeout(400);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-today-board-doing.png`, fullPage: true });

  // --- Doing -> Done ---
  const cardInDoing = doingColumn.getByText(BOARD_TASK_TITLE, { exact: false });
  await dragTo(page, cardInDoing, doneColumn);
  await expect(doneColumn.getByText(BOARD_TASK_TITLE, { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(doingColumn.getByText(BOARD_TASK_TITLE, { exact: false })).toHaveCount(0);

  // Persisted server-side, not just an optimistic client-only reorder — reload and
  // re-enter the board lens (lens choice itself is session-local, not persisted).
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(
    page.getByTestId('today-board-column-done').getByText(BOARD_TASK_TITLE, { exact: false })
  ).toBeVisible({ timeout: 10000 });
});

test('Clarity Phase 4b — Intake relocated to the header: trigger chip, drawer opens, Archive removes the item', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  // The trigger lives in the header (top right, under the week capacity strip) — nothing
  // intake-related renders in the main column anymore.
  const trigger = page.getByTestId('intake-drawer-trigger');
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await expect(trigger).toHaveText(/📬 Intake · \d+/);
  // The drawer lazy-mounts on first open (see IntakeDrawer.tsx) — not in the DOM at all
  // beforehand, rather than present-but-closed.
  await expect(page.getByTestId('intake-drawer')).toHaveCount(0);

  await trigger.click();
  const drawer = page.getByTestId('intake-drawer');
  await expect(drawer).toHaveAttribute('data-state', 'open');

  const archiveCard = drawer.getByTestId('intake-card').filter({ hasText: INTAKE_ARCHIVE_SUBJECT });
  await expect(archiveCard).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-oracle-intake-drawer-open.png`, fullPage: true });

  await archiveCard.getByRole('button', { name: /^archive$/i }).click();

  // state=archive_requested drops the ask out of the intake query (state=open only) —
  // it disappears from the list, resolved from Mike's perspective, without a reload.
  await expect(drawer.getByTestId('intake-card').filter({ hasText: INTAKE_ARCHIVE_SUBJECT })).toHaveCount(0, {
    timeout: 10000,
  });

  await assertNoHorizontalOverflow(page);
});

test('Clarity Phase 4b — Intake: a training note persists across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('intake-drawer-trigger').click();
  const drawer = page.getByTestId('intake-drawer');
  await expect(drawer).toHaveAttribute('data-state', 'open');

  const noteCard = drawer.getByTestId('intake-card').filter({ hasText: INTAKE_NOTE_SUBJECT });
  await expect(noteCard).toBeVisible();

  await noteCard.getByRole('button', { name: /note for bast/i }).click();
  await noteCard.getByTestId('intake-training-note-input').fill('E2E: this one was actually fine, not noise');
  await noteCard.getByRole('button', { name: /save note/i }).click();

  await expect(noteCard.getByTestId('intake-training-note')).toHaveText(
    /this one was actually fine, not noise/,
    { timeout: 10000 }
  );

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('intake-drawer-trigger').click();
  const reopenedDrawer = page.getByTestId('intake-drawer');
  await expect(reopenedDrawer).toHaveAttribute('data-state', 'open');
  const reopenedCard = reopenedDrawer.getByTestId('intake-card').filter({ hasText: INTAKE_NOTE_SUBJECT });
  await expect(reopenedCard.getByTestId('intake-training-note')).toHaveText(
    /this one was actually fine, not noise/
  );
});
