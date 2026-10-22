import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, request as pwRequest, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

// Portal phase C slice C3: the chat UI. The model side is scripted: this spec plays the runner's part
// over the real engine routes (claim, then complete with a recorded result), so no `claude -p` runs.
// Fixtures: scripts/seed-portal-v2-phase1-fixtures.ts (the client, two sites, the owner), then
// scripts/seed-portal-chat-fixtures.ts (mode on, sites switched on, four pages, an engine-scope key).
// Playwright has no database access, so the seed script also ages queued jobs (`--age-jobs`, the
// 60 second tree fallback without waiting a minute) and reads a filed request back (`--inspect`).
const APP_ROOT = path.resolve(__dirname, '..', '..');
const TS = 'npx ts-node --compiler-options \'{"module":"CommonJS"}\'';
const PHASE1 = `${TS} scripts/seed-portal-v2-phase1-fixtures.ts`;
const CHAT = `${TS} scripts/seed-portal-chat-fixtures.ts`;
const OWNER_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');
const ENGINE_KEY = 'citadel_e2e-portal-chat-engine-key-fixture-0001';
const BASE = 'http://localhost:3000';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

const run = (cmd: string) => execSync(cmd, { cwd: APP_ROOT, encoding: 'utf8' });

test.describe.configure({ mode: 'serial' });

let engine: APIRequestContext;
let siteId = '';
let pages: Record<string, string> = {};

