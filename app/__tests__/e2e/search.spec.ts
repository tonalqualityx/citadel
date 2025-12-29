import { test, expect } from '@playwright/test';

test.describe('Global Search (Command Palette)', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[id="email"]', 'admin@indelible.agency');
    await page.fill('input[id="password"]', 'password123');
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
