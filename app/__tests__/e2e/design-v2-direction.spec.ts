import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';
import { newTag, seedWorld, teardownWorld, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, loginState, newPage, openTask, startPreview } from './fixtures/design-helpers';
import { assertNoRealMail, draftRevision, newV2Context, openDockTab, previewMessages, seedBrief, seedDirection, seedNote, seedV2Track, type V2Track } from './fixtures/design-v2-fixture';

// Designer Portal v2 (W4.6): the Direction tab (SPEC 4.4), the width control and viewport switcher (4.2), the preview links (4.10)
// and sign-off (2.5, 4.4) in a real browser against the isolated e2e database. The worker is played through the worker route.

test.describe.configure({ mode: 'serial' });

let world: DesignWorld;
let worker: DesignWorker;
let preview: Awaited<ReturnType<typeof startPreview>>;
let track: V2Track;
let stateA = '';
let stateB = '';
let ctx: BrowserContext;
let page: Page;
let sessionId = '';
let noteId = '';
let staleRevision = '';
let previewUrl = '';

const SEEDED_SUMMARY = 'A seeded direction: plain, square, sturdy.';
const WORKER_SUMMARY = 'The worker rewrote the direction: warmer, still square.';
const REQUEST_QUOTE = 'Please keep photos of our own crew on every page.';

const summaryBox = () => page.getByRole('textbox', { name: 'Summary', exact: true });
const signSection = () => page.getByTestId('sign-off');
const signButton = () => signSection().getByRole('button', { name: 'Sign off', exact: true });
const innerWidth = () => page.frameLocator('iframe[title="Site preview"]').locator('body').evaluate(() => window.innerWidth);

test.beforeAll(async () => {
  world = await seedWorld(newTag());
  await assertNoRealMail(world);
  worker = new DesignWorker(BASE_URL, world);
  preview = await startPreview();
  await worker.heartbeat();
  track = await seedV2Track(world, { stage: 'art_direction' });
  noteId = await seedNote(world, { key: 'crew', quote: REQUEST_QUOTE, polarity: 'require', subject: 'photography' });
  await seedBrief(world, track.trackId, [{ id: 'brand', title: 'Brand', cards: [{ id: 'b1', headline: 'Plain and sturdy', summary: 'Square type, no gloss.' }] }]);
  await seedDirection(world, track.trackId, { summary: SEEDED_SUMMARY, feel: { words: ['plain', 'square'], register: 'quiet' } });
  stateA = await loginState(world.designerA.email, `${world.tag}-a`);
  stateB = await loginState(world.designerB.email, `${world.tag}-b`);
});

test.afterAll(async () => {
  await ctx?.close();
  await preview?.close();
  if (world) await teardownWorld(world);
});

