import { test, expect } from '@playwright/test';

// Oracle Phase 3 — "Respond" deep-link button (client side). Fixtures come from
// scripts/seed-oracle-fixtures.ts:
//   - demo-session-waiting-1 ("grantibly-wright-b1 — gate review"): waiting +
//     needs_attention + remote_url set -> Respond must render, correct href.
//   - demo-session-running-2 ("botanicaldream — Adaptogens post"): running, no
//     remote_url -> Respond must be absent (no dead button).
//   - demo-cron-daily-checkin ("daily-check-in"): ended, but carries a remote_url
//     anyway -> Respond must still be absent (live status gates it, not just URL
//     presence).
//
// ONE login for the whole file (auth endpoint is rate-limited to 10 req/min per
// lib/api/rate-limit.ts — same discipline as the other Oracle e2e specs).
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-p3-screens';

const WAITING_REMOTE_URL = 'https://claude.ai/code/session_demo_waiting1';

test('Oracle Phase 3 — Respond button gated by remote_url + live status, correct href/target, no 360px overflow', async ({
  page,
}) => {
  // --- login ---
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

  // --- mobile (390px): waiting fixture (remote_url set) shows Respond with the
  // exact href, opening in a new tab. ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');

  const waitingCard = page
    .getByTestId('session-card')
    .filter({ hasText: 'grantibly-wright-b1' });
  await expect(waitingCard).toBeVisible();
  const respondLink = waitingCard.getByTestId('respond-link');
  await expect(respondLink).toBeVisible();
  await expect(respondLink).toHaveAttribute('href', WAITING_REMOTE_URL);
  await expect(respondLink).toHaveAttribute('target', '_blank');
  const rel = await respondLink.getAttribute('rel');
  expect(rel).toContain('noopener');
  expect(rel).toContain('noreferrer');

  // Tap target: real hit box must be at least 44px tall (per spec).
  const box = await respondLink.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  // --- running session with no remote_url: no Respond button at all. ---
  const runningNoUrlCard = page
    .getByTestId('session-card')
    .filter({ hasText: 'botanicaldream — Adaptogens post' });
  await expect(runningNoUrlCard).toBeVisible();
  await expect(runningNoUrlCard.getByTestId('respond-link')).toHaveCount(0);

  // --- ended session with a remote_url set: still no Respond (status gates it). ---
  // The cron fixture is collapsed under its machine's "Crons" group — scope to the
  // demo machine (the real workstation's own telemetry lands under a different
  // machine name, "Bast", and may have its own Crons group) and expand it.
  const demoMachine = page.locator('[data-machine="reshi-workstation"]');
  const cronsToggle = demoMachine.getByRole('button', { name: /crons/i });
  if ((await cronsToggle.count()) > 0) {
    await cronsToggle.first().click();
  }
  const endedCard = demoMachine.getByTestId('session-card').filter({ hasText: 'daily-check-in' });
  await expect(endedCard).toBeVisible();
  await expect(endedCard.getByTestId('respond-link')).toHaveCount(0);

  // --- clicking Respond must not toggle the card's drawer open. ---
  await expect(waitingCard.getByRole('button', { name: /grantibly-wright-b1/i })).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  // --- 360px: no horizontal scroll with the Respond button present. ---
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle');
  await expect(page.getByTestId('waiting-strip')).toBeVisible();
  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);

  // --- screenshots: mobile-390 + desktop-1440, waiting strip with a prominent
  // Respond button visible, for Mike's visual review. ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/oracle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1440.png`, fullPage: true });
});
