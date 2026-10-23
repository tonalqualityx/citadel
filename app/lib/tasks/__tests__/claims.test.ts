// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertClaimHeld, clampTtl, isLeaseLive } from '../claims';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);
const dbWith = (row: unknown) => ({ task: { findUnique: vi.fn().mockResolvedValue(row) }, appSettings: { findUnique: vi.fn().mockResolvedValue(null) } }) as never;

afterEach(() => vi.restoreAllMocks());

describe('clampTtl', () => {
  it('clamps to 60..21600 and defaults to 1800', () => {
    expect(clampTtl(1)).toBe(60);
    expect(clampTtl(999999)).toBe(21600);
    expect(clampTtl(undefined)).toBe(1800);
    expect(clampTtl(null)).toBe(1800);
    expect(clampTtl(600)).toBe(600);
  });
});

describe('isLeaseLive', () => {
  it('is live only with a future lease', () => {
    expect(isLeaseLive({ lease_until: null })).toBe(false);
    expect(isLeaseLive({ lease_until: past() })).toBe(false);
    expect(isLeaseLive({ lease_until: future() })).toBe(true);
  });
});

describe('assertClaimHeld', () => {
  const live = { claim_holder: 'worker:a', claim_token: TOKEN, lease_until: future() };

  it('allows when there is no lease or the lease lapsed (today\'s behavior)', async () => {
    await expect(assertClaimHeld('t', null, { mode: 'enforce' }, dbWith({ claim_holder: null, claim_token: null, lease_until: null }))).resolves.toBeUndefined();
    await expect(assertClaimHeld('t', null, { mode: 'enforce' }, dbWith({ ...live, lease_until: past() }))).resolves.toBeUndefined();
  });
  it('allows the matching token in every mode', async () => {
    await expect(assertClaimHeld('t', TOKEN, { mode: 'enforce' }, dbWith(live))).resolves.toBeUndefined();
  });
  it('enforce throws 409 claim_lost on a missing or wrong token', async () => {
    for (const tok of [null, undefined, '22222222-2222-4222-8222-222222222222']) {
      await expect(assertClaimHeld('t', tok, { mode: 'enforce' }, dbWith(live))).rejects.toMatchObject({ statusCode: 409, code: 'claim_lost' });
    }
  });
  it('warn logs and allows; off allows silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(assertClaimHeld('t', null, { mode: 'warn' }, dbWith(live))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(assertClaimHeld('t', null, { mode: 'off' }, dbWith(live))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('reads the mode from settings, defaulting to warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(assertClaimHeld('t', null, {}, dbWith(live))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
