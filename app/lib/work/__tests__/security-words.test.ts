import { describe, it, expect } from 'vitest';
import { hasSecurityWords } from '../stale-asks';

describe('hasSecurityWords', () => {
  it('finds the server security wording in any part', () => {
    expect(hasSecurityWords('Security alert: new login', 'x')).toBe(true);
    expect(hasSecurityWords('Re: hello', 'We detected a possible compromise of your account')).toBe(true);
    expect(hasSecurityWords('Phishing attempt', null)).toBe(true);
  });
  it('does not fire on ordinary mail', () => {
    expect(hasSecurityWords('Invoice for November', 'Please find the invoice attached')).toBe(false);
    expect(hasSecurityWords(null, undefined)).toBe(false);
  });
});
