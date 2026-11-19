import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { pronounsFields, pronounsWrite, PRONOUNS_SOURCES } from '../pronouns';

describe('pronounsWrite', () => {
  it('writes nothing when neither field is sent', () => {
    expect(pronounsWrite({})).toEqual({});
  });

  it('defaults the source to stated when a person types pronouns', () => {
    expect(pronounsWrite({ pronouns: ' he/him ' })).toEqual({ pronouns: 'he/him', pronouns_source: 'stated' });
  });

  it('keeps an explicit source', () => {
    expect(pronounsWrite({ pronouns: 'she/her', pronouns_source: 'signature' })).toEqual({
      pronouns: 'she/her',
      pronouns_source: 'signature',
    });
  });

  it('clears both columns when pronouns are emptied', () => {
    expect(pronounsWrite({ pronouns: '', pronouns_source: 'assumed' })).toEqual({ pronouns: null, pronouns_source: null });
    expect(pronounsWrite({ pronouns: null })).toEqual({ pronouns: null, pronouns_source: null });
  });

  it('writes a source alone only when the contact already has pronouns', () => {
    expect(pronounsWrite({ pronouns_source: 'stated' }, 'he/him')).toEqual({ pronouns_source: 'stated' });
    expect(pronounsWrite({ pronouns_source: 'stated' })).toEqual({});
  });

  it('never clears a source while leaving the pronouns', () => {
    expect(pronounsWrite({ pronouns_source: null }, 'he/him')).toEqual({});
  });
});

describe('pronounsFields', () => {
  const schema = z.object(pronounsFields);
  it('accepts the three sources', () => {
    for (const s of PRONOUNS_SOURCES) expect(schema.safeParse({ pronouns_source: s }).success).toBe(true);
  });
  it('rejects an unknown source and over-long pronouns', () => {
    expect(schema.safeParse({ pronouns_source: 'guess' }).success).toBe(false);
    expect(schema.safeParse({ pronouns: 'x'.repeat(51) }).success).toBe(false);
  });
});