test('the Direction form shows the draft the worker left', async ({ browser }) => {
  ctx = await newV2Context(browser, stateA, preview.port, { clipboard: true });
  page = await ctx.newPage();
  sessionId = await openTask(page, track.artTask.title);
  const set = await worker.claimAndSetUp(sessionId);
  previewUrl = set.previewUrl;
  await expect(page.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });

  await openDockTab(page, 'Direction');
  await expect(page.getByTestId('direction-tab')).toBeVisible();
  await expect(summaryBox()).toHaveValue(SEEDED_SUMMARY, { timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Words for the feel' })).toHaveValue('plain, square');
  await expect(page.getByRole('combobox', { name: 'Overall register' })).toHaveValue(/\d/); // "Quiet" is chosen, not "Not set"
  await expect(page.getByRole('combobox', { name: 'Overall register' }).locator('option:checked')).toHaveText('Quiet');
  await expect(page.getByTestId('signed-banner')).toHaveCount(0);
});

test('a worker update, sent with the base revision the way the daemon does, appears in the form without a reload', async () => {
  const base = await draftRevision(world, track.trackId);
  const res = await worker.api<{ direction: { revision: string; body: { summary: string } } }>('PATCH', `/api/design/worker/sessions/${sessionId}/art-direction`, {
    patch: { summary: WORKER_SUMMARY, colour: { accent_job: 'primary button only' } }, base_version: base.version, base_revision: base.revision,
  });
  expect(res.status).toBe(200);
  staleRevision = res.json.direction.revision;
  expect(staleRevision).not.toBe(base.revision);

  // No reload: the feed line (or the next poll) brings it in, and the changed fields say "Updated".
  await expect(summaryBox()).toHaveValue(WORKER_SUMMARY, { timeout: 20_000 });
  await expect(page.getByRole('textbox', { name: 'What the accent colour is for' })).toHaveValue('primary button only');
  await expect(page.getByRole('status').filter({ hasText: 'Updated' }).first()).toBeVisible();

  // The same call with the old revision is refused: the daemon must read again.
  const stale = await worker.api('PATCH', `/api/design/worker/sessions/${sessionId}/art-direction`, { patch: { summary: 'lost update' }, base_revision: base.revision });
  expect(stale.status).toBe(409);
  expect((stale.json as { code?: string }).code).toBe('version_moved');
  await expect(summaryBox()).toHaveValue(WORKER_SUMMARY);
});

test('Sign off is disabled while a client request is unanswered or the navigation and width are empty, and says why', async () => {
  await expect(signButton()).toBeDisabled();
  const reasons = signSection().getByTestId('sign-reasons');
  await expect(reasons).toContainText('Sign off is not ready yet');
  await expect(reasons).toContainText('1 client request is not answered yet.');
  await expect(reasons).toContainText('Choose the desktop navigation.');
  await expect(reasons).toContainText('Choose the phone navigation.');
  await expect(reasons).toContainText('Set the page width.');
  await expect(signButton()).toHaveAccessibleDescription(/not ready yet/);
  // The unanswered request is listed with the client's words and an Answer button.
  const missing = signSection().getByTestId('missing-request');
  await expect(missing).toContainText(REQUEST_QUOTE);
  await expect(missing.getByRole('button', { name: 'Answer this request' })).toBeVisible();
  // Forcing the click on a disabled button does nothing.
  await signButton().click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the viewport switcher offers 1440 and 1680 and lays the page out at that width', async () => {
  const group = page.getByRole('group', { name: 'Preview width' });
  for (const w of ['390', '768', '1280', '1440', '1680', 'Fit']) await expect(group.getByRole('button', { name: w, exact: true })).toBeVisible();
  await group.getByRole('button', { name: '1440', exact: true }).click();
  await expect(group.getByRole('button', { name: '1440', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await innerWidth()).toBe(1440);
  await group.getByRole('button', { name: '1680', exact: true }).click();
  await expect(group.getByRole('button', { name: '1680', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await innerWidth()).toBe(1680);
  await group.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(group.getByRole('button', { name: 'Fit', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the width control changes the previewed width (a dp:preview-token reaches the frame) and saving writes the container fields', async () => {
  await page.getByRole('button', { name: 'Width', exact: true }).click();
  const panel = page.getByRole('group', { name: 'Page width' }).filter({ has: page.getByRole('button', { name: 'Save to direction' }) });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('width-summary')).toContainText('Showing the built page');
  await expect(panel.getByRole('button', { name: 'Save to direction' })).toBeDisabled(); // nothing picked yet

  await panel.getByRole('button', { name: '1280', exact: true }).click();
  await expect(panel.getByRole('button', { name: '1280', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('width-summary')).toContainText('1280px wide');
  await expect.poll(async () => (await previewMessages(page)).map((m) => m.data as { type?: string; name?: string; value?: string | null }).find((m) => m.type === 'dp:preview-token' && m.name === '--maxw')?.value, { timeout: 10_000 }).toBe('1280px');

  await panel.getByRole('radio', { name: /^Standard/ }).check();
  await panel.getByRole('radio', { name: /Padding cap/ }).check();
  await expect.poll(async () => (await previewMessages(page)).map((m) => m.data as { name?: string; value?: string | null }).filter((m) => m.name === '--gutter-desktop').map((m) => m.value)).toContain('48px');
  await expect.poll(async () => JSON.stringify((await previewMessages(page)).map((m) => m.data)), { timeout: 10_000 }).toContain('padding_cap');

  // A typed width goes through the same road, and a bad one is refused without a message to the frame.
  const typed = panel.getByLabel('Or type a width');
  await typed.fill('1500');
  await expect.poll(async () => (await previewMessages(page)).map((m) => m.data as { name?: string; value?: string | null }).filter((m) => m.name === '--maxw').map((m) => m.value)).toContain('1500px');
  const before = (await previewMessages(page)).length;
  await typed.fill('99999');
  await expect(panel.getByRole('alert')).toContainText('Enter a whole number from');
  expect((await previewMessages(page)).length).toBe(before);
  await typed.fill('1280');
  await expect(panel.getByRole('button', { name: '1280', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/art-direction`) && r.request().method() === 'PATCH');
  await panel.getByRole('button', { name: 'Save to direction' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId('width-status')).toContainText('Saved to the direction.');

  const row = await world.prisma.designArtDirection.findFirstOrThrow({ where: { track_id: track.trackId, status: 'draft' } });
  const body = row.body as { container?: { max_content_px?: number; method?: string; gutters_px?: Record<string, number> }; summary?: string };
  expect(body.container).toMatchObject({ max_content_px: 1280, method: 'padding_cap', gutters_px: { phone: 16, tablet: 32, desktop: 48 } });
  expect(body.summary).toBe(WORKER_SUMMARY); // the merge touched only the container

  // The form reads the saved width without a reload, and the "page width" reason is gone.
  await expect(page.getByRole('textbox', { name: 'Widest the content gets (px)' })).toHaveValue('1280', { timeout: 15_000 });
  await expect(signSection().getByTestId('sign-reasons')).not.toContainText('Set the page width.');
});

test('answering the client request and choosing both navigations enables Sign off', async () => {
  await signSection().getByTestId('missing-request').getByRole('button', { name: 'Answer this request' }).click();
  await expect(signSection().getByTestId('sign-reasons')).toContainText('Say how each client request is honoured.');
  await expect(signButton()).toBeDisabled();
  await page.getByRole('textbox', { name: 'How this is honoured' }).fill('Real crew photos on every page, no stock.');
  await page.keyboard.press('Tab'); // leave the field the way a keyboard user does (see the fixme below for why it matters)
  await page.getByRole('combobox', { name: 'Desktop navigation' }).selectOption({ label: 'Logo left, links inline' });
  await page.getByRole('combobox', { name: 'Phone navigation' }).selectOption({ label: 'Drawer from the right' });

  await expect(signButton()).toBeEnabled({ timeout: 20_000 });
  await expect(signSection().getByTestId('sign-reasons')).toContainText('Everything needed is filled in.');
  await expect(signSection().getByTestId('missing-request')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  const row = await world.prisma.designArtDirection.findFirstOrThrow({ where: { track_id: track.trackId, status: 'draft' } });
  const body = row.body as { nav?: { desktop?: { pattern?: string }; mobile?: { pattern?: string } }; client_requests?: Array<{ design_note_id: string; how_honoured: string }> };
  expect(body.nav?.desktop?.pattern).toBe('inline');
  expect(body.nav?.mobile?.pattern).toBe('drawer_right');
  expect(body.client_requests).toEqual([{ design_note_id: noteId, how_honoured: 'Real crew photos on every page, no stock.' }]);
});

// Regression: the database returns an object's keys in its own order, so a saved answer once looked unsaved for as long as its
// field kept focus and Sign off stayed disabled. `sameValue` in direction-model.ts now compares without regard to key order.
test('Sign off enables as soon as the answer has saved, without leaving the answer field', async () => {
  await page.getByRole('textbox', { name: 'How this is honoured' }).fill('Real crew photos on every page, no stock, ever.');
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });
  await expect(signSection().getByTestId('sign-reasons')).not.toContainText('still saving');
  await expect(signButton()).toBeEnabled();
});

test('the Preview links control opens this page and the site in new tabs, copies the links, and emails the link to the caller', async () => {
  // Go to the About page so the bridge reports a path for "this page".
  await page.getByRole('textbox', { name: 'Preview path' }).fill('/about.html');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Preview links', exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const panel = page.getByRole('group', { name: 'Preview links' });
  const pageLink = panel.getByRole('link', { name: 'Open this page (opens in a new tab)' });
  const siteLink = panel.getByRole('link', { name: 'Open the site (opens in a new tab)' });
  await expect(pageLink).toBeVisible({ timeout: 15_000 });

  const siteUrl = new URL('/', previewUrl).toString();
  const pageUrl = new URL('/about.html', previewUrl).toString();
  expect(new URL(previewUrl).hostname).toMatch(/^design-t-[a-z0-9]{16}\.dpe2e\.pages\.dev$|^[a-z0-9-]+\.dpe2e\.pages\.dev$/);
  await expect(pageLink).toHaveAttribute('href', pageUrl);
  await expect(siteLink).toHaveAttribute('href', siteUrl);
  await expect(pageLink).toHaveAttribute('target', '_blank');
  await expect(siteLink).toHaveAttribute('rel', 'noopener noreferrer');

  // Each opens a new tab at the right address (served by the routed fake host).
  const [pagePopup] = await Promise.all([ctx.waitForEvent('page'), pageLink.click()]);
  await pagePopup.waitForLoadState('domcontentloaded');
  expect(pagePopup.url()).toBe(pageUrl);
  await pagePopup.close();
  const [sitePopup] = await Promise.all([ctx.waitForEvent('page'), siteLink.click()]);
  await sitePopup.waitForLoadState('domcontentloaded');
  expect(sitePopup.url()).toBe(siteUrl);
  await sitePopup.close();

  // Copy puts the link on the clipboard.
  await panel.getByRole('button', { name: 'Copy link to this page' }).click();
  await expect(panel.getByRole('button', { name: 'Copied link to this page' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pageUrl);
  await panel.getByRole('button', { name: 'Copy link to the site' }).click();
  await expect(panel.getByRole('button', { name: 'Copied link to the site' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(siteUrl);

  // Email me this link: the route answers 200 and the page says so. The address is never in the request; the route is strict.
  const outboxBefore = await world.prisma.emailOutbox.count();
  const sent = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/preview-link`) && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Email me this link' }).click();
  const answer = await sent;
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toEqual({ sent: true });
  expect(answer.request().postDataJSON()).toEqual({ path: '/about.html' });
  await expect(page.getByRole('status').filter({ hasText: 'Sent to your email.' })).toBeAttached();

  // Where the mail went: the e2e app runs `next dev`, where sendEmail logs to the console and writes no outbox row, and no
  // sendgrid integration is active (asserted in beforeAll). If an outbox row did get written it must be to her own address.
  const rows = await world.prisma.emailOutbox.findMany({ where: { created_at: { gte: new Date(Date.now() - 60_000) }, subject: { contains: world.siteA.name } } });
  expect(rows.length).toBe((await world.prisma.emailOutbox.count()) - outboxBefore);
  for (const r of rows) expect(r.to).toBe(world.designerA.email);

  // A request that names another recipient is refused outright (the route is strict), and so is another designer's call.
  const smuggle = await page.request.post(`/api/design/sessions/${sessionId}/preview-link`, { data: { path: '/', to: 'someone@else.example' } });
  expect(smuggle.status()).toBe(400);
  const other = await otherDesigner(stateB);
  expect((await other.post(`/api/design/sessions/${sessionId}/preview-link`, { data: { path: '/' } })).status()).toBe(404);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

async function otherDesigner(state: string) {
  const { request } = await import('@playwright/test');
  return request.newContext({ baseURL: BASE_URL, storageState: state });
}

test('sign-off: a stale sign gets 409, an admin and a stranger are refused, then the designer signs and the form freezes', async ({ browser }) => {
  // The revision the worker's edit produced is older than what the form has saved since: a stale tab or a late daemon.
  const now = await draftRevision(world, track.trackId);
  expect(now.revision).not.toBe(staleRevision);
  const stale = await page.request.post(`/api/design/sessions/${sessionId}/art-direction/sign`, { data: { base_version: now.version, base_revision: staleRevision } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe('version_moved');
  expect((await world.prisma.designArtDirection.findFirstOrThrow({ where: { track_id: track.trackId } })).status).toBe('draft');

  // Nobody else can sign: another designer is a stranger to the session (404), an admin is refused (403 designer_only).
  const stranger = await otherDesigner(stateB);
  expect((await stranger.post(`/api/design/sessions/${sessionId}/art-direction/sign`, { data: { base_version: now.version, base_revision: now.revision } })).status()).toBe(404);
  const admin = await newPage(browser, SHARED_AUTH_STATE_PATH, preview.port);
  const refused = await admin.page.request.post(`/api/design/sessions/${sessionId}/art-direction/sign`, { data: { base_version: now.version, base_revision: now.revision } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe('designer_only');
  await admin.context.close();
  expect((await world.prisma.designArtDirection.findFirstOrThrow({ where: { track_id: track.trackId } })).status).toBe('draft');

  // The designer signs through the page.
  await signButton().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Sign off this direction?' })).toBeVisible();
  const signed = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/art-direction/sign`) && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Sign off', exact: true }).click();
  expect((await signed).status()).toBe(200);

  const banner = page.getByTestId('signed-banner');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText('Signed');
  await expect(banner).toContainText('version 1');
  await expect(banner).toContainText('can no longer be edited');
  // Frozen: no inputs, no sign-off block, and the words are shown as text.
  await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveCount(0);
  await expect(signSection()).toHaveCount(0);
  await expect(page.getByTestId('direction-tab')).toContainText(WORKER_SUMMARY);
  // Home becomes the current step.
  await expect(page.getByRole('navigation', { name: 'Design stages' }).getByRole('listitem').filter({ hasText: 'Home' })).toHaveAttribute('aria-current', 'step', { timeout: 15_000 });

  const dir = await world.prisma.designArtDirection.findFirstOrThrow({ where: { track_id: track.trackId, version: 1 } });
  expect(dir.status).toBe('signed');
  expect(dir.signed_by_id).toBe(world.designerA.id);
  expect((await world.prisma.designTrack.findUniqueOrThrow({ where: { id: track.trackId } })).stage).toBe('home_build');
  const kinds = (await world.prisma.designJob.findMany({ where: { track_id: track.trackId } })).map((j) => j.kind);
  expect(kinds).toEqual(expect.arrayContaining(['home_build', 'client_brief_email']));

  // A signed version cannot be edited through the API either.
  const edit = await page.request.patch(`/api/design/sessions/${sessionId}/art-direction`, { data: { patch: { summary: 'late edit' }, base_version: 1 } });
  expect(edit.status()).toBe(409);
});

test('Revise direction opens a new draft that is editable again', async () => {
  // While Bast builds the home page the button is not offered (busy). The daemon's adopt completion is simulated here the way
  // the stage machine leaves the track: stage refine, no busy job.
  await expect(page.getByRole('button', { name: 'Revise direction' })).toHaveCount(0);
  await world.prisma.designJob.updateMany({ where: { track_id: track.trackId, kind: 'home_build' }, data: { status: 'done' } });
  await world.prisma.designTrack.update({ where: { id: track.trackId }, data: { stage: 'refine', busy_job_id: null } });
  await page.reload();
  await expect(page.getByTestId('preview-state')).toBeVisible({ timeout: 20_000 });
  await openDockTab(page, 'Direction');
  const revise = page.getByRole('button', { name: 'Revise direction' });
  await expect(revise).toBeVisible({ timeout: 15_000 });
  const revised = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/art-direction/revise`) && r.request().method() === 'POST');
  await revise.click();
  expect((await revised).status()).toBe(201);

  await expect(page.getByTestId('signed-banner')).toHaveCount(0, { timeout: 15_000 });
  await expect(summaryBox()).toHaveValue(WORKER_SUMMARY);
  await summaryBox().fill('Second version: now with a warmer accent.');
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });

  const rows = await world.prisma.designArtDirection.findMany({ where: { track_id: track.trackId }, orderBy: { version: 'asc' } });
  expect(rows.map((r) => [r.version, r.status])).toEqual([[1, 'signed'], [2, 'draft']]);
  expect((rows[1].body as { summary?: string }).summary).toBe('Second version: now with a warmer accent.');
  expect((rows[0].body as { summary?: string }).summary).toBe(WORKER_SUMMARY); // the signed version is untouched
});
