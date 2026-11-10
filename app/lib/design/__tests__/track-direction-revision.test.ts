// @vitest-environment node
// W4.4a-fix: the pieces of the art direction revision that need no database (the integration suites cover the rest).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { MAX_PATCH_DEPTH, directionRevision, mergePatch, nextUpdatedAt } from '../track-direction';

const nest = (levels: number): Record<string, unknown> => {
  let v: Record<string, unknown> = { leaf: 1 };
  for (let i = 1; i < levels; i += 1) v = { a: v };
  return v;
};
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return 'none';
  } catch (e) {
    return e instanceof ApiError ? e.code : `not an ApiError: ${(e as Error).constructor.name}`;
  }
};

afterEach(() => vi.restoreAllMocks());

describe('nextUpdatedAt and directionRevision', () => {
  it('moves strictly forward even when the clock stands still or runs behind the row', () => {
    const t = Date.parse('2026-11-10T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(t);
    const first = nextUpdatedAt(new Date(t));
    const second = nextUpdatedAt(first);
    expect(first.getTime()).toBe(t + 1);
    expect(second.getTime()).toBe(t + 2);
    expect(directionRevision({ updated_at: first })).not.toBe(directionRevision({ updated_at: second }));
    // a clock behind the stored row still moves past it
    expect(nextUpdatedAt(new Date(t + 5000)).getTime()).toBe(t + 5001);
    // a clock ahead wins
    expect(nextUpdatedAt(new Date(t - 5000)).getTime()).toBe(t);
    expect(nextUpdatedAt(null).getTime()).toBe(t);
  });

  it('the revision fits the 40 character cap the routes put on base_revision', () => {
    expect(directionRevision({ updated_at: new Date('2026-11-10T12:00:00.123Z') }).length).toBeLessThanOrEqual(40);
  });
});

describe('mergePatch depth and reserved keys', () => {
  it('merges a patch as deep as the limit', () => {
    expect(mergePatch({}, nest(MAX_PATCH_DEPTH))).toEqual(nest(MAX_PATCH_DEPTH));
  });

  it('refuses one level more with 400 bad_patch, and a very deep patch without blowing the stack', () => {
    expect(codeOf(() => mergePatch({}, nest(MAX_PATCH_DEPTH + 1)))).toBe('bad_patch');
    expect(codeOf(() => mergePatch({}, { unknown_key: nest(50_000) }))).toBe('bad_patch');
  });

  it('refuses prototype keys at any depth', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const patch = JSON.parse(`{"feel":{"${key}":{"polluted":true}}}`) as Record<string, unknown>;
      expect(codeOf(() => mergePatch({}, patch)), key).toBe('bad_patch');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
