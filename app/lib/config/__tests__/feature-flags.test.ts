import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Oracle Projects Tab (2026-09-04) — ORACLE_HIDE_PLAN_PROCESS reads an env override so
// playwright.config.ts can force it false for the 14 existing Plan/Process-tab e2e specs.
// The flag is a module-level const computed at import time, so exercising both branches
// requires resetting the module registry and re-importing with the env var set/unset.
describe('feature-flags — ORACLE_HIDE_PLAN_PROCESS env override', () => {
  const ENV_KEY = 'NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS';
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
    vi.resetModules();
  });

  it('defaults to true (hidden) when the env var is unset', async () => {
    delete process.env[ENV_KEY];
    const { ORACLE_HIDE_PLAN_PROCESS } = await import('../feature-flags');
    expect(ORACLE_HIDE_PLAN_PROCESS).toBe(true);
  });

  it('is true for any value other than the literal string "false"', async () => {
    process.env[ENV_KEY] = 'true';
    const { ORACLE_HIDE_PLAN_PROCESS: withTrue } = await import('../feature-flags');
    expect(withTrue).toBe(true);

    vi.resetModules();
    process.env[ENV_KEY] = 'nonsense';
    const { ORACLE_HIDE_PLAN_PROCESS: withNonsense } = await import('../feature-flags');
    expect(withNonsense).toBe(true);
  });

  it('is false only when the env var is exactly "false" (playwright.config.ts webServer override)', async () => {
    process.env[ENV_KEY] = 'false';
    const { ORACLE_HIDE_PLAN_PROCESS } = await import('../feature-flags');
    expect(ORACLE_HIDE_PLAN_PROCESS).toBe(false);
  });

  it('ORACLE_PROJECTS_TAB is always true (Phase 1 ships it on)', async () => {
    const { ORACLE_PROJECTS_TAB } = await import('../feature-flags');
    expect(ORACLE_PROJECTS_TAB).toBe(true);
  });
});
