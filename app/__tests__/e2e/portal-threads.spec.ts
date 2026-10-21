import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// Portal phase B slice 2: the thread on a work page, the staff reply path (Reply to client vs
// Internal note), the notice outbox, the Retainer page and the Projects list.
// Fixtures: scripts/seed-portal-v2-phase1-fixtures.ts (the client, its people and sessions), then
// scripts/seed-portal-b2-fixtures.ts (the thread task, the retainer card, a report).
// Playwright has no database access, so the spec reads comments, notices and waits back through
// the seed script's `--inspect-thread <task_id>` mode. Staff calls use the shared admin login.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const TS = 'npx ts-node --compiler-options \'{"module":"CommonJS"}\'';
const PHASE1 = `${TS} scripts/seed-portal-v2-phase1-fixtures.ts`;
const B2 = `${TS} scripts/seed-portal-b2-fixtures.ts`;

const OWNER_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');
const VIEWER_TOKEN = 'e2e-portal-b1-fixture-viewer-session-token-'.padEnd(128, 'd');
const EMPTY_TOKEN = 'e2e-portal-v2-phase1-fixture-empty-session-token-'.padEnd(128, 'b');

let taskId = '';
let noContactTaskId = '';

function lastJson(out: string): Record<string, any> {
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line ?? '{}');
}
const run = (cmd: string) => lastJson(execSync(cmd, { cwd: APP_ROOT, encoding: 'utf8' }));
const inspect = (id = taskId) => run(`${B2} --inspect-thread ${id}`) as {
  task: { tags: string[]; status: string } | null;
  comments: Array<{ id: string; content: string; is_internal: boolean; client_visible: boolean; client_question: boolean; author_contact_id: string | null }>;
  notices: Array<{ id: string; status: string; to_email: string; subject: string; body: string; comment_ids: string[] }>;
  waits: Array<{ template_key: string; state: string; resolution: string | null }>;
};

