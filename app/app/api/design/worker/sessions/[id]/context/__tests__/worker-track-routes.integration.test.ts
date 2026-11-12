// @vitest-environment node
// W4.4a: the three worker-lane routes for a tracked session: context, art-direction, track-assets (SPEC 5.1).
import crypto from 'crypto';
import { NextRequest } from 'next/server';
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
import { findForbiddenKeys } from '@/lib/design/projections';
import { createOrGetSession } from '@/lib/design/sessions';
import { WORKER as WORKER_BASE, ctx, req } from '../../../../__tests__/harness';
import * as context from '../route';
import * as direction from '../../art-direction/route';
import * as trackAsset from '../../track-assets/[assetId]/route';

const P = '/api/design/worker';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// The suite needs the scratch database and is skipped without it: this line says in every gate log whether it ran.
it('reports whether the worker track routes suite ran against the scratch database', () => {
  console.log(`[worker-track-routes] scratch database suite ${SCRATCH ? 'RAN' : 'SKIPPED (no scratch database)'}`);
  expect(typeof SCRATCH).toBe('boolean');
});

describe.skipIf(!SCRATCH)('worker track routes (real database)', () => {
  let f: DesignFixture;
  let foreignF: DesignFixture; // another client, project and track: its rows must never reach this session
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
  let foreignRefId = '';
  let foreignNoteId = '';

  const get = async (part: string, ids?: string) => {
    const q = `part=${part}${ids !== undefined ? `&ids=${ids}` : ''}`;
    return context.GET(req('GET', `${P}/sessions/${sid}/context?${q}`) as never, ctx({ id: sid }));
  };
  const patch = (body: unknown, id = sid) => direction.PATCH(req('PATCH', `${P}/sessions/${id}/art-direction`, body) as never, ctx({ id }));
  /** The revision of the direction as the worker reads it (the token is opaque: it is only echoed back). */
  const revision = async () => ((await (await get('direction')).json()).direction?.revision ?? null) as string;
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
    foreignF = await seedDesign(`w44x${Date.now()}`);
    const other = await seedTrack(foreignF, { stage: 'art_direction' });
    foreignAssetId = await mkAsset(other.id, 'ref_fold', Buffer.from('FOREIGN'));
    foreignRefId = (await prisma.designReference.create({ data: { track_id: other.id, source: 'designer_url', url: 'https://foreign.example.test/', title: 'Foreign ref', desktop_fold_asset_id: foreignAssetId, capture_status: 'done' } })).id;
    foreignNoteId = (await prisma.designNote.create({
      data: { client_id: foreignF.clientId, source_kind: 'email', source_ref: 'foreign-1', source_date: new Date('2026-01-02'), speaker_name: 'Lee', speaker_role: 'client', quote: 'Only use red', quote_sha: sha('foreign'), category: 'colour', polarity: 'require', subject: 'red', confidence: 0.9, extracted_by: 'test' },
    })).id;

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
    await prisma.designTrack.deleteMany({ where: { site_id: foreignF.siteId } });
    await teardownDesign(foreignF);
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
      expect(findForbiddenKeys(body)).toEqual([]);
      expect(text).not.toContain('design/tracks/');
      expect(body).not.toHaveProperty('client_statements'); // its own part
    });

    it('board: references with live markups; ids narrow it and a real reference of another project matches nothing; forbidden keys are stripped', async () => {
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
      const foreign = await (await get('board', foreignRefId)).json();
      expect(foreign.references).toEqual([]);
      const mixed = await (await get('board', `${refId},${foreignRefId}`)).json();
      expect(mixed.references.map((r: { id: string }) => r.id)).toEqual([refId]);
      expect(all.references.map((r: { id: string }) => r.id)).not.toContain(foreignRefId);
      expect(JSON.stringify(all)).not.toContain(foreignAssetId);
      expect(findForbiddenKeys(all)).toEqual([]);
      void otherRefId;
    });

    it('client_statements: the client\'s own words, nothing of the client record, never another client\'s', async () => {
      const res = await get('client_statements');
      const text = await res.text();
      const body = JSON.parse(text);
      expect(body.client_statements).toHaveLength(1);
      expect(Object.keys(body.client_statements[0]).sort()).toEqual(['category', 'id', 'is_paraphrase', 'polarity', 'quote', 'source_date', 'source_kind', 'speaker_name', 'speaker_role', 'status', 'subject']);
      expect(body.client_statements[0].id).toBe(noteId);
      expect(findForbiddenKeys(body)).toEqual([]);
      expect(text).not.toContain(foreignNoteId);
      expect((await (await get('client_statements', foreignNoteId)).json()).client_statements).toEqual([]);
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
    it('writes version 1 as a worker draft without a base_version, then merges with the revision it read; a stale base is 409 version_moved', async () => {
      const first = await patch({ patch: { summary: 'Quiet and square', feel: { register: 'quiet' } } });
      expect(first.status).toBe(200);
      const d1 = (await first.json()).direction;
      expect(d1).toMatchObject({ version: 1, status: 'draft', drafted_by: 'worker', body: { summary: 'Quiet and square', feel: { register: 'quiet' } } });
      expect(typeof d1.revision).toBe('string');
      const second = await patch({ patch: { feel: { words: ['plain'] }, nav: { desktop: { pattern: 'inline' } } }, base_version: 1, base_revision: d1.revision });
      expect(second.status).toBe(200);
      expect((await second.json()).direction.body).toMatchObject({ feel: { register: 'quiet', words: ['plain'] }, nav: { desktop: { pattern: 'inline' } } });
      expect((await patch({ patch: { summary: 'x' }, base_version: 7, base_revision: await revision() })).status).toBe(409);
      const row = await prisma.designArtDirection.findFirstOrThrow({ where: { track_id: trackId } });
      expect(row.drafted_by).toBe('worker');
      // the designer feed gets one status line per write
      const lines = await prisma.designEvent.findMany({ where: { session_id: sid, kind: 'art_direction' }, orderBy: { seq: 'asc' } });
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0]).toMatchObject({ role: 'system', payload: { version: 1, status: 'draft', by: 'worker' } });
      const read = await (await get('direction')).json();
      expect(read.direction.version).toBe(1);
    });

    it('on an existing draft the revision is required: missing or stale is 409 version_moved and writes nothing; the current one saves and moves it', async () => {
      const before = await revision();
      const missing = await patch({ patch: { summary: 'no revision' } });
      expect(missing.status).toBe(409);
      expect(await missing.json()).toMatchObject({ code: 'version_moved', error: 'The art direction changed; read it again' });
      const withVersionOnly = await patch({ patch: { summary: 'no revision' }, base_version: 1 });
      expect(withVersionOnly.status).toBe(409);
      const stale = await patch({ patch: { summary: 'stale' }, base_revision: '2020-01-01T00:00:00.000Z' });
      expect(stale.status).toBe(409);
      expect((await stale.json()).code).toBe('version_moved');
      expect(await revision()).toBe(before);
      expect(((await prisma.designArtDirection.findFirstOrThrow({ where: { track_id: trackId } })).body as { summary: string }).summary).toBe('Quiet and square');
      expect((await patch({ patch: { summary: 'x' }, base_revision: 'r'.repeat(41) })).status).toBe(400);
      const ok = await patch({ patch: { open_questions: ['Who owns the photos?'] }, base_revision: before });
      expect(ok.status).toBe(200);
      const after = (await ok.json()).direction.revision;
      expect(after).not.toBe(before);
      expect(await revision()).toBe(after);
      // the revision the worker just used is now stale
      expect((await patch({ patch: { summary: 'again' }, base_revision: before })).status).toBe(409);
    });

    it('two writes in the same millisecond still get two different revisions', async () => {
      const r0 = await revision();
      const frozen = Date.parse(r0);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(frozen);
      try {
        const a = await patch({ patch: { feel: { detail: 'one' } }, base_revision: r0 });
        expect(a.status).toBe(200);
        const ra = (await a.json()).direction.revision as string;
        const b = await patch({ patch: { feel: { detail: 'two' } }, base_revision: ra });
        expect(b.status).toBe(200);
        const rb = (await b.json()).direction.revision as string;
        expect(new Set([r0, ra, rb]).size).toBe(3);
        expect((await patch({ patch: { feel: { detail: 'three' } }, base_revision: ra })).status).toBe(409);
      } finally {
        clock.mockRestore();
      }
    });

    it('validates like the designer route: `notes`, unknown keys and bad enums are 400; an unknown body key is 400', async () => {
      const base_revision = await revision();
      expect((await patch({ patch: { notes: 'x' }, base_revision })).status).toBe(400);
      expect((await patch({ patch: { feel: { register: 'loud' } }, base_revision })).status).toBe(400);
      expect((await patch({ patch: { summary: Array.from({ length: 130 }, () => 'w').join(' ') }, base_revision })).status).toBe(400);
      const deep = `{"patch":{"unknown_key":${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}},"base_revision":"${base_revision}"}`;
      const tooDeep = await direction.PATCH(new NextRequest(`http://localhost:3000${P}/sessions/${sid}/art-direction`, { method: 'PATCH', body: deep, headers: { 'Content-Type': 'application/json' } }) as never, ctx({ id: sid }));
      expect(tooDeep.status).toBe(400);
      expect((await tooDeep.json()).code).toBe('bad_patch');
      expect(await revision()).toBe(base_revision);
      expect((await patch({ patch: { summary: 's' }, sign: true })).status).toBe(400);
      expect((await patch({})).status).toBe(400);
    });

    it('404 for an untracked session', async () => {
      expect((await patch({ patch: { summary: 's' } }, plainSid)).status).toBe(404);
    });

    it('a closed or abandoned session is 404 on all three worker routes, like an unknown session', async () => {
      const w2 = await seedWorld(f, 'w44c');
      worlds.push(w2);
      const slug2 = 'bcdefghijklmnopq'.split('').reverse().join('');
      const t2 = await prisma.designTrack.create({
        data: { site_id: w2.siteId, project_id: w2.projectId, slug: slug2, stage: 'art_direction', branch: `design/t-${slug2}`, preview_alias: `design-t-${slug2}` },
      });
      const s2 = (await createOrGetSession(f.designer, w2.t.art)).session.id;
      const a2 = await mkAsset(t2.id, 'ref_fold', Buffer.from('CLOSED-BYTES'));
      const ctxRead = () => context.GET(req('GET', `${P}/sessions/${s2}/context?part=brief`) as never, ctx({ id: s2 }));
      expect((await ctxRead()).status).toBe(200);
      expect((await readAsset(a2, s2)).status).toBe(200);
      for (const status of ['closed', 'abandoned'] as const) {
        await prisma.designSession.update({ where: { id: s2 }, data: { status } });
        const c = await ctxRead();
        expect(c.status, status).toBe(404);
        expect((await c.json()).code, status).toBe('not_found');
        expect((await patch({ patch: { summary: 's' } }, s2)).status, status).toBe(404);
        expect((await readAsset(a2, s2)).status, status).toBe(404);
      }
      expect(await prisma.designArtDirection.count({ where: { track_id: t2.id } })).toBe(0);
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

    // W6.1 F11: a raster designer upload reaches the worker only as its stripped render, and only once it is ready.
    it('a raster upload: 404 while pending; once ready, the stripped render bytes, never the original', async () => {
      const original = await mkAsset(trackId, 'upload', Buffer.from('ORIGINAL-WITH-EXIF'), { content_type: 'image/jpeg', status: 'pending', source: 'designer', purpose: 'board' });
      expect((await readAsset(original)).status).toBe(404);
      await prisma.designTrackAsset.update({ where: { id: original }, data: { status: 'ready' } });
      expect((await readAsset(original)).status).toBe(404); // ready but no render: nothing is served
      await mkAsset(trackId, 'render', Buffer.from('STRIPPED-RENDER'), { parent_asset_id: original, status: 'ready' });
      const res = await readAsset(original);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('STRIPPED-RENDER');
      expect(res.headers.get('x-design-asset-kind')).toBe('render');
      // a PDF original is not a raster: the machine read still serves it as before
      const pdf = await mkAsset(trackId, 'upload', Buffer.from('%PDF-1.4'), { content_type: 'application/pdf', status: 'ready', source: 'designer', purpose: 'board' });
      expect(Buffer.from(await (await readAsset(pdf)).arrayBuffer()).toString()).toBe('%PDF-1.4');
    });

    it('404 for an asset of another project\'s track, a random id, a malformed id and an untracked session', async () => {
      expect((await readAsset(foreignAssetId)).status).toBe(404);
      expect((await readAsset(crypto.randomUUID())).status).toBe(404);
      expect((await readAsset('not-a-uuid')).status).toBe(404);
      expect((await readAsset(assetIds.fold, plainSid)).status).toBe(404);
    });
  });
});
