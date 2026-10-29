// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCRATCH } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
// W2.4 owns lib/design/publishes.ts; the route test stubs it so this suite does not depend on that task.
vi.mock('@/lib/design/publishes', () => ({ applyWorkerPublishPatch: vi.fn(async (id: string, patch: object) => ({ id, ...patch })) }));

import { requireAuth } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import * as inbox from '../inbox/route';
import * as heartbeat from '../heartbeat/route';
import * as sessions from '../sessions/route';
import * as session from '../sessions/[id]/route';
import * as asset from '../sessions/[id]/assets/[assetId]/route';
import * as assets from '../sessions/[id]/assets/route';
import * as events from '../sessions/[id]/events/route';
import * as changes from '../sessions/[id]/changes/route';
import * as scope from '../sessions/[id]/scope-flags/route';
import * as change from '../changes/[id]/route';
import * as pin from '../pins/[id]/route';
import * as command from '../commands/[id]/route';
import { NOT_WORKERS, WORKER, ctx, req } from './harness';

// The publishes route imports W2.4's lib/design/publishes.ts. Until that file exists the route cannot load, so it is
// imported only when present (the mock above then replaces the module).
type Handler = (r: never, c: never) => Promise<Response>;
const HAS_PUBLISHES = fs.existsSync(path.resolve(__dirname, '../../../../../lib/design/publishes.ts'));
const publish = (HAS_PUBLISHES ? await import('../publishes/[id]/route') : { PATCH: async () => new Response(null, { status: 403 }) }) as unknown as { PATCH: Handler };

const ID = '11111111-1111-4111-8111-111111111111';
const P = '/api/design/worker';
interface Row { name: string; h: Handler; method: string; path: string; body?: unknown; c: unknown }
const rows: Row[] = [
  { name: 'GET inbox', h: inbox.GET as Handler, method: 'GET', path: `${P}/inbox`, c: {} },
  { name: 'POST heartbeat', h: heartbeat.POST as Handler, method: 'POST', path: `${P}/heartbeat`, body: { configured_site_ids: [] }, c: {} },
  { name: 'GET sessions', h: sessions.GET as Handler, method: 'GET', path: `${P}/sessions?status=active`, c: {} },
  { name: 'GET sessions/:id', h: session.GET as Handler, method: 'GET', path: `${P}/sessions/${ID}`, c: ctx({ id: ID }) },
  { name: 'GET sessions/:id/assets/:assetId', h: asset.GET as Handler, method: 'GET', path: `${P}/sessions/${ID}/assets/${ID}`, c: ctx({ id: ID, assetId: ID }) },
  { name: 'PATCH sessions/:id', h: session.PATCH as Handler, method: 'PATCH', path: `${P}/sessions/${ID}`, body: { live_action: 'x' }, c: ctx({ id: ID }) },
  { name: 'POST sessions/:id/events', h: events.POST as Handler, method: 'POST', path: `${P}/sessions/${ID}/events`, body: { acks: [] }, c: ctx({ id: ID }) },
  { name: 'POST sessions/:id/changes', h: changes.POST as Handler, method: 'POST', path: `${P}/sessions/${ID}/changes`, body: { commit_sha: 'abcdef1', summary: 's' }, c: ctx({ id: ID }) },
  { name: 'PATCH changes/:id', h: change.PATCH as Handler, method: 'PATCH', path: `${P}/changes/${ID}`, body: {}, c: ctx({ id: ID }) },
  { name: 'POST sessions/:id/assets', h: assets.POST as Handler, method: 'POST', path: `${P}/sessions/${ID}/assets`, body: {}, c: ctx({ id: ID }) },
  { name: 'PATCH pins/:id', h: pin.PATCH as Handler, method: 'PATCH', path: `${P}/pins/${ID}`, body: {}, c: ctx({ id: ID }) },
  { name: 'POST sessions/:id/scope-flags', h: scope.POST as Handler, method: 'POST', path: `${P}/sessions/${ID}/scope-flags`, body: { title: 't' }, c: ctx({ id: ID }) },
  { name: 'PATCH commands/:id', h: command.PATCH as Handler, method: 'PATCH', path: `${P}/commands/${ID}`, body: { action: 'claim' }, c: ctx({ id: ID }) },
  { name: 'PATCH publishes/:id', h: publish.PATCH as Handler, method: 'PATCH', path: `${P}/publishes/${ID}`, body: { status: 'running' }, c: ctx({ id: ID }) },
];

beforeEach(() => vi.clearAllMocks());

describe('the 14 worker routes', () => {
  it('are exactly the lane list', () => {
    const lane = LANE_ROUTES['design-worker'].map((r) => `${r.method} ${r.pattern.replace('/api/design/worker/', '').replace(/:(\w+)/g, ':$1')}`);
    expect(rows).toHaveLength(14);
    expect(lane).toHaveLength(14);
    expect(HAS_PUBLISHES, 'W2.4 lib/design/publishes.ts missing: the publishes row is a placeholder').toBe(true);
  });

  for (const r of rows) {
    describe(r.name, () => {
      for (const [who, auth] of NOT_WORKERS) {
        it(`403 for ${who}`, async () => {
          vi.mocked(requireAuth).mockResolvedValue(auth);
          const res = await r.h(req(r.method, r.path, r.body) as never, r.c as never);
          expect(res.status).toBe(403);
        });
      }
      it('401 when anonymous', async () => {
        vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
        expect((await r.h(req(r.method, r.path, r.body) as never, r.c as never)).status).toBe(401);
      });
      it.skipIf(!SCRATCH)('the worker key gets past the gate (never 401/403)', async () => {
        vi.mocked(requireAuth).mockResolvedValue(WORKER);
        const res = await r.h(req(r.method, r.path, r.body) as never, r.c as never);
        expect([401, 403]).not.toContain(res.status);
      });
    });
  }

  it('there is no route to create a publish or a command, and none to confirm one', () => {
    expect((publish as Record<string, unknown>).POST).toBeUndefined();
    expect((command as Record<string, unknown>).POST).toBeUndefined();
    expect((sessions as Record<string, unknown>).POST).toBeUndefined();
  });
});
