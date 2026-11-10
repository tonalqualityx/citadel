// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';
import { seedWorld, teardownWorlds, type TrackWorld } from '@/lib/design/__tests__/track-world';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
// The private store, in memory (the keys must still sit under portal-private/, like the real one).
const objects = new Map<string, Buffer>();
vi.mock('@/lib/services/s3', async (orig) => {
  const real = await orig<typeof import('@/lib/services/s3')>();
  const check = (key: string) => {
    if (!key.startsWith(real.PRIVATE_PREFIX)) throw new Error('Private objects live under ' + real.PRIVATE_PREFIX);
  };
  return {
    ...real,
    putPrivateObject: vi.fn(async (key: string, buf: Buffer) => { check(key); objects.set(key, buf); }),
    getPrivateObject: vi.fn(async (key: string) => { check(key); const b = objects.get(key); if (!b) throw new Error('NoSuchKey'); return b; }),
  };
});

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { findForbiddenKeys } from '@/lib/design/projections';
import { transitionSession } from '@/lib/design/sessions';
import * as sessionsRoute from '../route';
import * as brief from '../[id]/brief/route';
import * as reactions from '../[id]/brief/reactions/route';
import * as references from '../[id]/references/route';
import * as reference from '../[id]/references/[refId]/route';
import * as markups from '../[id]/markups/route';
import * as markup from '../[id]/markups/[markupId]/route';
import * as uploads from '../[id]/uploads/route';
import * as trackAsset from '../[id]/track-assets/[assetId]/route';
import * as direction from '../[id]/art-direction/route';
import * as sign from '../[id]/art-direction/sign/route';
import * as revise from '../[id]/art-direction/revise/route';
import * as runnerAssets from '../../runner/tracks/[id]/assets/route';
import * as runnerAsset from '../../runner/tracks/[id]/assets/[assetId]/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 1, 0, 0, 0, 0, 200, 8, 6, 0, 0, 0]), Buffer.from('payload-bytes-here')]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.from([10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0, 0x30, 0]), Buffer.alloc(8)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PDF_JS = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/></svg>');
const SVG_SCRIPT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const SHA = 'a'.repeat(64);

