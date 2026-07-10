import { test, expect } from '@playwright/test';

// Mobile nav drawer (fix/mobile-nav): three bugs fixed —
//  1. drawer container wasn't a flex column, so <nav>'s overflow-y-auto never
//     had a bounded height to scroll within
//  2. NavSectionBlock had no collapse state (desktop Sidebar already did)
//  3. perceived slow-open was a consequence of #1/#2 (unbounded, fully-expanded
//     tall drawer laid out on every mount)
//
// One test, one login — the auth endpoint is rate-limited (10 req/min,
// lib/api/rate-limit.ts), same rationale as oracle-fleet.spec.ts.
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/mobile-nav-fix';

test('mobile nav drawer — scrolls, collapses sections, no horizontal overflow at 360px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // --- login (admin@indelible.agency / password123, per prisma/seed.ts) ---
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

  // --- open the mobile drawer ---
  await page.locator('header button.lg\\:hidden').click();
  await expect(page.getByText('Menu')).toBeVisible();

  const nav = page.getByRole('navigation');
  await expect(nav).toBeVisible();

  // --- (a) the nav region scrolls: bounded height + real scrollTop movement ---
  const overflowBefore = await nav.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
  }));
  expect(overflowBefore.scrollHeight).toBeGreaterThan(overflowBefore.clientHeight);
  expect(overflowBefore.scrollTop).toBe(0);

  await nav.evaluate((el) => {
    el.scrollTop = 150;
  });
  const scrollTopAfter = await nav.evaluate((el) => el.scrollTop);
  expect(scrollTopAfter).toBeGreaterThan(0);

  // Screenshot 1: menu open, sections expanded (default state)
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-menu-expanded.png`, fullPage: true });

  // --- (b) a section header tap hides/shows its items ---
  // "Foundry" is the Work section header under the default 'awesome' naming
  // convention (lib/hooks/use-terminology.ts); it defaults open, mirroring
  // Sidebar's defaultOpen: true for the same section.
  const foundryHeader = page.getByRole('button', { name: /Foundry/i });
  await expect(foundryHeader).toBeVisible();
  await expect(page.getByRole('link', { name: /Sites/i })).toBeVisible();

  await foundryHeader.click();
  await expect(page.getByRole('link', { name: /Sites/i })).not.toBeVisible();

  // Screenshot 2: menu open, Foundry section collapsed
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-menu-collapsed.png`, fullPage: true });

  await foundryHeader.click();
  await expect(page.getByRole('link', { name: /Sites/i })).toBeVisible();

  // --- (c) no horizontal scroll at 360px ---
  await page.setViewportSize({ width: 360, height: 800 });
  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);
});
