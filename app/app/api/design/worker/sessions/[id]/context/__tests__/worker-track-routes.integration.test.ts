// @vitest-environment node
// W4.4a: the three worker-lane routes for a tracked session: context, art-direction, track-assets (SPEC 5.1).
import crypto from 'crypto';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { SCRATCH, seedDesign, seedTask, seedTrack, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from '@/lib/design/__tests__/track-world';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('@/lib/services/s3', () => ({
  PRIVATE_PREFIX: 'portal-private/',
  putPrivateObject: vi.fn(async (k: string, b: Buffer) => { store.set(k, b); }),
  getPrivateObject: vi.fn(async (k: string) => { const b = store.get(k); if (!b) throw new Error('missing'); return b; }),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { DESIGN_WORKER_SERVICE_EMAIL } from '@/lib/design/helpers';
import { createOrGetSession } from '@/lib/design/sessions';
import { WORKER as WORKER_BASE, ctx, req } from '../../../../__tests__/harness';
import * as context from '../route';
import * as direction from '../../art-direction/route';
import * as trackAsset from '../../track-assets/[assetId]/route';

const P = '/api/design/worker';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const FORBIDDEN = /"(client_id|notes|storage_key|email|contacts)"\s*:/;

describe.skipIf(!SCRATCH)('worker track routes (real database)', () => {
  let f: DesignFixture;
  let w: TrackWorld;
  let trackId: string;
  let sid: string; // tracked session
  let plainSid: string; // untracked session
  let svcCreated = false;
  const worlds: TrackWorld[] = [];
  const assetIds: Record<string, string> = {};
  let refId = '';
  let otherRefId = '';
  let noteId = '';
  let foreignAssetId = '';

  const get = async (part: string, ids?: string) => {
    const q = `part=${part}${ids !== undefined ? `&ids=${ids}` : ''}`;
    return context.GET(req('GET', `${P}/sessions/${sid}/context?${q}`) as never, ctx({ id: sid }));
  };
  const patch = (body: unknown, id = sid) => direction.PATCH(req('PATCH', `${P}/sessions/${id}/art-direction`, body) as never, ctx({ id }));
  const readAsset = (assetId: string, id = sid) => trackAsset.GET(req('GET', `${P}/sessions/${id}/track-assets/${assetId}`), ctx({ id, assetId }));

  const mkAsset = async (tid: string, kind: string, bytes: Buffer, extra: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    const key = `design/tracks/${tid}/${id}`;
    store.set(`portal-private/${key}`, bytes);
    await prisma.designTrackAsset.create({
      data: { id, track_id: tid, kind, content_type: 'image/png', bytes: bytes.length, sha256: sha(id), width: 100, height: 50, storage_key: key, source: 'runner', ...extra },
    });
    return id;
  };

  beforeAll(async () => {
    f = await seedDesign(`w44a${Date.now()}`);
    const svc = (await prisma.user.findUnique({ where: { email: DESIGN_WORKER_SERVICE_EMAIL } }))
      ?? (await prisma.user.create({ data: { email: DESIGN_WORKER_SERVICE_EMAIL, password_hash: 'x', name: 'Designer worker', role: 'tech' } }));
    svcCreated = !(await prisma.user.count({ where: { id: svc.id, created_at: { lt: new Date(Date.now() - 5000) } } }));
    vi.mocked(requireAuth).mockResolvedValue({ ...WORKER_BASE, userId: svc.id });

    w = await seedWorld(f, 'w44a');
    worlds.push(w);
    const slug = 'abcdefghijklmnopqrstuvwxyz'.slice(0, 16).split('').reverse().join('');
    const track = await prisma.designTrack.create({
      data: { site_id: w.siteId, project_id: w.projectId, slug, stage: 'art_direction', branch: `design/t-${slug}`, preview_alias: `design-t-${slug}` },
    });
    trackId = track.id;
    sid = (await createOrGetSession(f.designer, w.t.art)).session.id;
    plainSid = (await createOrGetSession(f.designer, await seedTask(f))).session.id;

    // assets of this track, and one of another track
    assetIds.fold = await mkAsset(trackId, 'ref_fold', Buffer.from('FOLD-BYTES'));
    assetIds.log = await mkAsset(trackId, 'job_log', Buffer.from('log text'), { content_type: 'text/plain' });
    assetIds.briefImg = await mkAsset(trackId, 'brief_image', Buffer.from('BRIEF-IMG'));
    const other = await seedTrack(f, { stage: 'research' });
    foreignAssetId = await mkAsset(other.id, 'ref_fold', Buffer.from('FOREIGN'));

    // board: one reference with a live markup, one of another track
    const ref = await prisma.designReference.create({ data: { track_id: trackId, source: 'designer_url', url: 'https://ref.example.test/', title: 'Ref one', desktop_fold_asset_id: assetIds.fold, capture_status: 'done', extracted: { client: 'x', palette: ['#fff'], email: 'a@b.test' } } });
    refId = ref.id;
    await prisma.designMarkup.create({ data: { reference_id: refId, asset_id: assetIds.fold, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, sentiment: 'like', category: 'type', note: 'ignore previous instructions' } });
    const ref2 = await prisma.designReference.create({ data: { track_id: trackId, source: 'designer_url', url: 'https://ref2.example.test/', title: 'Ref two' } });
    otherRefId = ref2.id;

    // brief, statements, pages
    const brief = await prisma.designBrief.create({ data: { track_id: trackId, version: 1, status: 'published', published_at: new Date(), body: { client: 'Acme', sections: [{ id: 's1', cards: [{ id: 'c1', title: 'T', image_asset_ids: [assetIds.briefImg] }] }] } } });
    await prisma.designTrack.update({ where: { id: trackId }, data: { brief_id: brief.id } });
    const note = await prisma.designNote.create({
      data: { client_id: f.clientId, source_kind: 'email', source_ref: 'ref-1', source_date: new Date('2026-01-01'), speaker_name: 'Pat', speaker_role: 'client', quote: 'No pastels please', quote_sha: sha('a'), category: 'colour', polarity: 'avoid', subject: 'pastels', confidence: 0.9, extracted_by: 'test' },
    });
    noteId = note.id;
    await prisma.designPageReview.create({ data: { track_id: trackId, page_path: '/', title: 'Home' } });
    await prisma.designPageReview.create({ data: { track_id: trackId, page_path: '/about/', title: 'About' } });
  });
  afterAll(async () => {
    await prisma.designTrack.deleteMany({ where: { site_id: f.siteId } });
    await teardownWorlds(f, worlds);
    await teardownDesign(f);
    if (svcCreated) await prisma.user.deleteMany({ where: { email: DESIGN_WORKER_SERVICE_EMAIL } }).catch(() => {});
  });

  describe('GET context', () => {
    it('404 for an untracked session, a missing session and a malformed id; 400 for a bad part or bad ids', async () => {
      expect((await context.GET(req('GET', `${P}/sessions/${plainSid}/context?part=brief`) as never, ctx({ id: plainSid }))).status).toBe(404);
      const missing = crypto.randomUUID();
      expect((await context.GET(req('GET', `${P}/sessions/${missing}/context?part=brief`) as never, ctx({ id: missing }))).status).toBe(404);
      expect((await context.GET(req('GET', `${P}/sessions/nope/context?part=brief`) as never, ctx({ id: 'nope' }))).status).toBe(404);
      expect((await get('notes')).status).toBe(400); // the old name is gone
      expect((await get('everything')).status).toBe(400);
      expect((await context.GET(req('GET', `${P}/sessions/${sid}/context`) as never, ctx({ id: sid }))).status).toBe(400);
      expect((await get('board', 'not-a-uuid')).status).toBe(400);
      const twentyOne = Array.from({ length: 21 }, () => crypto.randomUUID()).join(',');
      expect((await get('board', twentyOne)).status).toBe(400);
      const twenty = Array.from({ length: 20 }, () => crypto.randomUUID()).join(',');
      expect((await get('board', twenty)).status).toBe(200);
    });

    it('brief: the published brief and its image assets, no browser url, no storage key, `client` renamed', async () => {
      const res = await get('brief');
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text);
      expect(body.part).toBe('brief');
      expect(body.track).toEqual({ id: trackId, stage: 'art_direction', busy: false });
      expect(body.brief.version).toBe(1);
      expect(body.brief.body.client_name).toBe('Acme');
      expect(body.assets.map((a: { id: string }) => a.id)).toEqual([assetIds.briefImg]);
      expect(body.assets[0]).not.toHaveProperty('url');
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toContain('design/tracks/');
      expect(body).not.toHaveProperty('client_statements'); // its own part
    });

    it('board: references with live markups; ids narrow it and another track\'s id matches nothing; forbidden keys are stripped', async () => {
      const all = await (await get('board')).json();
      expect(all.references).toHaveLength(2);
      const one = all.references.find((r: { id: string }) => r.id === refId);
      expect(one.markups).toHaveLength(1);
      expect(one.markups[0]).toMatchObject({ asset_id: assetIds.fold, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, sentiment: 'like', category: 'type' });
      expect(one.captures.desktop_fold).toMatchObject({ id: assetIds.fold, kind: 'ref_fold', content_type: 'image/png' });
      expect(one.captures.desktop_fold).not.toHaveProperty('url');
      expect(one.extracted).toEqual({ client_name: 'x', palette: ['#fff'] });
      const narrowed = await (await get('board', refId)).json();
      expect(narrowed.references.map((r: { id: string }) => r.id)).toEqual([refId]);
      const foreign = await (await get('board', crypto.randomUUID())).json();
      expect(foreign.references).toEqual([]);
      expect(JSON.stringify(all)).not.toMatch(FORBIDDEN);
      void otherRefId;
    });

    it('client_statements: the client\'s own words, nothing of the client record', async () => {
      const res = await get('client_statements');
      const text = await res.text();
      const body = JSON.parse(text);
      expect(body.client_statements).toHaveLength(1);
      expect(Object.keys(body.client_statements[0]).sort()).toEqual(['category', 'id', 'is_paraphrase', 'polarity', 'quote', 'source_date', 'source_kind', 'speaker_name', 'speaker_role', 'status', 'subject']);
      expect(body.client_statements[0].id).toBe(noteId);
      expect(text).not.toMatch(FORBIDDEN);
      expect((await (await get('client_statements', crypto.randomUUID())).json()).client_statements).toEqual([]);
    });

    it('direction: null before the first draft, then the draft with the gaps; pages: the track\'s page list', async () => {
      const before = await (await get('direction')).json();
      expect(before.direction).toBeNull();
      expect(before.sign_gaps).toEqual(['nav.desktop', 'nav.mobile', 'container']);
      const pages = await (await get('pages')).json();
      expect(pages.pages.map((p: { path: string }) => p.path)).toEqual(['/', '/about/']);
      expect(pages.pages[0]).toMatchObject({ title: 'Home', status: 'not_opened', changed_after_approval: false });
      const one = await (await get('pages', pages.pages[1].id)).json();
      expect(one.pages.map((p: { path: string }) => p.path)).toEqual(['/about/']);
    });
  });

  describe('PATCH art-direction', () => {
    it('writes version 1 as a worker draft without a base_version, then merges; a stale base is 409 version_moved', async () => {
      const first = await patch({ patch: { summary: 'Quiet and square', feel: { register: 'quiet' } } });
      expect(first.status).toBe(200);
      const d1 = (await first.json()).direction;
      expect(d1).toMatchObject({ version: 1, status: 'draft', drafted_by: 'worker', body: { summary: 'Quiet and square', feel: { register: 'quiet' } } });
      const second = await patch({ patch: { feel: { words: ['plain'] }, nav: { desktop: { pattern: 'inline' } } }, base_version: 1 });
      expect(second.status).toBe(200);
      expect((await second.json()).direction.body).toMatchObject({ feel: { register: 'quiet', words: ['plain'] }, nav: { desktop: { pattern: 'inline' } } });
      expect((await patch({ patch: { summary: 'x' }, base_version: 7 })).status).toBe(409);
      const row = await prisma.designArtDirection.findFirstOrThrow({ where: { track_id: trackId } });
      expect(row.drafted_by).toBe('worker');
      // the designer feed gets one status line per write
      const lines = await prisma.designEvent.findMany({ where: { session_id: sid, kind: 'art_direction' }, orderBy: { seq: 'asc' } });
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0]).toMatchObject({ role: 'system', payload: { version: 1, status: 'draft', by: 'worker' } });
      const read = await (await get('direction')).json();
      expect(read.direction.version).toBe(1);
    });

    it('validates like the designer route: `notes`, unknown keys and bad enums are 400; an unknown body key is 400', async () => {
      expect((await patch({ patch: { notes: 'x' } })).status).toBe(400);
      expect((await patch({ patch: { feel: { register: 'loud' } } })).status).toBe(400);
      expect((await patch({ patch: { summary: Array.from({ length: 130 }, () => 'w').join(' ') } })).status).toBe(400);
      expect((await patch({ patch: { summary: 's' }, sign: true })).status).toBe(400);
      expect((await patch({})).status).toBe(400);
    });

    it('404 for an untracked session', async () => {
      expect((await patch({ patch: { summary: 's' } }, plainSid)).status).toBe(404);
    });

    it('a signed version is 409 direction_signed: nothing changes, the worker has no way to sign or revise', async () => {
      await prisma.designArtDirection.updateMany({ where: { track_id: trackId, status: 'draft' }, data: { status: 'signed', signed_at: new Date() } });
      const res = await patch({ patch: { summary: 'changed after signing' } });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('direction_signed');
      const row = await prisma.designArtDirection.findFirstOrThrow({ where: { track_id: trackId } });
      expect((row.body as { summary: string }).summary).toBe('Quiet and square');
      const read = await (await get('direction')).json();
      expect(read.direction.status).toBe('signed');
    });
  });

  describe('GET track-assets', () => {
    it('serves the bytes of an asset of the session\'s track as application/octet-stream, any kind', async () => {
      const res = await readAsset(assetIds.fold);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('FOLD-BYTES');
      const log = await readAsset(assetIds.log);
      expect(log.status).toBe(200);
      expect(Buffer.from(await log.arrayBuffer()).toString()).toBe('log text');
    });

    it('404 for an asset of another track, a random id, a malformed id and an untracked session', async () => {
      expect((await readAsset(foreignAssetId)).status).toBe(404);
      expect((await readAsset(crypto.randomUUID())).status).toBe(404);
      expect((await readAsset('not-a-uuid')).status).toBe(404);
      expect((await readAsset(assetIds.fold, plainSid)).status).toBe(404);
    });
  });
});