describe.skipIf(!SCRATCH)('brief, board, art direction and track uploads (real database)', () => {
  let f: DesignFixture;
  let bastId: string;
  let RUNNER: Record<string, unknown>;
  const worlds: TrackWorld[] = [];
  const asDesigner = (userId = f.designer.userId) => as.mockResolvedValue({ userId, email: 'd@example.test', role: 'designer', via: 'session' });
  const asAdmin = () => as.mockResolvedValue({ userId: f.admin.userId, email: 'a@example.test', role: 'admin', via: 'session' });
  const asRunner = () => as.mockResolvedValue(RUNNER);

  beforeAll(async () => {
    f = await seedDesign(`tb${Date.now()}`);
    const bast = await prisma.user.create({ data: { email: `bast-${f.tag}@example.test`, password_hash: 'x', name: 'Bast test', role: 'pm' } });
    bastId = bast.id;
    RUNNER = { userId: bastId, email: bast.email, role: 'pm', via: 'api_key', apiKeyId: 'k-run', lane: 'design-track', laneEnforced: true };
  });
  beforeEach(() => { objects.clear(); asDesigner(); });
  afterAll(async () => {
    const ids = [f.designer.userId, f.admin.userId, f.other.userId];
    await prisma.designSession.updateMany({ where: { designer_id: { in: ids } }, data: { timer_entry_id: null } });
    await prisma.timeEntry.deleteMany({ where: { user_id: { in: ids } } });
    await teardownWorlds(f, worlds);
    await teardownDesign(f);
    await prisma.user.deleteMany({ where: { id: bastId } });
    await prisma.$disconnect();
  });

  async function tracked(label: string, stage: 'art_direction' | 'refine' | 'review' | 'done' = 'art_direction') {
    const w = await seedWorld(f, label);
    worlds.push(w);
    const slug = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'abcdefghijklmnopqrstuvwxyz234567'[b % 32]).join('');
    const track = await prisma.designTrack.create({
      data: { site_id: w.siteId, project_id: w.projectId, slug, stage, branch: `design/t-${slug}`, preview_alias: `design-t-${slug}`, preview_url: `https://design-t-${slug}.proj.pages.dev` },
    });
    asDesigner();
    const res = await sessionsRoute.POST(json('POST', '/api/design/sessions', { task_id: w.t.art }));
    expect(res.status).toBe(201);
    const session = (await res.json()).session as { id: string };
    await transitionSession(session.id, 'awaiting_input', 'worker');
    return { w, track, session };
  }
  const code = async (res: Response) => ((await res.json()) as { code?: string }).code;
  const get = (path: string) => json('GET', path);

  function upload(sessionId: string, file: Buffer | null, purpose: string | null, name = 'sample.png', headers: Record<string, string> = {}) {
    const fd = new FormData();
    if (file) fd.append('file', new File([new Uint8Array(file)], name));
    if (purpose) fd.append('purpose', purpose);
    return new NextRequest(`http://localhost:3000/api/design/sessions/${sessionId}/uploads`, { method: 'POST', body: fd, headers });
  }
  async function doUpload(sessionId: string, file: Buffer, purpose: string, name?: string) {
    return uploads.POST(upload(sessionId, file, purpose, name), ctx({ id: sessionId }));
  }
  function runnerUpload(trackId: string, file: Buffer, fields: Record<string, string>, name = 'shot.png') {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(file)], name));
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return runnerAssets.POST(new NextRequest(`http://localhost:3000/api/design/runner/tracks/${trackId}/assets`, { method: 'POST', body: fd }), ctx({ id: trackId }));
  }
  const serve = (sessionId: string, assetId: string) => trackAsset.GET(get(`/api/design/sessions/${sessionId}/track-assets/${assetId}`), ctx({ id: sessionId, assetId }));

  // ------------------------------------------------------------------------------------------------------------
  it('every route answers 404 for an untracked session and for another designer', async () => {
    const taskId = await seedTask(f, 'plain');
    asDesigner();
    const created = await sessionsRoute.POST(json('POST', '/api/design/sessions', { task_id: taskId }));
    expect(created.status).toBe(201);
    const plain = (await created.json()).session.id as string;
    const A = '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d';
    const calls: Array<[string, () => Promise<Response>]> = [
      ['brief', () => brief.GET(get(`/x`), ctx({ id: plain }))],
      ['reactions', () => reactions.POST(json('POST', '/x', { card_id: 'c', reaction: 'useful' }), ctx({ id: plain }))],
      ['references GET', () => references.GET(get('/x'), ctx({ id: plain }))],
      ['references POST', () => references.POST(json('POST', '/x', { url: 'https://example.com/' }), ctx({ id: plain }))],
      ['reference PATCH', () => reference.PATCH(json('PATCH', '/x', { decision: 'yes' }), ctx({ id: plain, refId: A }))],
      ['markups POST', () => markups.POST(json('POST', '/x', { reference_id: A, asset_id: A, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, sentiment: 'like', category: 'type' }), ctx({ id: plain }))],
      ['markup PATCH', () => markup.PATCH(json('PATCH', '/x', { deleted: true }), ctx({ id: plain, markupId: A }))],
      ['uploads', () => uploads.POST(upload(plain, PNG, 'board'), ctx({ id: plain }))],
      ['track-assets', () => trackAsset.GET(get('/x'), ctx({ id: plain, assetId: A }))],
      ['direction GET', () => direction.GET(get('/x'), ctx({ id: plain }))],
      ['direction PATCH', () => direction.PATCH(json('PATCH', '/x', { patch: {}, base_version: 0 }), ctx({ id: plain }))],
      ['sign', () => sign.POST(json('POST', '/x', { base_version: 1 }), ctx({ id: plain }))],
      ['revise', () => revise.POST(json('POST', '/x', {}), ctx({ id: plain }))],
    ];
    for (const [name, call] of calls) expect((await call()).status, `untracked ${name}`).toBe(404);
    // another designer on a tracked session
    const { session } = await tracked('stranger');
    asDesigner(f.other.userId);
    const stranger = [
      brief.GET(get('/x'), ctx({ id: session.id })),
      references.GET(get('/x'), ctx({ id: session.id })),
      references.POST(json('POST', '/x', { url: 'https://example.com/' }), ctx({ id: session.id })),
      uploads.POST(upload(session.id, PNG, 'board'), ctx({ id: session.id })),
      trackAsset.GET(get('/x'), ctx({ id: session.id, assetId: A })),
      direction.GET(get('/x'), ctx({ id: session.id })),
      direction.PATCH(json('PATCH', '/x', { patch: {}, base_version: 0 }), ctx({ id: session.id })),
      sign.POST(json('POST', '/x', { base_version: 1 }), ctx({ id: session.id })),
    ];
    for (const res of await Promise.all(stranger)) expect(res.status).toBe(404);
  });

  // ------------------------------------------------------------------------------------------------------------
  it('brief: published body, own reactions, client_statements only, no forbidden key', async () => {
    const { track, session } = await tracked('brief');
    const empty = await brief.GET(get('/x'), ctx({ id: session.id }));
    expect(empty.status).toBe(200);
    expect((await empty.json()).brief).toBeNull();
    const none = await reactions.POST(json('POST', '/x', { card_id: 'brand-01', reaction: 'useful' }), ctx({ id: session.id }));
    expect(none.status).toBe(409);
    expect(await code(none)).toBe('no_brief');

    const body = {
      version: 1, client: 'Test Co', one_line: 'Calm.',
      sections: [{ id: 'brand', title: 'Brand', cards: [{ id: 'brand-01', headline: 'h', summary: 's', image_asset_ids: [], detail_md: '', sources: [], confidence: 'evidenced' }] }],
    };
    const row = await prisma.designBrief.create({ data: { track_id: track.id, version: 1, status: 'published', body, published_at: new Date() } });
    await prisma.designTrack.update({ where: { id: track.id }, data: { brief_id: row.id } });
    await prisma.designNote.create({
      data: {
        client_id: f.clientId, source_kind: 'meeting', source_ref: 'm1', source_date: new Date(), speaker_name: 'Pat', speaker_role: 'client',
        quote: 'No pastels please.', quote_sha: SHA, category: 'colour', polarity: 'avoid', subject: 'pastels', confidence: 0.9, extracted_by: 'test',
      },
    });
    const res = await brief.GET(get('/x'), ctx({ id: session.id }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.brief.body.client_name).toBe('Test Co');
    expect(data.brief.body.client).toBeUndefined();
    expect(data.client_statements).toHaveLength(1);
    expect(data.client_statements[0]).toMatchObject({ quote: 'No pastels please.', polarity: 'avoid', speaker_name: 'Pat' });
    expect(data.client_statements[0].client_id).toBeUndefined();
    expect(findForbiddenKeys(data)).toEqual([]);

    const ok = await reactions.POST(json('POST', '/x', { card_id: 'brand-01', reaction: 'useful', note: 'good' }), ctx({ id: session.id }));
    expect(ok.status).toBe(200);
    expect((await reactions.POST(json('POST', '/x', { card_id: 'brand-01', reaction: 'not_relevant' }), ctx({ id: session.id }))).status).toBe(200);
    expect(await prisma.designBriefReaction.count({ where: { brief_id: row.id } })).toBe(1);
    expect((await reactions.POST(json('POST', '/x', { card_id: 'nope', reaction: 'useful' }), ctx({ id: session.id }))).status).toBe(404);
    expect((await reactions.POST(json('POST', '/x', { card_id: 'brand-01', reaction: 'meh' }), ctx({ id: session.id }))).status).toBe(400);
    const again = await (await brief.GET(get('/x'), ctx({ id: session.id }))).json();
    expect(again.reactions).toEqual([{ card_id: 'brand-01', reaction: 'not_relevant', note: null }]);
    asAdmin();
    expect((await (await brief.GET(get('/x'), ctx({ id: session.id }))).json()).reactions).toEqual([]);
  });

  // ------------------------------------------------------------------------------------------------------------
  it('references: https URL parsed server side, capture queued, decisions, uploads grouped; bad URLs refused', async () => {
    const { track, session } = await tracked('refs');
    const sid = ctx({ id: session.id });
    for (const url of ['http://example.com/', 'ftp://example.com/', 'not a url', 'https://user:pw@example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://intranet/', 'https://example.com:8443/', 'javascript:alert(1)', 'https://[::1]/']) {
      const res = await references.POST(json('POST', '/x', { url }), sid);
      expect(res.status, url).toBe(400);
      expect(await code(res), url).toBe('bad_url');
    }
    expect(await prisma.designReference.count({ where: { track_id: track.id } })).toBe(0);
    const ok = await references.POST(json('POST', '/x', { url: 'https://www.Example.com/shop/#top' }), sid);
    expect(ok.status).toBe(201);
    const card = (await ok.json()).reference;
    expect(card).toMatchObject({ source: 'designer_url', url: 'https://www.example.com/shop/', title: 'example.com', capture_status: 'queued', decision: 'pending' });
    expect(findForbiddenKeys(card)).toEqual([]);
    const jobs = await prisma.designJob.findMany({ where: { track_id: track.id, kind: 'capture' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ reference_id: card.id, url: 'https://www.example.com/shop/' });
    expect(await code(await references.POST(json('POST', '/x', { url: 'https://www.example.com/shop/' }), sid))).toBe('duplicate_url');
    expect((await references.POST(json('POST', '/x', { url: 'https://example.com/', extra: 1 }), sid)).status).toBe(400);

    const patched = await reference.PATCH(json('PATCH', '/x', { decision: 'no', decision_note: 'too loud', sort_order: 3 }), ctx({ id: session.id, refId: card.id }));
    expect(patched.status).toBe(200);
    expect((await patched.json()).reference).toMatchObject({ decision: 'no', decision_note: 'too loud', sort_order: 3 });
    expect((await reference.PATCH(json('PATCH', '/x', {}), ctx({ id: session.id, refId: card.id }))).status).toBe(400);
    expect((await reference.PATCH(json('PATCH', '/x', { decision: 'maybe' }), ctx({ id: session.id, refId: card.id }))).status).toBe(400);

    // an upload becomes a card
    const up = await (await doUpload(session.id, PNG, 'board', 'sample.png')).json();
    const grouped = await references.POST(json('POST', '/x', { upload_asset_ids: [up.asset.id] }), sid);
    expect(grouped.status).toBe(201);
    const g = (await grouped.json()).reference;
    expect(g).toMatchObject({ source: 'designer_upload', uploads: [{ asset: { id: up.asset.id, status: 'pending' }, renders: [] }] });
    expect(await code(await references.POST(json('POST', '/x', { upload_asset_ids: [up.asset.id] }), sid))).toBe('upload_in_use');
    expect(await code(await references.POST(json('POST', '/x', { upload_asset_ids: ['5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d'] }), sid))).toBe('bad_upload_ids');
    const list = await (await references.GET(get('/x'), sid)).json();
    expect(list.references).toHaveLength(2);
    expect(findForbiddenKeys(list)).toEqual([]);
    expect(JSON.stringify(list)).not.toContain('storage_key');
  });

  // ------------------------------------------------------------------------------------------------------------
  it('markups: fractions only, live cap of 50, edit and remove, assets must sit on the card', async () => {
    const { track, session } = await tracked('marks');
    const sid = ctx({ id: session.id });
    const up = await (await doUpload(session.id, PNG, 'board')).json();
    const card = (await (await references.POST(json('POST', '/x', { upload_asset_ids: [up.asset.id] }), sid)).json()).reference;
    const other = await (await doUpload(session.id, JPEG, 'board', 'b.jpg')).json();
    const base = { reference_id: card.id, asset_id: up.asset.id, rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 }, sentiment: 'like', category: 'type', note: 'serif' };
    const ok = await markups.POST(json('POST', '/x', base), sid);
    expect(ok.status).toBe(201);
    const m = (await ok.json()).markup;
    expect(m).toMatchObject({ sentiment: 'like', category: 'type', deleted: false });
    for (const rect of [{ x: 0.8, y: 0.1, w: 0.4, h: 0.3 }, { x: -0.1, y: 0, w: 0.2, h: 0.2 }, { x: 0, y: 0, w: 0, h: 0.2 }, { x: 0, y: 0, w: 1.5, h: 0.2 }]) {
      const res = await markups.POST(json('POST', '/x', { ...base, rect }), sid);
      expect(res.status).toBe(400);
    }
    expect(await code(await markups.POST(json('POST', '/x', { ...base, asset_id: other.asset.id }), sid))).toBe('bad_asset');
    expect((await markups.POST(json('POST', '/x', { ...base, category: 'wallpaper' }), sid)).status).toBe(400);
    expect((await markups.POST(json('POST', '/x', { ...base, note: 'x'.repeat(501) }), sid)).status).toBe(400);
    const edited = await markup.PATCH(json('PATCH', '/x', { sentiment: 'dislike', note: null }), ctx({ id: session.id, markupId: m.id }));
    expect((await edited.json()).markup).toMatchObject({ sentiment: 'dislike', note: null });
    // fill to 50 live boxes
    const have = await prisma.designMarkup.count({ where: { reference_id: card.id, deleted_at: null } });
    await prisma.designMarkup.createMany({ data: Array.from({ length: 50 - have }, () => ({ reference_id: card.id, asset_id: up.asset.id, rect: base.rect, sentiment: 'like', category: 'type' })) });
    const over = await markups.POST(json('POST', '/x', base), sid);
    expect(over.status).toBe(409);
    expect(await code(over)).toBe('markup_limit');
    const gone = await markup.PATCH(json('PATCH', '/x', { deleted: true }), ctx({ id: session.id, markupId: m.id }));
    expect((await gone.json()).markup.deleted).toBe(true);
    expect((await markups.POST(json('POST', '/x', base), sid)).status).toBe(201);
    const list = await (await references.GET(get('/x'), sid)).json();
    expect(list.references[0].markups.every((x: { id: string }) => x.id !== m.id)).toBe(true);
    expect(findForbiddenKeys(list)).toEqual([]);
    expect((await markup.PATCH(json('PATCH', '/x', { deleted: true }), ctx({ id: session.id, markupId: '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d' }))).status).toBe(404);
    // a markup of another track is a 404, not a hit
    const second = await tracked('marks2');
    asDesigner();
    expect((await markup.PATCH(json('PATCH', '/x', { deleted: true }), ctx({ id: second.session.id, markupId: m.id }))).status).toBe(404);
    void track;
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('uploads', () => {
    it('stores a raster pending, queues process_upload, hides storage_key; type comes from the bytes', async () => {
      const { track, session } = await tracked('up1');
      // a JPEG sent under a .png name is stored as JPEG; a PNG named .txt is stored as PNG
      const res = await doUpload(session.id, JPEG, 'board', 'looks-like.png');
      expect(res.status).toBe(201);
      const { asset } = await res.json();
      expect(asset).toMatchObject({ kind: 'upload', content_type: 'image/jpeg', status: 'pending' });
      expect(asset.url).toBe(`/api/design/sessions/${session.id}/track-assets/${asset.id}`);
      expect(findForbiddenKeys(asset)).toEqual([]);
      expect(JSON.stringify(asset)).not.toContain('storage_key');
      const row = await prisma.designTrackAsset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(row).toMatchObject({ track_id: track.id, purpose: 'board', source: 'designer', created_by_id: f.designer.userId });
      expect(row.original_name).toBe('looks-like.jpg');
      expect(row.storage_key).toBe(`design/tracks/${track.id}/${asset.id}`);
      expect(objects.has(`portal-private/${row.storage_key}`)).toBe(true);
      const jobs = await prisma.designJob.findMany({ where: { track_id: track.id, kind: 'process_upload' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ asset_id: asset.id, purpose: 'board' });
      const png = await (await doUpload(session.id, PNG, 'image', 'x.txt')).json();
      expect(png.asset.content_type).toBe('image/png');
    });

    it('accepts per purpose: board takes PNG JPEG WebP GIF PDF; image takes PNG JPEG WebP; decor takes PNG WebP SVG', async () => {
      const { session } = await tracked('up2');
      const cases: Array<[string, Buffer, string, number]> = [
        ['board', PNG, 'a.png', 201], ['board', JPEG, 'a.jpg', 201], ['board', WEBP, 'a.webp', 201], ['board', GIF, 'a.gif', 201], ['board', PDF, 'a.pdf', 201],
        ['image', PNG, 'a.png', 201], ['image', JPEG, 'a.jpg', 201], ['image', WEBP, 'a.webp', 201], ['image', GIF, 'a.gif', 400], ['image', PDF, 'a.pdf', 400], ['image', SVG, 'a.svg', 400],
        ['decor', PNG, 'a.png', 201], ['decor', WEBP, 'a.webp', 201], ['decor', SVG, 'a.svg', 201], ['decor', JPEG, 'a.jpg', 400], ['decor', GIF, 'a.gif', 400], ['decor', PDF, 'a.pdf', 400],
      ];
      for (const [purpose, file, name, status] of cases) {
        const res = await doUpload(session.id, file, purpose, name);
        expect(res.status, `${purpose} ${name}`).toBe(status);
        if (status === 400) expect(await code(res)).toBe('bad_type');
      }
      const svg = await prisma.designTrackAsset.findFirstOrThrow({ where: { purpose: 'decor', content_type: 'image/svg+xml' } });
      expect(svg.status).toBe('pending');
    });

    it('refuses a PDF with /JavaScript, an SVG for board, an SVG with <script> for decor', async () => {
      const { track, session } = await tracked('up3');
      const js = await doUpload(session.id, PDF_JS, 'board', 'evil.pdf');
      expect(js.status).toBe(400);
      expect(await code(js)).toBe('active_content');
      const board = await doUpload(session.id, SVG, 'board', 'art.svg');
      expect(board.status).toBe(400);
      const script = await doUpload(session.id, SVG_SCRIPT, 'decor', 'art.svg');
      expect(script.status).toBe(400);
      expect(await code(script)).toBe('bad_svg');
      const bad: Array<[string, string]> = [
        ['doctype', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'],
        ['entity', '<!ENTITY x "y"><svg xmlns="http://www.w3.org/2000/svg"/>'],
        ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>'],
        ['onload', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'],
        ['javascript:', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>'],
        ['encoded javascript:', '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x61;script:alert(1)"/></svg>'],
        ['external href', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>'],
        ['xlink external href', '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="//evil.example/x.svg#a"/></svg>'],
        ['html root', '<html><body></body></html>'],
        ['not utf-8', '\u0000'],
      ];
      for (const [name, text] of bad) {
        const res = await doUpload(session.id, Buffer.from(text), 'decor', 'x.svg');
        expect(res.status, name).toBe(400);
      }
      expect((await doUpload(session.id, Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe, 0x3e]), 'decor', 'x.svg')).status).toBe(400);
      expect(await prisma.designTrackAsset.count({ where: { track_id: track.id } })).toBe(0);
      expect(objects.size).toBe(0);
    });

    it('refuses wrong magic bytes, empty files, a missing file or purpose, and a non-multipart body', async () => {
      const { track, session } = await tracked('up4');
      const lie = await doUpload(session.id, Buffer.from('this is just text pretending to be a picture'), 'board', 'pic.png');
      expect(lie.status).toBe(400);
      expect(await code(lie)).toBe('bad_type');
      expect((await doUpload(session.id, Buffer.from('MZ\x90\x00\x03\x00\x00\x00 executable'), 'board', 'pic.png')).status).toBe(400);
      expect((await doUpload(session.id, Buffer.alloc(0), 'board')).status).toBe(400);
      expect((await uploads.POST(upload(session.id, null, 'board'), ctx({ id: session.id }))).status).toBe(400);
      expect((await uploads.POST(upload(session.id, PNG, null), ctx({ id: session.id }))).status).toBe(400);
      expect((await uploads.POST(upload(session.id, PNG, 'avatar'), ctx({ id: session.id }))).status).toBe(400);
      expect((await uploads.POST(json('POST', '/x', {}), ctx({ id: session.id }))).status).toBe(415);
      expect(await prisma.designTrackAsset.count({ where: { track_id: track.id } })).toBe(0);
    });

    it('refuses an upload over the cap (413), before the body is read when the declared length says so', async () => {
      const { track, session } = await tracked('up5');
      const big = Buffer.concat([PNG, Buffer.alloc(25 * 1024 * 1024 - PNG.length + 1, 1)]);
      expect(big.length).toBe(25 * 1024 * 1024 + 1);
      const res = await doUpload(session.id, big, 'board');
      expect(res.status).toBe(413);
      expect(await code(res)).toBe('asset_too_large');
      const bigSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(1024 * 1024)}</svg>`);
      const svgRes = await doUpload(session.id, bigSvg, 'decor', 'big.svg');
      expect(svgRes.status).toBe(413);
      const declared = await uploads.POST(upload(session.id, PNG, 'board', 'a.png', { 'content-length': String(30 * 1024 * 1024) }), ctx({ id: session.id }));
      expect(declared.status).toBe(413);
      expect(await code(declared)).toBe('payload_too_large');
      expect(await prisma.designTrackAsset.count({ where: { track_id: track.id } })).toBe(0);
      // exactly at the cap is accepted
      const atCap = Buffer.concat([PNG, Buffer.alloc(25 * 1024 * 1024 - PNG.length, 1)]);
      expect((await doUpload(session.id, atCap, 'board')).status).toBe(201);
    });

    it('refuses the 101st upload (upload_limit), the 1 GB total (upload_bytes_limit) and the 21st in a minute (rate_limited)', async () => {
      const { track, session } = await tracked('up6');
      const seed = (n: number, bytes: number, ageMs: number) => prisma.designTrackAsset.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          track_id: track.id, kind: 'upload', purpose: 'board', status: 'ready', content_type: 'image/png', bytes, sha256: SHA, storage_key: `design/tracks/${track.id}/seed-${i}`,
          source: 'designer', created_at: new Date(Date.now() - ageMs),
        })),
      });
      await seed(100, 10, 3_600_000);
      const full = await doUpload(session.id, PNG, 'board');
      expect(full.status).toBe(409);
      expect(await code(full)).toBe('upload_limit');
      await prisma.designTrackAsset.deleteMany({ where: { track_id: track.id } });
      await seed(1, 1024 * 1024 * 1024 - 5, 3_600_000);
      const heavy = await doUpload(session.id, PNG, 'board');
      expect(heavy.status).toBe(409);
      expect(await code(heavy)).toBe('upload_bytes_limit');
      await prisma.designTrackAsset.deleteMany({ where: { track_id: track.id } });
      await seed(20, 10, 1000);
      const fast = await doUpload(session.id, PNG, 'board');
      expect(fast.status).toBe(429);
      expect(await code(fast)).toBe('rate_limited');
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('serving and the runner asset routes', () => {
    it('serves a raster original with nosniff and the sandbox CSP; PDF and SVG originals and job logs are 404; renders are served', async () => {
      const { track, session } = await tracked('srv');
      const png = (await (await doUpload(session.id, PNG, 'board')).json()).asset;
      const pdf = (await (await doUpload(session.id, PDF, 'board', 'a.pdf')).json()).asset;
      const svg = (await (await doUpload(session.id, SVG, 'decor', 'a.svg')).json()).asset;
      expect(pdf.url).toBeNull();
      expect(svg.url).toBeNull();

      const ok = await serve(session.id, png.id);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('image/png');
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
      expect(ok.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(ok.headers.get('cache-control')).toBe('private, no-store');
      expect(ok.headers.get('content-disposition')).toMatch(/^inline/);
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG);

      for (const a of [pdf, svg]) {
        const res = await serve(session.id, a.id);
        expect(res.status, a.content_type).toBe(404);
      }
      // the runner renders the PDF: the render is served, the original still is not
      asRunner();
      const rr = await runnerUpload(track.id, PNG, { kind: 'render', parent_asset_id: pdf.id, page: '1' });
      expect(rr.status).toBe(201);
      const render = (await rr.json()).asset;
      expect(render).toMatchObject({ kind: 'render', parent_asset_id: pdf.id, content_type: 'image/png', width: 256, height: 200, status: 'ready' });
      expect(JSON.stringify(render)).not.toContain('storage_key');
      expect((await prisma.designTrackAsset.findUniqueOrThrow({ where: { id: pdf.id } })).status).toBe('ready');
      asDesigner();
      expect((await serve(session.id, render.id)).status).toBe(200);
      expect((await serve(session.id, pdf.id)).status).toBe(404);
      const board = await (await references.GET(get('/x'), ctx({ id: session.id }))).json();
      expect(findForbiddenKeys(board)).toEqual([]);

      // job logs, rejected uploads and malformed ids are 404
      asRunner();
      const log = (await (await runnerUpload(track.id, Buffer.from('line one\nline two\n'), { kind: 'job_log' }, 'log.txt')).json()).asset;
      expect(log).toMatchObject({ kind: 'job_log', content_type: 'text/plain' });
      asDesigner();
      expect((await serve(session.id, log.id)).status).toBe(404);
      await prisma.designTrackAsset.update({ where: { id: png.id }, data: { status: 'rejected', reject_reason: 'bad file' } });
      expect((await serve(session.id, png.id)).status).toBe(404);
      expect((await serve(session.id, 'not-a-uuid')).status).toBe(404);
    });

    it('another designer gets 404, and an asset of another track is 404 on both read routes', async () => {
      const a = await tracked('srvA');
      const b = await tracked('srvB');
      asDesigner();
      const asset = (await (await doUpload(a.session.id, PNG, 'board')).json()).asset;
      asDesigner(f.other.userId);
      expect((await serve(a.session.id, asset.id)).status).toBe(404);
      asDesigner();
      expect((await serve(b.session.id, asset.id)).status).toBe(404);
      asRunner();
      const res = await runnerAsset.GET(get('/x'), ctx({ id: b.track.id, assetId: asset.id }));
      expect(res.status).toBe(404);
    });

    it('the runner reads any asset of its track as application/octet-stream, even a PDF original', async () => {
      const { track, session } = await tracked('rd');
      const pdf = (await (await doUpload(session.id, PDF, 'board', 'a.pdf')).json()).asset;
      asRunner();
      const res = await runnerAsset.GET(get('/x'), ctx({ id: track.id, assetId: pdf.id }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-design-asset-type')).toBe('application/pdf');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
      expect((await runnerAsset.GET(get('/x'), ctx({ id: track.id, assetId: '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d' }))).status).toBe(404);
      expect((await runnerAsset.GET(get('/x'), ctx({ id: '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d', assetId: pdf.id }))).status).toBe(404);
    });

    it('runner uploads: PNG or WebP only, types from bytes, kind rules, parent must be an upload of the track', async () => {
      const { track, session } = await tracked('ru');
      asRunner();
      for (const kind of ['ref_fold', 'ref_full', 'brief_image']) {
        const res = await runnerUpload(track.id, PNG, { kind, viewport_w: '1440' });
        expect(res.status, kind).toBe(201);
        expect((await res.json()).asset).toMatchObject({ kind, viewport_w: 1440 });
      }
      expect((await runnerUpload(track.id, WEBP, { kind: 'ref_fold' })).status).toBe(201);
      const shot = await runnerUpload(track.id, PNG, { kind: 'spot_shot', page_path: '/shop/', viewport_w: '390' });
      expect((await shot.json()).asset).toMatchObject({ kind: 'spot_shot', page_path: '/shop/', viewport_w: 390 });
      for (const [file, fields, name] of [
        [JPEG, { kind: 'ref_fold' }, 'jpeg'], [GIF, { kind: 'ref_fold' }, 'gif'], [PDF, { kind: 'ref_fold' }, 'pdf'], [Buffer.from('text'), { kind: 'ref_fold' }, 'text'],
        [PNG, { kind: 'render' }, 'render without parent'], [PNG, { kind: 'render', parent_asset_id: '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d' }, 'render with unknown parent'],
        [PNG, { kind: 'wallpaper' }, 'unknown kind'], [PNG, { kind: 'ref_fold', page_path: '/x/' }, 'page_path on a capture'], [PNG, { kind: 'ref_fold', parent_asset_id: '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d' }, 'parent on a capture'],
        [Buffer.from('a\u0000b'), { kind: 'job_log' }, 'binary log'], [Buffer.alloc(0), { kind: 'job_log' }, 'empty log'], [Buffer.alloc(1024 * 1024 + 1, 97), { kind: 'job_log' }, 'log over 1 MB'],
      ] as Array<[Buffer, Record<string, string>, string]>) {
        const res = await runnerUpload(track.id, file, fields);
        expect([400, 413], name).toContain(res.status);
      }
      // an upload of another track is not a valid parent
      const other = await tracked('ru2');
      asDesigner();
      const foreign = (await (await doUpload(other.session.id, PDF, 'board', 'a.pdf')).json()).asset;
      asRunner();
      expect((await runnerUpload(track.id, PNG, { kind: 'render', parent_asset_id: foreign.id })).status).toBe(400);
      expect((await runnerUpload('5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d', PNG, { kind: 'ref_fold' })).status).toBe(404);
      // a designer session cannot use the runner route
      asDesigner();
      expect((await runnerAssets.POST(new NextRequest('http://localhost:3000/x', { method: 'POST', body: new FormData() }), ctx({ id: track.id }))).status).toBe(403);
      void session;
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe('art direction', () => {
    const NAV = { desktop: { pattern: 'inline', items: [{ label: 'Shop', url: '/shop/' }], utility: ['cart'], sticky: true }, mobile: { pattern: 'drawer_right', trigger: 'icon_with_label', always_visible: ['cart'], cta_in_drawer: true, sticky: true } };
    const FULL = { summary: 'Plain and square.', feel: { words: ['plain'], register: 'quiet', detail: 'quiet' }, nav: NAV, container: { max_content_px: 1280, method: 'padding_cap', gutters_px: { phone: 16 } } };
    const patch = (sessionId: string, p: unknown, base: number) => direction.PATCH(json('PATCH', '/x', { patch: p, base_version: base }), ctx({ id: sessionId }));
    // Sign carries the revision on screen (W4.4a-fix): read it the way the form does, from the GET.
    const signIt = async (sessionId: string, base: number, mode?: string) => {
      const shown = (await (await direction.GET(get('/x'), ctx({ id: sessionId }))).json()) as { direction?: { revision?: string } | null };
      const base_revision = shown.direction?.revision ?? 'none';
      return sign.POST(json('POST', '/x', { base_version: base, base_revision, ...(mode ? { mode } : {}) }), ctx({ id: sessionId }));
    };

    it('draft edits: merge patch, stale base, notes refused, version moved, no forbidden keys', async () => {
      const { session } = await tracked('ad1');
      const sid = ctx({ id: session.id });
      const none = await (await direction.GET(get('/x'), sid)).json();
      expect(none.direction).toBeNull();
      expect(none.sign_gaps).toContain('container');
      expect((await patch(session.id, { summary: 'x' }, 3)).status).toBe(409);
      const first = await patch(session.id, { summary: 'Plain.', feel: { words: ['a'], detail: 'd' } }, 0);
      expect(first.status).toBe(200);
      const d1 = (await first.json()).direction;
      expect(d1).toMatchObject({ version: 1, status: 'draft', drafted_by: 'designer' });
      expect(findForbiddenKeys(d1)).toEqual([]);
      // merge: feel.detail removed with null, feel.words replaced, other keys kept
      const second = await patch(session.id, { feel: { words: ['b', 'c'], detail: null }, colour: { avoid: ['pastels'] } }, 1);
      const d2 = (await second.json()).direction;
      expect(d2.body).toEqual({ summary: 'Plain.', feel: { words: ['b', 'c'] }, colour: { avoid: ['pastels'] } });
      const stale = await patch(session.id, { summary: 'later' }, 7);
      expect(stale.status).toBe(409);
      expect(await code(stale)).toBe('version_moved');
      for (const bad of [{ notes: 'free text' }, { feel: { notes: 'x' } }, { client: 'x' }, { feel: { register: 'loud' } }, { container: { max_content_px: 50 } }, { summary: 'w '.repeat(121) }, { __proto__: { x: 1 }, nav: { evil: 1 } }]) {
        const res = await direction.PATCH(new NextRequest('http://localhost:3000/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: bad, base_version: 1 }) }), sid);
        expect(res.status, JSON.stringify(bad)).toBe(400);
      }
      expect((await direction.PATCH(json('PATCH', '/x', { patch: {} }), sid)).status).toBe(400);
      const read = await (await direction.GET(get('/x'), sid)).json();
      expect(read.direction.body.feel.words).toEqual(['b', 'c']);
      expect(findForbiddenKeys(read)).toEqual([]);
      expect(JSON.stringify(read)).not.toContain('client_email');
    });

    it('sign: needs nav and container and answered client requests; freezes, queues the build, modules and email; refuses an admin, a stale base and a second sign', async () => {
      const { track, session, w } = await tracked('ad2');
      const sid = ctx({ id: session.id });
      await prisma.designNote.create({
        data: {
          client_id: f.clientId, source_kind: 'email', source_ref: 'e1', source_date: new Date(), speaker_name: 'Pat', speaker_role: 'client',
          quote: 'Never use stock photos.', quote_sha: 'b'.repeat(64), category: 'imagery', polarity: 'require', subject: 'photos', confidence: 0.9, extracted_by: 'test',
        },
      });
      const note = await prisma.designNote.findFirstOrThrow({ where: { client_id: f.clientId, source_ref: 'e1' } });
      expect((await signIt(session.id, 1)).status).toBe(409); // no draft yet
      await patch(session.id, { summary: 'Plain.', features: [{ id: 'f1', name: 'Store', build_as: 'module', what: 'checkout', pages: ['/shop/*'] }, { id: 'f2', name: 'Selector', build_as: 'variant' }] }, 0);
      const gaps = await signIt(session.id, 1);
      expect(gaps.status).toBe(409);
      expect(await code(gaps)).toBe('direction_incomplete');
      await patch(session.id, { nav: NAV, container: FULL.container }, 1);
      const missing = await signIt(session.id, 1);
      expect(missing.status).toBe(409);
      expect(await code(missing)).toBe('client_requests_missing');
      const read = await (await direction.GET(get('/x'), sid)).json();
      expect(read.missing_client_requests.map((n: { id: string }) => n.id)).toContain(note.id);
      expect(read.sign_gaps).toEqual([]);
      const everyNote = await prisma.designNote.findMany({ where: { client_id: f.clientId, polarity: { in: ['require', 'avoid'] } } });
      await patch(session.id, { client_requests: everyNote.map((n) => ({ design_note_id: n.id, how_honoured: 'Only brand photos.' })) }, 1);

      asAdmin();
      const admin = await signIt(session.id, 1);
      expect(admin.status).toBe(403);
      expect(await code(admin)).toBe('designer_only');
      asDesigner();
      const stale = await signIt(session.id, 4);
      expect(await code(stale)).toBe('version_moved');
      expect((await sign.POST(json('POST', '/x', {}), sid)).status).toBe(400);

      const res = await signIt(session.id, 1);
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out).toMatchObject({ stage: 'home_build', direction: { version: 1, status: 'signed' } });
      expect(findForbiddenKeys(out)).toEqual([]);
      const t = await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } });
      expect(t.stage).toBe('home_build');
      expect(t.busy_job_id).toBe(out.build_job_id);
      expect(t.art_direction_id).toBe(out.direction.id);
      const jobs = await prisma.designJob.findMany({ where: { track_id: track.id } });
      expect(jobs.filter((j) => j.kind === 'home_build')).toHaveLength(1);
      expect(jobs.filter((j) => j.kind === 'module')).toHaveLength(1);
      expect(jobs.find((j) => j.kind === 'module')?.payload).toMatchObject({ feature_id: 'f1', name: 'Store' });
      const mail = jobs.find((j) => j.kind === 'client_brief_email');
      expect(mail?.id).toBe(out.client_email_job_id);
      const row = await prisma.designArtDirection.findUniqueOrThrow({ where: { id: out.direction.id } });
      expect(row).toMatchObject({ status: 'signed', signed_by_id: f.designer.userId, client_email_job_id: mail?.id, client_email_status: 'queued' });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: w.t.art } })).status).toBe('done');

      const again = await signIt(session.id, 1);
      expect(again.status).toBe(409);
      expect(await code(again)).toBe('direction_signed');
      const busyNow = await patch(session.id, { summary: 'changed' }, 1);
      expect(await code(busyNow)).toBe('track_busy'); // the home build is running
      await prisma.designTrack.update({ where: { id: track.id }, data: { busy_job_id: null } });
      const late = await patch(session.id, { summary: 'changed' }, 1);
      expect(late.status).toBe(409);
      expect(await code(late)).toBe('direction_signed');
      // the signed version stays readable
      const after = await (await direction.GET(get('/x'), sid)).json();
      expect(after.direction).toMatchObject({ version: 1, status: 'signed' });
      expect(after.signed).toMatchObject({ version: 1 });
    });

    it('open_questions that cite a note id answer it, so the direction can be signed', async () => {
      const { session } = await tracked('ad2b');
      const n = await prisma.designNote.create({
        data: {
          client_id: f.clientId, source_kind: 'email', source_ref: 'e2', source_date: new Date(), speaker_name: 'Pat', speaker_role: 'client',
          quote: 'Avoid red.', quote_sha: 'c'.repeat(64), category: 'colour', polarity: 'avoid', subject: 'red', confidence: 0.9, extracted_by: 'test',
        },
      });
      await patch(session.id, { ...FULL, open_questions: [`Is dark red ok for errors? (note ${n.id})`] }, 0);
      // the earlier test's note is the same client's: answer it too
      const others = await prisma.designNote.findMany({ where: { client_id: f.clientId, polarity: { in: ['require', 'avoid'] }, id: { not: n.id } } });
      if (others.length) await patch(session.id, { client_requests: others.map((o) => ({ design_note_id: o.id, how_honoured: 'ok' })) }, 1);
      expect((await signIt(session.id, 1)).status).toBe(200);
    });

    it('revise and sign in refine: refinements keep the stage and send one designer text event; rebuild queues a new home build; each version queues its own email', async () => {
      const { track, session } = await tracked('ad3');
      const notes = await prisma.designNote.findMany({ where: { client_id: f.clientId, polarity: { in: ['require', 'avoid'] } } });
      const answered = notes.map((n) => ({ design_note_id: n.id, how_honoured: 'ok' }));
      await patch(session.id, { ...FULL, client_requests: answered }, 0);
      expect((await signIt(session.id, 1)).status).toBe(200);
      // revise is refused until the build is adopted (busy), and in art_direction
      const busy = await revise.POST(json('POST', '/x', {}), ctx({ id: session.id }));
      expect(busy.status).toBe(409);
      expect(await code(busy)).toBe('track_busy');
      // the build is adopted: refine, not busy
      await prisma.designJob.updateMany({ where: { track_id: track.id, kind: 'home_build' }, data: { status: 'done' } });
      await prisma.designTrack.update({ where: { id: track.id }, data: { stage: 'refine', busy_job_id: null } });
      const rev = await revise.POST(json('POST', '/x', {}), ctx({ id: session.id }));
      expect(rev.status).toBe(201);
      const d2 = (await rev.json()).direction;
      expect(d2).toMatchObject({ version: 2, status: 'draft' });
      expect(d2.body.container.max_content_px).toBe(1280);
      expect(await code(await revise.POST(json('POST', '/x', {}), ctx({ id: session.id })))).toBe('draft_exists');
      await patch(session.id, { type: { display: { family: 'Spectral', source: 'designer' } }, colour: { avoid: ['pastels'] } }, 2);
      const refined = await signIt(session.id, 2); // default mode: refinements
      expect(refined.status).toBe(200);
      const out = await refined.json();
      expect(out).toMatchObject({ stage: 'refine', build_job_id: null, direction: { version: 2, status: 'signed' } });
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } })).stage).toBe('refine');
      expect(await prisma.designJob.count({ where: { track_id: track.id, kind: 'home_build' } })).toBe(1);
      expect(await prisma.designJob.count({ where: { track_id: track.id, kind: 'client_brief_email' } })).toBe(2);
      const ev = await prisma.designEvent.findMany({ where: { session_id: session.id, client_ref: `art-direction:${out.direction.id}` } });
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ role: 'designer', kind: 'text', author_id: f.designer.userId });
      expect(JSON.stringify(ev[0].payload)).toContain('type');
      const v1 = await prisma.designArtDirection.findFirstOrThrow({ where: { track_id: track.id, version: 1 } });
      expect(v1.status).toBe('superseded');
      expect((await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } })).art_direction_id).toBe(out.direction.id);

      // rebuild: a third version, signed with mode rebuild
      expect((await revise.POST(json('POST', '/x', {}), ctx({ id: session.id }))).status).toBe(201);
      await patch(session.id, { feel: { words: ['bold'] } }, 3);
      const rebuilt = await signIt(session.id, 3, 'rebuild');
      expect(rebuilt.status).toBe(200);
      const rb = await rebuilt.json();
      expect(rb.stage).toBe('home_build');
      expect(rb.build_job_id).toBeTruthy();
      const t = await prisma.designTrack.findUniqueOrThrow({ where: { id: track.id } });
      expect(t).toMatchObject({ stage: 'home_build', busy_job_id: rb.build_job_id });
      expect(await prisma.designJob.count({ where: { track_id: track.id, kind: 'client_brief_email' } })).toBe(3);
      // home_build with a running build: revise is refused (busy)
      expect(await code(await revise.POST(json('POST', '/x', {}), ctx({ id: session.id })))).toBe('track_busy');
    });

    it('revise in art_direction or review-less stages is refused; writes are track_busy while building and track_done once done', async () => {
      const a = await tracked('ad4');
      expect(await code(await revise.POST(json('POST', '/x', {}), ctx({ id: a.session.id })))).toBe('illegal_transition');

      // busy: art direction PATCH and revise are 409 track_busy; the board, uploads and reads stay open
      const job = await prisma.designJob.create({ data: { track_id: a.track.id, kind: 'rest_build', status: 'running', payload: {} } });
      await prisma.designTrack.update({ where: { id: a.track.id }, data: { busy_job_id: job.id } });
      const busy = await patch(a.session.id, { summary: 'x' }, 0);
      expect(busy.status).toBe(409);
      expect(await code(busy)).toBe('track_busy');
      expect(await code(await revise.POST(json('POST', '/x', {}), ctx({ id: a.session.id })))).toBe('track_busy');
      expect((await doUpload(a.session.id, PNG, 'board')).status).toBe(201);
      expect((await references.POST(json('POST', '/x', { url: 'https://busy.example.com/' }), ctx({ id: a.session.id }))).status).toBe(201);
      expect((await direction.GET(get('/x'), ctx({ id: a.session.id }))).status).toBe(200);

      // done: every write refuses with track_done, reads stay open
      await prisma.designTrack.update({ where: { id: a.track.id }, data: { stage: 'done', busy_job_id: null, finished_at: new Date(), finish_result: { green: true } } });
      const A = '5d1d5d1d-5d1d-4d1d-8d1d-5d1d5d1d5d1d';
      const writes: Array<[string, () => Promise<Response>]> = [
        ['reactions', () => reactions.POST(json('POST', '/x', { card_id: 'c', reaction: 'useful' }), ctx({ id: a.session.id }))],
        ['references', () => references.POST(json('POST', '/x', { url: 'https://done.example.com/' }), ctx({ id: a.session.id }))],
        ['reference PATCH', () => reference.PATCH(json('PATCH', '/x', { decision: 'yes' }), ctx({ id: a.session.id, refId: A }))],
        ['markups', () => markups.POST(json('POST', '/x', { reference_id: A, asset_id: A, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, sentiment: 'like', category: 'type' }), ctx({ id: a.session.id }))],
        ['markup PATCH', () => markup.PATCH(json('PATCH', '/x', { deleted: true }), ctx({ id: a.session.id, markupId: A }))],
        ['uploads', () => doUpload(a.session.id, PNG, 'board')],
        ['direction', () => patch(a.session.id, { summary: 'x' }, 0)],
        ['sign', () => signIt(a.session.id, 1)],
        ['revise', () => revise.POST(json('POST', '/x', {}), ctx({ id: a.session.id }))],
      ];
      for (const [name, call] of writes) {
        const res = await call();
        expect(res.status, name).toBe(409);
        expect(await code(res), name).toBe('track_done');
      }
      expect((await brief.GET(get('/x'), ctx({ id: a.session.id }))).status).toBe(200);
      expect((await references.GET(get('/x'), ctx({ id: a.session.id }))).status).toBe(200);
      expect((await direction.GET(get('/x'), ctx({ id: a.session.id }))).status).toBe(200);
    });
  });
});
