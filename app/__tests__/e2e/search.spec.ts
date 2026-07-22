import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Clarity Phase 4c deviation (real, reproducible regression, not this phase's own file):
// this used to log in via `beforeEach` — a fresh real POST /api/auth/login per test (3
// logins for this file's 3 tests), the exact bug class Clarity Phase 4b already fixed
// once in oracle-phase3.spec.ts. That, plus this phase's own new 5th Oracle e2e file
// each doing one more per-file login, tipped the whole suite's total real login count
// over the shared, IP-bucketed authRateLimit (10 req/min, lib/api/rate-limit.ts) —
// confirmed deterministic (not flaky) across multiple clean full-suite runs. Root-fixed
// (not just patched here) by replacing EVERY spec file's own per-file login with ONE
// shared admin login for the entire suite (Playwright globalSetup — see
// global-setup.ts's own header); this file just points storageState at that one shared
// file, same as every other Oracle e2e file.
test.describe('Global Search (Command Palette)', () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test('should open command palette with Cmd+K', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Meta+k');

    // Command palette should be visible
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('should close command palette with Escape', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Meta+k');
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('input[placeholder*="Search"]')).not.toBeVisible();
  });

  test('should show search results when typing', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Meta+k');

    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');

    // Wait for results or "No results" message
    await expect(
      page.locator('text=No results').or(page.locator('[data-index="0"]'))
    ).toBeVisible({ timeout: 5000 });
  });
});
