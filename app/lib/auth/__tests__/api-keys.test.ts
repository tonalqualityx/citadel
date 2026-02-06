import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey } from '../api-keys';

describe('generateApiKey', () => {
  it('returns rawKey, keyHash, and keyPrefix', () => {
    const result = generateApiKey();
    expect(result).toHaveProperty('rawKey');
    expect(result).toHaveProperty('keyHash');
    expect(result).toHaveProperty('keyPrefix');
  });

  it('rawKey has citadel_ prefix followed by 64 hex chars', () => {
    const { rawKey } = generateApiKey();
    expect(rawKey).toMatch(/^citadel_[0-9a-f]{64}$/);
  });

  it('keyHash is a valid SHA-256 hex string (64 chars)', () => {
    const { keyHash } = generateApiKey();
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keyPrefix equals first 16 chars of rawKey', () => {
    const { rawKey, keyPrefix } = generateApiKey();
    expect(keyPrefix).toBe(rawKey.substring(0, 16));
  });

  it('produces unique keys on each call', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.rawKey).not.toBe(key2.rawKey);
    expect(key1.keyHash).not.toBe(key2.keyHash);
  });
});

describe('hashApiKey', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashApiKey('citadel_test123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same input produces same output)', () => {
    const input = 'citadel_abc123';
    expect(hashApiKey(input)).toBe(hashApiKey(input));
  });

  it('matches keyHash from generateApiKey', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(hashApiKey(rawKey)).toBe(keyHash);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashApiKey('key_a')).not.toBe(hashApiKey('key_b'));
  });
});
