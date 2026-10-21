import { describe, it, expect } from 'vitest';
import { assertShareable, canShareWithClient } from '../share-reply';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

describe('canShareWithClient', () => {
  it('allows pm and admin and the Bast token, nobody else', () => {
    expect(canShareWithClient({ userId: 'u', role: 'pm' })).toBe(true);
    expect(canShareWithClient({ userId: 'u', role: 'admin' })).toBe(true);
    expect(canShareWithClient({ userId: BAST_USER_ID, role: 'tech' })).toBe(true);
    expect(canShareWithClient({ userId: 'u', role: 'tech' })).toBe(false);
  });
});

describe('assertShareable', () => {
  const pm = { userId: 'u', role: 'pm' } as const;
  it('passes a plain reply', () => {
    expect(() => assertShareable(pm, { content: 'We updated the hours.', is_internal: false })).not.toThrow();
  });
  it('403s someone who may not share', () => {
    expect(() => assertShareable({ userId: 'u', role: 'tech' }, { content: 'x', is_internal: false })).toThrowError(expect.objectContaining({ statusCode: 403 }));
  });
  it('400s an internal note', () => {
    expect(() => assertShareable(pm, { content: 'x', is_internal: true })).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });
  it('400s a body that names Bast, any case, whole word only', () => {
    for (const t of ['Bast fixed it', 'thanks, BAST', '~ Bast: done', 'ask bast.']) {
      expect(() => assertShareable(pm, { content: t, is_internal: false }), t).toThrowError(expect.objectContaining({ statusCode: 400, code: 'names_bast' }));
    }
    for (const t of ['The bastion server', 'Bastille day', 'broadcast']) {
      expect(() => assertShareable(pm, { content: t, is_internal: false }), t).not.toThrow();
    }
  });
});
