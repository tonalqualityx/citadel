import { test, expect, type Page } from '@playwright/test';
import { newTag, seedWorld, teardownWorld, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, loginState, newPage, siteRow, startPreview } from './fixtures/design-helpers';

// Staff layout: a tech user gets the Citadel shell and the Sites list; the workspace fills the viewport exactly
// (the page never scrolls, the preview does) and the top of the page can be hidden for a taller preview.

test.describe.configure({ mode: 'serial' });

let world: DesignWorld;
let worker: DesignWorker;
let preview: Awaited<ReturnType<typeof startPreview>>;
let stateTech = '';
let stateA = '';
let techSession = '';

const VIEWPORTS = [
  { width: 1440, height: 900, desktop: true },
  { width: 1280, height: 720, desktop: true },
  { width: 1100, height: 700, desktop: true },
  { width: 390, height: 844, desktop: false },
];

test.beforeAll(async () => {
  world = await seedWorld(newTag());
  worker = new DesignWorker(BASE_URL, world);
  preview = await startPreview();
  await worker.heartbeat();
  stateTech = await loginState(world.tech.email, `${world.tag}-tech`);
  stateA = await loginState(world.designerA.email, `${world.tag}-sl-a`);
});

test.afterAll(async () => {
  await preview?.close();
  if (world) await teardownWorld(world);
});

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
const frameHeight = async (page: Page) => (await page.getByTestId('preview-frame-wrapper').boundingBox())?.height ?? 0;

/** The page never scrolls at any of the viewports; at desktop sizes the preview frame is visible and tall enough. */
async function expectFillsViewport(page: Page): Promise<void> {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect.poll(() => noPageScroll(page), { message: `no page scroll at ${vp.width}x${vp.height}`, timeout: 10_000 }).toBe(true);
    const layout = () => page.evaluate(() => {
      const stage = document.querySelector('[data-testid="workspace-stage"]')?.getBoundingClientRect();
      const wrapper = document.querySelector('[data-testid="preview-frame-wrapper"]')?.getBoundingClientRect();
      return { stageBottom: stage ? stage.bottom : Number.POSITIVE_INFINITY, wrapperHeight: wrapper ? wrapper.height : 0, innerHeight: window.innerHeight };
    });
    await expect.poll(async () => { const l = await layout(); return l.stageBottom <= l.innerHeight + 1; }, { message: `stage bottom inside the viewport at ${vp.width}x${vp.height}`, timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await layout()).wrapperHeight, { message: `preview wrapper height at ${vp.width}x${vp.height}`, timeout: 10_000 }).toBeGreaterThan(150);
    if (vp.desktop) {
      const iframe = page.locator('iframe[title="Site preview"]');
      await expect(iframe).toBeVisible();
      await expect.poll(async () => (await iframe.boundingBox())?.height ?? 0, { message: `preview height at ${vp.width}x${vp.height}` }).toBeGreaterThan(150);
    }
  }
}

/** Hide the top, check it, reload, check it again, then show it again. `wrap` is the shell's header wrapper test id. */
async function expectHideTop(page: Page, wrap: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  const toggle = page.getByTestId('top-toggle');
  const shellHeader = page.getByTestId(wrap);
  const workspaceHeader = page.locator('header', { has: page.getByTestId('preview-state') });
  await expect(shellHeader).toBeVisible();
  await expect(workspaceHeader).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const before = await frameHeight(page);
  expect(before).toBeGreaterThan(150);

  await toggle.click();
  await expect(shellHeader).toBeHidden();
  await expect(workspaceHeader).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => frameHeight(page), { message: 'the preview area got taller' }).toBeGreaterThan(before);
  expect(await noPageScroll(page)).toBe(true);

  await page.reload();
  await expect(page.getByTestId('top-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(wrap)).toBeHidden();
  await expect(page.locator('header', { has: page.getByTestId('preview-state') })).toBeHidden();
  expect(await noPageScroll(page)).toBe(true);

  await page.getByTestId('top-toggle').click();
  await expect(page.getByTestId(wrap)).toBeVisible();
  await expect(page.locator('header', { has: page.getByTestId('preview-state') })).toBeVisible();
  await expect(page.getByTestId('top-toggle')).toHaveAttribute('aria-pressed', 'false');
}

test('a tech user sees /design in the staff shell with a Sites list, opens a site, and Resume returns to the same session', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateTech, preview.port);
  await page.goto('/design');
  const nav = page.locator('aside');
  await expect(nav.getByRole('link', { name: /Design/ })).toBeVisible({ timeout: 20_000 });
  await expect(nav.locator('a[href="/projects"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sites', level: 1 })).toBeVisible();

  // Every enabled fixture site's project, with no assignment needed.
  for (const p of [world.projectA, world.projectB, world.projectC]) await expect(siteRow(page, p.id)).toBeVisible();

  const row = siteRow(page, world.projectA.id);
  await row.getByRole('button', { name: 'Open' }).click();
  await page.waitForURL(/\/design\/s\/[0-9a-f-]{36}/, { timeout: 20_000 });
  techSession = new URL(page.url()).pathname.split('/').pop() as string;

  await page.goto('/design');
  const again = siteRow(page, world.projectA.id);
  await expect(again.getByRole('button', { name: 'Resume' })).toBeVisible();
  await again.getByRole('button', { name: 'Resume' }).click();
  await page.waitForURL(/\/design\/s\/[0-9a-f-]{36}/);
  expect(new URL(page.url()).pathname.split('/').pop()).toBe(techSession);
  await context.close();
});

test('as a tech user the workspace fills the viewport and the page never scrolls', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateTech, preview.port);
  await worker.claimAndSetUp(techSession);
  await page.goto(`/design/s/${techSession}`);
  await expect(page.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });
  await expectFillsViewport(page);
  await context.close();
});

test('as a tech user the top of the page can be hidden, stays hidden after a reload, and comes back', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateTech, preview.port);
  await page.goto(`/design/s/${techSession}`);
  await expect(page.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });
  await expectHideTop(page, 'staff-header-wrap');
  await context.close();
});

test("a designer sees only their own projects' site rows", async ({ browser }) => {
  const { context, page } = await newPage(browser, stateA, preview.port);
  await page.goto('/design');
  await expect(siteRow(page, world.projectA.id)).toBeVisible();
  await expect(siteRow(page, world.projectC.id)).toBeVisible();
  await expect(siteRow(page, world.projectB.id)).toHaveCount(0);
  await expect(page.getByTestId('site-row')).toHaveCount(2);
  await context.close();
});

test('as a designer the workspace fills the viewport, and the top can be hidden', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateA, preview.port);
  await page.goto('/design');
  await siteRow(page, world.projectC.id).getByRole('button', { name: 'Open' }).click();
  await page.waitForURL(/\/design\/s\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const id = new URL(page.url()).pathname.split('/').pop() as string;
  await worker.claimAndSetUp(id);
  await expect(page.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });
  await expectFillsViewport(page);
  await expectHideTop(page, 'designer-header-wrap');
  await context.close();
});
