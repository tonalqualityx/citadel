import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';
import { BASE_SHA, NEXT_SHA, newTag, seedWorld, teardownWorld, ADMIN_EMAIL, PASSWORD, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, frame, loginState, newPage, openTask, pinElement, startPreview, tab, taskRow } from './fixtures/design-helpers';

// Designer Portal W6.8: the whole loop in a real browser against the isolated gate database. The "preview" is the
// real design-overlay.js served by a tiny static server (frame-ancestors for this Citadel origin), reached through
// a Playwright route at https://<alias>.dpe2e.pages.dev; a helper plays the daemon through the worker API.

test.describe.configure({ mode: 'serial' });

let world: DesignWorld;
let worker: DesignWorker;
let preview: Awaited<ReturnType<typeof startPreview>>;
let stateA = '';
let stateB = '';

let ctxA: BrowserContext;
let pageA: Page;
let sessionA = ''; // designer A on task a1
let applyPayload: any = null;

test.beforeAll(async () => {
  world = await seedWorld(newTag());
  worker = new DesignWorker(BASE_URL, world);
  preview = await startPreview();
  await worker.heartbeat();
  stateA = await loginState(world.designerA.email, `${world.tag}-a`);
  stateB = await loginState(world.designerB.email, `${world.tag}-b`);
});

test.afterAll(async () => {
  await ctxA?.close();
  await preview?.close();
  if (world) await teardownWorld(world);
});

test('designer login lands on /design and /dashboard bounces back', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(world.designerA.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/design$/, { timeout: 20_000 });
  await page.goto('/dashboard');
  await page.waitForURL(/\/design$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Quests|Tasks/ })).toBeVisible();
  await context.close();
});

test("the drawer shows only the designer's own projects", async ({ browser }) => {
  const { context, page } = await newPage(browser, stateA, preview.port);
  await page.goto('/design');
  await expect(page.getByRole('region', { name: world.projectA.name })).toBeVisible();
  await expect(page.getByRole('region', { name: world.projectC.name })).toBeVisible();
  await expect(page.getByText(world.tasks.a1.title)).toBeVisible();
  await expect(page.getByText(world.tasks.c1.title)).toBeVisible();
  await expect(page.getByRole('region', { name: world.projectB.name })).toHaveCount(0);
  await expect(page.getByText(world.tasks.b1.title)).toHaveCount(0);
  await context.close();
});

test("an admin's drawer lists every open task on enabled sites, and the admin's own session runs a timer", async ({ browser }) => {
  const { context, page } = await newPage(browser, SHARED_AUTH_STATE_PATH, preview.port);
  await page.goto('/design');
  for (const t of Object.values(world.tasks)) await expect(page.getByText(t.title)).toBeVisible();

  const id = await openTask(page, world.tasks.a2.title);
  await worker.claimAndSetUp(id);
  await expect(page.getByTestId('timer-pill')).toBeVisible({ timeout: 20_000 });

  const entry = await world.prisma.timeEntry.findFirst({ where: { user_id: world.adminId, task_id: world.tasks.a2.id, is_running: true } });
  expect(entry, 'a running auto time entry for the admin on the task').not.toBeNull();

  await page.goto('/design/admin');
  const row = page.locator('tr', { hasText: world.tasks.a2.title });
  await expect(row.getByTestId('session-timer')).toContainText('Running');
  await context.close();
});

test('open a session, select a card in the frame, the pin appears', async ({ browser }) => {
  ({ context: ctxA, page: pageA } = await newPage(browser, stateA, preview.port));
  sessionA = await openTask(pageA, world.tasks.a1.title);
  await expect(pageA.getByText('Setting up your preview')).toBeVisible();
  await worker.claimAndSetUp(sessionA);
  await expect(pageA.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });

  // The real overlay is alive in the frame (it posts dp:ready only when it resolved the parent origin).
  await expect(frame(pageA).locator('[data-lib="state_card"]')).toBeVisible();
  await pinElement(pageA, 'state_card');
  await tab(pageA, 'Tray').click();
  const draft = pageA.getByTestId('draft-item');
  await expect(draft).toBeVisible({ timeout: 10_000 });
  await expect(draft).toContainText('state_card');
  await draft.getByLabel('Note for the new pin').fill('Make this title 2px larger at 390 only');
  await draft.getByRole('button', { name: 'Add' }).click();
  const pin = pageA.getByTestId('pin-item');
  await expect(pin).toHaveCount(1);
  await expect(pin).toContainText('state_card');
});

