import { describe, it, expect } from 'vitest';
import { pronounsLabel } from '../client-contacts-tab';

describe('pronounsLabel', () => {
  it('shows stated pronouns plainly', () => {
    expect(pronounsLabel({ pronouns: 'he/him', pronouns_source: 'stated' })).toBe('he/him');
  });
  it('marks signature and assumed values so a guess never reads as fact', () => {
    expect(pronounsLabel({ pronouns: 'she/her', pronouns_source: 'signature' })).toBe('she/her (from signature)');
    expect(pronounsLabel({ pronouns: 'she/her', pronouns_source: 'assumed' })).toBe('she/her (assumed)');
  });
  it('returns null when unset', () => {
    expect(pronounsLabel({ pronouns: null, pronouns_source: null })).toBeNull();
  });
});
