import { test, expect } from '@playwright/test';

// Oracle Phase 2 — orchestrator/subagent nesting + honest "waiting" (Task B, client
// side). Fixtures come from scripts/seed-oracle-fixtures.ts, which now also seeds a
// "working" orchestrator (demo-session-orchestrator-working-1): a claude_code session
// that reads waiting + needs_attention on its own stored status but has one live
// running child agent (demo-orch-child-a0). Per the spec (feature-planning/
// oracle-phase2-orchestrator-nesting.md, "Server — honest status at READ time" + "UI"):
// that session must be EXCLUDED from the Waiting-on-Reshi strip, must render a
// "working · N agents" badge (accent, not warning), and must still expand to show
// its nested child agent. The genuinely-waiting fixture (demo-session-waiting-1,
// "grantibly-wright-b1") must still be pinned in the strip.
//
// ONE login for the whole file (the auth endpoint is rate-limited to 10 req/min per
// lib/api/rate-limit.ts — same discipline as oracle-fleet.spec.ts).
const SCREENSHOT_DIR =
  '/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-p2-screens';

test('Oracle Phase 2 — working orchestrator excluded from Waiting strip, badge + nested child render, no 360px overflow', async ({
  page,
}) => {
  // --- login ---
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

  // --- mobile (390px): the working orchestrator must NOT be in the Waiting strip,
  // the genuinely-waiting fixture MUST be, and the orchestrator's own card must show
  // the "Working" badge and expand to reveal its running child. ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');

  const waitingStrip = page.getByTestId('waiting-strip');
  await expect(waitingStrip).toBeVisible();
  await expect(waitingStrip.getByText(/grantibly-wright-b1/)).toBeVisible();
  await expect(waitingStrip.getByText(/Oracle Task B — orchestrator fan-out/)).toHaveCount(0);

  const orchestratorCard = page
    .getByTestId('session-card')
    .filter({ hasText: 'Oracle Task B — orchestrator fan-out' });
  await expect(orchestratorCard).toBeVisible();
  // The card must render OUTSIDE the Waiting strip (it's in the Running/Working
  // group instead) — confirm it isn't a descendant of the strip.
  await expect(
    waitingStrip
      .getByTestId('session-card')
      .filter({ hasText: 'Oracle Task B — orchestrator fan-out' })
  ).toHaveCount(0);

  // Badge reads "Working · 1 agent" (accent, not the warning "Waiting"/"Needs
  // attention" pill) — one running child in the fixture.
  await expect(orchestratorCard.getByText(/working\s*·\s*1\s*agent/i)).toBeVisible();

  // Expand the card (tap header) — its nested child agent must render (the
  // pre-existing AgentRow expansion, extended to claude_code sources in Phase 2's
  // impact analysis — no change needed there, this just confirms it still works).
  await orchestratorCard.locator('button').first().click();
  await expect(orchestratorCard.getByText(/Fix false "waiting on Reshi" status/)).toBeVisible();

  // --- 360px: no horizontal scroll (same discipline as Phase 1) ---
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle');
  await expect(page.getByTestId('waiting-strip')).toBeVisible();
  const overflow360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow360.scrollWidth).toBeLessThanOrEqual(overflow360.clientWidth);

  // --- screenshots: mobile-390 + desktop-1440, both showing the working
  // orchestrator (with its nested agent expanded) and the waiting strip excluding
  // it, for Mike's visual review. ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/oracle');
  await page
    .getByTestId('session-card')
    .filter({ hasText: 'Oracle Task B — orchestrator fan-out' })
    .locator('button')
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/oracle');
  await page
    .getByTestId('session-card')
    .filter({ hasText: 'Oracle Task B — orchestrator fan-out' })
    .locator('button')
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1440.png`, fullPage: true });
});
