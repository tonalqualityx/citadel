import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Mobile nav drawer. Original bug-fix coverage (fix/mobile-nav):
//  1. drawer container wasn't a flex column, so <nav>'s overflow-y-auto never
//     had a bounded height to scroll within
//  2. NavSectionBlock had no collapse state (desktop Sidebar already did)
//  3. perceived slow-open was a consequence of #1/#2 (unbounded, fully-expanded
//     tall drawer laid out on every mount)
//
// Reworked (Clarity Phase 3c follow-up): the original version asserted real
// scrollHeight > clientHeight straight off the default-open drawer at 390x844 — brittle,
// because whether that default state happens to overflow a given viewport drifts with
// nav content over time (it stopped holding once this repo's nav grew/shrank), and the
// assertion was never the point of the fix anyway. This version tests what the fix
// actually guarantees: (a) the nav region IS a bounded, scrollable flex column
// structurally (classes present, independent of current content height), (b) a section
// header tap collapses/expands its items, (c) every nav item is still reachable once
// every section is forced open, and (d) no HORIZONTAL overflow at 360px. Scrolling is
// still exercised for real — but only after deliberately expanding every collapsible
// section first, so overflow is guaranteed to exist rather than assumed.
//
// Clarity Phase 4c — this file used to perform its own real UI login inline (rationale:
// the auth endpoint is rate-limited, 10 req/min, lib/api/rate-limit.ts). That per-file-
// login pattern is what kept tipping the suite's shared login budget over as more Oracle
// e2e files accumulated (see global-setup.ts's own header for the full story) — fixed at
// the root with ONE shared admin login for the whole suite; this file now just points
// storageState at that shared file instead of logging in itself.
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/mobile-nav-fix';

test.use({ storageState: SHARED_AUTH_STATE_PATH });

// Hrefs are stable literals in Sidebar.tsx/MobileNav.tsx regardless of the
// terminology-preference labels — asserting on these (not visible text) is robust to
// wording changes. admin@indelible.agency is PM/Admin AND Admin, so every section
// (including Oracle, which is admin-only) renders. Clarity Phase 3c added Fleet
// (/oracle/fleet) as Oracle's second child — included here as the tie-in check.
const EXPECTED_ITEM_HREFS = [
  '/dashboard',
  '/time',
  '/projects',
  '/clients',
  '/sites',
  '/domains',
  '/tasks',
  '/tools',
  '/deals',
  '/meetings',
  '/charters',
  '/deals/wares',
  '/deals/msa',
  '/deals/automation',
  '/sops',
  '/recipes',
  '/oracle',
  '/oracle/fleet',
  '/settings',
  '/billing',
  '/admin/team',
  '/settings/reports',
];

test('mobile nav drawer — collapse/expand, all items reachable, scrolls, no horizontal overflow at 360px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // Already authenticated via the shared storageState (see test.use() above).
  await page.goto('/dashboard');

  // --- open the mobile drawer ---
  await page.locator('header button.lg\\:hidden').click();
  await expect(page.getByText('Menu')).toBeVisible();

  const nav = page.getByRole('navigation');
  await expect(nav).toBeVisible();

  // --- (a) structural fix #1: the nav region is a bounded, scrollable flex column —
  // true regardless of whether today's content happens to overflow it. ---
  await expect(nav).toHaveClass(/flex-1/);
  await expect(nav).toHaveClass(/overflow-y-auto/);
  const drawer = nav.locator('xpath=..');
  await expect(drawer).toHaveClass(/flex/);
  await expect(drawer).toHaveClass(/flex-col/);

  // Screenshot 1: menu open, default state (some sections collapsed, some open)
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-menu-expanded.png`, fullPage: true });

  // --- (b) a section header tap hides/shows its items (fix #2) ---
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

  // --- (c) every nav item is reachable: force every collapsible section open, then
  // confirm every expected href has exactly one link in the drawer. "Reachable" means
  // present in the bounded, scrollable nav (proven in (a)/(d) below) — not necessarily
  // visible without scrolling, which is the whole point of the bounded-flex-column fix. ---
  let closedHeaders = page.locator('nav button[aria-expanded="false"]');
  let remaining = await closedHeaders.count();
  while (remaining > 0) {
    await closedHeaders.first().click();
    closedHeaders = page.locator('nav button[aria-expanded="false"]');
    remaining = await closedHeaders.count();
  }

  for (const href of EXPECTED_ITEM_HREFS) {
    await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(1);
  }

  // --- (d) with every section forced open, the drawer nav now genuinely overflows its
  // bounded height — scroll for real here, never assumed. (Clicking through the section
  // headers above auto-scrolled the nav to bring each one into view, so reset scrollTop
  // to a known 0 before proving it can move — the overflow itself, not the incidental
  // starting position, is what this asserts.) ---
  await nav.evaluate((el) => {
    el.scrollTop = 0;
  });
  const overflow = await nav.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
  }));
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  expect(overflow.scrollTop).toBe(0);

  await nav.evaluate((el) => {
    el.scrollTop = 150;
  });
  const scrollTopAfter = await nav.evaluate((el) => el.scrollTop);
  expect(scrollTopAfter).toBeGreaterThan(0);

  // Screenshot 3: menu open, every section expanded, scrolled
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-menu-all-expanded-scrolled.png`, fullPage: true });

  // --- (e) no horizontal scroll at 360px, with everything expanded ---
  await page.setViewportSize({ width: 360, height: 800 });
  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);
});
