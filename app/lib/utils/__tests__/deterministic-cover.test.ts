import { describe, it, expect } from 'vitest';
import {
  stableHash,
  COVER_POOL,
  deterministicPoolCover,
  deterministicCoverDataUri,
} from '../deterministic-cover';

describe('stableHash', () => {
  it('is deterministic — same input always produces the same output', () => {
    expect(stableHash('task-123')).toBe(stableHash('task-123'));
  });

  it('is non-negative', () => {
    expect(stableHash('anything')).toBeGreaterThanOrEqual(0);
    expect(stableHash('')).toBeGreaterThanOrEqual(0);
  });

  it('differs across (most) distinct inputs', () => {
    const hashes = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(stableHash));
    expect(hashes.size).toBeGreaterThan(1);
  });
});

describe('deterministicPoolCover', () => {
  it('is deterministic — same id always maps to the same pool entry', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(deterministicPoolCover(id)).toBe(deterministicPoolCover(id));
  });

  it('always returns a path into the bundled pool', () => {
    const result = deterministicPoolCover('some-task-id');
    expect(COVER_POOL).toContain(result);
  });

  it('spreads across the pool for different ids (not always the same entry)', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const picks = new Set(ids.map(deterministicPoolCover));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('the pool itself is non-empty and every entry looks like a real bundled asset path', () => {
    expect(COVER_POOL.length).toBeGreaterThan(0);
    for (const entry of COVER_POOL) {
      expect(entry).toMatch(/^\/covers\/.+\.jpg$/);
    }
  });
});

describe('deterministicCoverDataUri', () => {
  it('is deterministic — same id always produces the same data URI', () => {
    const id = 'stable-id';
    expect(deterministicCoverDataUri(id)).toBe(deterministicCoverDataUri(id));
  });

  it('returns a valid base64-encoded SVG data URI', () => {
    const uri = deterministicCoverDataUri('any-id');
    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    const base64 = uri.replace('data:image/svg+xml;base64,', '');
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('</svg>');
  });

  it('never embeds any text content (decorative texture only)', () => {
    const uri = deterministicCoverDataUri('any-id');
    const decoded = Buffer.from(uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf-8');
    expect(decoded).not.toMatch(/<text/);
  });

  it('stays well under the cover_url column limit (VarChar(1000))', () => {
    for (const id of ['a', 'a much longer sample uuid-like-identifier-1234567890']) {
      expect(deterministicCoverDataUri(id).length).toBeLessThan(1000);
    }
  });
});