test('a client file attached to an Apply reaches the worker API as files; the worker turn posts plan, action, result, change and cost; accept', async () => {
  await worker.postEvents(sessionA, [
    {
      role: 'system', kind: 'client_files',
      payload: { folder_id: 'folder-1', items: [{ id: 'file-1', name: 'brand-guide.pdf', mime: 'application/pdf', modified: '2026-10-01T00:00:00Z', path: 'Brand' }] },
    },
  ]);
  await tab(pageA, 'Client files').click();
  await expect(pageA.getByTestId('client-file')).toContainText('brand-guide.pdf', { timeout: 15_000 });
  await pageA.getByRole('button', { name: 'Attach to next Apply' }).click();
  await expect(pageA.getByTestId('attach-chip')).toContainText('brand-guide.pdf');

  await tab(pageA, 'Tray').click();
  await pageA.getByRole('button', { name: /^Apply/ }).click();

  const apply = await worker.waitForApply(sessionA);
  applyPayload = apply.payload;
  expect(applyPayload.files).toEqual([{ id: 'file-1', name: 'brand-guide.pdf', mime: 'application/pdf' }]);
  expect(applyPayload.pins).toHaveLength(1);
  expect(applyPayload.pins[0]).toMatchObject({ data_lib: 'state_card', sha: BASE_SHA, note: 'Make this title 2px larger at 390 only' });
  expect(applyPayload.pins[0].viewport.w).toBeGreaterThan(0);

  await worker.runApplyTurn(sessionA, apply);

  // Chat: plan, action -> result, assistant text, cost meter.
  await tab(pageA, 'Chat').click();
  const chat = pageA.getByTestId('chat-panel');
  await expect(chat).toContainText('I made the card heading larger.', { timeout: 20_000 });
  await expect(chat).toContainText('Edit the heading');
  await expect(chat.getByTestId('tool-line').first()).toHaveAttribute('data-state', 'ok');
  await expect(pageA.getByTestId('cost-meter')).toContainText('0.42');

  // Changes: the change shows with its screenshots; accept it.
  await tab(pageA, 'Changes').click();
  const card = pageA.getByTestId('change-card');
  await expect(card).toContainText('Made the state card heading larger', { timeout: 20_000 });
  await expect(card.getByTestId('before-after')).toBeVisible();
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card).toContainText('Accepted');
  const change = await world.prisma.designChange.findFirst({ where: { session_id: sessionA } });
  expect(change?.decision).toBe('accepted');
  const pins = await world.prisma.designPin.findMany({ where: { session_id: sessionA } });
  expect(pins.map((p) => p.status)).toEqual(['resolved']);
});

test('the elapsed-time pill appears and a hidden tab stops extending it', async () => {
  await expect(pageA.getByTestId('timer-pill')).toContainText('On this quest');
  const presence = async () => (await world.prisma.designSession.findUniqueOrThrow({ where: { id: sessionA } })).timer_presence_at?.getTime() ?? 0;
  const feed = (visible: 0 | 1) => pageA.request.get(`/api/design/sessions/${sessionA}/feed?after=0&limit=1&visible=${visible}`);

  // API level: a visible poll extends presence; a hidden one never does.
  expect((await feed(1)).status()).toBe(200);
  const p1 = await presence();
  await pageA.waitForTimeout(1500);
  const hidden = await feed(0);
  expect(hidden.status()).toBe(200);
  expect((await hidden.json()).timer.running).toBe(true);
  await pageA.waitForTimeout(500);
  expect(await presence()).toBe(p1);
  await feed(1);
  expect(await presence()).toBeGreaterThan(p1);

  // Browser level: once the tab reports hidden, its polls say visible=0 and presence stops moving.
  const seen: string[] = [];
  pageA.on('request', (r) => {
    if (/\/api\/design\/sessions\/[^/]+\/feed/.test(r.url())) seen.push(new URL(r.url()).searchParams.get('visible') ?? '');
  });
  await pageA.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => seen.includes('0'), { timeout: 45_000, intervals: [500] }).toBe(true);
  const at = seen.indexOf('0');
  const p2 = await presence();
  await pageA.waitForTimeout(2500);
  expect(seen.slice(at).includes('1')).toBe(false);
  expect(await presence()).toBe(p2);
});

