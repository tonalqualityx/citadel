import { describe, it, expect } from 'vitest';
import { decideTokenReset, isRequestNewHref, withFreshToken } from '../request-token';

describe('request token', () => {
  it('stamps a fresh token and keeps prefill', () => {
    expect(withFreshToken('/portal/requests/new', 5)).toBe('/portal/requests/new?new=5');
    expect(withFreshToken('/portal/requests/new?site_id=a&new=1', 9)).toBe('/portal/requests/new?site_id=a&new=9');
    expect(isRequestNewHref('/portal/requests/new?type=x')).toBe(true);
    expect(isRequestNewHref('/portal/requests')).toBe(false);
  });
  it('resets on a new token, with the notice only when a conversation existed', () => {
    expect(decideTokenReset({ token: '2', handledToken: '1', hadConversation: true })).toEqual({ fresh: true, notice: true });
    expect(decideTokenReset({ token: '2', handledToken: null, hadConversation: false })).toEqual({ fresh: true, notice: false });
  });
  it('does not reset on a reload of a handled token or with no token', () => {
    expect(decideTokenReset({ token: '2', handledToken: '2', hadConversation: true }).fresh).toBe(false);
    expect(decideTokenReset({ token: null, handledToken: '2', hadConversation: true }).fresh).toBe(false);
  });
});
