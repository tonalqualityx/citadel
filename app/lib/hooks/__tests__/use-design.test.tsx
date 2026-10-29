import { describe, it, expect, vi, afterEach } from 'vitest';
import { designKeys, pollInterval, DRAWER_POLL_MS, HIDDEN_POLL_MS } from '../use-design';

vi.mock('@/lib/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

function setHidden(v: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
}
afterEach(() => setHidden(false));

describe('designKeys', () => {
  it('are stable and scoped', () => {
    expect(designKeys.drawer()).toEqual(['design', 'drawer', 'all']);
    expect(designKeys.drawer('p1')).toEqual(['design', 'drawer', 'p1']);
    expect(designKeys.sessions()).toEqual(['design', 'sessions', 'all']);
    expect(designKeys.sessions('closed')).toEqual(['design', 'sessions', 'closed']);
  });
});

describe('pollInterval', () => {
  it('uses the default foreground cadence, or next_poll_ms when given', () => {
    expect(pollInterval()).toBe(DRAWER_POLL_MS);
    expect(pollInterval(1500)).toBe(1500);
  });
  it('is 30 s when the tab is hidden, never faster', () => {
    setHidden(true);
    expect(pollInterval()).toBe(HIDDEN_POLL_MS);
    expect(pollInterval(1500)).toBe(HIDDEN_POLL_MS);
    expect(pollInterval(60_000)).toBe(60_000);
  });
});