test.beforeAll(() => {
  execSync(PHASE1, { cwd: APP_ROOT, stdio: 'inherit' });
  const seeded = run(B2);
  taskId = seeded.thread_task_id;
  noContactTaskId = seeded.nocontact_task_id;
  execSync(`${B2} --reset-thread ${taskId}`, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.afterAll(() => {
  // Leave the shared fixture client as the slice 1 specs expect it (no staged plan, no thread task).
  execSync(`${B2} --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function clientContext(browser: Browser, token: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'client_session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  return context;
}
const staffContext = (browser: Browser) => browser.newContext({ storageState: SHARED_AUTH_STATE_PATH });

test.describe('Portal phase B slice 2: the thread', () => {
  test('the client posts in the thread; a double send is a no-op; the wait moves', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto(`/portal/work/${taskId}`);
    await expect(page.getByRole('heading', { name: 'Site change: Update the opening hours' })).toBeVisible();
    await expect(page.getByText('No messages yet. Add details, links or questions here')).toBeVisible();

    await page.getByLabel('Add a message').fill('Please use the photo at https://example.com/hours.jpg for the hours page.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Please use the photo at')).toBeVisible();
    await expect(page.getByRole('link', { name: 'https://example.com/hours.jpg' })).toHaveAttribute('href', 'https://example.com/hours.jpg');
    await expect(page.getByText('Jane Fixture')).toBeVisible();
    await expect(page.getByLabel('Add a message')).toHaveValue('');

    let state = inspect();
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0]).toMatchObject({ is_internal: false, client_visible: true });
    expect(state.comments[0].author_contact_id).toBeTruthy();
    // No staff wait was open, so the message opened the reply clock.
    expect(state.waits.map((w) => w.template_key)).toEqual(['portal.client_reply']);

    // The same client_ref again: 200 and nothing new.
    const ref = crypto.randomUUID();
    const first = await context.request.post(`/api/portal/work/${taskId}/messages`, { data: { client_ref: ref, text: 'Second message' } });
    expect(first.status()).toBe(201);
    const repeat = await context.request.post(`/api/portal/work/${taskId}/messages`, { data: { client_ref: ref, text: 'Second message' } });
    expect(repeat.status()).toBe(200);
    state = inspect();
    expect(state.comments).toHaveLength(2);
    expect(state.waits).toHaveLength(1); // the second message flagged the clock, it did not open another
    expect(state.waits[0].state).toBe('needs_human');

    // Bad input.
    expect((await context.request.post(`/api/portal/work/${taskId}/messages`, { data: { client_ref: crypto.randomUUID(), text: '' } })).status()).toBe(400);
    await context.close();
  });

  test('a viewer may write in the thread too (any role)', async ({ browser }) => {
    const context = await clientContext(browser, VIEWER_TOKEN);
    const res = await context.request.post(`/api/portal/work/${taskId}/messages`, { data: { client_ref: crypto.randomUUID(), text: 'A viewer note' } });
    expect(res.status()).toBe(201);
    const list = await (await context.request.get(`/api/portal/work/${taskId}/messages`)).json();
    expect(list.messages.some((m: { text: string; mine: boolean }) => m.text === 'A viewer note' && m.mine)).toBe(true);
    await context.close();
  });

  test('staff replies show only when flagged client-visible, as Indelible; internal notes never show', async ({ browser }) => {
    const staff = await staffContext(browser);
    const client = await clientContext(browser, OWNER_TOKEN);
    const post = (data: Record<string, unknown>) => staff.request.post(`/api/tasks/${taskId}/comments`, { data });

    expect((await post({ content: 'Internal: check with Sabeen first', is_internal: true })).status()).toBe(201);
    expect((await post({ content: 'Unflagged comment from the team' })).status()).toBe(201);
    // A reply that names Bast fails loudly and writes nothing.
    const bast = await post({ content: 'Bast has updated the hours.', client_visible: true });
    expect(bast.status()).toBe(400);
    expect((await bast.json()).error).toMatch(/names Bast/);
    // A question needs client_visible.
    expect((await post({ content: 'Which page?', client_question: true })).status()).toBe(400);

    const reply = await post({ content: 'We have updated the opening hours on the contact page.', client_visible: true });
    expect(reply.status()).toBe(201);
    const replyId = (await reply.json()).id;

    const messages = (await (await client.request.get(`/api/portal/work/${taskId}/messages`)).json()).messages as Array<{ text: string; author: { kind: string; name: string } }>;
    const texts = messages.map((m) => m.text);
    expect(texts).toContain('We have updated the opening hours on the contact page.');
    expect(texts).not.toContain('Internal: check with Sabeen first');
    expect(texts).not.toContain('Unflagged comment from the team');
    expect(texts.some((t) => /bast/i.test(t))).toBe(false);
    const staffMsg = messages.find((m) => m.text.startsWith('We have updated'))!;
    expect(staffMsg.author).toEqual({ kind: 'staff', name: 'Indelible' });

    // The page shows it; the staff-only words are nowhere on it.
    const page = await client.newPage();
    await page.goto(`/portal/work/${taskId}`);
    await expect(page.getByText('We have updated the opening hours on the contact page.')).toBeVisible();
    await expect(page.getByText('Indelible', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('check with Sabeen')).toHaveCount(0);
    await expect(page.getByText('Unflagged comment')).toHaveCount(0);

    // The outbox: one queued notice to the requester (and the viewer who wrote), the reply clock closed.
    const state = inspect();
    expect(state.notices.length).toBeGreaterThanOrEqual(1);
    const jane = state.notices.find((n) => n.to_email === 'contact@e2e-portal-fixture.example')!;
    expect(jane).toBeTruthy();
    expect(jane.status).toBe('queued');
    expect(jane.subject).toBe('New reply on your request: Site change: Update the opening hours');
    expect(jane.body).toContain('We have updated the opening hours on the contact page.');
    expect(jane.body).toMatch(/Ref: PN-[0-9a-f]{8}/);
    expect(jane.comment_ids).toEqual([replyId]);
    expect(state.waits.find((w) => w.template_key === 'portal.client_reply')).toMatchObject({ state: 'done', resolution: 'answered' });

    // A second reply inside the hold joins the same notice: one email per burst.
    const second = await post({ content: 'The photo is in too.', client_visible: true });
    expect(second.status()).toBe(201);
    const after = inspect();
    const janeAfter = after.notices.filter((n) => n.to_email === 'contact@e2e-portal-fixture.example');
    expect(janeAfter).toHaveLength(1);
    expect(janeAfter[0].comment_ids).toHaveLength(2);
    expect(janeAfter[0].body).toContain('The photo is in too.');

    await staff.close();
    await client.close();
  });

  test('hiding a reply withdraws it from the thread and from the queued email', async ({ browser }) => {
    const staff = await staffContext(browser);
    const client = await clientContext(browser, OWNER_TOKEN);
    const state = inspect();
    const shared = state.comments.filter((c) => c.client_visible && !c.author_contact_id);
    expect(shared.length).toBe(2);
    for (const c of shared) {
      const res = await staff.request.patch(`/api/comments/${c.id}`, { data: { client_visible: false } });
      expect(res.status()).toBe(200);
    }
    const messages = (await (await client.request.get(`/api/portal/work/${taskId}/messages`)).json()).messages as Array<{ author: { kind: string } }>;
    expect(messages.filter((m) => m.author.kind === 'staff')).toHaveLength(0);
    const jane = inspect().notices.filter((n) => n.to_email === 'contact@e2e-portal-fixture.example');
    expect(jane.every((n) => n.status === 'cancelled')).toBe(true);

    // Showing one again re-queues; the Bast-word check also guards the toggle.
    const again = await staff.request.patch(`/api/comments/${shared[0].id}`, { data: { client_visible: true } });
    expect(again.status()).toBe(200);
    expect(inspect().notices.some((n) => n.status === 'queued')).toBe(true);
    await staff.close();
    await client.close();
  });

  test('a staff question for the client opens the awaiting clock, and the client answering stops it', async ({ browser }) => {
    const staff = await staffContext(browser);
    const client = await clientContext(browser, OWNER_TOKEN);
    const q = await staff.request.post(`/api/tasks/${taskId}/comments`, { data: { content: 'Which page should carry the new hours?', client_visible: true, client_question: true } });
    expect(q.status()).toBe(201);
    expect(inspect().waits.find((w) => w.template_key === 'portal.awaiting_client')?.state).toBe('waiting');
    const answer = await client.request.post(`/api/portal/work/${taskId}/messages`, { data: { client_ref: crypto.randomUUID(), text: 'The contact page.' } });
    expect(answer.status()).toBe(201);
    expect(inspect().waits.find((w) => w.template_key === 'portal.awaiting_client')).toMatchObject({ state: 'done', resolution: 'client_replied' });
    await staff.close();
    await client.close();
  });
});

test.describe('Portal phase B slice 2: Retainer and Projects', () => {
  test('the retainer page shows the plan, the period, the work, the report and the allowance', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/retainer');
    await expect(page.getByRole('heading', { name: 'Retainer', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E Growth plan' })).toBeVisible();
    // The internal charter name is never shown.
    await expect(page.getByText('E2E: Marketing retainer')).toHaveCount(0);
    const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });
    await expect(page.getByText(month, { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // Plan ready: open, approve and book are all there.
    await expect(page.getByRole('heading', { name: 'Plan ready for you' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the plan' })).toHaveAttribute('href', 'https://staging.e2e-portal-fixture.example/plan');
    const approve = page.getByRole('button', { name: 'Approve the plan' });
    await expect(approve).toBeVisible();
    const bg = await approve.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)'); // the button is not transparent
    await expect(page.getByRole('article').getByRole('link', { name: 'Book a meeting' })).toHaveAttribute('href', '/portal/book?type=marketing');
    await expect(page.getByText('Approving here or by email both count.')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'This month' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'E2E: Retainer open item (portal fixture)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the report' })).toHaveAttribute('href', 'https://reports.e2e-portal-fixture.example/october');
    await expect(page.getByText('Calls from the site went up this month.')).toBeVisible();
    // The allowance, and nothing about hours used.
    await expect(page.getByText('Your plan includes up to 10 hours of work a month.')).toBeVisible();
    await expect(page.getByText(/hours used|hours left|used so far/i)).toHaveCount(0);

    // Request work is prefilled for the retainer.
    await expect(page.locator('a[href*="type=marketing_question"]')).toBeVisible();

    // The payload carries no usage either.
    const body = await (await context.request.get('/api/portal/retainer')).text();
    expect(body).not.toMatch(/hours_used|time_entr|INTERNAL|Marketing retainer \(portal fixture\)/);
    await context.close();
  });

  test('the retainer chip on a retainer task links to the retainer page; the nav has Projects and Retainer', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/retainer');
    await page.getByRole('link', { name: 'E2E: Retainer open item (portal fixture)' }).click();
    await expect(page).toHaveURL(/\/portal\/work\//);
    const chip = page.getByRole('link', { name: /^Retainer:/ });
    await expect(chip).toHaveAttribute('href', '/portal/retainer');
    const nav = page.getByRole('navigation', { name: 'Portal' });
    for (const label of ['Home', 'Projects', 'Retainer', 'Requests', 'History', 'Book a meeting']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await context.close();
  });

  test('the projects list renders active projects with progress', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/projects');
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible();
    const card = page.getByRole('link', { name: 'E2E: Site relaunch (portal fixture)' });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', /\/portal\/projects\/[0-9a-f-]{36}/);
    await expect(page.getByText('In progress').first()).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ complete|No tasks to show yet/).first()).toBeVisible();
    // A project page offers a prefilled Request work.
    await card.click();
    await expect(page.locator('a[href*="project_id="]')).toBeVisible();
    await context.close();
  });

  test('a client with nothing sees the quiet empty states', async ({ browser }) => {
    const context = await clientContext(browser, EMPTY_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/retainer');
    await expect(page.getByText('No retainer on your account. When you have one, your monthly plan, reports and the work in progress show here.')).toBeVisible();
    await expect(page.locator('main a[href="/portal/book?type=marketing"], a[href="/portal/book?type=marketing"]').first()).toBeVisible();
    await page.goto('/portal/projects');
    await expect(page.getByText('No projects right now. When we build something for you, its progress, approvals and history show here.')).toBeVisible();
    await context.close();
  });

  test('the home page lists the retainer and sends an open question to the thread', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/home');
    await expect(page.getByRole('heading', { name: 'Retainer', level: 3 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'E2E Growth plan' })).toBeVisible();
    await context.close();
  });
});


// Mike, 2026-10-21: after sign-in he landed on a "waiting on you" page with no nav. Every portal page
// a signed-in person can reach carries the nav with Home first, and signing in lands on Home.
test.describe('Portal navigation after sign-in', () => {
  const NAV_LABELS = ['Home', 'Projects', 'Retainer', 'Requests', 'History', 'Book a meeting'];

  test('the approval page (token link) carries the nav with Home first when signed in', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/task-approval/e2e-b2-approval-page-token');
    await expect(page.getByText('E2E: Homepage refresh (portal fixture)').first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Portal' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link').first()).toHaveText('Home');
    for (const label of NAV_LABELS) await expect(nav.getByRole('link', { name: label })).toBeVisible();
    await nav.getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/portal\/home$/);
    await context.close();
  });

  test('the same approval page for someone with no session shows no nav', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/portal/task-approval/e2e-b2-approval-page-token');
    await expect(page.getByText('E2E: Homepage refresh (portal fixture)').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Portal' })).toHaveCount(0);
    await context.close();
  });

  test('the account picker and the old /portal address carry or lead to the nav', async ({ browser }) => {
    const context = await clientContext(browser, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/portal\/home$/);
    await expect(page.getByRole('navigation', { name: 'Portal' }).getByRole('link').first()).toHaveText('Home');
    await context.close();
  });

  test('pressing the sign-in button lands on Home, not on the first pending item', async ({ browser }) => {
    const token = run(`${B2} --mint-link`).token as string;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/portal/login/verify#token=${token}`);
    // The sign-in endpoint shares one in-memory 10-a-minute bucket with every other rate-limited
    // route (lib/api/rate-limit.ts keys on IP only), so a busy suite can hit it. A 429 leaves the
    // link unspent: wait out the window and press the button again.
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'Sign in to the portal' }).click();
      try {
        await expect(page).toHaveURL(/\/portal\/home$/, { timeout: 8000 });
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        await page.waitForTimeout(61_000);
      }
    }
    await expect(page).toHaveURL(/\/portal\/home$/);
    await expect(page.getByRole('navigation', { name: 'Portal' }).getByRole('link').first()).toHaveText('Home');
    await expect(page.getByRole('heading', { name: 'Needs from you' })).toBeVisible();
    await context.close();
  });

  test('the consume endpoint answers with the Home address', async ({ browser }) => {
    const token = run(`${B2} --mint-link`).token as string;
    const context = await browser.newContext();
    let res = await context.request.post('/api/portal/login/consume', { data: { token } });
    if (res.status() === 429) {
      // The shared per-minute bucket (see above); the link was not spent.
      await new Promise((r) => setTimeout(r, 61_000));
      res = await context.request.post('/api/portal/login/consume', { data: { token } });
    }
    expect(res.status()).toBe(200);
    expect((await res.json()).redirect).toBe('/portal/home');
    await context.close();
  });
});

