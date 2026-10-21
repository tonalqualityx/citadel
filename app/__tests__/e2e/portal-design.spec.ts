import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

// Portal redesign (slice 3) visual and behavior pass. For Home, Requests, Request new, Work,
// Retainer, History and Login, at 390 by 844 and 1280 by 900, light and dark, with a fixed clock:
//  - no horizontal scroll;
//  - Request work is visible in the viewport (signed-in screens);
//  - the first Tab lands on a visible element with a focus outline;
//  - every [data-tone] chip holds an aria-hidden icon and a word;
//  - the primary button has a real background (the invisible-button regression of phase B section 0);
//  - the full-page screenshot matches the baseline (run with --update-snapshots to write it; the
//    portal-design Playwright config points the baselines at the indelible-ops screens folder).
// Fixtures: scripts/seed-portal-v2-phase1-fixtures.ts then scripts/seed-portal-b2-fixtures.ts.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const TS = 'npx ts-node --compiler-options \'{"module":"CommonJS"}\'';
const OWNER_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');

let taskId = '';

test.beforeAll(() => {
  execSync(`${TS} scripts/seed-portal-v2-phase1-fixtures.ts`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-contract-sign-kickoff-e2e-fixtures.ts`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-portal-b3-fixtures.ts`, { cwd: APP_ROOT, stdio: 'inherit' });
  const out = execSync(`${TS} scripts/seed-portal-b2-fixtures.ts`, { cwd: APP_ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}';
  taskId = JSON.parse(line).thread_task_id;
  execSync(`${TS} scripts/seed-portal-b2-fixtures.ts --reset-thread ${taskId}`, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.afterAll(() => {
  execSync(`${TS} scripts/seed-portal-b3-fixtures.ts --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
  execSync(`${TS} scripts/seed-portal-b2-fixtures.ts --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.describe.configure({ mode: 'serial' });

const SIZES = [
  { tag: '390', width: 390, height: 844 },
  { tag: '1280', width: 1280, height: 900 },
];
const SCHEMES = ['light', 'dark'] as const;

const SCREENS: Array<{ name: string; url: () => string; signedIn: boolean; ready: RegExp | string }> = [
  { name: 'home', url: () => '/portal/home', signedIn: true, ready: /need|Nothing needs you/i },
  { name: 'requests', url: () => '/portal/requests', signedIn: true, ready: /open request|No open requests/i },
  { name: 'request-new', url: () => '/portal/requests/new', signedIn: true, ready: 'Ask us for something' },
  { name: 'work', url: () => `/portal/work/${taskId}`, signedIn: true, ready: /Update the opening hours/ },
  { name: 'retainer', url: () => '/portal/retainer', signedIn: true, ready: /E2E Growth plan/ },
  { name: 'history', url: () => '/portal/history', signedIn: true, ready: 'What we have finished together' },
  { name: 'projects', url: () => '/portal/projects', signedIn: true, ready: /active projects?|No active projects/i },
  { name: 'book', url: () => '/portal/book', signedIn: true, ready: 'Book a meeting' },
  { name: 'select', url: () => '/portal/select', signedIn: true, ready: 'Choose an account' },
  { name: 'task-approval', url: () => '/portal/task-approval/e2e-b2-approval-page-token', signedIn: true, ready: /Homepage refresh/ },
  { name: 'proposal', url: () => `/portal/proposal/${'e2e-b3-proposal-fixture-token-'.padEnd(128, 'p')}`, signedIn: true, ready: /\S/ },
  { name: 'contract', url: () => `/portal/contract/${'e2e-kickoff-contract-fixture-token-'.padEnd(128, 'a')}`, signedIn: true, ready: /\S/ },
  { name: 'login', url: () => '/portal/login', signedIn: false, ready: 'Sign in to your Indelible portal' },
];

async function settle(page: Page, ready: RegExp | string) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(ready);
  // Let the web fonts finish so the baseline is stable.
  await page.evaluate(() => document.fonts.ready);
}

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`${size.tag} ${scheme}`, () => {
      for (const screen of SCREENS) {
        test(screen.name, async ({ browser }) => {
          // The account picker only shows with two accounts; give the owner one for this screen only.
          if (screen.name === 'select') execSync(`${TS} scripts/seed-portal-b3-fixtures.ts --second-account`, { cwd: APP_ROOT, stdio: 'inherit' });
          try {
          const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, reducedMotion: 'reduce' });
          if (screen.signedIn) {
            await context.addCookies([{ name: 'client_session', value: OWNER_TOKEN, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
          }
          const page = await context.newPage();
          await page.clock.setFixedTime('2026-10-21T14:00:00-04:00');
          await page.goto(screen.url());
          await settle(page, screen.ready);

          // No horizontal scroll.
          const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(widths.scroll).toBeLessThanOrEqual(widths.client);

          // Request work is in the viewport on signed-in screens (sidebar on wide, top bar on phones).
          if (screen.signedIn) {
            const rw = page.getByRole('link', { name: /^(Request work|Request)$/ }).filter({ visible: true }).first();
            await expect(rw).toBeVisible();
            await expect(rw).toBeInViewport();
          }

          // The first Tab lands on a visible element with a real focus outline.
          await page.keyboard.press('Tab');
          const focus = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { w: r.width, h: r.height, outline: cs.outlineStyle, outlineWidth: cs.outlineWidth };
          });
          expect(focus, 'something took focus').not.toBeNull();
          expect(focus!.w).toBeGreaterThan(0);
          expect(focus!.h).toBeGreaterThan(0);
          expect(focus!.outline).not.toBe('none');

          // Every chip is an aria-hidden icon plus a word.
          const chips = page.locator('[data-tone]');
          const n = await chips.count();
          for (let i = 0; i < n; i++) {
            const chip = chips.nth(i);
            await expect(chip.locator('svg[aria-hidden="true"]').first()).toBeAttached();
            expect(((await chip.textContent()) ?? '').trim().length).toBeGreaterThan(0);
          }

          // The primary button is not transparent.
          const primary = page.locator('.btn-primary').filter({ visible: true }).first();
          if ((await primary.count()) > 0) {
            const bg = await primary.evaluate((el) => getComputedStyle(el).backgroundColor);
            expect(bg).not.toBe('rgba(0, 0, 0, 0)');
            expect(bg).not.toBe('transparent');
          }

          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await page.mouse.move(0, 0);
          await expect(page).toHaveScreenshot(`${screen.name}-${size.tag}-${scheme}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
          await context.close();
          } finally {
            if (screen.name === 'select') execSync(`${TS} scripts/seed-portal-b3-fixtures.ts --cleanup-second-account`, { cwd: APP_ROOT, stdio: 'inherit' });
          }
        });
      }
    });
  }
}
