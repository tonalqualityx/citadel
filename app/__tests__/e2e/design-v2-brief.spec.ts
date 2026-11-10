import { test, expect, type BrowserContext, type Dialog, type Page } from '@playwright/test';
import { newTag, seedWorld, teardownWorld, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, loginState, openTask, startPreview } from './fixtures/design-helpers';
import { newV2Context, openDockTab, seedBrief, seedNote, seedV2Track, type V2Track } from './fixtures/design-v2-fixture';

// Designer Portal v2 (W4.6): the Brief tab (SPEC 4.1) and the stage strip (SPEC 2.5, 4) in a real browser against the isolated
// e2e database. The track, the brief and the client's notes are seeded the way the runner and the brief job leave them.

test.describe.configure({ mode: 'serial' });

const SCRIPT_TEXT = '<script>window.xssFlag = 1</script>';
const IMG_TEXT = '<img src=x onerror=window.xssFlag=2>';

let world: DesignWorld;
let worker: DesignWorker;
let preview: Awaited<ReturnType<typeof startPreview>>;
let track: V2Track;
let state = '';
let ctx: BrowserContext;
let page: Page;
let sessionId = '';
const dialogs: string[] = [];
const onDialog = (d: Dialog) => { dialogs.push(d.message()); void d.dismiss(); };

const cards = {
  brand: { id: 'brand-01', headline: 'The brand is plain and sturdy', summary: 'Square type, one warm accent, no gloss.' },
  said: { id: 'said-01', headline: 'Pat wants real photos of the crew', summary: 'No stock photos anywhere on the site.' },
  hostile: {
    id: 'cons-01', headline: `Keep it honest ${SCRIPT_TEXT}`, summary: `Summary with ${IMG_TEXT} inside.`,
    detail_md: `Detail line one.\n\nA paragraph with ${SCRIPT_TEXT} and ${IMG_TEXT} that must stay text.`,
  },
};

test.beforeAll(async () => {
  world = await seedWorld(newTag());
  worker = new DesignWorker(BASE_URL, world);
  preview = await startPreview();
  await worker.heartbeat();
  track = await seedV2Track(world, { stage: 'art_direction' });
  const noteId = await seedNote(world, { key: 'photos', quote: 'We never want stock photos, only our own crew.', polarity: 'require' });
  await seedBrief(world, track.trackId, [
    { id: 'brand', title: 'Brand', cards: [{ ...cards.brand, detail_md: 'Brand detail with **bold** words.', sources: [{ kind: 'url', url: 'https://brand.example.test/guide', accessed: '2026-10-20' }] }] },
    { id: 'client_said', title: 'What the client said', cards: [{ ...cards.said, confidence: 'confirmed', sources: [{ kind: 'design_note', id: noteId }] }] },
    { id: 'constraints', title: 'Constraints', cards: [cards.hostile] },
  ]);
  state = await loginState(world.designerA.email, `${world.tag}-a`);
});

test.afterAll(async () => {
  await ctx?.close();
  await preview?.close();
  if (world) await teardownWorld(world);
});

test('a designer opens a session on a tracked project and the stage strip shows where she is', async ({ browser }) => {
  ctx = await newV2Context(browser, state, preview.port);
  page = await ctx.newPage();
  page.on('dialog', onDialog);
  sessionId = await openTask(page, track.artTask.title);
  await worker.claimAndSetUp(sessionId);
  await expect(page.getByTestId('preview-state')).toContainText('Preview up to date', { timeout: 20_000 });

  const strip = page.getByRole('navigation', { name: 'Design stages' });
  const steps = strip.getByRole('listitem');
  await expect(steps).toHaveCount(7);
  await expect(steps.filter({ hasText: 'Direction' })).toHaveAttribute('aria-current', 'step');
  await expect(steps.filter({ hasText: 'Direction' })).toContainText('(now)');
  for (const done of ['Research', 'Outline']) {
    await expect(steps.filter({ hasText: done })).toHaveAttribute('data-state', 'complete');
    await expect(steps.filter({ hasText: done })).toContainText('(done)');
  }
  for (const next of ['Home', 'Refine', 'Rest of site', 'Review']) await expect(steps.filter({ hasText: next })).toHaveAttribute('data-state', 'upcoming');

  // A tracked session shows Brief, Board and Direction ahead of the v1 tabs.
  for (const name of ['Brief', 'Board', 'Direction', 'Chat', 'Tasks', 'Changes', 'Versions', 'Client files']) await expect(page.getByRole('tab', { name })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pages' })).toHaveCount(0);
});

test('the Brief tab shows the one line and a card for every seeded finding, by section', async () => {
  await openDockTab(page, 'Brief');
  await expect(page.getByTestId('brief-one-line')).toContainText('A plain, sturdy site');
  await expect(page.getByTestId('brief-card')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Brand', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What the client said', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: cards.brand.headline })).toBeVisible();
  await expect(page.getByText(cards.brand.summary)).toBeVisible();
  // The client's own words ride on the card that cites the note.
  await expect(page.getByTestId('client-quote')).toContainText('We never want stock photos, only our own crew.');
  await expect(page.getByTestId('confidence').first()).toContainText(/Backed by evidence|Confirmed by the client/);
});

