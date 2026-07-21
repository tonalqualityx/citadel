import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// Clarity Phase 3 — The Oracle Face. Fixtures come from
// scripts/seed-clarity-phase3-fixtures.ts (one demo arc with a task in every board column
// + a blocked task, plus two Today picks for today's UTC date) and
// scripts/seed-oracle-fixtures.ts (the demo fleet — running/waiting/idle/orchestrator
// sessions). One sequential test per Mike's rate-limit note (auth is rate-limited to 10
// req/min) — desktop layout, no-overflow, arc board drag, then mobile, then the Fleet
// screen (Clarity Phase 3c).
const SCREENSHOT_DIR = '/home/mike/.openclaw/workspace/citadel-clarity-wt/app/test-results/clarity-phase3';
const APP_ROOT = path.resolve(__dirname, '..', '..');

// Serial, not fullyParallel: with the default project config each test() below could
// otherwise land on a different worker and run concurrently, which would fire
// beforeAll's reseed (below) more than once in parallel — idempotent on its own, but a
// reseed racing mid-flight against the arc-board drag test (which reads/mutates those
// same rows) is exactly the kind of intermittent flake this file shouldn't reintroduce.
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  // Re-seed idempotently before this file's tests run. The arc-board drag test below
  // PERSISTS a real status change (not_started -> in_progress) server-side as part of
  // proving the drag survived a reload — so a prior run of this same file leaves the
  // "E2E: not started task" fixture already sitting in in_progress, and a repeat run
  // fails at the drag step with no visible not_started source card. seed-clarity-
  // phase3-fixtures.ts is itself idempotent (deletes + recreates this arc's tasks/picks
  // fresh every run) — this just makes sure it actually runs before the suite does,
  // rather than relying on whoever last ran it by hand.
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-clarity-phase3-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
}

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test('Oracle Phase 3 — desktop layout, arc board drag-move, screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  await page.goto('/oracle');
  await expect(page.getByTestId('oracle-header')).toBeVisible();
  await expect(page.getByTestId('today-section')).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Today section renders the seeded arc pick + note pick. (The arc pick's label also
  // appears a second time as a time-shape focus block — that's the layout logic working
  // as designed, so these assertions are scoped to the pick-card list specifically.)
  const todayList = page.getByTestId('today-list');
  await expect(todayList).toBeVisible();
  await expect(todayList.getByText('E2E Clarity Phase 3 Arc (demo)')).toBeVisible();
  await expect(todayList.getByText('E2E: quick note pick')).toBeVisible();

  // Time-shape track renders (even with an empty/near-empty calendar day, the component
  // itself must mount).
  await expect(page.getByTestId('time-shape')).toBeVisible();

  // --- Clarity Phase 3d bug fix, verified in the real browser: Mike reported the
  // Seeing Stone rendering his calendar in UTC instead of America/New_York — a 9am ET
  // meeting showed at 13:00 on the time-shape. The seeded fixture meeting
  // (scripts/seed-clarity-phase3-fixtures.ts: 14:00-15:30 UTC = 10:00-11:30am EDT) is
  // this exact scenario. The track spans 8a-6p (a 10-hour window); at the correct ET
  // hour this block starts (10am - 8am) / 10h = 20% in. Under the old bug (a literal
  // UTC 8:00-18:00 window), the same 14:00Z instant would land at (14-8)/10 = 60% —
  // i.e. rendering as if it were 2pm, three hours later than its real 10am ET start. ---
  const meetingBlock = page
    .locator('[data-testid="time-shape-block"][data-kind="meeting"]')
    .filter({ hasText: 'E2E: fixture meeting (red block)' });
  await expect(meetingBlock).toBeVisible();
  const meetingLeftPercent = await meetingBlock.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(meetingLeftPercent).toBeGreaterThanOrEqual(15);
  expect(meetingLeftPercent).toBeLessThanOrEqual(25); // ~20% — the correct ET position
  expect(meetingLeftPercent).toBeLessThan(50); // decisively NOT ~60% (the UTC-bug position)

  // --- Clarity Phase 3c: In Motion/Docked moved off Seeing Stone entirely, onto their
  // own /oracle/fleet screen (see the dedicated Fleet test below). This page now shows
  // only a quiet count-link to Fleet, never the sections themselves (fixtures from
  // scripts/seed-oracle-fixtures.ts, already resident in this dev DB alongside our
  // Phase 3 fixtures). ---
  await expect(page.getByTestId('in-motion-section')).toHaveCount(0);
  await expect(page.getByTestId('docked-section')).toHaveCount(0);

  const fleetLink = page.getByTestId('fleet-link');
  await expect(fleetLink).toBeVisible();
  await expect(fleetLink).toHaveAttribute('href', '/oracle/fleet');
  await expect(fleetLink).toHaveText(/\d+ in motion · \d+ docked/);

  // Legacy hook-flagged needs_attention session (no manifest ask) STAYS in Needs
  // Reshi's Answer column as a compact "session · legacy" card with Respond — the
  // split doesn't move it: it's waiting on Mike, not machinery. Ported from the
  // retired oracle-fleet-p3.spec.ts's Respond-gating coverage: this fixture
  // (demo-session-waiting-1) is the "waiting + remote_url -> Respond renders with the
  // correct deep-link" case — it no longer surfaces as a full SessionCard anywhere
  // (waiting sessions are excluded from Fleet's In Motion/Docked buckets entirely), so
  // the assertion now targets its AskCard here instead.
  const needsReshi = page.getByTestId('needs-reshi-section');
  await expect(needsReshi).toBeVisible();
  const answerColumn = page.getByTestId('needs-reshi-column-answer');
  const legacyCard = answerColumn.locator('[data-testid="ask-card"][data-source-label="session · legacy"]');
  const grantiblyCard = legacyCard.filter({ hasText: 'grantibly-wright-b1' });
  await expect(grantiblyCard).toBeVisible();
  const legacyRespond = grantiblyCard.getByRole('link', { name: /respond/i });
  await expect(legacyRespond).toBeVisible();
  await expect(legacyRespond).toHaveAttribute('href', 'https://claude.ai/code/session_demo_waiting1');
  await expect(legacyRespond).toHaveAttribute('target', '_blank');

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-oracle.png`, fullPage: true });

  // --- navigate to the arc board via the seeded pick's "Arc" primary action ---
  const arcCard = page.getByTestId('today-pick-card').filter({ hasText: 'E2E Clarity Phase 3 Arc (demo)' });
  await expect(arcCard).toBeVisible();
  await arcCard.getByRole('link', { name: 'Arc' }).click();
  await expect(page).toHaveURL(/\/oracle\/arcs\/.+/);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('arc-column-not_started')).toBeVisible();
  await expect(page.getByTestId('arc-column-in_progress')).toBeVisible();
  await expect(page.getByTestId('arc-column-review')).toBeVisible();
  await expect(page.getByTestId('arc-column-done')).toBeVisible();
  await expect(page.getByTestId('arc-progress-bar')).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-before-drag.png`, fullPage: true });

  // --- drag "E2E: not started task" from Not started into In progress ---
  const sourceCard = page
    .getByTestId('arc-column-not_started')
    .getByText('E2E: not started task', { exact: false });
  const targetColumn = page.getByTestId('arc-column-in_progress');

  const sourceBox = await sourceCard.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not resolve bounding boxes for the drag fixture — seed data missing?');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // dnd-kit's PointerSensor needs to clear its activation-distance constraint (5px)
  // before it starts tracking a drag — a handful of intermediate steps well past that.
  await page.mouse.move(startX + 20, startY, { steps: 5 });
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  // Persisted via the existing task PATCH endpoint; React Query invalidates the arc
  // detail query on success, so the card should reflow into In progress without a reload.
  await expect(
    page.getByTestId('arc-column-in_progress').getByText('E2E: not started task', { exact: false })
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByTestId('arc-column-not_started').getByText('E2E: not started task', { exact: false })
  ).toHaveCount(0);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-arc-board-after-drag.png`, fullPage: true });

  // Reload to confirm the move actually PERSISTED server-side, not just an optimistic
  // client-only reorder.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByTestId('arc-column-in_progress').getByText('E2E: not started task', { exact: false })
  ).toBeVisible();

  // Blocked task renders as a chip, not its own column.
  await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-testid^="arc-column-"]')).toHaveCount(4);
});

test('Oracle Phase 3 — mobile layout, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('oracle-header')).toBeVisible();
  await expect(page.getByTestId('today-section')).toBeVisible();

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390-oracle.png`, fullPage: true });

  // Ported from the retired legacy Oracle e2e specs' 360px discipline: no horizontal
  // scroll at the narrowest supported viewport, on Seeing Stone specifically.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('oracle-header')).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test('Oracle Phase 3c — Fleet screen: sections, Respond gating, subagent nesting, no 360px overflow, screenshot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);

  await page.goto('/oracle/fleet');
  await expect(page.getByTestId('fleet-header')).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Same corrected section-to-bucket mapping as before the split, just relocated:
  // In Motion = WORKING bucket ONLY: a running session belongs here.
  const inMotion = page.getByTestId('in-motion-section');
  await expect(inMotion).toBeVisible();
  await expect(inMotion.getByText('oracle-phase1-visualizer (Task A)')).toBeVisible();

  // Docked = IDLE bucket: an idle (parked) session belongs here, NOT in In Motion.
  const docked = page.getByTestId('docked-section');
  await expect(docked).toBeVisible();
  await expect(docked.getByText('msr-carwash-acquisition')).toBeVisible();
  await expect(inMotion.getByText('msr-carwash-acquisition')).toHaveCount(0);

  // Fleet is machinery-only — Today and Needs Reshi don't render here.
  await expect(page.getByTestId('today-section')).toHaveCount(0);
  await expect(page.getByTestId('needs-reshi-section')).toHaveCount(0);

  // --- Ported from the retired oracle-fleet-p3.spec.ts: Respond button gating by
  // remote_url + live status, on the sessions that still render as full SessionCards
  // here (In Motion/Docked). The third leg of that spec's coverage — an ended cron
  // with a remote_url still hides Respond — no longer applies: ended/cron sessions
  // don't render as cards ANYWHERE post-split (Fleet renders only the working/idle
  // buckets, never the crons/recentlyEnded ones), a strictly stronger guarantee than
  // "renders but hides the button". ---
  // running2 ("botanicaldream — Adaptogens post"): running, no remote_url -> no
  // Respond button at all.
  const runningNoUrlCard = inMotion.getByTestId('session-card').filter({ hasText: 'botanicaldream — Adaptogens post' });
  await expect(runningNoUrlCard).toBeVisible();
  await expect(runningNoUrlCard.getByTestId('respond-link')).toHaveCount(0);

  // idle1 ("msr-carwash-acquisition — parked"): idle, remote_url set -> Idle is live
  // too, so Respond renders with the exact href, opens in a new tab, real >=44px tap
  // target.
  const idleCard = docked.getByTestId('session-card').filter({ hasText: 'msr-carwash-acquisition' });
  const idleRespond = idleCard.getByTestId('respond-link');
  await expect(idleRespond).toBeVisible();
  await expect(idleRespond).toHaveAttribute('href', 'https://claude.ai/code/session_demo_idle1');
  await expect(idleRespond).toHaveAttribute('target', '_blank');
  const idleRel = await idleRespond.getAttribute('rel');
  expect(idleRel).toContain('noopener');
  expect(idleRel).toContain('noreferrer');
  const idleRespondBox = await idleRespond.boundingBox();
  expect(idleRespondBox?.height).toBeGreaterThanOrEqual(44);

  // --- Ported from the retired oracle-fleet-p2.spec.ts: orchestrator/subagent
  // nesting + honest "working" status. demo-session-orchestrator-working-1 ("Oracle
  // Task B — orchestrator fan-out") reads waiting+needs_attention on its own stored
  // status but has one live running child agent — it must land in In Motion (not
  // excluded as "waiting"), show the accent "Working · 1 agent" badge (never the
  // warning-gold waiting/needs_attention pill), and its nested child agent renders in
  // the (uncollapsed-by-default) agent grid without needing any extra click. ---
  const orchestratorCard = inMotion.getByTestId('session-card').filter({ hasText: 'Oracle Task B — orchestrator fan-out' });
  await expect(orchestratorCard).toBeVisible();
  await expect(orchestratorCard.getByText(/working\s*·\s*1\s*agent/i)).toBeVisible();
  await expect(orchestratorCard.getByText(/Fix false "waiting on Reshi" status/)).toBeVisible();

  // --- Ported from the retired legacy specs' 360px discipline, on the Fleet screen. ---
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/oracle/fleet');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('fleet-header')).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle/fleet');
  await page.waitForLoadState('networkidle');
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1280-fleet.png`, fullPage: true });
});
