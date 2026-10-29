import { test, expect } from '@playwright/test';
import { newTag, seedWorld, teardownWorld, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, HOSTILE_ORIGIN, frame, loginState, newPage, openTask, pinElement, startPreview } from './fixtures/design-helpers';

// Designer Portal W6.8, the security half: what a designer cannot reach, and what a hostile frame cannot do.

test.describe.configure({ mode: 'serial' });

let world: DesignWorld;
let worker: DesignWorker;
let preview: Awaited<ReturnType<typeof startPreview>>;
let stateA = '';
let stateB = '';
let sessionId = '';

test.beforeAll(async () => {
  world = await seedWorld(newTag());
  worker = new DesignWorker(BASE_URL, world);
  preview = await startPreview();
  await worker.heartbeat();
  stateA = await loginState(world.designerA.email, `${world.tag}-sa`);
  stateB = await loginState(world.designerB.email, `${world.tag}-sb`);
});

test.afterAll(async () => {
  await preview?.close();
  if (world) await teardownWorld(world);
});

test('as a designer, the time-entry routes are 403', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateA, preview.port);
  expect((await page.request.get('/api/time-entries')).status()).toBe(403);
  expect((await page.request.get('/api/time-entries/active')).status()).toBe(403);
  // And nothing staff-only is reachable either.
  expect((await page.request.get('/api/design/admin/settings')).status()).toBe(403);
  expect((await page.request.get('/api/design/worker/inbox')).status()).toBe(403);
  expect((await page.request.get('/api/tasks')).status()).toBe(403);
  await context.close();
});

test('another designer gets 404 on the session, its feed and its assets', async ({ browser }) => {
  const a = await newPage(browser, stateA, preview.port);
  sessionId = await openTask(a.page, world.tasks.a1.title);
  await worker.claimAndSetUp(sessionId);
  await a.context.close();

  const b = await newPage(browser, stateB, preview.port);
  for (const url of [`/api/design/sessions/${sessionId}`, `/api/design/sessions/${sessionId}/feed`, `/api/design/sessions/${sessionId}/assets/${sessionId}`]) {
    expect((await b.page.request.get(url)).status(), url).toBe(404);
  }
  const apply = await b.page.request.post(`/api/design/sessions/${sessionId}/pins`, { data: { path: '/' } });
  expect([400, 404]).toContain(apply.status());
  await b.page.goto(`/design/s/${sessionId}`);
  await expect(b.page.getByTestId('preview-state')).toHaveCount(0);
  await expect(b.page.locator('iframe[title="Site preview"]')).toHaveCount(0);
  await expect(b.page.getByText(world.tasks.a1.title)).toHaveCount(0);
  // Opening a task on a project she is not on is refused the same way.
  const open = await b.page.request.post('/api/design/sessions', { data: { task_id: world.tasks.a2.id } });
  expect(open.status()).toBe(404);
  await b.context.close();
});

test('a hostile frame on a third origin cannot add a pin', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateA, preview.port, true);
  const pinPosts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/pins$/.test(r.url())) pinPosts.push(r.url());
  });
  await page.goto(`/design/s/${sessionId}`);
  await expect(page.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });

  // A frame on another origin, beside the real one, posting valid packets at its parent with targetOrigin "*".
  await page.evaluate((origin) => {
    const f = document.createElement('iframe');
    f.id = 'hostile';
    f.src = origin + '/';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:200px;height:100px';
    document.body.appendChild(f);
  }, HOSTILE_ORIGIN);
  await expect(page.frameLocator('#hostile').locator('body')).toContainText('hostile');
  await page.waitForTimeout(6000); // the page re-posts for ~5 s

  await expect(page.getByTestId('selection-chip')).toHaveCount(0);
  await expect(page.getByText('EVIL PIN')).toHaveCount(0);
  expect(pinPosts).toEqual([]);
  expect(await world.prisma.designPin.count({ where: { session_id: sessionId } })).toBe(0);

  // Control: the real preview, same page, still pins through the real overlay.
  await expect(frame(page).locator('[data-lib="state_card"]')).toBeVisible();
  await pinElement(page, 'state_card');
  await expect(page.getByTestId('selection-chip')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('selection-chip')).not.toContainText('EVIL');
  await context.close();
});

test('the preview frame itself is locked down', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateA, preview.port);
  await page.goto(`/design/s/${sessionId}`);
  const iframe = page.locator('iframe[title="Site preview"]');
  await expect(iframe).toBeVisible({ timeout: 20_000 });
  expect(await iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  expect(await iframe.getAttribute('src')).toMatch(/^https:\/\/design-[a-z0-9]+\.dpe2e\.pages\.dev\//);
  // The preview host must not be framable by anyone but this Citadel origin (the header the fixture sends).
  const res = await fetch(`http://127.0.0.1:${preview.port}/`);
  expect(res.headers.get('content-security-policy')).toBe(`frame-ancestors ${BASE_URL}`);
  await context.close();
});
