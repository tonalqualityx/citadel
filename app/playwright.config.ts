import { defineConfig, devices } from '@playwright/test';

// Designer Portal W6.8: PW_PORT moves the app (baseURL, dev server command and URL) off 3000 so a run never
// collides with another dev server, and PW_DATABASE_URL points the spawned dev server at a different database
// (the isolated gate DB). Both default to the old behavior: port 3000, whatever DATABASE_URL the env has.
const PW_PORT = process.env.PW_PORT || '3000';
const PW_BASE_URL = `http://localhost:${PW_PORT}`;
// Isolated mode (own database or own port): the dev server gets its own dist dir (it can run beside another
// `next dev` in this checkout) and talks to an in-memory fake S3, never a real bucket (design asset uploads).
const ISOLATED = !!process.env.PW_DATABASE_URL || PW_PORT !== '3000';
const FAKE_S3_PORT = Number(PW_PORT) + 2;

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
    baseURL: PW_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    ...(ISOLATED
      ? [
          {
            command: `node __tests__/e2e/fixtures/design-preview/fake-s3.js ${FAKE_S3_PORT}`,
            url: `http://127.0.0.1:${FAKE_S3_PORT}/__health`,
            reuseExistingServer: !process.env.CI,
          },
        ]
      : []),
    {
      command: `PORT=${PW_PORT} npm run dev`,
      url: PW_BASE_URL,
      reuseExistingServer: !process.env.CI,
      // Oracle Projects Tab (2026-09-04) — Plan/Process are hidden by default in the
      // shipped app (lib/config/feature-flags.ts's ORACLE_HIDE_PLAN_PROCESS). The 14
      // existing Plan/Process-tab specs (oracle-phase3, oracle-phase4a-email,
      // oracle-phase4b-peek, oracle-phase5-soothsayer, oracle-phase8-composition) stay
      // valid until those panes are retired by forcing the flag off here.
      //
      // Phase 2 follow-up (verification) — this only works because `next dev` (below)
      // reads NEXT_PUBLIC_* env vars per-request at runtime. ORACLE_HIDE_PLAN_PROCESS is a
      // NEXT_PUBLIC_ var, which Next.js normally BAKES INTO THE CLIENT BUNDLE AT BUILD
      // TIME (`next build`) — setting it in a webServer env would have zero effect against
      // a production build/`next start`. If this command ever changes to a build+start
      // flow, this override needs to move to build time (e.g. as an env var ahead of the
      // build step) or it will silently stop taking effect.
      env: {
        ...process.env,
        ...(process.env.PW_DATABASE_URL ? { DATABASE_URL: process.env.PW_DATABASE_URL } : {}),
        ...(ISOLATED
          ? {
              NEXT_DIST_DIR: `.next-pw-${PW_PORT}`,
              AWS_S3_BUCKET: 'dp-e2e',
              AWS_ACCESS_KEY_ID: 'fake',
              AWS_SECRET_ACCESS_KEY: 'fake',
              AWS_ENDPOINT_URL_S3: `http://127.0.0.1:${FAKE_S3_PORT}`,
              AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED',
              AWS_RESPONSE_CHECKSUM_VALIDATION: 'WHEN_REQUIRED',
            }
          : {}),
        JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-key-for-ci-testing-only-32chars',
        JWT_REFRESH_SECRET:
          process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-for-ci-only-32chars',
        NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS: 'false',
      },
    },
  ],
});
