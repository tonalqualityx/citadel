import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Wait record phase 1 — the Work-mode blocks. Fixtures come from
// scripts/seed-wait-blocks-fixtures.ts: seven client-blocking waits on the admin (one a
// project approval when the dev DB has a project), two waits due later this week. The shared
// dev DB also holds other specs' admin-soon and task fixtures, so the Due this week and Admin
// blocks are asserted by presence and caps, never exact contents.
//
// Flags (lib/config/feature-flags.ts): ORACLE_WAIT_BLOCKS is on by default; ORACLE_WORK_DOORS is
// off by default, so the doors row is absent from Work in this run.
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-results', 'wait-blocks');
const APP_ROOT = path.resolve(__dirname, '..', '..');

test.describe.configure({ mode: 'serial' });
test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-wait-blocks-fixtures.ts',
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

test('Blocking today caps at five, counts the rest, and expands', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const block = page.getByTestId('blocking-today');
  await expect(block).toBeVisible();
  await expect(block.getByTestId('blocking-row')).toHaveCount(5);

  // Seven fixtures are ours; other specs may add more, so "at least 2 more".
  const more = block.getByTestId('blocking-more');
  await expect(more).toBeVisible();
  const text = await more.innerText();
  expect(Number.parseInt(text.match(/\d+/)?.[0] ?? '0', 10)).toBeGreaterThanOrEqual(2);

  await more.click();
  expect(await block.getByTestId('blocking-row').count()).toBeGreaterThanOrEqual(7);

  // Every row carries one action. The project approval, when the dev DB has a project, is first.
  const first = block.getByTestId('blocking-row').first();
  await expect(first.getByTestId('blocking-row-action')).toHaveCount(1);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/work-blocking-today.png`, fullPage: true });
});

test('Blocking today renders above Today\'s picks; Due this week and Admin render below', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');

  const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? Number.NaN;
  const blocking = await y('blocking-today');
  const picks = await y('todays-picks-hero');
  const due = await y('due-this-week');
  expect(blocking).toBeLessThan(picks);
  expect(due).toBeGreaterThan(picks);

  // Due this week holds our two later-this-week waits, capped at seven rows.
  await expect(page.getByTestId('due-this-week').getByText('E2E due this week number 1')).toBeVisible();
  expect(await page.getByTestId('due-this-week').getByTestId('due-row').count()).toBeLessThanOrEqual(7);
  // Admin, when present, is capped at five.
  if (await page.getByTestId('admin-block').count()) {
    expect(await page.getByTestId('admin-row').count()).toBeLessThanOrEqual(5);
  }
});

test('the doors row is hidden by default', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/oracle');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('work-view')).toBeVisible();
  await expect(page.getByTestId('doors-row')).toHaveCount(0);
  await expect(page.getByTestId('door-intake')).toHaveCount(0);
});

test('GET /api/waits/mine returns the blocks the page renders', async ({ page }) => {
  await page.goto('/oracle');
  const res = await page.request.get('/api/waits/mine');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json.blocking_today.rows.length).toBeLessThanOrEqual(5);
  expect(json.blocking_today.total).toBeGreaterThanOrEqual(7);
  expect(json.due_this_week.rows.length).toBeLessThanOrEqual(7);
  expect(json.admin.rows.length).toBeLessThanOrEqual(5);
  expect(typeof json.summary).toBe('string');
});
