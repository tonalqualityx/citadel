import { describe, it, expect } from 'vitest';
import { safeReturnPath } from '../safe-return-path';

describe('safeReturnPath', () => {
  it.each(['/dashboard', '/tasks/abc?tab=2', '/design/sessions/1#top', '/'])('accepts %s', (p) => {
    expect(safeReturnPath(p)).toBe(p);
  });

  it.each([
    'https://evil.example',
    'http://evil.example/x',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/%5Cevil.example',
    '/%2F%2Fevil.example/x',
    'evil.example',
    'dashboard',
    'javascript:alert(1)',
    '/a\r\nSet-Cookie: x=1',
    '/a\tb',
    '',
    '/api/tasks',
    '/api',
    '/api/auth/continue?to=/x',
  ])('refuses %j', (p) => {
    expect(safeReturnPath(p)).toBeNull();
  });

  it('refuses non-strings and very long values', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(['/x'])).toBeNull();
    expect(safeReturnPath('/' + 'a'.repeat(3000))).toBeNull();
  });
});
