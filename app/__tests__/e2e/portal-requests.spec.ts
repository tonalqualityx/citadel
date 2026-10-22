import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, type BrowserContext } from '@playwright/test';

// Portal phase B slice 1: request intake, the Requests list and the work page. Fixtures come from
// scripts/seed-portal-v2-phase1-fixtures.ts (a client with two sites, an open build on the first,
// a locked build on the second, an active client-wide charter, and an owner, a member and a viewer).
//
// Like portal-home.spec.ts, this does not use the admin storageState: the portal has its own
// `client_session` cookie, injected from the fixed token the seed writes.
//
// Playwright has no database access, so each filed request is read back through the seed script's
// `--inspect <intake_id>` mode, which prints the task's tags, chain and waits as one JSON line.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const SEED = 'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-portal-v2-phase1-fixtures.ts';

// Must match the exported constants in the seed script exactly.
const OWNER_TOKEN = 'e2e-portal-v2-phase1-fixture-session-token-'.padEnd(128, 'a');
const MEMBER_TOKEN = 'e2e-portal-b1-fixture-member-session-token-'.padEnd(128, 'c');
const VIEWER_TOKEN = 'e2e-portal-b1-fixture-viewer-session-token-'.padEnd(128, 'd');
// The other client (a different company entirely), from the phase 1 seed.
const OTHER_CLIENT_TOKEN = 'e2e-portal-v2-phase1-fixture-empty-session-token-'.padEnd(128, 'b');

const SITE_ONE = 'E2E Portal Fixture Site';
const SITE_TWO = 'E2E Portal Fixture Site Two';
const OPEN_BUILD = 'E2E: Open build (portal fixture)';
const LOCKED_BUILD = 'E2E: Locked build (portal fixture)';

test.beforeAll(() => {
  execSync(SEED, { cwd: APP_ROOT, stdio: 'inherit' });
});

test.describe.configure({ mode: 'serial' });

