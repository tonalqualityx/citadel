// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, seedTrack, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { UPLOAD_REJECT_CODES } from '@/lib/design/track-assets';
import { loadSessionTrackView } from '@/lib/design/track-session';
import { readBrief } from '@/lib/design/track-board';
import * as asset from '../tracks/[id]/assets/[assetId]/route';
import * as track from '../tracks/[id]/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const actx = (id: string, assetId: string) => ({ params: Promise.resolve({ id, assetId }) });
const tctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (tid: string, aid: string, body: unknown, raw = false) =>
  asset.PATCH(
    new NextRequest(`http://localhost:3000/api/design/runner/tracks/${tid}/assets/${aid}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body),
    }),
    actx(tid, aid),
  );
const REJECT = { status: 'rejected', reject_reason: 'not_an_image' };

describe.skipIf(!SCRATCH)('runner reject route and client_name on the track read (W3.8b)', () => {
  let f: DesignFixture;
  let other: DesignFixture;
  let t: { id: string };
  let t2: { id: string };
  let runner: Record<string, unknown>;

  const mk = (trackId: string, over: Record<string, unknown> = {}) =>
    prisma.designTrackAsset.create({
      data: {
        track_id: trackId, kind: 'upload', purpose: 'image', status: 'pending', content_type: 'image/png', bytes: 10,
        sha256: crypto.randomBytes(32).toString('hex'), storage_key: `design/tracks/${trackId}/${crypto.randomUUID()}`, source: 'designer', ...over,
      },
    });

  beforeAll(async () => {
    f = await seedDesign('w38bA');
    other = await seedDesign('w38bB');
    t = await seedTrack(f);
    t2 = await seedTrack(other);
    const bast = await prisma.user.create({ data: { email: 'dp-w38b-bast@example.test', password_hash: 'x', name: 'bast w38b', role: 'pm' } });
    runner = { userId: bast.id, email: bast.email, role: 'pm', via: 'api_key', apiKeyId: 'k-run', lane: 'design-track', laneEnforced: true };
  });
  afterAll(async () => {
    await prisma.designTrackAsset.deleteMany({ where: { track_id: { in: [t.id, t2.id] } } });
    await prisma.designTrack.deleteMany({ where: { id: { in: [t.id, t2.id] } } });
    await prisma.user.deleteMany({ where: { id: runner.userId as string } });
    await teardownDesign(f);
    await teardownDesign(other);
  });

  it('pending becomes rejected with the reason, and the response is the runner asset view', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id);
    const res = await patch(t.id, a.id, { status: 'rejected', reject_reason: 'too_many_pixels' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset).toMatchObject({ id: a.id, track_id: t.id, kind: 'upload', status: 'rejected' });
    expect(Object.keys(body.asset)).not.toContain('storage_key');
    const row = await prisma.designTrackAsset.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'rejected', reject_reason: 'too_many_pixels' });
  });

  it('every listed code is accepted', async () => {
    as.mockResolvedValue(runner);
    for (const code of UPLOAD_REJECT_CODES) {
      const a = await mk(t.id);
      expect((await patch(t.id, a.id, { status: 'rejected', reject_reason: code })).status, code).toBe(200);
    }
  });

  it('already rejected is 200 and unchanged: the first reason stays', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id);
    expect((await patch(t.id, a.id, { status: 'rejected', reject_reason: 'timeout' })).status).toBe(200);
    const again = await patch(t.id, a.id, { status: 'rejected', reject_reason: 'too_large' });
    expect(again.status).toBe(200);
    expect((await again.json()).asset.status).toBe('rejected');
    expect((await prisma.designTrackAsset.findUnique({ where: { id: a.id } }))!.reject_reason).toBe('timeout');
  });

  it('a ready upload is 409 already_ready and nothing changes', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id, { status: 'ready' });
    const res = await patch(t.id, a.id, REJECT);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('already_ready');
    expect(await prisma.designTrackAsset.findUnique({ where: { id: a.id } })).toMatchObject({ status: 'ready', reject_reason: null });
  });

  it('a non-upload asset is 409 and unchanged', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id, { kind: 'render', purpose: null, status: 'pending', source: 'runner' });
    expect((await patch(t.id, a.id, REJECT)).status).toBe(409);
    expect((await prisma.designTrackAsset.findUnique({ where: { id: a.id } }))!.status).toBe('pending');
  });

  it('an asset of another track, an unknown asset and a malformed id are 404; the asset is untouched', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t2.id);
    expect((await patch(t.id, a.id, REJECT)).status).toBe(404);
    expect((await prisma.designTrackAsset.findUnique({ where: { id: a.id } }))!.status).toBe('pending');
    expect((await patch(t.id, crypto.randomUUID(), REJECT)).status).toBe(404);
    expect((await patch(t.id, 'nope', REJECT)).status).toBe(404);
  });

  it('refuses any body but {status: "rejected", reject_reason: <code>} with 400 and changes nothing', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id);
    const bad: unknown[] = [
      { status: 'ready', reject_reason: 'timeout' },
      { status: 'pending', reject_reason: 'timeout' },
      { status: 'rejected', reject_reason: 'because I said so' },
      { status: 'rejected', reject_reason: 'TIMEOUT' },
      { status: 'rejected' },
      { reject_reason: 'timeout' },
      { status: 'rejected', reject_reason: 'timeout', extra: 1 },
      { status: 'rejected', reject_reason: 'timeout', kind: 'render' },
      { status: 'rejected', reject_reason: ['timeout'] },
      {},
      [],
      ['rejected'],
      'rejected',
      null,
      42,
    ];
    for (const b of bad) expect((await patch(t.id, a.id, b)).status, JSON.stringify(b)).toBe(400);
    expect((await patch(t.id, a.id, '{not json', true)).status).toBe(400);
    expect((await patch(t.id, a.id, '', true)).status).toBe(400);
    expect(await prisma.designTrackAsset.findUnique({ where: { id: a.id } })).toMatchObject({ status: 'pending', reject_reason: null });
  });

  it('two concurrent rejects both answer 200 and exactly one reason is stored', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id);
    const rs = await Promise.all([
      patch(t.id, a.id, { status: 'rejected', reject_reason: 'pdf_failed' }),
      patch(t.id, a.id, { status: 'rejected', reject_reason: 'svg_failed' }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const stored = (await prisma.designTrackAsset.findUnique({ where: { id: a.id } }))!;
    expect(stored.status).toBe('rejected');
    const reasons = (await Promise.all(rs.map((r) => r.json()))).map((j) => j.asset.status);
    expect(reasons).toEqual(['rejected', 'rejected']);
    expect(['pdf_failed', 'svg_failed']).toContain(stored.reject_reason);
    // a later call never overwrites it
    await patch(t.id, a.id, { status: 'rejected', reject_reason: 'timeout' });
    expect((await prisma.designTrackAsset.findUnique({ where: { id: a.id } }))!.reject_reason).toBe(stored.reject_reason);
  });

  it('a reject racing a ready: ready wins or the reject wins, never both (the loser is 409 or 200 on the rejected row)', async () => {
    as.mockResolvedValue(runner);
    const a = await mk(t.id);
    const [rej, rdy] = await Promise.all([
      patch(t.id, a.id, REJECT),
      prisma.designTrackAsset.updateMany({ where: { id: a.id, status: 'pending' }, data: { status: 'ready' } }),
    ]);
    const row = (await prisma.designTrackAsset.findUnique({ where: { id: a.id } }))!;
    if (row.status === 'ready') {
      expect(rej.status).toBe(409);
      expect(row.reject_reason).toBeNull();
    } else {
      expect(rej.status).toBe(200);
      expect(rdy.count).toBe(0);
    }
  });

  it('track read: client_name (the owning client name) on the runner view only', async () => {
    as.mockResolvedValue(runner);
    const res = await track.GET(new NextRequest(`http://localhost:3000/api/design/runner/tracks/${t.id}`), tctx(t.id));
    const body = await res.json();
    expect(body.track.client_name).toBe('DP w38bA Co');
    expect(Object.keys(body)).toEqual(['track']);
    // the keys of the runner track view: the existing ones plus client_name
    expect(Object.keys(body.track).sort()).toEqual([
      'art_direction_id', 'branch', 'brief_id', 'busy_job_id', 'client_name', 'created_at', 'finish_command_id', 'finish_result', 'finished_at', 'head_sha', 'id',
      'preview_alias', 'preview_sha', 'preview_url', 'project_id', 'round', 'site_id', 'slug', 'stage', 'updated_at',
    ]);
  });

  it('client_name never reaches a designer-facing projection', async () => {
    const sess = await loadSessionTrackView({ track_id: t.id });
    expect(Object.keys(sess!).sort()).toEqual(['busy', 'busy_line', 'finish', 'id', 'preview_alias', 'preview_url', 'stage']);
    const brief = await readBrief({ id: t.id, project_id: f.projectId, site_id: f.siteId, brief_id: null }, 'sess', f.designer.userId);
    expect(Object.keys(brief).sort()).toEqual(['assets', 'brief', 'client_statements', 'reactions']);
    expect(JSON.stringify({ sess, brief })).not.toMatch(/client_name|DP w38bA Co/);
  });
});
