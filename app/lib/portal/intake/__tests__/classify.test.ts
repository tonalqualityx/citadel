import { describe, it, expect, vi, afterEach } from 'vitest';

// The model slot ships off: with the flag off, no network call is ever made.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('classifyIntake', () => {
  it('returns null and never calls fetch with the flag off (the shipped default)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    const { classifyIntake } = await import('../classify');
    const { PORTAL_INTAKE_LLM } = await import('@/lib/config/feature-flags');
    expect(PORTAL_INTAKE_LLM).toBe(false);
    expect(await classifyIntake('please make the logo bigger', { type: 'other' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without calling fetch when enabled but no key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { classifyIntake } = await import('../classify');
    expect(await classifyIntake('x', { type: 'other' }, { enabled: true })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only runs for the "other" type', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    const { classifyIntake } = await import('../classify');
    expect(await classifyIntake('x', { type: 'site_change' }, { enabled: true })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('when on, suggests a known type and nothing else', async () => {
    const reply = (text: string) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('broken')).mockResolvedValueOnce(reply('nonsense')).mockResolvedValueOnce(reply('other'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    const { classifyIntake } = await import('../classify');
    expect(await classifyIntake('the checkout is erroring', { type: 'other' }, { enabled: true })).toBe('broken');
    expect(await classifyIntake('hello', { type: 'other' }, { enabled: true })).toBeNull();
    expect(await classifyIntake('hello', { type: 'other' }, { enabled: true })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('swallows a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    const { classifyIntake } = await import('../classify');
    expect(await classifyIntake('x', { type: 'other' }, { enabled: true })).toBeNull();
  });
});
