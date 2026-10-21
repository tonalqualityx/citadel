import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';

// "View as client": a Citadel admin opens a client's portal read-only. Fixtures: the phase 1 client
// (scripts/seed-portal-v2-phase1-fixtures.ts) and the B2 thread task and staged plan
// (scripts/seed-portal-b2-fixtures.ts). The admin uses the shared login; the portal session is minted by
// the real button on the client record, never injected.
const APP_ROOT = path.resolve(__dirname, '..', '..');
const TS = 'npx ts-node --compiler-options \'{"module":"CommonJS"}\'';
const PHASE1 = `${TS} scripts/seed-portal-v2-phase1-fixtures.ts`;
const B2 = `${TS} scripts/seed-portal-b2-fixtures.ts`;
const CLIENT_NAME = 'E2E Portal Client (fixture)';
const READ_ONLY_LINE = 'This is a read-only view. Nothing was sent or changed.';

let clientId = '';
let taskId = '';

function lastJson(out: string): Record<string, any> {
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line ?? '{}');
}
const run = (cmd: string) => lastJson(execSync(cmd, { cwd: APP_ROOT, encoding: 'utf8' }));

test.use({ storageState: SHARED_AUTH_STATE_PATH });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  execSync(PHASE1, { cwd: APP_ROOT, stdio: 'inherit' });
  taskId = run(B2).thread_task_id;
  execSync(`${B2} --reset-thread ${taskId}`, { cwd: APP_ROOT, stdio: 'inherit' });
  const context = await browser.newContext({ storageState: SHARED_AUTH_STATE_PATH });
  const res = await context.request.get(`/api/clients?search=${encodeURIComponent(CLIENT_NAME)}`);
  const body = await res.json();
  const list = (body.data ?? body.clients ?? body) as Array<{ id: string; name: string }>;
  clientId = list.find((c) => c.name === CLIENT_NAME)?.id ?? '';
  await context.close();
  expect(clientId).toBeTruthy();
});

test.afterAll(() => {
  execSync(`${B2} --cleanup`, { cwd: APP_ROOT, stdio: 'inherit' });
});

const banner = (page: import('@playwright/test').Page, text: string) =>
  expect(page.locator('[data-view-as-banner]')).toContainText(text);

test.describe('Portal: view as client', () => {
  test('an admin starts a view, sees the banner on every page, cannot act, and exits back to Citadel', async ({ page }) => {
    await page.goto(`/clients/${clientId}`);
    await page.getByRole('button', { name: `View portal as ${CLIENT_NAME}` }).click();
    await page.waitForURL(/\/portal\/home/);

    const bannerText = `Viewing as ${CLIENT_NAME} (Owner). Read-only.`;
    await banner(page, bannerText);
    await expect(page.getByRole('button', { name: 'Exit view' })).toBeVisible();

    // Home: the plan's Approve is switched off, with the read-only line beside it.
    const approve = page.getByRole('button', { name: 'Approve' }).first();
    await expect(approve).toBeVisible();
    await expect(approve).toBeDisabled();
    await expect(page.getByText(READ_ONLY_LINE).first()).toBeVisible();

    // The other pages carry the same banner.
    for (const [url, heading] of [
      ['/portal/requests', /open requests?/],
      ['/portal/retainer', /E2E Growth plan/],
    ] as const) {
      await page.goto(url);
      await banner(page, bannerText);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }

    // Booking a time is a real action: the widget is replaced by the read-only line.
    await page.goto('/portal/book');
    await banner(page, bannerText);
    await expect(page.getByText(READ_ONLY_LINE).first()).toBeVisible();

    // A work page: Send is off, the box is read-only, nothing is posted.
    await page.goto(`/portal/work/${taskId}`);
    await banner(page, bannerText);
    await expect(page.getByLabel('Add a message')).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(page.getByText(READ_ONLY_LINE).first()).toBeVisible();

    // The server refuses too, whatever the page does: 403 and the plain line, nothing saved.
    const refused = await page.request.post(`/api/portal/work/${taskId}/messages`, {
      data: { client_ref: '00000000-0000-4000-8000-000000000009', text: 'should not land' },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error).toBe(READ_ONLY_LINE);
    const approveRefused = await page.request.post(`/api/portal/tasks/mine/${taskId}/approve`);
    expect(approveRefused.status()).toBe(403);
    const state = run(`${B2} --inspect-thread ${taskId}`) as { comments: unknown[]; notices: unknown[]; waits: unknown[] };
    expect(state.comments).toHaveLength(0);
    expect(state.notices).toHaveLength(0);
    expect(state.waits).toHaveLength(0);

    // Exit view: back on the client record in Citadel, still signed in as the admin.
    await page.getByRole('button', { name: 'Exit view' }).click();
    await page.waitForURL(new RegExp(`/clients/${clientId}`));
    await expect(page.getByRole('heading', { name: CLIENT_NAME })).toBeVisible();
    // The record lists who looked, as which role, and when.
    await expect(page.getByRole('list', { name: 'Recent portal views' }).getByRole('listitem').first()).toContainText('as owner');
    // The view session is gone: the portal asks for a sign-in.
    await page.goto('/portal/home');
    await expect(page.locator('[data-view-as-banner]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/portal\/login/);
  });

  test('an admin can view as a chosen role', async ({ page }) => {
    await page.goto(`/clients/${clientId}`);
    await page.getByLabel('View as role').selectOption('viewer');
    await page.getByRole('button', { name: `View portal as ${CLIENT_NAME}` }).click();
    await page.waitForURL(/\/portal\/home/);
    await banner(page, `Viewing as ${CLIENT_NAME} (Viewer). Read-only.`);
    await page.getByRole('button', { name: 'Exit view' }).click();
    await page.waitForURL(new RegExp(`/clients/${clientId}`));
  });
});
