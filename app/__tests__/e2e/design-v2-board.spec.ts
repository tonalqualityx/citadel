import { randomFillSync } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { newTag, seedWorld, teardownWorld, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, loginState, openTask, startPreview } from './fixtures/design-helpers';
import { newV2Context, openDockTab, seedBrief, seedCapturedShot, seedReference, seedV2Track, type V2Track } from './fixtures/design-v2-fixture';

// Designer Portal v2 (W4.6): the Board and Inspiration tabs (SPEC 4.3) in a real browser against the isolated e2e database. The capture job is
// never run (no runner here): the card of an added site stays in the state the server gave it, "queued".

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
let shotId = '';
const ids: Record<'alpine' | 'tide' | 'granite', string> = { alpine: '', tide: '', granite: '' };

const TITLES = { alpine: 'Alpine Outfitters', tide: 'Tidewater Goods', granite: 'Granite Works' } as const;
const SHOT_ALT = `${TITLES.alpine}, Desktop, top of the page`;

/** A real PNG of random RGB noise: it does not shrink when compressed, so the file is about width x height x 3 bytes. */
function noisePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits per channel, RGB
  const stride = width * 3 + 1; // one filter byte (0 = none) in front of every row
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;
    // Cheap noise: random bytes in 64 KB steps, so building the file stays fast.
    for (let x = 1; x < stride; x += 65536) randomFillSync(raw, row + x, Math.min(65536, stride - x));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

const card = (title: string): Locator => page.getByTestId('reference-card').filter({ has: page.getByRole('heading', { name: title }) });
const yes = (c: Locator) => c.getByRole('button', { name: /^Yes/ });
const no = (c: Locator) => c.getByRole('button', { name: /^No/ });

test.beforeAll(async () => {
  world = await seedWorld(newTag());
  worker = new DesignWorker(BASE_URL, world);
  preview = await startPreview();
  await worker.heartbeat();
  track = await seedV2Track(world, { stage: 'art_direction' });
  stateA = await loginState(world.designerA.email, `${world.tag}-a`);
  stateB = await loginState(world.designerB.email, `${world.tag}-b`);
});

test.afterAll(async () => {
  await ctx?.close();
  await preview?.close();
  if (world) await teardownWorld(world);
});

test('seeded references show as cards on the Inspiration tab: Bast pick with its why and shot, client-named site, and a site not captured yet', async ({ browser }) => {
  ctx = await newV2Context(browser, stateA, preview.port);
  page = await ctx.newPage();
  sessionId = await openTask(page, track.artTask.title);
  await worker.claimAndSetUp(sessionId);

  // Seed the board the way the runner leaves it, once the session exists (the shot goes through the real upload route).
  shotId = await seedCapturedShot(world, page.request, sessionId, track.trackId);
  ids.alpine = await seedReference(world, track.trackId, { title: TITLES.alpine, url: 'https://alpine.example.test/', why_md: 'Square type over plain photos, the same register the client asked for.', desktopFoldAssetId: shotId, sort_order: 0 });
  ids.tide = await seedReference(world, track.trackId, { title: TITLES.tide, source: 'client_named', why_md: 'Pat: "the tide tables page is exactly how plain we want it".', sort_order: 1 });
  ids.granite = await seedReference(world, track.trackId, { title: TITLES.granite, url: 'https://granite.example.test/', sort_order: 2 });
  await seedBrief(world, track.trackId, [{ id: 'brand', title: 'Brand', cards: [{ id: 'b1', headline: 'Plain', summary: 'Plain.' }] }]);

  await page.reload();
  await expect(page.getByTestId('preview-state')).toBeVisible({ timeout: 20_000 });
  await openDockTab(page, 'Inspiration');
  await expect(page.getByTestId('reference-card')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByTestId('inspiration-note')).toContainText('These are used only when you ask for the design to be built from inspiration.');

  const alpine = card(TITLES.alpine);
  await expect(alpine).toContainText('Picked by Bast');
  await expect(alpine.getByTestId('why-text')).toContainText('Square type over plain photos');
  await expect(alpine.getByTestId('capture-chip')).toContainText('Captured');
  await expect(alpine.getByRole('img', { name: SHOT_ALT })).toBeVisible();

  await expect(card(TITLES.tide)).toContainText('Named by the client');
  await expect(card(TITLES.tide).getByTestId('why-text')).toContainText('tide tables page');
  await expect(card(TITLES.tide).getByTestId('capture-chip')).toHaveCount(0); // no URL, nothing to capture

  await expect(card(TITLES.granite).getByTestId('capture-chip')).toContainText('Not captured');
  for (const t of Object.values(TITLES)) {
    await expect(yes(card(t))).toHaveAttribute('aria-pressed', 'false');
    await expect(no(card(t))).toHaveAttribute('aria-pressed', 'false');
  }
});

