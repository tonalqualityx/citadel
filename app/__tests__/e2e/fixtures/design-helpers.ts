/** Shared plumbing for the Designer Portal e2e specs: logins, the fake preview host, the select-and-pin gesture. */
import path from 'node:path';
import { expect, request as pwRequest, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, BASE_SHA } from './design-portal-fixture';
import { startPreviewServer } from './design-preview/server';

export const PW_PORT = process.env.PW_PORT || '3000';
export const BASE_URL = `http://localhost:${PW_PORT}`;
const STATE_DIR = path.resolve(__dirname, '..', '..', '..', 'test-results');

/** Real API login (no UI), saved as a storage state file. Few logins on purpose: /api/auth/login is 10 req/min. */
export async function loginState(email: string, label: string): Promise<string> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/auth/login', { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${email} -> ${res.status()}`);
  const file = path.join(STATE_DIR, `.dpe2e-${label}.json`);
  await ctx.storageState({ path: file });
  await ctx.dispose();
  return file;
}

/** A page for the fixture preview host: any https://<alias>.dpe2e.pages.dev is served by the local static server. */
export async function startPreview() {
  const server = await startPreviewServer({ portalOrigin: BASE_URL, sha: BASE_SHA });
  return server;
}

export async function routePreview(context: BrowserContext, previewPort: number): Promise<void> {
  await context.route(/^https:\/\/[a-z0-9-]+\.dpe2e\.pages\.dev\//, async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(`http://127.0.0.1:${previewPort}${u.pathname}${u.search}`);
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v;
    });
    await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
}

/** A hostile page on a third origin: it posts a valid-looking dp:packet and dp:ready at its parent, repeatedly. */
export const HOSTILE_ORIGIN = 'https://hostile.dpe2e-evil.test';
const HOSTILE_HTML = `<!doctype html><title>hostile</title><body>hostile<script>
function packet(){return {type:'dp:packet',path:'/',sha:'${BASE_SHA}',data_lib:'hero',lib_stack:['hero'],data_shape:null,
 selector:'section[data-lib="hero"]:nth-of-type(1)',tag:'section',classes:['card'],text_quote:'EVIL PIN',bbox:{x:0,y:0,w:10,h:10},viewport:{w:1000,h:700}};}
function go(){try{parent.postMessage(packet(),'*');parent.postMessage({type:'dp:ready',path:'/',sha:'${BASE_SHA}',viewport:{w:1,h:1}},'*');
 parent.postMessage({type:'dp:navigate',path:'/evil'},'*');}catch(e){}}
go();var n=0;var t=setInterval(function(){go();if(++n>20)clearInterval(t);},250);
</script></body>`;

export async function routeHostile(context: BrowserContext): Promise<void> {
  await context.route(`${HOSTILE_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: HOSTILE_HTML }));
}

export async function newPage(browser: Browser, storageState: string, previewPort: number, hostile = false): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState });
  await routePreview(context, previewPort);
  if (hostile) await routeHostile(context);
  return { context, page: await context.newPage() };
}

/** The drawer row for a task title. */
export const taskRow = (page: Page, title: string) => page.locator('li', { hasText: title }).filter({ has: page.getByRole('button') });

/** Start/Resume a task from the drawer and return the new session id from the URL. */
export async function openTask(page: Page, title: string): Promise<string> {
  await page.goto('/design');
  const row = taskRow(page, title);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Start|Resume/ }).click();
  await page.waitForURL(/\/design\/s\/[0-9a-f-]{36}/);
  return new URL(page.url()).pathname.split('/').pop() as string;
}

export const frame = (page: Page) => page.frameLocator('iframe[title="Site preview"]');

/** Select mode via the S key, then click a data-lib element inside the real overlay in the frame. */
export async function pinElement(page: Page, dataLib: string): Promise<void> {
  await page.locator('body').click({ position: { x: 2, y: 2 } }); // focus the parent document, not the frame
  // The chat floats over the preview's bottom-right; tuck it away so it cannot cover the element being clicked.
  const collapse = page.getByRole('button', { name: 'Collapse chat' });
  if (await collapse.isVisible()) await collapse.click();
  const select = page.getByRole('button', { name: 'Select' });
  if ((await select.getAttribute('aria-pressed')) !== 'true') await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
  await frame(page).locator(`[data-lib="${dataLib}"]`).first().click();
}

export const tab = (page: Page, name: string) => page.getByRole('tab', { name });

/** The chat is a floating panel; expand it from the pill when it is collapsed (it starts open on a fresh browser). */
export async function expandChat(page: Page): Promise<void> {
  const pill = page.getByTestId('chat-pill');
  if (await pill.isVisible()) await pill.click();
  await expect(page.getByTestId('chat-dock')).toBeVisible();
}
