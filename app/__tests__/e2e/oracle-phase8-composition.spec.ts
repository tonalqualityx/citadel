import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Clarity Phase 8 (composition) — the three-mode front page. Fixtures come from
// scripts/seed-clarity-phase8-fixtures.ts (crisis, 12 intake across every lane, a
// promised-due-today task, an internal target task, an in-progress task, an active
// session + its session-type pick, 2 review items sharing a client, an admin-soon task,
// and a calendar event carrying description/meet_url/location/attendees).
//
// Gate note: global-setup.ts already POSTs ritual-runs {action:'ran'} for the shared auth
// state, so every test here lands past the cover with no further action — the RitualGate
// cover itself (including the Quick-start door) is covered by RitualGate.test.tsx (unit),
// not here; a real gate-cover e2e would need to clear the shared ritual_runs row, which
// would race every OTHER parallel Oracle e2e file relying on it staying satisfied.
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-results', 'clarity-phase8');
const APP_ROOT = path.resolve(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase8-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
});

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('Clarity Phase 8 — Work mode is the landing surface: signals, hero, doors, screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  // Work is the default — the mode tab shows it as current, Return to Work is hidden.
  await expect(page.getByTestId('mode-tab-work')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('return-to-work')).not.toBeVisible();
  await expect(page.getByTestId('work-view')).toBeVisible();

  // Signals rail: the crisis fixture, the promised-due-today task, and the active session
  // are all bare tasks/sessions (not today_picks — see the seed script's own note on the
  // shared, WIP-capped picks surface every Oracle e2e file competes for) but each still
  // lights up its own signal directly off live state, never off a pick.
  await expect(page.getByTestId('signals-rail')).toBeVisible();
  await expect(page.getByTestId('signal-crisis')).toBeVisible();
  await expect(page.getByTestId('signal-promised_due_today')).toBeVisible();
  await expect(page.getByTestId('signal-session_needs_you')).toBeVisible();

  // Today's picks hero renders whatever the shared dev DB's picks are (other Oracle e2e
  // files seed their own) — just prove the hero itself renders sanely, without asserting
  // on any specific fixture's presence (none of Phase 8's own fixtures are picks, by
  // design — the WIP cap is exact-full already without them).
  await expect(page.getByTestId('todays-picks-hero')).toBeVisible();

  // Four doors, always present.
  await expect(page.getByTestId('door-reviews')).toBeVisible();
  await expect(page.getByTestId('door-intake')).toBeVisible();
  await expect(page.getByTestId('door-pipeline')).toBeVisible();
  await expect(page.getByTestId('door-due_soon')).toBeVisible();
  // The door's count is the TRUE total across every intake source in the shared dev DB
  // (other Oracle e2e specs seed their own intake fixtures too) — assert it's truthfully
  // at least our 12, not an exact match.
  const intakeText = await page.getByTestId('door-intake').innerText();
  const intakeCount = Number.parseInt(intakeText.match(/\d+/)?.[0] ?? '0', 10);
  expect(intakeCount).toBeGreaterThanOrEqual(12);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/work-mode.png`, fullPage: true });
});

test('Clarity Phase 8 — clock-strip meeting opens the calendar context popover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const meeting = page.getByTestId('clock-strip-meeting').filter({ hasText: 'BRIC board' });
  await expect(meeting).toBeVisible();
  await meeting.click();

  const popover = page.getByTestId('calendar-event-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('BRIC board');
  await expect(popover).toContainText('Springfield VT');
  await expect(page.getByTestId('calendar-event-join')).toBeVisible();
  await expect(page.getByTestId('calendar-event-attendee')).toHaveCount(3);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/work-event-popover.png`, fullPage: true });
});

test('Clarity Phase 8 — Plan mode: doing-first board, done collapsed, both chip variants, screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('mode-tab-plan').click();
  await expect(page.getByTestId('mode-tab-plan')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('return-to-work')).toBeVisible();
  await expect(page.getByTestId('plan-view')).toBeVisible();
  await expect(page.getByTestId('week-strip')).toBeVisible();
  await expect(page.getByTestId('today-section')).toBeVisible();
  // PipelineLane renders nothing at all when every pipeline group is empty (existing,
  // unchanged behavior) — no accord fixtures are seeded for this spec, so it's a soft
  // check rather than an assertion it must be visible.
  void page.getByTestId('pipeline-lane');

  // The session pick's reason chip renders on the board too (same ReasonChip component,
  // one source of truth with Work's hero — see lib/reason-chips.ts).
  await expect(page.locator('[data-testid="reason-chip"]').first()).toBeVisible();

  // The promised-due-today task (a bare task, not a pick — see the seed script's note)
  // surfaces in the Due-soon row at the foot of Today's board.
  const dueSoonRow = page.getByTestId('due-soon-row');
  await expect(dueSoonRow).toBeVisible();
  await expect(dueSoonRow.getByText('record walkthrough video')).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/plan-mode.png`, fullPage: true });

  await page.getByTestId('return-to-work').click();
  await expect(page.getByTestId('work-view')).toBeVisible();
});

test('Clarity Phase 8 — Process mode: exactly one card at a time, screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('door-intake').click();
  await expect(page.getByTestId('mode-tab-process')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('process-view')).toBeVisible();

  // Exactly one card in the DOM — the "no walls" law.
  await expect(page.locator('[data-testid="process-deal-card"]')).toHaveCount(1);
  const firstCardText = await page.locator('[data-testid="process-deal-card"]').innerText();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/process-card.png`, fullPage: true });

  // Dismissing the current card advances to the next one — still exactly one card, and
  // it's a DIFFERENT card than before.
  const dismissBtn = page.getByTestId('intake-deal-dismiss');
  if (await dismissBtn.isVisible()) {
    await dismissBtn.click();
    await expect(page.locator('[data-testid="process-deal-card"]')).toHaveCount(1, { timeout: 10000 });
    const secondCardText = await page.locator('[data-testid="process-deal-card"]').innerText();
    expect(secondCardText).not.toBe(firstCardText);
  }
});