test('Yes works by mouse and saves', async () => {
  const alpine = card(TITLES.alpine);
  const saved = page.waitForResponse((r) => r.url().includes(`/references/${ids.alpine}`) && r.request().method() === 'PATCH');
  await yes(alpine).click();
  expect((await saved).status()).toBe(200);
  await expect(yes(alpine)).toHaveAttribute('aria-pressed', 'true');
  await expect(no(alpine)).toHaveAttribute('aria-pressed', 'false');
  const row = await world.prisma.designReference.findUniqueOrThrow({ where: { id: ids.alpine } });
  expect(row.decision).toBe('yes');
  expect(row.decided_by_id).toBe(world.designerA.id);
});

test('Yes and No work from the keyboard alone, and a No moves the card to the Set aside strip, where it can be brought back', async () => {
  // Yes on Tidewater: focus the button, activate with Space.
  const tide = card(TITLES.tide);
  await yes(tide).focus();
  await expect(yes(tide)).toBeFocused();
  const savedYes = page.waitForResponse((r) => r.url().includes(`/references/${ids.tide}`) && r.request().method() === 'PATCH');
  await page.keyboard.press('Space');
  expect((await savedYes).status()).toBe(200);
  await expect(yes(tide)).toHaveAttribute('aria-pressed', 'true');

  // No on Granite: Tab from its Yes button lands on its No button; Enter sets it aside.
  const granite = card(TITLES.granite);
  await yes(granite).focus();
  await page.keyboard.press('Tab');
  await expect(no(granite)).toBeFocused();
  const savedNo = page.waitForResponse((r) => r.url().includes(`/references/${ids.granite}`) && r.request().method() === 'PATCH');
  await page.keyboard.press('Enter');
  expect((await savedNo).status()).toBe(200);

  await expect(page.getByTestId('reference-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: TITLES.granite })).toHaveCount(0);
  const strip = page.getByRole('region', { name: 'Set aside' });
  const toggle = strip.getByRole('button', { name: 'Set aside (1)' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(strip.getByTestId('set-aside-item')).toContainText(TITLES.granite);
  expect((await world.prisma.designReference.findUniqueOrThrow({ where: { id: ids.granite } })).decision).toBe('no');

  // Reversible.
  const back = page.waitForResponse((r) => r.url().includes(`/references/${ids.granite}`) && r.request().method() === 'PATCH');
  await strip.getByRole('button', { name: /^Bring back/ }).click();
  expect((await back).status()).toBe(200);
  await expect(page.getByTestId('reference-card')).toHaveCount(3);
  await expect(no(card(TITLES.granite))).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Set aside' })).toHaveCount(0);
  expect((await world.prisma.designReference.findUniqueOrThrow({ where: { id: ids.granite } })).decision).toBe('pending');
});

test('adding a site by address on the Inspiration tab shows its capture status as queued (the capture job is not run), and a bad address is refused in words', async () => {
  const input = page.getByRole('textbox', { name: 'Add a site' });
  await input.fill('http://plain.example.test/');
  await page.getByRole('button', { name: 'Add site' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'https://' })).toBeVisible();
  expect(await world.prisma.designReference.count({ where: { track_id: track.trackId, url: { startsWith: 'http://' } } })).toBe(0);

  await input.fill('https://newsite.example.org/');
  const posted = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/references`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add site' }).click();
  expect((await posted).status()).toBe(201);

  const added = card('newsite.example.org');
  await expect(added).toBeVisible();
  await expect(added).toContainText('Added by you');
  await expect(added.getByTestId('capture-chip')).toContainText('Capturing');
  await expect(input).toHaveValue('');

  const row = await world.prisma.designReference.findFirstOrThrow({ where: { track_id: track.trackId, url: 'https://newsite.example.org/' } });
  expect(row.capture_status).toBe('queued');
  const jobs = await world.prisma.designJob.findMany({ where: { track_id: track.trackId, kind: 'capture' } });
  expect(jobs.map((j) => (j.payload as { reference_id?: string }).reference_id)).toContain(row.id);
  expect(jobs.every((j) => j.status === 'queued')).toBe(true); // nothing ran it

  // The same address again is refused, in words.
  await input.fill('https://newsite.example.org/');
  await page.getByRole('button', { name: 'Add site' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /already on the board/i })).toBeVisible();
});

test('a markup box is drawn on the reference shot, given a like chip, a category chip and a note, and is there after a reload', async () => {
  const alpine = card(TITLES.alpine);
  const shot = alpine.getByRole('img', { name: SHOT_ALT });
  await shot.scrollIntoViewIfNeeded();
  const box = await shot.boundingBox();
  expect(box, 'the shot has a box on screen').not.toBeNull();
  const at = (fx: number, fy: number) => ({ x: box!.x + box!.width * fx, y: box!.y + box!.height * fy });
  const from = at(0.2, 0.2);
  const to = at(0.6, 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();

  const editor = alpine.getByRole('group', { name: 'New markup box' });
  await expect(editor).toBeVisible();
  const saveBtn = editor.getByRole('button', { name: 'Save box' });
  await expect(saveBtn).toBeDisabled();
  await expect(editor).toContainText('Choose like, dislike or note, and one category, to save.');

  await editor.getByRole('radiogroup', { name: 'What do you think of this part' }).getByRole('radio', { name: 'Like', exact: true }).check({ force: true });
  await editor.getByRole('radiogroup', { name: 'What is it about' }).getByRole('radio', { name: 'Type', exact: true }).check({ force: true });
  await editor.getByLabel('Note (optional)').fill('This heading style, big and square');
  await expect(editor.getByTestId('note-count')).toContainText('34 of 500');
  await expect(saveBtn).toBeEnabled();
  const created = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/markups`) && r.request().method() === 'POST');
  await saveBtn.click();
  expect((await created).status()).toBe(201);

  const marker = alpine.getByRole('button', { name: /^Markup box 1: Like, Type/ });
  await expect(marker).toBeVisible();
  const rectBefore = (await marker.getAttribute('data-rect'))!;
  const rect = rectBefore.split(',').map(Number);
  expect(rect[0]).toBeGreaterThan(0.1);
  expect(rect[0]).toBeLessThan(0.3);
  expect(rect[2]).toBeGreaterThan(0.3);
  expect(rect[2]).toBeLessThan(0.5);

  const rows = await world.prisma.designMarkup.findMany({ where: { reference_id: ids.alpine, deleted_at: null } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sentiment: 'like', category: 'type', note: 'This heading style, big and square', asset_id: shotId, created_by_id: world.designerA.id });

  await page.reload();
  await expect(page.getByTestId('preview-state')).toBeVisible({ timeout: 20_000 });
  await openDockTab(page, 'Inspiration');
  const again = card(TITLES.alpine).getByRole('button', { name: /^Markup box 1: Like, Type/ });
  await expect(again).toBeVisible({ timeout: 15_000 });
  expect(await again.getAttribute('data-rect')).toBe(rectBefore);
  // Open it again: the chips and the note came back with it.
  await again.focus();
  await page.keyboard.press('Enter');
  const edit = card(TITLES.alpine).getByRole('group', { name: 'Edit markup box' });
  await expect(edit.getByRole('radio', { name: /^Like/ })).toBeChecked();
  await expect(edit.getByRole('radio', { name: /^Type/ })).toBeChecked();
  await expect(edit.getByLabel('Note (optional)')).toHaveValue('This heading style, big and square');
});

test('the Board holds design files: a Figma link shows a card bringing it in, and a site address in that field is refused', async () => {
  await openDockTab(page, 'Board');
  await expect(page.getByRole('textbox', { name: 'Add a site' })).toHaveCount(0); // sites live on Inspiration now
  // The three seeded sites are not design files, so the Board starts empty.
  await expect(page.getByTestId('reference-card')).toHaveCount(0);
  await expect(page.getByText('Nothing here yet. Paste a Figma link or upload your designs to start.')).toBeVisible();

  const field = page.getByRole('textbox', { name: 'Add a Figma link' });
  await field.fill('https://example.com/design/abcdefghij');
  await page.getByRole('button', { name: 'Add from Figma' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That is not a Figma link. Sites go on the Inspiration tab.' })).toBeVisible();
  expect(await world.prisma.designReference.count({ where: { track_id: track.trackId, source: 'designer_figma' } })).toBe(0);

  await field.fill('https://www.figma.com/design/abcdefghij1/Kit?node-id=1-2');
  const posted = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/references`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add from Figma' }).click();
  expect((await posted).status()).toBe(201);
  const added = card('Figma design');
  await expect(added).toBeVisible();
  await expect(added).toContainText('From your Figma file');
  await expect(added.getByTestId('capture-chip')).toContainText('Bringing it in'); // nobody ran the capture job
  await expect(field).toHaveValue('');
  const row = await world.prisma.designReference.findFirstOrThrow({ where: { track_id: track.trackId, source: 'designer_figma' } });
  expect(row.capture_status).toBe('queued');

  // It is a design file, so it is not on the Inspiration tab, and that tab's note now says the build follows a design.
  await openDockTab(page, 'Inspiration');
  await expect(page.getByRole('heading', { name: 'Figma design' })).toHaveCount(0);
});

test('a captured Figma reference with a picture shows on the Board and not on Inspiration', async () => {
  const figmaShot = await seedCapturedShot(world, page.request, sessionId, track.trackId);
  await seedReference(world, track.trackId, {
    title: 'Home desktop', source: 'designer_figma', url: 'https://www.figma.com/design/abcdefghij2?node-id=3-4', desktopFoldAssetId: figmaShot, sort_order: 10,
    extracted: { schema: 1, source: 'figma', figma: { file_key: 'abcdefghij2', file_name: 'UI Kit', page: 'Home', node_id: '3:4', frame: { name: 'Home desktop', width: 1440, height: 900 }, frames_total: 4, frames_imported: 2 } },
  });
  await page.reload();
  await expect(page.getByTestId('preview-state')).toBeVisible({ timeout: 20_000 });
  await openDockTab(page, 'Board');
  const frame = card('Home desktop');
  await expect(frame).toBeVisible({ timeout: 15_000 });
  await expect(frame).toContainText('From your Figma file');
  await expect(frame.getByTestId('capture-chip')).toContainText('Ready');
  await expect(frame.getByRole('img', { name: /Home desktop/ })).toBeVisible();
  await expect(frame.getByTestId('figma-line')).toContainText('1440 x 900');
  await expect(frame.getByTestId('figma-line')).toContainText('Showing the first 2 of 4 frames');
  await expect(frame.getByRole('link', { name: /Open in Figma/ })).toHaveAttribute('target', '_blank');

  await openDockTab(page, 'Inspiration');
  await expect(page.getByRole('heading', { name: 'Home desktop' })).toHaveCount(0);
  await expect(page.getByTestId('inspiration-note')).toContainText('You have added your own design, so the build follows that.');
});

test('a 12 MB picture uploads whole', async () => {
  const png = noisePng(2000, 2000);
  expect(png.length, 'the test picture is past the 10 MB a proxied body used to be cut at').toBeGreaterThan(11 * 1024 * 1024);
  expect(png.length).toBeLessThan(13 * 1024 * 1024);
  await openDockTab(page, 'Board');
  const sent = page.waitForResponse((r) => r.url().endsWith(`/api/design/sessions/${sessionId}/uploads`) && r.request().method() === 'POST', { timeout: 60_000 });
  await page.getByLabel('Choose files to upload').setInputFiles({ name: 'big-noise.png', mimeType: 'image/png', buffer: png });
  const res = await sent;
  // A body cut short would come back as an error here, or store fewer bytes below.
  expect(res.status(), 'the upload route accepted the whole body').toBe(201);
  const { asset } = (await res.json()) as { asset: { id: string } };
  const row = await world.prisma.designTrackAsset.findUniqueOrThrow({ where: { id: asset.id } });
  expect(row.bytes, 'the stored size equals the size of the file sent').toBe(png.length);
  await expect(card('big-noise.png')).toBeVisible({ timeout: 20_000 });
});

test('another designer who is not on the project cannot read or change the board', async ({ browser }) => {
  const other = await browser.newContext({ baseURL: BASE_URL, storageState: stateB });
  try {
    const base = `/api/design/sessions/${sessionId}`;
    const read = await other.request.get(`${base}/references`);
    expect([403, 404]).toContain(read.status());
    expect(read.status(), 'the route answers 404 for a stranger, like every session route').toBe(404);
    expect(await read.text()).not.toContain(TITLES.alpine);
    expect((await other.request.get(`${base}/brief`)).status()).toBe(404);
    expect((await other.request.patch(`${base}/references/${ids.alpine}`, { data: { decision: 'no' } })).status()).toBe(404);
    expect((await other.request.post(`${base}/references`, { data: { url: 'https://intruder.example.org/' } })).status()).toBe(404);
    const asset = await other.request.get(`${base}/track-assets/${shotId}`);
    expect(asset.status()).toBe(404);
    // Nothing moved.
    expect((await world.prisma.designReference.findUniqueOrThrow({ where: { id: ids.alpine } })).decision).toBe('yes');
    expect(await world.prisma.designReference.count({ where: { track_id: track.trackId, url: 'https://intruder.example.org/' } })).toBe(0);
  } finally {
    await other.close();
  }
});
