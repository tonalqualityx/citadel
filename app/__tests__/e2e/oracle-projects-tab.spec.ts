import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Oracle Projects Tab Phase 4 — the tab itself. Fixtures come from
// scripts/seed-oracle-projects-fixtures.ts (one in-progress project with a needs-mike
// decision task whose last comment is Bast's, one done+needs_review review task, and one
// parked_until note). One shared admin login (SHARED_AUTH_STATE_PATH), matching every
// other Oracle e2e file's contention-avoidance pattern — see global-setup.ts.
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
const APP_ROOT = path.resolve(__dirname, '..', '..');

// These MUST match scripts/seed-oracle-projects-fixtures.ts's own constants exactly —
// duplicated here (not imported) because that script executes its seed as a side effect
// of being run, not of being imported as a module.
const PROJECT_NAME = 'E2E Oracle Projects Tab Fixture Project';
const DECISION_TASK_TITLE = 'E2E: decide on the domain migration approach';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-oracle-projects-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
});

test('Oracle Projects Tab — badge, card, drawer, reply-clears-tag, screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/oracle');
  await expect(page.getByTestId('oracle-header')).toBeVisible();

  // The tab badge — the law's one permitted pull — shows a count > 0 once the fixture
  // project's decision blocker exists (mikeOwner() in blockers.ts is a hardcoded
  // constant, so this project is stalled_on_mike regardless of which real user seeded
  // it).
  const badge = page.getByTestId('mode-tab-projects-badge');
  await expect(badge).toBeVisible();
  await expect(page.getByText(/projects waiting on you/)).toBeVisible();

  await page.getByTestId('mode-tab-projects').click();
  await page.waitForLoadState('networkidle');

  // Stalled summary line renders.
  await expect(page.getByTestId('stalled-summary')).toContainText('stalled on you');

  // The fixture card: red left edge (stalled_on_mike) + the seeded project's name.
  const grid = page.getByTestId('projects-grid');
  await expect(grid).toBeVisible();
  const card = grid.getByTestId('project-card').filter({ hasText: PROJECT_NAME });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('project-card-next-step')).toBeVisible();

  const borderLeftColor = await card.evaluate((el) => getComputedStyle(el).borderLeftColor);
  // var(--error) resolves to a red RGB triple in every theme this app ships (see
  // app/globals.css) — assert redness (R clearly dominant) rather than one exact hex,
  // since light/dark/dim each define a slightly different --error value.
  const rgbMatch = borderLeftColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  expect(rgbMatch).not.toBeNull();
  const [, r, g, b] = rgbMatch!.map(Number) as unknown as [never, number, number, number];
  expect(r).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(b);

  // Open the drawer via the card.
  await card.click();
  await expect(page.getByTestId('drawer-blockers')).toBeVisible();
  await expect(page.getByTestId('drawer-next-step')).toBeVisible();

  // Reply to the decision blocker — this is the row whose detail text is Bast's comment.
  const decisionRow = page.locator('[data-testid="blocker-row"][data-kind="decision"]').first();
  await expect(decisionRow).toBeVisible();
  await decisionRow.getByRole('button', { name: /reply and clear/i }).click();
  await decisionRow.getByPlaceholder(/write a reply/i).fill('Go with the DNS cutover this week.');
  await decisionRow.getByRole('button', { name: /reply and clear/i }).click();

  // The tag clears server-side — verify via the real API (not just optimistic UI),
  // reusing the shared session's cookies.
  await expect(async () => {
    const tasksRes = await page.request.get(`/api/tasks?search=${encodeURIComponent(DECISION_TASK_TITLE)}`);
    expect(tasksRes.ok()).toBe(true);
    const body = await tasksRes.json();
    const task = body.tasks.find((t: { title: string }) => t.title === DECISION_TASK_TITLE);
    expect(task).toBeTruthy();
    expect(task.tags).not.toContain('needs-mike');
  }).toPass({ timeout: 10_000 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'oracle-projects-tab.png'), fullPage: true });
});