test.beforeAll(async () => {
  run(PHASE1);
  run(`${CHAT} --cleanup`);
  run(CHAT);
  engine = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${ENGINE_KEY}` } });
});
test.afterAll(async () => {
  await engine?.dispose();
  run(`${CHAT} --cleanup`);
});

async function owner(browser: import('@playwright/test').Browser, viewport = { width: 1280, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'client_session', value: OWNER_TOKEN, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  return { context, page: await context.newPage() };
}

/** Plays the runner: waits for a queued job, claims it and posts the recorded result. */
async function engineAnswers(result: Record<string, unknown>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const claim = await engine.post('/api/engine/claim', { data: {} });
    if (claim.status() === 200) {
      const { job } = await claim.json();
      const done = await engine.post(`/api/engine/jobs/${job.id}/complete`, { data: { result, runs: [] } });
      expect(done.status(), await done.text()).toBe(200);
      return job.id as string;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('no chat job was queued');
}

async function ids(context: BrowserContext) {
  const ctx = await (await context.request.get('/api/portal/intake/context')).json();
  siteId = ctx.sites.find((s: { name: string }) => s.name === 'E2E Portal Fixture Site').id;
  const list = await (await context.request.get(`/api/portal/sites/${siteId}/pages`)).json();
  pages = Object.fromEntries(list.pages.map((p: { title: string; id: string }) => [p.title, p.id]));
}

const log = (page: Page) => page.getByRole('log', { name: 'Conversation' });
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });

test.describe('Portal chat (phase C slice 3)', () => {
  test('opens the chat, runs three turns with a choice and an image, confirms, and carries on in the work page', async ({ browser }) => {
    const { context, page } = await owner(browser);
    await ids(context);
    await page.goto('/portal/requests/new');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ask us for something');
    await expect(page.getByText('The assistant asks a few quick questions')).toBeVisible();
    // The disclosure line appears once, under the header.
    await expect(page.getByTestId('chat-disclosure')).toHaveCount(1);
    await expect(page.getByTestId('chat-disclosure')).toContainText('written by an AI assistant');
    expect(await page.getByRole('heading', { name: 'What do you need?' }).count()).toBe(0);

    // Turn 1: words and a photo. The image uploads before the message is sent.
    const upload = page.waitForResponse((r) => r.url().includes('/api/portal/uploads') && r.status() === 201);
    await page.getByTestId('chat-file-input').setInputFiles({ name: 'team-photo.png', mimeType: 'image/png', buffer: PNG });
    const att = (await (await upload).json()).attachment as { id: string };
    await expect(page.getByText('team-photo.png')).toBeVisible();
    await page.getByLabel('What do you need?').fill('Can you add this picture to the website?');
    await sendButton(page).click();

    // The writing state appears, then clears when the answer lands.
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    await expect(page.getByTestId('chat-writing')).toContainText('Writing');
    await engineAnswers({
      reply: "Which page should this photo go on?",
      actions: [
        { type: 'record', site_id: siteId, attachment_ids: [att.id], request_type: 'site_change' },
        { type: 'ask', slot: 'page', question: 'Which page should this photo go on?', choice_ids: [pages.About, pages.Home, pages.Menu], allow_free_text: true, allow_upload: false },
      ],
      sources: [],
    });
    await expect(page.getByTestId('chat-writing')).toHaveCount(0);
    await expect(log(page)).toContainText('Which page should this photo go on?');
    await expect(log(page)).toContainText('Can you add this picture to the website?');
    await expect(log(page).locator('img[alt="team-photo.png"]')).toBeVisible();
    const choices = page.getByTestId('chat-choices-page');
    for (const label of ['About', 'Home', 'Menu', 'Another page', 'Not sure']) await expect(choices.getByRole('button', { name: new RegExp(label) })).toBeVisible();

    // Turn 2: a choice button.
    await choices.getByRole('button', { name: /About/ }).click();
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    await engineAnswers({
      reply: 'What should change on the About page?',
      actions: [{ type: 'ask', slot: 'change', question: 'What should change on the About page?', choice_ids: [], allow_free_text: true, allow_upload: false }],
      sources: [],
    });
    await expect(page.getByTestId('chat-writing')).toHaveCount(0);
    await expect(log(page)).toContainText('What should change on the About page?');

    // Turn 3: free text, then the summary card.
    await page.getByLabel('What do you need?').fill('Swap the team photo for this new one.');
    await sendButton(page).click();
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    await engineAnswers({
      reply: "Here's your request as I have it. Check it before it goes to the team.",
      actions: [
        { type: 'record', change: 'Replace the team photo with the attached photo.', attachment_ids: [att.id] },
        { type: 'propose_summary', summary: 'On the About page, replace the team photo with the attached photo.', request_type: 'site_change', site_id: siteId, page_id: pages.About, change: 'Replace the team photo with the attached photo.', attachment_ids: [att.id] },
      ],
      sources: [],
    });
    const card = page.getByTestId('chat-summary');
    await expect(card).toBeVisible();
    await expect(card).toContainText('About');
    await expect(card).toContainText('Replace the team photo');
    await expect(card.getByText('team-photo.png')).toBeVisible();
    await card.getByRole('button', { name: 'Send to the team' }).click();
    await expect(page.getByTestId('chat-sent')).toContainText('Request sent.');
    await expect(page.getByTestId('chat-sent')).toContainText('You can keep adding details here.');
    await expect(page.getByTestId('chat-summary')).toHaveCount(0);

    // Request work again starts a fresh request: a new, empty chat with no memory of the filed one.
    const workHref = await page.getByRole('link', { name: 'View your request' }).getAttribute('href');
    const filedConversation = await page.evaluate(() => window.sessionStorage.getItem('portal-chat-resume'));
    expect(filedConversation, 'the saved chat is forgotten once the request is filed').toBeNull();
    await page.getByRole('link', { name: /^Request work$/ }).filter({ visible: true }).first().click();
    await expect(page.getByTestId('chat-sent')).toHaveCount(0);
    await expect(log(page)).not.toContainText('Can you add this picture to the website?');
    await expect(page.getByLabel('What do you need?')).toHaveValue('');
    // Leave it empty (no second conversation is created until a message is sent), then reload: still fresh.
    await page.reload();
    await expect(log(page)).not.toContainText('Can you add this picture to the website?');
    await expect(page.getByTestId('chat-sent')).toHaveCount(0);

    // The work page: its Conversation section is the same chat, with the earlier turns.
    await page.goto(workHref!);
    await expect(page.getByRole('heading', { name: 'Conversation' })).toBeVisible();
    await expect(page.getByTestId('chat-disclosure')).toHaveCount(1);
    await expect(log(page)).toContainText('Can you add this picture to the website?');
    await page.getByLabel('Add a message').fill('Thanks, one more thing: the photo is for the top row.');
    await sendButton(page).click();
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    await engineAnswers({ reply: 'The team will review this.', actions: [], sources: [] });
    await expect(page.getByTestId('chat-writing')).toHaveCount(0);
    await expect(log(page)).toContainText('The team will review this.');
    // Later messages exist now, so the filed notice is a one-line chip, not the full card.
    await expect(page.getByTestId('chat-sent')).toHaveCount(0);
    await expect(page.getByTestId('chat-sent-chip')).toBeVisible();
    await context.close();
  });

  test('a photo with no words, sent with Enter, files the request; Shift plus Enter is a new line', async ({ browser }) => {
    const { context, page } = await owner(browser);
    await ids(context);
    await page.goto('/portal/requests/new');
    await expect(page.getByText('Press Enter to send')).toBeVisible();
    const upload = page.waitForResponse((r) => r.url().includes('/api/portal/uploads') && r.status() === 201);
    await page.getByTestId('chat-file-input').setInputFiles({ name: 'menu-photo.png', mimeType: 'image/png', buffer: PNG });
    const att = (await (await upload).json()).attachment as { id: string };
    // Shift plus Enter is a new line and sends nothing.
    const box = page.getByLabel('What do you need?');
    await box.fill('first line');
    await box.press('Shift+Enter');
    await box.type('second line');
    await expect(box).toHaveValue('first line\nsecond line');
    await box.fill('');
    // Enter with only a photo sends it.
    await box.press('Enter');
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    await engineAnswers({
      reply: "Which page should this photo go on?",
      actions: [
        { type: 'record', site_id: siteId, attachment_ids: [att.id], request_type: 'site_change' },
        { type: 'ask', slot: 'page', question: 'Which page should this photo go on?', choice_ids: [pages.Menu, pages.Home], allow_free_text: true, allow_upload: false },
      ],
      sources: [],
    });
    await expect(log(page).locator('img[alt="menu-photo.png"]')).toBeVisible();
    await expect(log(page)).not.toContainText('(attachment)');
    await expect(log(page)).toContainText('Which page should this photo go on?');
    await context.close();
  });

  test('on a work page with no conversation yet, a photo can be attached and sent with no words', async ({ browser }) => {
    const { context, page } = await owner(browser);
    const lazy = JSON.parse(run(`${CHAT} --lazy-task`).trim().split('\n').filter((l) => l.startsWith('{')).pop()!) as { task_id: string };
    await page.goto(`/portal/work/${lazy.task_id}`);
    await expect(page.getByRole('heading', { name: 'Conversation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach a file' })).toBeVisible();
    const upload = page.waitForResponse((r) => r.url().includes('/api/portal/uploads') && r.status() === 201);
    await page.getByTestId('chat-file-input').setInputFiles({ name: 'lazy-photo.png', mimeType: 'image/png', buffer: PNG });
    await upload;
    await sendButton(page).click();
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    await engineAnswers({ reply: 'Which page should this photo go on?', actions: [], sources: [] });
    await expect(log(page).locator('img[alt="lazy-photo.png"]')).toBeVisible();
    await expect(log(page)).toContainText('Which page should this photo go on?');
    await context.close();
  });

  test('a handoff shows the banner and keeps the composer', async ({ browser }) => {
    const { context, page } = await owner(browser);
    await page.goto('/portal/requests/new');
    await page.getByLabel('What do you need?').fill('I would like to talk to a person please.');
    await sendButton(page).click();
    await engineAnswers({
      reply: 'A person on the team will read this and reply here.',
      actions: [{ type: 'hand_to_person', reason: 'asked_for_person', draft_reply: 'Thanks for writing in. The team will review this.' }],
      sources: [],
    });
    // The drafted reply is for the team only: it never appears in the client's chat.
    await expect(log(page)).toContainText('A person on the team will read this and reply here.');
    await expect(page.locator('body')).not.toContainText('Thanks for writing in. The team will review this.');
    const banner = page.getByTestId('chat-handoff');
    await expect(banner).toContainText('A person on the team will reply here. You can keep adding details while you wait.');
    await expect(page.getByLabel('What do you need?')).toBeEnabled();
    await expect(page.getByTestId('chat-person-mark')).toHaveCount(0);

    // A staff reply lands while this view stays open: no reload, and the banner names the person.
    const { first_name } = JSON.parse(run(`${CHAT} --staff-reply "We updated the hours on the Contact page."`).trim().split('\n').pop()!);
    await expect(log(page)).toContainText('We updated the hours on the Contact page.', { timeout: 20_000 });
    await expect(banner).toContainText(`${first_name} from Indelible replied.`);
    await expect(banner).not.toContainText('A person on the team will reply here');
    await expect(page.getByTestId('chat-person-mark')).toBeVisible();
    await expect(log(page).getByText('Indelible team', { exact: true })).toBeVisible();
    await context.close();
  });

  test('dragging a file over the box shows one steady drop overlay', async ({ browser }) => {
    const { context, page } = await owner(browser);
    await page.goto('/portal/requests/new');
    const box = page.locator('form.chat-composer');
    const textarea = page.getByLabel('What do you need?');
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(['x'], 'p.png', { type: 'image/png' }));
      return d;
    });
    await box.dispatchEvent('dragenter', { dataTransfer: dt });
    const overlay = page.getByTestId('chat-drop-active');
    await expect(overlay).toBeVisible();
    // The pointer crosses a child: enter the child, leave the form. The overlay stays.
    await textarea.dispatchEvent('dragenter', { dataTransfer: dt });
    await box.dispatchEvent('dragleave', { dataTransfer: dt });
    await expect(overlay).toBeVisible();
    await textarea.dispatchEvent('dragleave', { dataTransfer: dt });
    await expect(overlay).toHaveCount(0);
    await context.close();
  });

  test('shows the stepper when the first message comes back 409 chat_unavailable', async ({ browser }) => {
    const { context, page } = await owner(browser);
    await page.route('**/api/portal/chat', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Chat is not available', code: 'chat_unavailable', reason: 'mode_off' }) })
        : route.continue()
    );
    await page.goto('/portal/requests/new');
    await page.getByLabel('What do you need?').fill('Please change my opening hours.');
    await sendButton(page).click();
    await expect(page.getByRole('group', { name: 'What do you need?' })).toBeVisible();
    await expect(page.getByText('Nothing reaches the team until you press Send request.')).toBeVisible();
    // What was typed survives the fallback.
    await expect(page.getByTestId('intake-carried')).toContainText('Please change my opening hours.');
    await context.close();
  });

  test('shows the stepper when chat is switched off', async ({ browser }) => {
    run(`${CHAT} --off`);
    try {
      const { context, page } = await owner(browser);
      await page.goto('/portal/requests/new');
      await expect(page.getByRole('group', { name: 'What do you need?' })).toBeVisible();
      await expect(page.getByTestId('chat-disclosure')).toHaveCount(0);
      await context.close();
    } finally {
      run(CHAT);
    }
  });

  test('a job nobody claims for 60 seconds becomes a question-steps turn, and writing clears', async ({ browser }) => {
    const { context, page } = await owner(browser);
    await page.goto('/portal/requests/new');
    await page.getByLabel('What do you need?').fill('Please update the opening hours on the website.');
    await sendButton(page).click();
    await expect(page.getByTestId('chat-writing')).toBeVisible();
    // The seed script moves the queued job 70 seconds into the past; the next poll expires it.
    run(`${CHAT} --age-jobs`);
    await expect(page.getByTestId('chat-writing')).toHaveCount(0, { timeout: 15_000 });
    // The next fixed question arrives as an ordinary assistant bubble with real choices.
    await expect(log(page).locator('.msg.us').last()).toBeVisible();
    await expect(page.locator('[data-testid^="chat-choices-"]').first()).toBeVisible();
    await context.close();
  });
});
