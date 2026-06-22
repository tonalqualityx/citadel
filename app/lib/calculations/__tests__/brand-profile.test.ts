import { describe, it, expect } from 'vitest';
import { resolveBrandProfile, BRAND_FIELDS } from '../brand-profile';

describe('resolveBrandProfile — per-field cascade', () => {
  it('returns all fields null with null source when neither profile exists', () => {
    const resolved = resolveBrandProfile(null, null);
    for (const field of BRAND_FIELDS) {
      expect(resolved[field]).toEqual({ value: null, source: null });
    }
  });

  it('uses the client value with source "client" when the site has none', () => {
    const resolved = resolveBrandProfile(null, {
      voice_profile: 'calm and precise',
      figma_url: 'https://figma.com/client',
    });
    expect(resolved.voice_profile).toEqual({ value: 'calm and precise', source: 'client' });
    expect(resolved.figma_url).toEqual({ value: 'https://figma.com/client', source: 'client' });
    expect(resolved.notes).toEqual({ value: null, source: null });
  });

  it('uses the site value with source "site" when set, overriding the client', () => {
    const resolved = resolveBrandProfile(
      { figma_url: 'https://figma.com/site' },
      { figma_url: 'https://figma.com/client', voice_profile: 'inherited voice' }
    );
    // site overrides figma_url...
    expect(resolved.figma_url).toEqual({ value: 'https://figma.com/site', source: 'site' });
    // ...but voice_profile still inherits from the client
    expect(resolved.voice_profile).toEqual({ value: 'inherited voice', source: 'client' });
  });

  it('treats null site fields as unset (falls back to client) but keeps non-null site values', () => {
    const resolved = resolveBrandProfile(
      { voice_profile: null, brand_tokens: { colors: ['#000'] } },
      { voice_profile: 'client voice', brand_tokens: { colors: ['#fff'] } }
    );
    expect(resolved.voice_profile).toEqual({ value: 'client voice', source: 'client' });
    expect(resolved.brand_tokens).toEqual({ value: { colors: ['#000'] }, source: 'site' });
  });
});