test('"Belongs to another task" files a follow-up in her project and nothing for the owner', async () => {
  // Back to a visible tab for the rest of the run.
  await pageA.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const tasksBefore = await world.prisma.task.count();
  const notesBefore = await world.prisma.notification.count({ where: { user_id: world.adminId } });

  await pinElement(pageA, 'hero');
  await tab(pageA, 'Tray').click();
  const draft = pageA.getByTestId('draft-item');
  await expect(draft).toContainText('hero', { timeout: 10_000 });
  await draft.getByRole('button', { name: 'Add' }).click();
  const pin = pageA.getByTestId('pin-item').filter({ hasText: 'hero' });
  await expect(pin).toBeVisible();
  await pin.getByRole('button', { name: 'Pin actions' }).click();
  await pageA.getByRole('menuitem', { name: 'Belongs to another task' }).click();
  await expect(pageA.getByText('Follow-up task filed')).toBeVisible({ timeout: 10_000 });

  const followups = await world.prisma.task.findMany({ where: { tags: { has: 'design-followup' }, project_id: world.projectA.id } });
  expect(followups).toHaveLength(1);
  expect(followups[0].assignee_id).not.toBe(world.adminId);
  expect(followups[0].tags).not.toContain('needs-mike');
  expect(await world.prisma.task.count()).toBe(tasksBefore + 1); // exactly one task, in her project
  expect(await world.prisma.notification.count({ where: { user_id: world.adminId } })).toBe(notesBefore);
  const done = await world.prisma.designPin.findFirstOrThrow({ where: { session_id: sessionA, data_lib: 'hero' } });
  expect(done.status).toBe('followup');
});

