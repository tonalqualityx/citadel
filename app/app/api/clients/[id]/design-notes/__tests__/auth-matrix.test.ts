// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';
import { SCRATCH } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import * as notes from '../route';
import * as note from '../../../../design-notes/[id]/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ID = '3f2b8c1e-0000-4000-8000-000000000001';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const rows: Array<{ route: string; handler: Handler; url: string; method: string }> = [
  { route: 'POST /api/clients/:id/design-notes', handler: notes.POST as never, url: `/api/clients/${ID}/design-notes`, method: 'POST' },
  { route: 'GET /api/clients/:id/design-notes', handler: notes.GET as never, url: `/api/clients/${ID}/design-notes`, method: 'GET' },
  { route: 'PATCH /api/design-notes/:id', handler: note.PATCH as never, url: `/api/design-notes/${ID}`, method: 'PATCH' },
];

const KEY = { userId: ID, email: 'bast@example.test', role: 'pm', via: 'api_key', apiKeyId: 'k1', lane: 'design-notes', laneEnforced: true };
const NOT_NOTES: Array<[string, Record<string, unknown>]> = [
  ['the design worker key', { ...KEY, email: DESIGN_WORKER_SERVICE_EMAIL, lane: 'design-worker' }],
  ['the design-track runner key', { ...KEY, lane: 'design-track' }],
  ['an admin session', { ...KEY, via: 'session', apiKeyId: undefined, lane: undefined, role: 'admin' }],
  ['a designer session', { ...KEY, via: 'session', apiKeyId: undefined, lane: undefined, role: 'designer' }],
  ['an admin key with no lane', { ...KEY, lane: undefined, laneEnforced: undefined, role: 'admin' }],
  ['a design-notes key without enforce (shadow)', { ...KEY, laneEnforced: false }],
  ['a session cookie for the key user', { ...KEY, via: 'session', apiKeyId: undefined }],
  ['another lane key', { ...KEY, lane: 'bast' }],
];

const call = (r: (typeof rows)[number]) =>
  r.handler(
    new NextRequest(`http://localhost:3000${r.url}`, { method: r.method, ...(r.method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }) }),
    { params: Promise.resolve({ id: ID }) },
  );

describe('design-notes lane routes: auth matrix', () => {
  it('has a handler row for every lane route and no other', () => {
    expect(rows.map((r) => r.route).sort()).toEqual(LANE_ROUTES['design-notes'].map((r) => `${r.method} ${r.pattern}`).sort());
    expect(rows).toHaveLength(3);
  });

  it.each(rows.map((r) => [r.route, r] as const))('%s: anonymous is 401', async (_n, r) => {
    as.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await call(r)).status).toBe(401);
  });

  for (const [who, auth] of NOT_NOTES) {
    it.each(rows.map((r) => [r.route, r] as const))(`%s: ${who} is 403`, async (_n, r) => {
      as.mockResolvedValue(auth);
      expect((await call(r)).status).toBe(403);
    });
  }

  it.skipIf(!SCRATCH).each(rows.map((r) => [r.route, r] as const))('%s: the enforced design-notes key passes the gate', async (_n, r) => {
    as.mockResolvedValue(KEY);
    const status = (await call(r)).status;
    expect([401, 403]).not.toContain(status);
  });
});
