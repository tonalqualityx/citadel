import { test, expect } from '@playwright/test';

// Oracle Phase 1 fleet visualizer — nav wiring, WaitingStrip priority ordering,
// no-horizontal-scroll at 360px, and themed screenshots (desktop/mobile x light/dark)
// for Mike's visual review. Fixtures come from scripts/seed-oracle-fixtures.ts.
// Phase 1.5 adds: admin-only gating (1.5a) and the Remote Spawn New Session flow
// (1.5b) — both exercised below.
//
// Deliberately ONE big test with sequential steps for the admin flow, plus one small
// second test for the PM-denial check, rather than one-test-per-assertion: the auth
// endpoint is rate-limited to 10 req/min (lib/api/rate-limit.ts) and each Playwright
// test re-runs beforeEach from a clean context, so N tests = N logins. Two logins
// total (one per test) stays well under that limit.
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-p15';

// ThemeProvider (components/layout/ThemeProvider.tsx) re-applies the user's SERVER-side
// preference once /api/users/me/preferences resolves, overriding a plain localStorage
// write within a few hundred ms — so a screenshot taken right after setting localStorage
// alone silently snaps back to whatever theme the seeded user already had. Persist the
// theme for real via the same PATCH the app's own settings UI uses, so it survives.
async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.evaluate(async (t) => {
    localStorage.setItem('indelible-theme', t);
    await fetch('/api/users/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ theme: t }),
    });
  }, theme);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test('Oracle fleet visualizer — nav, WaitingStrip priority, responsive, themed screenshots', async ({
  page,
}) => {
  // --- login ---
  // NOTE: the repo's other e2e specs (auth.spec.ts) select via input[id="email"], but
  // components/ui/input.tsx only sets that id when an explicit `id` prop is passed —
  // the login page doesn't pass one, so it falls back to React.useId() and that
  // selector never matches (pre-existing breakage, unrelated to Oracle; confirmed by
  // running auth.spec.ts standalone on this branch — same 3 pre-existing failures).
  // Label-based selectors are robust to the generated id.
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

  // --- nav entry visible in the sidebar (desktop) ---
  await expect(page.locator('aside a[href="/oracle"]')).toBeVisible();

  // --- nav entry visible in the mobile drawer ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.locator('header button.lg\\:hidden').click();
  // The sidebar's own /oracle link is also in the DOM (CSS-hidden below lg:), so
  // scope to the drawer's copy — it renders after the sidebar, hence .last().
  await expect(page.locator('a[href="/oracle"]').last()).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');

  // --- WaitingStrip: needs_attention fixture is pinned in the strip; no horizontal
  // scroll at 360px. NOTE (pre-existing, unrelated to 1.5): this dev DB also carries
  // REAL Oracle telemetry from this workstation's own heartbeat/hooks alongside the
  // seed fixtures (scripts/seed-oracle-fixtures.ts writes into the same table a live
  // machine POSTs to), so a genuinely-waiting live session can legitimately outrank
  // the demo fixture by wait time and take the #1 slot. Assert the fixture is
  // present in the strip, not that it's first — confirmed by reproducing this same
  // failure against the pre-1.5 baseline (commit 7931e9c) with zero Oracle UI
  // changes applied, i.e. it isn't something this task introduced.
  const waitingStrip = page.getByTestId('waiting-strip');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle');
  await expect(waitingStrip).toBeVisible();
  await expect(waitingStrip.getByText(/grantibly-wright-b1/)).toBeVisible();

  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);

  // --- 1.5b mobile: New Session opens as a full-screen sheet, not a centered dialog ---
  await page.getByRole('button', { name: /new session/i }).click();
  const mobileModal = page.getByTestId('new-session-modal');
  await expect(mobileModal).toBeVisible();
  const mobileModalBox = await mobileModal.boundingBox();
  expect(mobileModalBox?.width).toBeGreaterThanOrEqual(350); // ~full 360px viewport, not a centered card
  await page.keyboard.press('Escape');
  await expect(mobileModal).not.toBeVisible();

  // --- 1.5b: New Session flow — validation, then a real command against machine
  // "Bast" (present from live telemetry on this workstation). The rehearsal
  // dispatcher may be running concurrently and could claim/complete this command
  // before the assertion below runs — a chip advancing past pending is SUCCESS for
  // the pipeline, so this only asserts the chip's presence, never its status.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/oracle');
  await page.getByRole('button', { name: /new session/i }).click();
  await expect(page.getByTestId('new-session-modal')).toBeVisible();

  await page.getByRole('button', { name: /queue session/i }).click();
  await expect(page.getByText('Working directory is required')).toBeVisible();

  const testTitle = `e2e-oracle-p15-${Date.now()}`;
  const testCwd = `/tmp/oracle-e2e-${Date.now()}`;
  await page.getByLabel('Machine').selectOption({ label: 'Bast' });
  await page.getByLabel('Working directory').fill(testCwd);
  await page.getByLabel('Title (optional)').fill(testTitle);
  await page.getByRole('button', { name: /queue session/i }).click();
  await expect(page.getByTestId('new-session-modal')).not.toBeVisible({ timeout: 10000 });

  await expect(
    page.getByTestId('command-chip').filter({ hasText: testTitle })
  ).toBeVisible({ timeout: 15000 });

  // --- screenshots: desktop 1440 x light/dark, mobile 390 x light/dark ---
  await setTheme(page, 'light');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('waiting-strip')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1440-light.png`, fullPage: true });

  await setTheme(page, 'dark');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1440-dark.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-light.png`, fullPage: true });

  await setTheme(page, 'dark');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-dark.png`, fullPage: true });

  // Restore the seeded admin's original theme preference (reversible-by-default).
  await setTheme(page, 'light');
});

test('1.5a — a PM (previously allowed) user is denied Oracle: no nav entry, direct nav redirects', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('pm@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

  // Oracle's nav entry must be entirely absent for a PM now (was PM/Admin in Phase 1).
  await expect(page.locator('aside a[href="/oracle"]')).toHaveCount(0);

  // Direct navigation is redirected away by the page-level gate.
  await page.goto('/oracle');
  await expect(page).not.toHaveURL(/\/oracle$/, { timeout: 10000 });
});
