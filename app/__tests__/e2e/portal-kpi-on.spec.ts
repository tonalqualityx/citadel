import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

// Saturday 10-24 run, item 3: the Retainer and Home screens with PORTAL_KPI_VIEWS and
// PORTAL_ONBOARD_CHECKLIST both ON. Run this against a server started with both set to "true"
// (the flags are read from process.env at call time). Screens are written next to the baselines as
// *-kpi-on-*.png by playwright.portal-sat3.config.ts. The flag-OFF screens stay in portal-design.spec.ts.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const TS = 'npx ts-node --compiler-options \'{"module":"CommonJS"}\'';
const OWNER_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');
const COOKIE = { name: 'client_session', value: OWNER_TOKEN, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' as const };

test.beforeAll(() => {
  execSync(`${TS} scripts/seed-portal-v2-phase1-fixtures.ts`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-portal-b3-fixtures.ts`, { cwd: APP_ROOT, stdio: 'inherit' });
  const out = execSync(`${TS} scripts/seed-portal-b2-fixtures.ts`, { cwd: APP_ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}';
  const taskId = JSON.parse(line).thread_task_id;
  execSync(`${TS} scripts/seed-portal-b2-fixtures.ts --reset-thread ${taskId}`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-portal-sat3-kpi-fixtures.ts`, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.afterAll(() => {
  execSync(`${TS} scripts/seed-portal-sat3-kpi-fixtures.ts --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-portal-b3-fixtures.ts --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-portal-b2-fixtures.ts --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.describe.configure({ mode: 'serial' });

const SIZES = [
  { tag: '390', width: 390, height: 844 },
  { tag: '1280', width: 1280, height: 900 },
];
const SCHEMES = ['light', 'dark'] as const;

async function settle(page: Page, ready: RegExp | string) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(ready);
  await page.evaluate(() => document.fonts.ready);
}

test('API: the new fields are present with both switches ON, and only the allow-list', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([COOKIE]);
  const retainer = await (await context.request.get('http://localhost:3000/api/portal/retainer')).json();
  const goals = retainer.retainers[0].goals;
  expect(goals.length).toBe(3);
  for (const g of goals) expect(Object.keys(g).sort()).toEqual(['direction', 'label', 'last_text', 'target_text']);
  expect(JSON.stringify(goals)).not.toMatch(/Not agreed yet|ga4|gsc|kuma|"source"|"status"/);
  const home = await (await context.request.get('http://localhost:3000/api/portal/home')).json();
  expect(home.site_goals.length).toBe(2);
  expect(home.onboarding.still_need.map((n: { label: string }) => n.label)).toEqual(
    expect.arrayContaining(['Your logo file', 'Who should receive your invoices', 'A time for our kickoff meeting'])
  );
  await context.close();
});

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`${size.tag} ${scheme}`, () => {
      for (const screen of [
        { name: 'retainer', url: '/portal/retainer', ready: /E2E Growth plan/ },
        { name: 'home', url: '/portal/home', ready: /need|Nothing needs you/i },
      ]) {
        test(screen.name, async ({ browser }) => {
          const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, reducedMotion: 'reduce' });
          await context.addCookies([COOKIE]);
          const page = await context.newPage();
          await page.clock.setFixedTime('2026-10-21T14:00:00-04:00');
          await page.goto(screen.url);
          await settle(page, screen.ready);

          if (screen.name === 'retainer') {
            await expect(page.getByRole('heading', { name: 'Your goals' })).toBeVisible();
            await expect(page.getByText('E2E sat3: More enquiries from the website')).toBeVisible();
            await expect(page.getByText('Reach 40 by Mar 31, 2027')).toBeVisible();
            await expect(page.getByText('Now 12')).toBeVisible();
            await expect(page.getByText('Not agreed yet')).toHaveCount(0);
          } else {
            await expect(page.getByText('What we still need from you')).toBeVisible();
            await expect(page.getByText('Your logo file')).toBeVisible();
            await expect(page.getByText('E2E sat3: Keep the shop online')).toBeVisible();
          }

          const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(widths.scroll).toBeLessThanOrEqual(widths.client);

          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await page.mouse.move(0, 0);
          await expect(page).toHaveScreenshot(`${screen.name}-kpi-on-${size.tag}-${scheme}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
          await context.close();
        });
      }
    });
  }
}
