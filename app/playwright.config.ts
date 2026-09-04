import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/e2e',
  // Clarity Phase 4c — one shared admin login for the whole run instead of one real
  // login per spec file (see global-setup.ts's own header for the full contention story
  // this fixes: POST /api/auth/login's shared 10 req/min rate limit).
  globalSetup: require.resolve('./__tests__/e2e/global-setup.ts'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial everywhere, matching CI: specs seed real rows in the shared e2e DB (e.g. the
  // contract-sign specs create kickoff tasks), and parallel workers let one spec's live
  // fixtures leak into another's board/count assertions (2026-08-09 flake investigation).
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Oracle Projects Tab (2026-09-04) — Plan/Process are hidden by default in the
    // shipped app (lib/config/feature-flags.ts's ORACLE_HIDE_PLAN_PROCESS). The 14
    // existing Plan/Process-tab specs (oracle-phase3, oracle-phase4a-email,
    // oracle-phase4b-peek, oracle-phase5-soothsayer, oracle-phase8-composition) stay
    // valid until those panes are retired by forcing the flag off here.
    env: {
      ...process.env,
      NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS: 'false',
    },
  },
});
