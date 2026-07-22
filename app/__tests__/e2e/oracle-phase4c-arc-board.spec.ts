import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Clarity Phase 4c — arc board header enrichment. Mike's rulings covered here: the arc
// board's session panel (linked session + live status + Respond + waiting-since), the
// time-estimate badge (computed sum, with a hand-set override), assignee chips on every
// task card, and task cards opening the peek drawer (reusing TaskPeekProvider/
// TaskPeekDrawer from Phase 4b exactly as the Seeing Stone does) instead of navigating
// full-screen — with drag-to-move still working unaffected. Fixtures come from
// scripts/seed-clarity-phase4c-arc-board-fixtures.ts, which also writes the fixture arc's
// id to test-results/clarity-phase4c/fixture-ids.json since no /oracle/arcs list page
// exists to navigate through.
//
// Auth: this file does NOT perform its own login. Adding a 5th file with its own
// per-file real login (on top of a separately-discovered bug in search.spec.ts doing 3
// real logins instead of 1) tipped the whole suite's total real POST /api/auth/login
// calls over the shared, IP-bucketed authRateLimit (10 req/min) — a real, reproducible
// (not flaky) regression, confirmed across multiple clean full-suite runs. Root-fixed by
// replacing every spec file's own per-file login with ONE shared admin login for the
// entire suite (Playwright globalSetup — see global-setup.ts's own header for the full
// story); this file just points storageState at that shared file like every other one.
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase4c';
const APP_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_IDS_PATH = `${SCREENSHOT_DIR}/fixture-ids.json`;

const ASSIGNED_TASK_TITLE = 'E2E: assigned task (Clarity Phase 4c fixture)';
const UNASSIGNED_TASK_TITLE = 'E2E: unassigned task (Clarity Phase 4c fixture)';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

let arcId: string;

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase4c-arc-board-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );

  const fixtureIds = JSON.parse(fs.readFileSync(FIXTURE_IDS_PATH, 'utf-8'));
  arcId = fixtureIds.arcId;
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

test('Clarity Phase 4c — arc board: session panel, estimate badge, assignee chips, desktop screenshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/oracle/arcs/${arcId}`);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('arc-column-not_started')).toBeVisible();

  // --- session panel: the arc's linked session (arc_id-linked, needs_attention, waiting) ---
  const sessionPanel = page.getByTestId('arc-session-panel');
  await expect(sessionPanel).toBeVisible();
  const sessionRow = page.getByTestId('arc-session-row');
  await expect(sessionRow).toHaveCount(1);
  await expect(sessionRow).toContainText('E2E: arc-linked session (fixture)');
  // needs_attention outranks the plain "Waiting" status label (same STATUS_META priority
  // every other Oracle status chip already uses — see oracle-logic.ts's getStatusMeta).
  await expect(sessionRow).toContainText('Needs attention');
  const respondLink = page.getByTestId('arc-session-respond');
  await expect(respondLink).toHaveAttribute('href', 'https://claude.ai/code/session_e2e_clarity_phase4c');
  await expect(page.getByTestId('arc-session-waiting-since')).toContainText('waiting since');

  // --- time-estimate badge: open (30) + in_progress (60) = 90 open minutes; the done
  // task's 500-minute estimate must NOT be counted. ---
  const estimateBadge = page.getByTestId('arc-estimate-badge');
  await expect(estimateBadge).toHaveText('~1h 30m estimated');

  // --- assignee chips: every task card shows one, assigned or the quiet "unassigned"
  // placeholder — never neither. ---
  const assignedCard = page.getByTestId('arc-column-not_started').filter({ hasText: ASSIGNED_TASK_TITLE });
  await expect(assignedCard.getByTestId('arc-task-assignee-chip')).toBeVisible();
  await expect(assignedCard.getByTestId('arc-task-assignee-chip')).not.toHaveAttribute('data-unassigned', 'true');

  const unassignedCard = page.getByTestId('arc-column-in_progress').filter({ hasText: UNASSIGNED_TASK_TITLE });
  await expect(unassignedCard.getByTestId('arc-task-assignee-chip')).toHaveAttribute('data-unassigned', 'true');

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-header.png`, fullPage: true });
});

test('Clarity Phase 4c — task cards open the peek drawer on click, URL stays on the arc board', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/oracle/arcs/${arcId}`);
  await page.waitForLoadState('networkidle');

  const titleButton = page
    .getByTestId('arc-column-not_started')
    .filter({ hasText: ASSIGNED_TASK_TITLE })
    .getByTestId('arc-task-card-title');
  await titleButton.click();

  // The drawer is permanently mounted (forceMount + CSS-transform animated, same as
  // Phase 4b's own peek drawer) so a generic toBeVisible() can't distinguish open from
  // closed — assert via data-state, matching that phase's own established convention.
  const drawer = page.getByTestId('task-peek-drawer');
  await expect(drawer).toHaveAttribute('data-state', 'open');
  await expect(drawer).toContainText(ASSIGNED_TASK_TITLE);
  await expect(page).toHaveURL(new RegExp(`/oracle/arcs/${arcId}$`));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-peek-open.png`, fullPage: true });

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveAttribute('data-state', 'closed');
});

test('Clarity Phase 4c — drag still moves a task between columns, persists through reload (drag unaffected by peek)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/oracle/arcs/${arcId}`);
  await page.waitForLoadState('networkidle');

  const sourceCard = page.getByTestId('arc-column-not_started').getByText(ASSIGNED_TASK_TITLE, { exact: false });
  const targetColumn = page.getByTestId('arc-column-in_progress');

  await dragTo(page, sourceCard, targetColumn);

  await expect(
    page.getByTestId('arc-column-in_progress').getByText(ASSIGNED_TASK_TITLE, { exact: false })
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByTestId('arc-column-not_started').getByText(ASSIGNED_TASK_TITLE, { exact: false })
  ).toHaveCount(0);

  // The peek drawer must NOT have opened as a side effect of the drag (it's permanently
  // mounted via forceMount — same as Phase 4b's own peek drawer — so "closed" is the
  // correct assertion, not absence from the DOM).
  await expect(page.getByTestId('task-peek-drawer')).toHaveAttribute('data-state', 'closed');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByTestId('arc-column-in_progress').getByText(ASSIGNED_TASK_TITLE, { exact: false })
  ).toBeVisible();
});

test('Clarity Phase 4c — estimate override: set via the inline editor, persists through reload, Clear reverts to the computed sum', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/oracle/arcs/${arcId}`);
  await page.waitForLoadState('networkidle');

  const badge = page.getByTestId('arc-estimate-badge');
  await expect(badge).toHaveText('~1h 30m estimated');

  await badge.click();
  const form = page.getByTestId('arc-estimate-form');
  await expect(form).toBeVisible();
  await page.getByTestId('arc-estimate-input').fill('120');
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByTestId('arc-estimate-badge')).toHaveText('~2h (set by hand)', { timeout: 10000 });

  // Persisted server-side, not just an optimistic client-only change.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('arc-estimate-badge')).toHaveText('~2h (set by hand)');

  await page.getByTestId('arc-estimate-badge').click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('arc-estimate-badge')).toHaveText('~1h 30m estimated', { timeout: 10000 });

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('arc-estimate-badge')).toHaveText('~1h 30m estimated');
});
