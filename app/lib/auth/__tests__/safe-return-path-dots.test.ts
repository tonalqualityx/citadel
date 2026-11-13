import { describe, it, expect } from 'vitest';
import { safeReturnPath } from '../safe-return-path';

describe('safeReturnPath resolves dot segments before the API check', () => {
  it.each([
    '/x/../api/tasks',
    '/x/%2e%2e/api/tasks',
    '/x/..%2Fapi/tasks',
    '/./api',
    '/a/b/../../api/auth/continue',
    '/x/../api?y=1',
  ])('refuses %s', (p) => {
    expect(safeReturnPath(p)).toBeNull();
  });
  it.each(['/x/../dashboard', '/a/./b', '/apiary', '/api-docs', '/x?next=/api/tasks'])('still accepts %s', (p) => {
    expect(safeReturnPath(p)).toBe(p);
  });
});