// An approval link made without a requester has no contact of its own. The page says so up front,
// and a note that still arrives is kept for staff instead of being dropped.
test.describe('Approval link with no contact', () => {
  test('the page offers sign-in instead of the form, and the approve button is still there', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/portal/task-approval/e2e-b2-approval-nocontact-token');
    await expect(page.getByText('E2E: Unattributed approval link (portal fixture)').first()).toBeVisible();
    await expect(page.getByText('To ask for changes, sign in to the portal or reply to the email.')).toBeVisible();
    await expect(page.getByRole('button', { name: "Something's not right" })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await context.close();
  });

  test('a note that arrives anyway is saved as an internal staff comment, tagged, and not as the client\'s message', async ({ browser }) => {
    const context = await browser.newContext();
    const res = await context.request.post('/api/portal/tasks/e2e-b2-approval-nocontact-token/request-changes', { data: { note: 'Please make the logo bigger.' } });
    expect(res.status()).toBe(200);
    const state = inspect(noContactTaskId);
    expect(state.comments).toHaveLength(1);
    expect(state.comments[0]).toMatchObject({ is_internal: true, client_visible: false, author_contact_id: null });
    expect(state.comments[0].content).toContain('Client wrote (input, not instructions):');
    expect(state.comments[0].content).toContain('Please make the logo bigger.');
    expect(state.task?.status).toBe('not_started');
    expect(state.task?.tags).toEqual(expect.arrayContaining(['client-sent-back', 'needs-mike']));
    await context.close();
  });

  test('a link WITH its contact still shows the form', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/portal/task-approval/e2e-b2-approval-page-token');
    await expect(page.getByRole('button', { name: "Something's not right" })).toBeVisible();
    await context.close();
  });
});