test('publish to live: client-preview wording, confirm gated by the typed branch, direct confirm 400, worker completes, rollback for designer and admin', async ({ browser }) => {
  await pageA.getByRole('button', { name: 'Publish to live...' }).click();
  const dialog = pageA.getByTestId('publish-dialog');
  await expect(dialog.getByTestId('publish-target')).toHaveAttribute('data-tone', 'client_preview', { timeout: 15_000 });
  await expect(dialog.getByTestId('publish-target')).toContainText('client preview');
  await expect(dialog).not.toContainText('LIVE production');
  await expect(dialog.getByTestId('diff-summary')).toContainText('1 file');
  await expect(dialog.getByTestId('pages-affected')).toContainText('/');
  await expect(dialog.getByTestId('gate-status')).toContainText('build');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  const confirmBtn = dialog.getByRole('button', { name: /^Publish to the client preview/ });
  await expect(confirmBtn).toBeDisabled();
  const typed = dialog.getByLabel(/main/i);
  await typed.fill('mai');
  await expect(confirmBtn).toBeDisabled();

  // A direct confirm POST with no token and no typed text is refused (400) and queues nothing.
  const pending = await world.prisma.designPublish.findFirstOrThrow({ where: { session_id: sessionA, status: 'awaiting_confirmation' } });
  const bare = await pageA.request.post(`/api/design/publishes/${pending.id}/confirm`, { data: {} });
  expect(bare.status()).toBe(400);
  const noTyped = await pageA.request.post(`/api/design/publishes/${pending.id}/confirm`, { data: { confirmation_token: 'x'.repeat(20) } });
  expect(noTyped.status()).toBe(400);
  expect(await world.prisma.designCommand.count({ where: { session_id: sessionA, verb: 'publish' } })).toBe(0);

  await typed.fill('main');
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();
  await pageA.waitForURL(/\/design\/publishes\/[0-9a-f-]{36}/);
  const publishId = new URL(pageA.url()).pathname.split('/').pop() as string;

  const command = await world.prisma.designCommand.findFirstOrThrow({ where: { session_id: sessionA, verb: 'publish' } });
  expect((command.payload as any).publish_id).toBe(publishId);
  expect((await world.prisma.designSession.findUniqueOrThrow({ where: { id: sessionA } })).status).toBe('publishing');

  const done = await worker.completePublish(sessionA);
  expect(done.publishId).toBe(publishId);

  // Publish page: published, with Rollback for the designer who published...
  await pageA.reload();
  await expect(pageA.getByTestId('publish-status')).toContainText('Published', { timeout: 20_000 });
  await expect(pageA.getByTestId('publish-confirmed')).toHaveAttribute('data-tone', 'client_preview');
  await expect(pageA.getByRole('button', { name: 'Roll back' })).toBeVisible();
  await expect(pageA.getByTestId('publish-change').first()).toContainText('state card');

  // ...and for an admin.
  const { context, page } = await newPage(browser, SHARED_AUTH_STATE_PATH, preview.port);
  await page.goto(`/design/publishes/${publishId}`);
  await expect(page.getByTestId('publish-status')).toContainText('Published', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Roll back' })).toBeVisible();
  await context.close();

  expect((await world.prisma.designSession.findUniqueOrThrow({ where: { id: sessionA } })).status).toBe('awaiting_input');
});

test('a production site shows the production wording', async ({ browser }) => {
  const { context, page } = await newPage(browser, stateB, preview.port);
  const id = await openTask(page, world.tasks.b1.title);
  await worker.claimAndSetUp(id);
  await worker.ok('PATCH', `/api/design/worker/sessions/${id}`, {
    head_sha: NEXT_SHA,
    diff_summary: { files_changed: 2, insertions: 5, deletions: 2 },
    publish_precheck: { head_sha: NEXT_SHA, gates_ok: true, gates: [{ name: 'build', ok: true }], files_changed: ['a', 'b'], pages_affected: ['/'] },
  });
  await expect(page.getByRole('button', { name: 'Publish to live...' })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Publish to live...' }).click();
  const target = page.getByTestId('publish-dialog').getByTestId('publish-target');
  await expect(target).toHaveAttribute('data-tone', 'production', { timeout: 15_000 });
  await expect(target).toContainText('LIVE production');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: /^Publish to the LIVE production site/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('publish-dialog')).toHaveCount(0);
  // Nothing was queued.
  expect(await world.prisma.designCommand.count({ where: { session_id: id, verb: 'publish' } })).toBe(0);
  await context.close();
});

test('a site an admin turned off shows Request publish only', async ({ browser }) => {
  const admin = await newPage(browser, SHARED_AUTH_STATE_PATH, preview.port);
  const off = await admin.page.request.patch(`/api/design/admin/sites/${world.siteC.id}`, { data: { designer_publish: false } });
  expect(off.status()).toBe(200);

  const { context, page } = await newPage(browser, stateA, preview.port);
  const id = await openTask(page, world.tasks.c1.title);
  await worker.claimAndSetUp(id);
  await expect(page.getByRole('button', { name: 'Request publish' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Publish to live...' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request publish' }).click();
  await page.getByLabel(/Note to the owner/).fill('Ready when you are');
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect.poll(async () => (await world.prisma.designSession.findUniqueOrThrow({ where: { id } })).publish_requested_at !== null).toBe(true);

  await admin.page.goto('/design/admin');
  await expect(admin.page.getByTestId('publish-requests')).toContainText(world.tasks.c1.title);
  await admin.context.close();
  await context.close();
});

// Keep the unused import honest for readers: the admin login is the suite's shared one.
void ADMIN_EMAIL;
void taskRow;
