import { test, expect } from '@playwright/test';

// Oracle Phase 4 — three ordered live buckets (Waiting on you / Working / Idle) +
// idle Respond. Fixtures come from scripts/seed-oracle-fixtures.ts:
//   - demo-session-waiting-1 ("grantibly-wright-b1 — gate review"): waiting +
//     needs_attention + remote_url -> pinned in the Waiting-on-Reshi strip (top).
//   - demo-session-running-1 / -2 and demo-wf-run-* ("...page fan-out", has nested
//     agents + remote_url): running -> land in the machine's "Working" section.
//   - demo-session-orchestrator-working-1: waiting/needs_attention on its own
//     stored status but has a live running child -> also lands in "Working", not
//     Waiting (Phase 2 behavior, unaffected by Phase 4's bucket rename).
//   - demo-session-idle-1 ("msr-carwash-acquisition — parked"): status idle, no
//     running children, no needs_attention, remote_url set -> lands in the
//     machine's "Idle" section AND still renders a Respond button (idle is live).
//   - demo-cron-daily-checkin: openclaw_cron source, ended -> stays in the
//     collapsed "Crons" group regardless of the three-bucket rename.
//
// ONE login for the whole file (auth endpoint is rate-limited to 10 req/min per
// lib/api/rate-limit.ts — same discipline as the other Oracle e2e specs).
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-p4-screens';

const IDLE_REMOTE_URL = 'https://claude.ai/code/session_demo_idle1';

test('Oracle Phase 4 — three ordered buckets (Waiting/Working/Idle), idle Respond, no 360px overflow', async ({
  page,
}) => {
  // --- login ---
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

  // --- mobile (390px): all three sections present, in DOM order Waiting -> Working
  // -> Idle within the demo machine. ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');

  const waitingStrip = page.getByTestId('waiting-strip');
  await expect(waitingStrip).toBeVisible();
  await expect(waitingStrip.getByText(/grantibly-wright-b1/)).toBeVisible();

  const demoMachine = page.locator('[data-machine="reshi-workstation"]');
  await expect(demoMachine).toBeVisible();

  const workingHeading = demoMachine.getByText(/^Working \(\d+\)$/);
  const idleHeading = demoMachine.getByText(/^Idle \(\d+\)$/);
  await expect(workingHeading).toBeVisible();
  await expect(idleHeading).toBeVisible();

  // Order: Waiting strip above the machine section; within the machine section,
  // "Working" heading precedes "Idle" heading precedes the (collapsed) Crons group.
  const waitingBox = await waitingStrip.boundingBox();
  const workingBox = await workingHeading.boundingBox();
  const idleBox = await idleHeading.boundingBox();
  const cronsToggle = demoMachine.getByRole('button', { name: /crons/i }).first();
  const cronsBox = await cronsToggle.boundingBox();
  expect(waitingBox && workingBox && waitingBox.y).toBeLessThan(workingBox!.y);
  expect(workingBox!.y).toBeLessThan(idleBox!.y);
  expect(idleBox!.y).toBeLessThan(cronsBox!.y);

  // The working orchestrator (Phase 2 fixture) is NOT in the Waiting strip, and IS
  // under the Working heading.
  await expect(waitingStrip.getByText(/Oracle Task B — orchestrator fan-out/)).toHaveCount(0);
  const orchestratorCard = demoMachine
    .getByTestId('session-card')
    .filter({ hasText: 'Oracle Task B — orchestrator fan-out' });
  await expect(orchestratorCard).toBeVisible();

  // The idle fixture renders under Idle with a live Respond button.
  const idleCard = demoMachine
    .getByTestId('session-card')
    .filter({ hasText: 'msr-carwash-acquisition — parked' });
  await expect(idleCard).toBeVisible();
  const idleRespond = idleCard.getByTestId('respond-link');
  await expect(idleRespond).toBeVisible();
  await expect(idleRespond).toHaveAttribute('href', IDLE_REMOTE_URL);
  const idleRespondBox = await idleRespond.boundingBox();
  expect(idleRespondBox?.height).toBeGreaterThanOrEqual(44);

  // No standalone "Workflows" group exists anymore (Phase 4 removed it).
  await expect(demoMachine.getByRole('button', { name: /^workflows/i })).toHaveCount(0);

  // --- 360px: no horizontal scroll with all three sections rendered. ---
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle');
  await expect(page.getByTestId('waiting-strip')).toBeVisible();
  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);

  // --- screenshots: mobile-390 + desktop-1440, showing all three buckets. ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/oracle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1440.png`, fullPage: true });
});
