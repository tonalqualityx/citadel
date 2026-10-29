import { describe, it, expect } from 'vitest';
import { DESIGNER_ROUTES, designerMayCall, designerMayCallRoute } from '../designer-routes';

// Designer Portal (design D1): the designer session allowlist, deny by default.
const concrete = (pattern: string) =>
  pattern.replace(':assetId', 'asset-9').replace(/:id/g, '3f2b8c1e-0000-4000-8000-000000000001');

describe('DESIGNER_ROUTES', () => {
  it('is exactly the D1 list (plus the confirm ruling)', () => {
    expect(DESIGNER_ROUTES.map((r) => `${r.method} ${r.pattern}`)).toEqual([
      'GET /api/auth/me',
      'GET /api/design/tasks',
      'GET /api/design/sessions',
      'POST /api/design/sessions',
      'GET /api/design/sessions/:id',
      'GET /api/design/sessions/:id/feed',
      'POST /api/design/sessions/:id/messages',
      'POST /api/design/sessions/:id/pins',
      'PATCH /api/design/pins/:id',
      'POST /api/design/sessions/:id/apply',
      'POST /api/design/sessions/:id/stop',
      'PATCH /api/design/changes/:id',
      'POST /api/design/sessions/:id/restore',
      'POST /api/design/sessions/:id/budget',
      'POST /api/design/sessions/:id/publish',
      'POST /api/design/publishes/:id/confirm',
      'POST /api/design/sessions/:id/request-publish',
      'POST /api/design/sessions/:id/close',
      'GET /api/design/publishes/:id',
      'POST /api/design/publishes/:id/rollback',
      'GET /api/design/sessions/:id/assets/:assetId',
    ]);
  });

  it.each(DESIGNER_ROUTES.map((r) => [r.method, concrete(r.pattern)]))('allows %s %s', (method, path) => {
    expect(designerMayCall(method, path)).toBe(true);
    expect(designerMayCallRoute(`${method} ${path}`)).toBe(true);
  });

  it('allows a trailing slash and a lower-case method (same matcher as the lanes)', () => {
    expect(designerMayCall('get', '/api/design/sessions/')).toBe(true);
  });
});

describe('designerMayCall refuses staff routes', () => {
  const STAFF: Array<[string, string]> = [
    ['GET', '/api/clients'],
    ['GET', '/api/clients/abc'],
    ['GET', '/api/sites'],
    ['GET', '/api/sites/abc'],
    ['GET', '/api/time-entries'],
    ['POST', '/api/time-entries'],
    ['GET', '/api/time-entries/active'],
    ['GET', '/api/tasks'],
    ['GET', '/api/tasks/abc'],
    ['PATCH', '/api/tasks/abc'],
    ['GET', '/api/projects/abc'],
    ['GET', '/api/api-keys'],
    ['POST', '/api/api-keys'],
    ['GET', '/api/billing'],
    ['GET', '/api/notifications'],
    ['GET', '/api/users'],
    ['GET', '/api/users/me/preferences'],
    ['PATCH', '/api/users/me/preferences'],
    ['GET', '/api/admin/settings'],
    ['POST', '/api/admin/users'],
    ['GET', '/api/oracle/projects'],
    ['POST', '/api/oracle/projects/abc/refresh'],
    ['GET', '/api/dashboard'],
    ['GET', '/api/docs'],
    ['GET', '/api/design'],
    ['GET', '/api/design/sessions/abc/unknown'],
    ['GET', '/api/design/sessions/abc/assets'],
    ['POST', '/api/auth/me/extra'],
  ];

  it.each(STAFF)('refuses %s %s', (method, path) => {
    expect(designerMayCall(method, path)).toBe(false);
    expect(designerMayCallRoute(`${method} ${path}`)).toBe(false);
  });

  it('has at least 20 staff samples', () => {
    expect(STAFF.length).toBeGreaterThanOrEqual(20);
  });
});

describe('designerMayCall refuses the wrong method', () => {
  it.each([
    ['POST', '/api/auth/me'],
    ['DELETE', '/api/design/sessions/abc'],
    ['PATCH', '/api/design/sessions/abc'],
    ['GET', '/api/design/sessions/abc/publish'],
    ['GET', '/api/design/publishes/abc/rollback'],
    ['GET', '/api/design/publishes/abc/confirm'],
    ['POST', '/api/design/pins/abc'],
    ['DELETE', '/api/design/changes/abc'],
    ['PUT', '/api/design/tasks'],
    ['HEAD', '/api/auth/me'],
  ])('refuses %s %s', (method, path) => {
    expect(designerMayCall(method, path)).toBe(false);
  });
});

describe('designerMayCallRoute fails closed', () => {
  it.each([[null], [undefined], [''], ['/api/auth/me'], ['GET'], ['GET api/auth/me'], ['G3T /api/auth/me']])(
    'refuses %j',
    (header) => {
      expect(designerMayCallRoute(header as string | null | undefined)).toBe(false);
    }
  );
});