async function loginAs(context: BrowserContext, token: string) {
  await context.addCookies([
    { name: 'client_session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
  ]);
}

interface Inspected {
  task: {
    id: string;
    title: string;
    client_title: string | null;
    priority: number;
    tags: string[];
    is_retainer_work: boolean;
    project: { name: string } | null;
    charter: { name: string } | null;
    site: { name: string } | null;
  } | null;
  waits: Array<{ template_key: string; state: string }>;
}

function inspect(intakeId: string): Inspected {
  const out = execSync(`${SEED} --inspect ${intakeId}`, { cwd: APP_ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line ?? '{"task":null,"waits":[]}');
}

const uuid = () => crypto.randomUUID();

async function siteIdByName(context: BrowserContext, name: string): Promise<string> {
  const res = await context.request.get('/api/portal/intake/context');
  const body = await res.json();
  return body.sites.find((s: { name: string }) => s.name === name).id;
}

let ownerTaskId = '';

test.describe('Portal phase B slice 1: requests', () => {
  test('files each kind of request with the right chain, tags and client label, then rate-limits the 21st', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, OWNER_TOKEN);
    const siteOne = await siteIdByName(context, SITE_ONE);
    const siteTwo = await siteIdByName(context, SITE_TWO);

    const file = async (body: Record<string, unknown>) => {
      const intake_id = uuid();
      const res = await context.request.post('/api/portal/requests', { data: { intake_id, ...body } });
      return { intake_id, res };
    };

    // Site change on the site with an open, unlocked build: the project, in scope.
    const a = await file({
      type: 'site_change',
      site_id: siteOne,
      answers: [{ key: 'q1', value: 'Update the opening hours' }, { key: 'q2', value: '/contact' }],
    });
    expect(a.res.status()).toBe(201);
    expect((await a.res.json()).task.engagement).toMatchObject({ kind: 'project', label: OPEN_BUILD });
    const ia = inspect(a.intake_id);
    expect(ia.task?.project?.name).toBe(OPEN_BUILD);
    ownerTaskId = ia.task!.id;
    expect(ia.task?.client_title).toBe('Site change: Update the opening hours');
    expect(ia.task?.tags).toEqual(['portal-chat', 'kind:site-change']);
    expect(ia.waits.map((w) => w.template_key)).toEqual(['portal.first_response']);

    // The same change on the site whose build is past content lock: a quote.
    const b = await file({
      type: 'site_change',
      site_id: siteTwo,
      answers: [{ key: 'q1', value: 'Swap the hero photo' }, { key: 'q2', value: 'Home' }],
    });
    expect(b.res.status()).toBe(201);
    expect((await b.res.json()).task.state.label).toBe('We will quote this');
    const ib = inspect(b.intake_id);
    expect(ib.task?.project?.name).toBe(LOCKED_BUILD);
    expect(ib.task?.tags).toEqual(['portal-chat', 'kind:site-change', 'quote', 'needs-mike']);
    expect(ib.waits.map((w) => w.template_key)).toEqual(['build.gate_mike']);

    // A new page during a build is always a quote.
    const c = await file({
      type: 'new_page_feature',
      site_id: siteOne,
      answers: [{ key: 'q1', value: 'A careers page' }, { key: 'q2', value: 'new_page' }],
    });
    expect(c.res.status()).toBe(201);
    expect(inspect(c.intake_id).task?.tags).toEqual(['portal-chat', 'kind:new-feature', 'quote', 'needs-mike']);

    // A blog article with a build open and a retainer: the charter.
    const d = await file({
      type: 'content_article',
      site_id: siteOne,
      answers: [{ key: 'q1', value: 'Spring maintenance tips' }, { key: 'q2', value: 'blog' }],
    });
    expect(d.res.status()).toBe(201);
    const id = inspect(d.intake_id);
    expect(id.task?.charter?.name).toBe('E2E: Marketing retainer (portal fixture)');
    expect(id.task?.project).toBeNull();
    expect(id.task?.is_retainer_work).toBe(true);
    expect((await d.res.json()).task.engagement.kind).toBe('retainer');

    // The whole site is down: urgent.
    const e = await file({ type: 'broken', site_id: siteOne, answers: [{ key: 'q1', value: 'site_down' }] });
    expect(e.res.status()).toBe(201);
    expect((await e.res.json()).urgent).toBe(true);
    const ie = inspect(e.intake_id);
    expect(ie.task?.priority).toBe(1);
    expect(ie.task?.tags).toEqual(['portal-chat', 'kind:troubleshoot', 'emergency', 'needs-mike']);
    expect(ie.task?.project).toBeNull();
    expect(ie.waits.map((w) => w.template_key)).toEqual(['portal.emergency']);

    // A marketing question with a charter: the charter.
    const f = await file({
      type: 'marketing_question',
      site_id: siteOne,
      answers: [{ key: 'q1', value: 'How is search traffic trending?' }, { key: 'q2', value: 'traffic_search' }],
    });
    expect(f.res.status()).toBe(201);
    expect(inspect(f.intake_id).task?.charter).not.toBeNull();

    // Repeating an intake id is a no-op: 200, the same task, nothing new filed.
    const again = await context.request.post('/api/portal/requests', {
      data: {
        intake_id: a.intake_id,
        type: 'site_change',
        site_id: siteOne,
        answers: [{ key: 'q1', value: 'Update the opening hours' }, { key: 'q2', value: '/contact' }],
      },
    });
    expect(again.status()).toBe(200);
    expect((await again.json()).task.id).toBe(ia.task?.id);
    expect(inspect(a.intake_id).waits).toHaveLength(1);

    // Twenty distinct requests an hour is the limit (six are filed above); the twenty-first says so
    // in plain words, without the support address, and names the limiter that fired.
    for (let n = 7; n <= 20; n++) {
      const filler = await file({ type: 'other', site_id: siteOne, answers: [{ key: 'q1', value: `Another thing ${n}` }, { key: 'q2', value: 'not_really' }] });
      expect(filler.res.status()).toBe(201);
    }
    const over = await file({ type: 'other', site_id: siteOne, answers: [{ key: 'q1', value: 'One more thing' }, { key: 'q2', value: 'not_really' }] });
    expect(over.res.status()).toBe(429);
    const overBody = await over.res.json();
    expect(overBody.error).toBe('You have sent a lot in a short time. Please try again in a few minutes.');
    expect(overBody.limit).toBe('requests_per_hour');

    await context.close();
  });

  test('a member files an "other" request into the project and a non-urgent break onto the live site', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, MEMBER_TOKEN);
    const siteOne = await siteIdByName(context, SITE_ONE);

    const other = uuid();
    const r1 = await context.request.post('/api/portal/requests', {
      data: { intake_id: other, type: 'other', site_id: siteOne, answers: [{ key: 'q1', value: 'A question about the build' }, { key: 'q2', value: 'not_really' }] },
    });
    expect(r1.status()).toBe(201);
    expect(inspect(other).task?.project?.name).toBe(OPEN_BUILD);

    const broken = uuid();
    const r2 = await context.request.post('/api/portal/requests', {
      data: { intake_id: broken, type: 'broken', site_id: siteOne, answers: [{ key: 'q1', value: 'page_link' }, { key: 'q2', value: '/about shows an error' }] },
    });
    expect(r2.status()).toBe(201);
    const ib = inspect(broken);
    expect(ib.task?.priority).toBe(2);
    expect(ib.task?.tags).toEqual(['portal-chat', 'kind:troubleshoot']);
    expect(ib.task?.project).toBeNull();
    expect(ib.task?.charter).toBeNull();
    expect(ib.task?.site?.name).toBe(SITE_ONE);
    await context.close();
  });

  test('a viewer can use the chat end to end, then sees the request and its work page', async ({ browser }) => {
    const context = await browser.newContext();
    await loginAs(context, VIEWER_TOKEN);
    const page = await context.newPage();

    await page.goto('/portal/requests/new');
    // Picking the type moves straight on, so click rather than check.
    await page.getByRole('button', { name: /Change something on my site/ }).click();

    // Two sites, so the chat asks which one.
    await expect(page.getByText('Which site is this about?')).toBeVisible();
    await page.getByRole('button', { name: SITE_ONE, exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await page.getByRole('textbox').fill('Change the phone number in the footer');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('textbox').fill('Every page');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByRole('heading', { name: 'Here is what we will send.' })).toBeVisible();
    await expect(page.getByText('Change the phone number in the footer')).toBeVisible();
    await expect(page.getByText(`This goes to your project: ${OPEN_BUILD}`)).toBeVisible();
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page.getByText('Request sent.')).toBeVisible();
    await page.getByRole('link', { name: 'View your request' }).click();
    await expect(page).toHaveURL(/\/portal\/work\//);
    await expect(page.getByRole('heading', { name: 'Site change: Change the phone number in the footer' })).toBeVisible();
    await expect(page.getByText('Received', { exact: true })).toBeVisible();
    await expect(page.getByText(`Project: ${OPEN_BUILD}`)).toBeVisible();
    await page.getByText('Your request').click();
    await expect(page.getByText('Every page')).toBeVisible();

    await page.goto('/portal/requests');
    await expect(page.getByRole('link', { name: 'Site change: Change the phone number in the footer' })).toBeVisible();

    await page.goto('/portal/home');
    await expect(page.getByRole('region', { name: 'Needs you' }).or(page.getByRole('heading', { name: /\d+ open/ })).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request work' }).first()).toBeVisible();
    await context.close();
  });

  test('a burst of parallel requests cannot beat the hourly limit', async ({ browser }) => {
    // The viewer filed one request in the chat test above; twenty an hour leaves room for nineteen.
    const context = await browser.newContext();
    await loginAs(context, VIEWER_TOKEN);
    const siteOne = await siteIdByName(context, SITE_ONE);
    const statuses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        context.request
          .post('/api/portal/requests', {
            data: { intake_id: uuid(), type: 'other', site_id: siteOne, answers: [{ key: 'q1', value: `Burst ${i}` }, { key: 'q2', value: 'not_really' }] },
          })
          .then((r) => r.status())
      )
    );
    expect(statuses.filter((s) => s === 201)).toHaveLength(19);
    expect(statuses.filter((s) => s === 429)).toHaveLength(6);
    await context.close();
  });

  test('another client cannot see or file against this client: 404, never 403', async ({ browser }) => {
    const owner = await browser.newContext();
    await loginAs(owner, OWNER_TOKEN);
    const siteOne = await siteIdByName(owner, SITE_ONE);
    await owner.close();

    const other = await browser.newContext();
    await loginAs(other, OTHER_CLIENT_TOKEN);
    // Reading the first client's work page.
    expect(ownerTaskId).not.toBe('');
    expect((await other.request.get(`/api/portal/work/${ownerTaskId}`)).status()).toBe(404);
    // Filing against the first client's site.
    const res = await other.request.post('/api/portal/requests', {
      data: { intake_id: uuid(), type: 'site_change', site_id: siteOne, answers: [{ key: 'q1', value: 'x' }, { key: 'q2', value: 'y' }] },
    });
    expect(res.status()).toBe(404);
    // Their own lists carry nothing of the first client's.
    const list = await (await other.request.get('/api/portal/requests')).json();
    expect(JSON.stringify(list)).not.toContain(ownerTaskId);
    const ctx = await (await other.request.get('/api/portal/intake/context')).json();
    expect(JSON.stringify(ctx)).not.toContain(siteOne);
    await other.close();
  });

  test('the primary Approve button is visible: its background is not transparent (the invisible-button bug)', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    await loginAs(context, OWNER_TOKEN);
    const page = await context.newPage();
    await page.goto('/portal/home');
    await page.waitForLoadState('networkidle');
    const approve = page.getByRole('button', { name: 'Approve' }).first();
    await expect(approve).toBeVisible();
    const bg = await approve.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
    // White text on a white card was the bug: the button must not be white either.
    expect(bg).not.toBe('rgb(255, 255, 255)');
    await context.close();
  });
});
