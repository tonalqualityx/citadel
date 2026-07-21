import { test, expect } from '@playwright/test';

// Selectors fixed against the real login page markup (app/(auth)/login/page.tsx uses
// components/ui/input.tsx's <Input label="Email" .../> without an explicit `id` — the
// component falls back to React.useId() in that case, so a hardcoded input[id="email"]
// selector never matches. Label-based selectors are robust to the generated id (same
// fix already applied in the Oracle e2e specs' own login() helper).
test.describe('Authentication', () => {
  test('should show login page', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('invalid@test.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.click('button[type="submit"]');

    // Should show error message (app/api/auth/login/route.ts throws "Invalid credentials")
    await expect(page.locator('text=Invalid')).toBeVisible({ timeout: 5000 });
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');

    // Use test credentials from seed data
    await page.getByLabel('Email').fill('admin@indelible.agency');
    await page.getByLabel('Password').fill('password123');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
  });
});
