import fs from 'node:fs';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';

// Clarity Phase 4c fix — a real, reproducible regression this phase's own new spec file
// exposed (not caused alone): POST /api/auth/login is rate-limited 10 req/min, IP-bucketed
// (lib/api/rate-limit.ts), shared across the ENTIRE suite regardless of which spec file or
// worker makes the request. Every Oracle e2e file used to do its OWN real UI login in its
// own beforeAll (the fix Clarity Phase 4b applied to oracle-phase3.spec.ts for the same
// contention class) — that pattern scales at +1 real login per new phase file forever, and
// this phase's addition (the 5th such file) plus a separately-discovered bug in
// search.spec.ts (a real per-TEST login via beforeEach, 3x instead of 1x) pushed the full
// suite's real total to 11 in a clean run — one over budget, deterministically blocking
// whichever file's login happened to land last. Fixing search.spec.ts's own bug brought it
// down but not enough headroom for the suite to keep growing safely. The actual fix: ONE
// shared admin login for the whole run (Playwright's globalSetup, which runs exactly once
// before any test file, in any project), writing ONE shared storageState file every spec
// file now points `test.use({ storageState })` at instead of performing its own login.
// auth.spec.ts is the one exception — it's the dedicated login-FLOW test, its real submits
// (valid + invalid credentials) are the point of that file and must stay real.
export const SHARED_AUTH_STATE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'test-results',
  '.shared-auth-state.json'
);

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  fs.mkdirSync(path.dirname(SHARED_AUTH_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@indelible.agency');
  await page.getByLabel('Password').fill('password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(/.*dashboard/, { timeout: 15000 });
  await context.storageState({ path: SHARED_AUTH_STATE_PATH });
  await browser.close();
}
