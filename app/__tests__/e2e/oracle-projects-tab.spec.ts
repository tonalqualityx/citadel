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
const REVIEW_TASK_TITLE = 'E2E: ship the contact form (needs review)';
const CONTACT_NAME = 'E2E Fixture Contact';
const CONTACT_EMAIL = 'e2e-oracle-projects-contact@example.com';

async function openFixtureDrawer(page: import('@playwright/test').Page) {
  await page.goto('/oracle');
  await page.getByTestId('mode-tab-projects').click();
  await page.waitForLoadState('networkidle');
  const card = page.getByTestId('projects-grid').getByTestId('project-card').filter({ hasText: PROJECT_NAME });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId('drawer-blockers')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-oracle-projects-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
});

// LOW-5: the "queues a draft" test below leaves exactly one ApprovalRequest row in
// 'queued', addressed to the fixture contact's fake @example.com address — exactly the
// shape the machine-side sender (approval-sender.py) polls for every 5 minutes. Cancel
// it here so this spec never leaves a live queued row behind for a real cron tick
// pointed at the same dev DB to pick up. Runs even if an earlier test in this serial
// file failed partway through (test.afterAll always runs), and is a no-op (nothing
// found, nothing to cancel) if the queuing test never got that far.
test.afterAll(async ({ request }) => {
  const tasksRes = await request.get(`/api/tasks?search=${encodeURIComponent(REVIEW_TASK_TITLE)}`);
  if (!tasksRes.ok()) return;
  const tasksBody = await tasksRes.json();
  const reviewTask = tasksBody.tasks.find((t: { title: string }) => t.title === REVIEW_TASK_TITLE);
  if (!reviewTask) return;

  const arRes = await request.get(`/api/approval-requests?task_id=${reviewTask.id}`);
  if (!arRes.ok()) return;
  const arBody = await arRes.json();
  const stillQueued = (arBody.requests ?? []).filter(
    (r: { status: string; to_email: string | null }) => r.status === 'queued' && r.to_email === CONTACT_EMAIL
  );
  for (const row of stillQueued) {
    await request.patch(`/api/approval-requests/${row.id}`, { data: { status: 'cancelled' } });
  }
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

// Phase 5 — dismiss a blocker, verify it disappears, undo it, verify it reappears. Runs
// against the fixture's review blocker (task-sourced, kind='task' dismissal per
// DISMISSAL_KIND_BY_BLOCKER_KIND). Ends in the same state it started in (undone), so a
// later test in this serial file still finds the review blocker.
test('Oracle Projects Tab — dismiss a blocker and undo (real API)', async ({ page }) => {
  await openFixtureDrawer(page);

  const reviewRow = page.locator('[data-testid="blocker-row"][data-kind="review"]').first();
  await expect(reviewRow).toBeVisible();
  await reviewRow.getByRole('button', { name: /^dismiss$/i }).click();

  // The dismissed blocker drops out of the Blockers list entirely (the route excludes
  // it, not just a client-side hide) — wait for the row itself to go away.
  await expect(reviewRow).toHaveCount(0, { timeout: 10_000 });

  // Confirmed via the real API too, not just the UI's own optimistic state.
  const projectsRes = await page.request.get('/api/oracle/projects');
  expect(projectsRes.ok()).toBe(true);
  const projectsBody = await projectsRes.json();
  const fixtureProject = projectsBody.projects.find((p: { name: string }) => p.name === PROJECT_NAME);
  expect(fixtureProject).toBeTruthy();
  expect(fixtureProject.blockers.some((b: { kind: string }) => b.kind === 'review')).toBe(false);
  expect(fixtureProject.dismissals.length).toBeGreaterThan(0);

  // Undo via the drawer's "Dismissed items" section.
  await page.getByText(/dismissed items \(\d+\)/i).click();
  const dismissedItem = page.getByTestId('dismissed-item').first();
  await expect(dismissedItem).toBeVisible();
  await dismissedItem.getByRole('button', { name: /undo/i }).click();

  await expect(page.locator('[data-testid="blocker-row"][data-kind="review"]')).toHaveCount(1, { timeout: 10_000 });
});

// Phase 5 — open the ApprovalPanel for the review blocker (review blockers qualify per
// showsApprovalPanel, same as client_approval ones), draft, pick the fixture contact,
// and queue it. Verified via the real API — status:'queued' means the machine-side
// sender would pick this row up on its next poll, not that the UI merely rendered a
// success toast.
test('Oracle Projects Tab — opens the ApprovalPanel and queues a draft (status queued via API)', async ({ page }) => {
  await openFixtureDrawer(page);

  const approvals = page.getByTestId('drawer-approvals');
  await expect(approvals).toBeVisible();
  await approvals.getByRole('button', { name: /draft approval request/i }).click();

  const panel = approvals.getByTestId('approval-panel');
  await expect(panel.getByLabel(/^subject$/i)).toBeVisible({ timeout: 10_000 });

  await panel.getByLabel(/^send to$/i).selectOption({ label: `${CONTACT_NAME} (${CONTACT_EMAIL})` });
  await panel.getByRole('button', { name: /queue to send from my gmail/i }).click();

  await expect(panel.getByTestId('approval-panel-status')).toHaveText(/queued/i, { timeout: 10_000 });

  // Confirmed via the real API: the row this button just PATCHed is actually 'queued',
  // with the fixture contact's email, ready for the machine-side sender's next poll.
  await expect(async () => {
    const tasksRes = await page.request.get(`/api/tasks?search=${encodeURIComponent(REVIEW_TASK_TITLE)}`);
    expect(tasksRes.ok()).toBe(true);
    const tasksBody = await tasksRes.json();
    const reviewTask = tasksBody.tasks.find((t: { title: string }) => t.title === REVIEW_TASK_TITLE);
    expect(reviewTask).toBeTruthy();

    const arRes = await page.request.get(`/api/approval-requests?task_id=${reviewTask.id}`);
    expect(arRes.ok()).toBe(true);
    const arBody = await arRes.json();
    expect(arBody.requests.length).toBeGreaterThan(0);
    const latest = arBody.requests[arBody.requests.length - 1];
    expect(latest.status).toBe('queued');
    expect(latest.to_email).toBe(CONTACT_EMAIL);
  }).toPass({ timeout: 10_000 });
});
