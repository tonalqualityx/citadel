import { test, expect } from '@playwright/test';

test.describe('Global Search (Command Palette)', () => {
  test.beforeEach(async ({ page }) => {
    // Login first. Label-based selectors — components/ui/input.tsx only sets a
    // predictable `id` when one is passed explicitly; the login page doesn't, so it
    // falls back to React.useId() and a hardcoded input[id="email"] never matches
    // (same fix as auth.spec.ts).
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@indelible.agency');
    await page.getByLabel('Password').fill('password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
  });

  test('should open command palette with Cmd+K', async ({ page }) => {
    await page.keyboard.press('Meta+k');

    // Command palette should be visible
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('should close command palette with Escape', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('input[placeholder*="Search"]')).not.toBeVisible();
  });

  test('should show search results when typing', async ({ page }) => {
    await page.keyboard.press('Meta+k');

    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');

    // Wait for results or "No results" message
    await expect(
      page.locator('text=No results').or(page.locator('[data-index="0"]'))
    ).toBeVisible({ timeout: 5000 });
  });
});
