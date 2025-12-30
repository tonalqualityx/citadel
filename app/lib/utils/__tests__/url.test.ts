import { describe, it, expect } from 'vitest';
import { isValidUrl, getHostname, getOrigin } from '../url';

describe('isValidUrl', () => {
  it('returns true for valid HTTP URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
    expect(isValidUrl('https://example.com?query=value')).toBe(true);
    expect(isValidUrl('https://example.com#anchor')).toBe(true);
  });

  it('returns true for localhost URLs', () => {
    expect(isValidUrl('http://localhost')).toBe(true);
    expect(isValidUrl('http://localhost:3000')).toBe(true);
    expect(isValidUrl('http://127.0.0.1:8080')).toBe(true);
  });

  it('returns true for URLs with subdomains', () => {
    expect(isValidUrl('https://sub.domain.example.com')).toBe(true);
    expect(isValidUrl('https://www.example.com')).toBe(true);
  });

  it('returns false for empty/null/undefined', () => {
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl(null)).toBe(false);
    expect(isValidUrl(undefined)).toBe(false);
  });

  it('returns false for strings without protocol', () => {
    expect(isValidUrl('example.com')).toBe(false);
    expect(isValidUrl('www.example.com')).toBe(false);
  });

  it('returns false for invalid strings', () => {
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('just-text')).toBe(false);
    expect(isValidUrl('http://')).toBe(false);
  });
});

describe('getHostname', () => {
  it('extracts hostname from valid URLs', () => {
    expect(getHostname('https://example.com')).toBe('example.com');
    expect(getHostname('https://example.com/path')).toBe('example.com');
    expect(getHostname('https://example.com:8080')).toBe('example.com');
    expect(getHostname('https://example.com?query=1')).toBe('example.com');
  });

  it('extracts hostname with subdomains', () => {
    expect(getHostname('https://www.example.com')).toBe('www.example.com');
    expect(getHostname('https://sub.domain.example.com')).toBe('sub.domain.example.com');
  });

  it('extracts localhost', () => {
    expect(getHostname('http://localhost:3000')).toBe('localhost');
    expect(getHostname('http://127.0.0.1:8080')).toBe('127.0.0.1');
  });

  it('returns null for empty/null/undefined', () => {
    expect(getHostname('')).toBeNull();
    expect(getHostname(null)).toBeNull();
    expect(getHostname(undefined)).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(getHostname('not-a-url')).toBeNull();
    expect(getHostname('example.com')).toBeNull();
    expect(getHostname('just text')).toBeNull();
  });
});

describe('getOrigin', () => {
  it('extracts origin from valid URLs', () => {
    expect(getOrigin('https://example.com/path')).toBe('https://example.com');
    expect(getOrigin('http://example.com:8080/path')).toBe('http://example.com:8080');
  });

  it('extracts origin from localhost', () => {
    expect(getOrigin('http://localhost:3000/api')).toBe('http://localhost:3000');
  });

  it('returns null for invalid URLs', () => {
    expect(getOrigin('')).toBeNull();
    expect(getOrigin(null)).toBeNull();
    expect(getOrigin('not-a-url')).toBeNull();
  });
});