test('a card opens the drill-down drawer with its detail and sources, and Escape closes it with focus back on the card', async () => {
  const opener = page.getByRole('button', { name: `Open details and sources: ${cards.brand.headline}` });
  await opener.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: cards.brand.headline })).toBeVisible();
  await expect(drawer.getByText('bold', { exact: true })).toBeVisible(); // the markdown subset rendered the emphasis
  await expect(drawer.getByRole('list', { name: 'Sources' })).toContainText('https://brand.example.test/guide');
  const link = drawer.getByRole('link', { name: 'https://brand.example.test/guide' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('brief text with markup-looking characters renders as text: no dialog fires and the literal text is visible', async () => {
  // The card on the page: headline and summary carry the literal characters.
  await expect(page.getByRole('heading', { name: cards.hostile.headline })).toBeVisible();
  await expect(page.getByText(cards.hostile.summary)).toBeVisible();

  const opener = page.getByRole('button', { name: `Open details and sources: ${cards.hostile.headline}` });
  await opener.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('brief-drawer-body')).toContainText(SCRIPT_TEXT);
  await expect(drawer.getByTestId('brief-drawer-body')).toContainText(IMG_TEXT);
  // No element was created from the text.
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('script', { hasText: 'xssFlag' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { xssFlag?: number }).xssFlag)).toBeUndefined();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(dialogs, 'no alert, confirm or prompt dialog opened').toEqual([]);
});

test('a reaction can be set, takes a note, and survives a reload', async () => {
  const group = page.getByRole('group', { name: `Your view of: ${cards.brand.headline}` });
  const useful = group.getByRole('button', { name: 'Useful' });
  await expect(useful).toHaveAttribute('aria-pressed', 'false');
  const saved = page.waitForResponse((r) => r.url().includes(`/api/design/sessions/${sessionId}/brief/reactions`) && r.request().method() === 'POST');
  await useful.click();
  expect((await saved).status()).toBe(200);
  await expect(group.getByRole('button', { name: /Useful/ })).toHaveAttribute('aria-pressed', 'true');

  const note = group.getByLabel(`Note on: ${cards.brand.headline}`);
  await expect(note).toBeEnabled();
  await note.fill('Matches what Pat told us');
  const noteSaved = page.waitForResponse((r) => r.url().includes('/brief/reactions') && r.request().method() === 'POST');
  await group.getByRole('button', { name: 'Save note' }).click();
  expect((await noteSaved).status()).toBe(200);

  const rows = await world.prisma.designBriefReaction.findMany({ where: { brief: { track_id: track.trackId } } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ card_id: cards.brand.id, reaction: 'useful', note: 'Matches what Pat told us', created_by_id: world.designerA.id });

  // Another card stays unmarked.
  await expect(page.getByRole('group', { name: `Your view of: ${cards.said.headline}` }).getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.getByTestId('preview-state')).toBeVisible({ timeout: 20_000 });
  await openDockTab(page, 'Brief');
  const after = page.getByRole('group', { name: `Your view of: ${cards.brand.headline}` });
  await expect(after.getByRole('button', { name: /Useful/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(after.getByLabel(`Note on: ${cards.brand.headline}`)).toHaveValue('Matches what Pat told us');
  await expect(page.getByRole('group', { name: `Your view of: ${cards.said.headline}` }).getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'false');
});
