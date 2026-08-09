import { execSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { SHARED_AUTH_STATE_PATH } from './global-setup';
import {
  CONTRACT_PORTAL_TOKEN,
  MSA_PORTAL_TOKEN,
} from '../../scripts/seed-contract-sign-kickoff-e2e-fixtures';

// Ops-review B6 (Citadel quest cc8b8353) — signing a contract or MSA through the public
// portal now auto-creates a cockpit-owned kickoff task (lib/services/kickoff.ts) instead of
// silently waiting for a human to notice. No prior Playwright coverage existed for the
// contract/MSA-sign flow at all (only the unit-level route.test.ts files) — this is new
// end-to-end coverage of the real public sign flow, added specifically to prove the
// kickoff-task side effect actually lands in the database, not just that the mocked
// service was called (that part is covered at the unit level in
// lib/services/__tests__/kickoff.test.ts and the two route.test.ts files).
//
// Two separate browser contexts per test: an anonymous one drives the real public sign
// page (no auth — same as any client following an emailed link), and an admin one (shared
// storageState, same pattern as every other Oracle e2e file) verifies the resulting task
// via the authenticated /api/tasks endpoint.
const APP_ROOT = path.resolve(__dirname, '..', '..');

test.beforeAll(() => {
  execSync(
    'npx ts-node --compiler-options \'{"module":"CommonJS"}\' scripts/seed-contract-sign-kickoff-e2e-fixtures.ts',
    { cwd: APP_ROOT, stdio: 'inherit' }
  );
});

// Serial — the contract/MSA fixture rows are shared, fixed-token singletons, and the
// signing tests mutate their signed state.
test.describe.configure({ mode: 'serial' });

test.describe('Contract/MSA sign → kickoff task automation', () => {
  test('signing the contract creates a cockpit-owned kickoff task linked to the accord', async ({
    browser,
  }) => {
    const anonContext = await browser.newContext();
    const page = await anonContext.newPage();

    await page.goto(`/portal/contract/${CONTRACT_PORTAL_TOKEN}`);
    await page.waitForLoadState('networkidle');

    await page.getByPlaceholder('Your full name').fill('E2E Signer');
    await page.getByPlaceholder('your@email.com').fill('e2e-signer@example.com');
    await page.getByRole('button', { name: 'Sign Contract' }).click();

    await expect(page.getByText('Contract Signed')).toBeVisible({ timeout: 10000 });
    await anonContext.close();

    const adminContext = await browser.newContext({ storageState: SHARED_AUTH_STATE_PATH });
    const tasksRes = await adminContext.request.get('/api/tasks?source=internal&tags=cockpit-owned&limit=100');
    expect(tasksRes.ok()).toBe(true);
    const { tasks } = await tasksRes.json();

    const kickoffTask = tasks.find((t: any) =>
      t.title === 'Kickoff: E2E Kickoff Client (fixture) — contract signed'
    );
    expect(kickoffTask).toBeDefined();
    expect(kickoffTask.priority).toBe(2);
    expect(kickoffTask.tags).toContain('cockpit-owned');
    expect(kickoffTask.status).toBe('not_started');
    expect(kickoffTask.client?.name).toBe('E2E Kickoff Client (fixture)');
    await adminContext.close();
  });

  test('signing the MSA creates a cockpit-owned kickoff task linked to the client', async ({ browser }) => {
    const anonContext = await browser.newContext();
    const page = await anonContext.newPage();

    await page.goto(`/portal/msa/${MSA_PORTAL_TOKEN}`);
    await page.waitForLoadState('networkidle');

    // Neither <label> wraps its <input> nor pairs via htmlFor/id on this page, so
    // getByLabel() can't resolve them — placeholder text is the reliable selector here,
    // same reasoning as the contract page above.
    await page.getByPlaceholder('Your full legal name').fill('E2E MSA Signer');
    await page.getByPlaceholder('your@email.com').fill('e2e-msa-signer@example.com');
    await page.getByRole('button', { name: 'Sign Agreement' }).click();

    await expect(page.getByText('Agreement Signed')).toBeVisible({ timeout: 10000 });
    await anonContext.close();

    const adminContext = await browser.newContext({ storageState: SHARED_AUTH_STATE_PATH });
    const tasksRes = await adminContext.request.get('/api/tasks?source=internal&tags=cockpit-owned&limit=100');
    expect(tasksRes.ok()).toBe(true);
    const { tasks } = await tasksRes.json();

    const kickoffTask = tasks.find((t: any) =>
      t.title === 'Kickoff: E2E Kickoff Client (fixture) — MSA signed'
    );
    expect(kickoffTask).toBeDefined();
    expect(kickoffTask.tags).toContain('cockpit-owned');
    await adminContext.close();
  });
});
