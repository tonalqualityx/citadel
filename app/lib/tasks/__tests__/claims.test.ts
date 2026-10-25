// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertClaimHeld, clampTtl, isLeaseLive } from '../claims';

const TOKEN = '11111111-1111-4111-8111-111111111111';
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);
const activity = vi.hoisted(() => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/activity', () => activity);
const dbWith = (row: unknown) => ({ task: { findUnique: vi.fn().mockResolvedValue(row) }, appSettings: { findUnique: vi.fn().mockResolvedValue(null) }, user: { findUnique: vi.fn().mockResolvedValue({ name: 'Mike' }) } }) as never;

afterEach(() => { vi.restoreAllMocks(); activity.logActivity.mockClear(); });

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
  const live = { title: 'T', claim_holder: 'worker:a', claim_token: TOKEN, lease_until: future() };

  it('allows when there is no lease or the lease lapsed (today\'s behavior)', async () => {
    await expect(assertClaimHeld('t', null, { mode: 'enforce' }, dbWith({ claim_holder: null, claim_token: null, lease_until: null }))).resolves.toBeDefined();
    await expect(assertClaimHeld('t', null, { mode: 'enforce' }, dbWith({ ...live, lease_until: past() }))).resolves.toBeDefined();
  });
  it('allows the matching token in every mode', async () => {
    await expect(assertClaimHeld('t', TOKEN, { mode: 'enforce' }, dbWith(live))).resolves.toBeDefined();
  });
  it('enforce throws 409 claim_lost on a missing or wrong token', async () => {
    for (const tok of [null, undefined, '22222222-2222-4222-8222-222222222222']) {
      await expect(assertClaimHeld('t', tok, { mode: 'enforce' }, dbWith(live))).rejects.toMatchObject({ statusCode: 409, code: 'claim_lost' });
    }
  });
  it('warn logs and allows; off allows silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(assertClaimHeld('t', null, { mode: 'warn' }, dbWith(live))).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(assertClaimHeld('t', null, { mode: 'off' }, dbWith(live))).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('warn writes a claim_warn activity row when the caller is known', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await assertClaimHeld('t', null, { mode: 'warn', caller: { userId: 'u1', role: 'pm', via: 'api_key' } }, dbWith(live));
    expect(activity.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim_warn', entityId: 't', userId: 'u1' }));
  });
  it('any person on a browser session (pm, admin, tech) moves it: claim released, activity line written only when logOverride runs, even in enforce', async () => {
    for (const role of ['pm', 'admin', 'tech']) {
      activity.logActivity.mockClear();
      const r = await assertClaimHeld('t', null, { mode: 'enforce', caller: { userId: 'u1', role, via: 'session' } }, dbWith(live));
      expect(r.overridden_holder).toBe('worker:a');
      expect(activity.logActivity).not.toHaveBeenCalled();
      await r.logOverride();
      const call = activity.logActivity.mock.calls[0][0];
      expect(call.action).toBe('claim_override');
      expect(call.changes.message.to).toBe('Moved by Mike while worker:a held it; claim released.');
    }
  });
  it('API keys stay under the check in enforce, whatever their role', async () => {
    for (const role of ['admin', 'tech']) {
      await expect(assertClaimHeld('t', null, { mode: 'enforce', caller: { userId: 'u1', role, via: 'api_key' } }, dbWith(live))).rejects.toMatchObject({ code: 'claim_lost' });
    }
  });
  it('reads the mode from settings, defaulting to warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(assertClaimHeld('t', null, {}, dbWith(live))).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});
