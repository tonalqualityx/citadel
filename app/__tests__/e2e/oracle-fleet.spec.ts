import { test, expect } from '@playwright/test';

// Oracle Phase 1 fleet visualizer — nav wiring, WaitingStrip priority ordering,
// no-horizontal-scroll at 360px, and themed screenshots (desktop/mobile x light/dark)
// for Mike's visual review. Fixtures come from scripts/seed-oracle-fixtures.ts.
//
// Deliberately ONE test with sequential steps rather than one-test-per-assertion:
// the auth endpoint is rate-limited to 10 req/min (lib/api/rate-limit.ts) and each
// Playwright test re-runs beforeEach from a clean context, so N tests = N logins.
// Logging in once and reusing the session avoids tripping that limit.
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots';

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

  // --- WaitingStrip: needs_attention fixture pinned on top; no horizontal scroll at 360px ---
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle');
  await expect(page.getByTestId('waiting-strip')).toBeVisible();

  const firstWaitingCard = page.getByTestId('waiting-strip').getByTestId('session-card').first();
  await expect(firstWaitingCard).toContainText('grantibly-wright-b1');

  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);

  // --- screenshots: desktop 1440 x light/dark, mobile 390 x light/dark ---
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/oracle');
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
