// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { quoteSha } from '@/lib/design/design-notes';
import * as notes from '../route';
import * as note from '../../../../design-notes/[id]/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const MISSING = '3f2b8c1e-0000-4000-8000-0000000000ff';

const mk = (n: number, over: Record<string, unknown> = {}) => ({
  source_kind: 'meeting',
  source_ref: 'proposal-1#L12',
  source_date: '2026-11-05T15:00:00.000Z',
  speaker_name: 'Brian Hernon',
  speaker_role: 'client',
  quote: `I want the header to feel calm number ${n}`,
  category: 'feel',
  polarity: 'require',
  subject: `header feel ${n}`,
  confidence: 0.9,
  extracted_by: 'intake-test',
  ...over,
});

describe.skipIf(!SCRATCH)('design notes lane routes (real database)', () => {
  let a: DesignFixture;
  let b: DesignFixture;

  beforeAll(async () => {
    const tag = Date.now();
    a = await seedDesign(`dna${tag}`);
    b = await seedDesign(`dnb${tag}`);
  });
  afterAll(async () => {
    await teardownDesign(a);
    await teardownDesign(b);
  });
  beforeEach(async () => {
    as.mockResolvedValue({ userId: a.admin.userId, email: 'bast@example.test', role: 'pm', via: 'api_key', apiKeyId: 'k1', lane: 'design-notes', laneEnforced: true });
    await prisma.designNote.deleteMany({ where: { client_id: { in: [a.clientId, b.clientId] } } });
  });

  const post = (clientId: string, body: unknown) => notes.POST(req('POST', `/api/clients/${clientId}/design-notes`, body), ctx(clientId));
  const list = (clientId: string, qs = '') => notes.GET(req('GET', `/api/clients/${clientId}/design-notes${qs}`), ctx(clientId));
  const patch = (id: string, body: unknown) => note.PATCH(req('PATCH', `/api/design-notes/${id}`, body), ctx(id));

  it('creates a batch: 201, ids in order, quote_sha computed from the collapsed quote, every field stored', async () => {
    const res = await post(a.clientId, { notes: [mk(1, { project_id: a.projectId, site_id: a.siteId, is_paraphrase: true, reference_url: 'https://example.com/x' }), mk(2, { quote: '  spaced   out\n quote  ' })] });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.skipped).toEqual([]);
    expect(j.created.map((c: { index: number }) => c.index)).toEqual([0, 1]);
    const rows = await prisma.designNote.findMany({ where: { client_id: a.clientId }, orderBy: { subject: 'asc' } });
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.id === j.created[0].id)!;
    expect(first).toMatchObject({ project_id: a.projectId, site_id: a.siteId, is_paraphrase: true, reference_url: 'https://example.com/x', status: 'active', speaker_role: 'client', confidence: 0.9 });
    expect(first.quote_sha).toBe(quoteSha(first.quote));
    const second = rows.find((r) => r.id === j.created[1].id)!;
    expect(second.quote).toBe('  spaced   out\n quote  ');
    expect(second.quote_sha).toBe(quoteSha('spaced out quote'));
  });

  it('is idempotent: a repeat post creates nothing and reports the duplicates as skipped with the existing ids', async () => {
    const batch = { notes: [mk(1), mk(2)] };
    const first = await (await post(a.clientId, batch)).json();
    const res = await post(a.clientId, batch);
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.created).toEqual([]);
    expect(j.skipped.map((s: { id: string }) => s.id)).toEqual(first.created.map((c: { id: string }) => c.id));
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(2);
    // a new note beside a duplicate: only the new one is created
    const mixed = await (await post(a.clientId, { notes: [mk(2), mk(3)] })).json();
    expect(mixed.created).toHaveLength(1);
    expect(mixed.created[0].index).toBe(1);
    expect(mixed.skipped).toHaveLength(1);
    expect(mixed.skipped[0].index).toBe(0);
  });

  it('treats the same quote under another source_ref, or for another client, as a new note; whitespace-only differences are duplicates', async () => {
    await post(a.clientId, { notes: [mk(1)] });
    const other = await (await post(a.clientId, { notes: [mk(1, { source_ref: 'proposal-2#L3' })] })).json();
    expect(other.created).toHaveLength(1);
    const otherClient = await (await post(b.clientId, { notes: [mk(1)] })).json();
    expect(otherClient.created).toHaveLength(1);
    const spaced = await (await post(a.clientId, { notes: [mk(1, { quote: '  I want the header to feel calm   number 1 ' })] })).json();
    expect(spaced.created).toEqual([]);
    expect(spaced.skipped).toHaveLength(1);
  });

  it('skips duplicates inside one batch after the first', async () => {
    const j = await (await post(a.clientId, { notes: [mk(1), mk(2), mk(1, { subject: 'again' })] })).json();
    expect(j.created.map((c: { index: number }) => c.index)).toEqual([0, 1]);
    expect(j.skipped.map((c: { index: number }) => c.index)).toEqual([2]);
    expect(j.skipped[0].id).toBe(j.created[0].id);
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(2);
  });

  it('two concurrent identical posts create one row between them', async () => {
    const batch = { notes: [mk(1), mk(2), mk(3)] };
    const [r1, r2] = await Promise.all([post(a.clientId, batch), post(a.clientId, batch)]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const [j1, j2] = [await r1.json(), await r2.json()];
    expect(j1.created.length + j2.created.length).toBe(3);
    expect(j1.skipped.length + j2.skipped.length).toBe(3);
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(3);
  });

  it('refuses more than 100 notes (400, nothing stored) and accepts exactly 100', async () => {
    const many = (n: number) => Array.from({ length: n }, (_v, i) => mk(i));
    const over = await post(a.clientId, { notes: many(101) });
    expect(over.status).toBe(400);
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(0);
    const ok = await post(a.clientId, { notes: many(100) });
    expect(ok.status).toBe(201);
    expect((await ok.json()).created).toHaveLength(100);
  });

  it('refuses an empty batch, a bad enum, a long quote, an unknown field and a wrong quote_sha (400, nothing stored)', async () => {
    for (const body of [
      { notes: [] },
      {},
      { notes: [mk(1, { polarity: 'love' })] },
      { notes: [mk(1, { category: 'vibes' })] },
      { notes: [mk(1, { speaker_role: 'boss' })] },
      { notes: [mk(1, { source_kind: 'carrier_pigeon' })] },
      { notes: [mk(1, { quote: 'x'.repeat(601) })] },
      { notes: [mk(1, { quote: '   ' })] },
      { notes: [mk(1, { confidence: 1.5 })] },
      { notes: [mk(1, { reference_url: 'javascript:alert(1)' })] },
      { notes: [mk(1, { source_date: 'yesterday' })] },
      { notes: [mk(1, { client_id: b.clientId })] },
      { notes: [mk(1, { quote_sha: 'a'.repeat(64) })] },
      { notes: [mk(2), mk(1, { quote_sha: 'a'.repeat(64) })] },
      { notes: [mk(1)], extra: true },
    ]) {
      expect((await post(a.clientId, body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(0);
  });

  it('accepts a 600-character quote and a matching quote_sha', async () => {
    const quote = 'q'.repeat(600);
    const res = await post(a.clientId, { notes: [mk(1, { quote, quote_sha: quoteSha(quote) })] });
    expect(res.status).toBe(201);
  });

  it("refuses a project or site that is not the client's (400, nothing stored)", async () => {
    expect((await post(a.clientId, { notes: [mk(1, { project_id: b.projectId })] })).status).toBe(400);
    expect((await post(a.clientId, { notes: [mk(1, { site_id: b.siteId })] })).status).toBe(400);
    expect((await post(a.clientId, { notes: [mk(1, { project_id: MISSING })] })).status).toBe(400);
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(0);
  });

  it('refuses a body over 1 MB with 413', async () => {
    const res = await post(a.clientId, { notes: [mk(1, { subject: 'x'.repeat(200) })], pad: 'p'.repeat(1024 * 1024 + 10) });
    expect(res.status).toBe(413);
  });

  it('answers 404 for an unknown client or a malformed id, on POST and GET', async () => {
    expect((await post(MISSING, { notes: [mk(1)] })).status).toBe(404);
    expect((await list(MISSING)).status).toBe(404);
    expect((await post('not-a-uuid', { notes: [mk(1)] })).status).toBe(404);
    expect((await list('not-a-uuid')).status).toBe(404);
  });

  it('GET lists every status oldest first and filters by source_ref and since; it never shows another client', async () => {
    await post(a.clientId, { notes: [mk(1), mk(2)] });
    await new Promise((r) => setTimeout(r, 25));
    const mark = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 25));
    await post(a.clientId, { notes: [mk(3, { source_ref: 'email-9' })] });
    await post(b.clientId, { notes: [mk(4)] });

    const all = (await (await list(a.clientId)).json()).notes as Array<{ id: string; subject: string; client_id: string; status: string; quote_sha: string }>;
    expect(all).toHaveLength(3);
    expect(all.every((n) => n.client_id === a.clientId)).toBe(true);
    // one batch shares a timestamp, so its own order is not promised; batches are oldest first
    expect(all.slice(0, 2).map((n) => n.subject).sort()).toEqual(['header feel 1', 'header feel 2']);
    expect(all[2].subject).toBe('header feel 3');
    expect(all.find((n) => n.subject === 'header feel 1')!.quote_sha).toBe(quoteSha('I want the header to feel calm number 1'));

    const byRef = (await (await list(a.clientId, `?source_ref=${encodeURIComponent('email-9')}`)).json()).notes;
    expect(byRef.map((n: { subject: string }) => n.subject)).toEqual(['header feel 3']);
    const none = (await (await list(a.clientId, '?source_ref=nope')).json()).notes;
    expect(none).toEqual([]);
    const since = (await (await list(a.clientId, `?since=${encodeURIComponent(mark)}`)).json()).notes;
    expect(since.map((n: { subject: string }) => n.subject)).toEqual(['header feel 3']);
    const both = (await (await list(a.clientId, `?since=${encodeURIComponent(mark)}&source_ref=proposal-1%23L12`)).json()).notes;
    expect(both).toEqual([]);

    // superseded and withdrawn notes still show (dedupe needs them)
    await patch(all[2].id, { status: 'withdrawn' });
    expect((await (await list(a.clientId)).json()).notes).toHaveLength(3);

    expect((await list(a.clientId, '?since=yesterday')).status).toBe(400);
  });

  it('PATCH withdraws a note, and supersedes with a same-client active note', async () => {
    const j = await (await post(a.clientId, { notes: [mk(1), mk(2), mk(3)] })).json();
    const [n1, n2, n3] = j.created.map((c: { id: string }) => c.id);

    const w = await patch(n1, { status: 'withdrawn' });
    expect(w.status).toBe(200);
    expect((await w.json()).note).toMatchObject({ id: n1, status: 'withdrawn', superseded_by_id: null });

    const s = await patch(n2, { status: 'superseded', superseded_by_id: n3 });
    expect(s.status).toBe(200);
    expect((await s.json()).note).toMatchObject({ id: n2, status: 'superseded', superseded_by_id: n3 });
    expect((await prisma.designNote.findUniqueOrThrow({ where: { id: n2 } })).superseded_by_id).toBe(n3);

    // superseded with no replacement is allowed; withdrawing afterwards clears the link
    const bare = await patch(n3, { status: 'superseded' });
    expect(bare.status).toBe(200);
    expect((await bare.json()).note.superseded_by_id).toBeNull();
    const again = await patch(n2, { status: 'withdrawn' });
    expect((await again.json()).note).toMatchObject({ status: 'withdrawn', superseded_by_id: null });
  });

  it("refuses another client's note as superseded_by_id (400, nothing changed)", async () => {
    const [mine] = (await (await post(a.clientId, { notes: [mk(1)] })).json()).created;
    const [theirs] = (await (await post(b.clientId, { notes: [mk(2)] })).json()).created;
    const res = await patch(mine.id, { status: 'superseded', superseded_by_id: theirs.id });
    expect(res.status).toBe(400);
    const row = await prisma.designNote.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row).toMatchObject({ status: 'active', superseded_by_id: null });
  });

  it('refuses the other invalid PATCH bodies and unknown notes', async () => {
    const j = await (await post(a.clientId, { notes: [mk(1), mk(2)] })).json();
    const [n1, n2] = j.created.map((c: { id: string }) => c.id);
    expect((await patch(n1, { status: 'active' })).status).toBe(400);
    expect((await patch(n1, { status: 'deleted' })).status).toBe(400);
    expect((await patch(n1, {})).status).toBe(400);
    expect((await patch(n1, { status: 'superseded', quote: 'new words' })).status).toBe(400);
    expect((await patch(n1, { status: 'withdrawn', superseded_by_id: n2 })).status).toBe(400);
    expect((await patch(n1, { status: 'superseded', superseded_by_id: n1 })).status).toBe(400);
    expect((await patch(n1, { status: 'superseded', superseded_by_id: MISSING })).status).toBe(400);
    expect((await patch(n1, { status: 'superseded', superseded_by_id: 'nope' })).status).toBe(400);
    expect((await patch(MISSING, { status: 'withdrawn' })).status).toBe(404);
    expect((await patch('not-a-uuid', { status: 'withdrawn' })).status).toBe(404);
    // a replacement must itself be active: no chains through withdrawn notes
    await patch(n2, { status: 'withdrawn' });
    expect((await patch(n1, { status: 'superseded', superseded_by_id: n2 })).status).toBe(400);
    expect(await prisma.designNote.findUniqueOrThrow({ where: { id: n1 } })).toMatchObject({ status: 'active', superseded_by_id: null });
  });

  it('a wrong-lane caller never reaches the database (403, nothing stored)', async () => {
    as.mockResolvedValue({ userId: a.admin.userId, email: 'a@example.test', role: 'admin', via: 'session' });
    expect((await post(a.clientId, { notes: [mk(1)] })).status).toBe(403);
    expect((await list(a.clientId)).status).toBe(403);
    expect(await prisma.designNote.count({ where: { client_id: a.clientId } })).toBe(0);
  });
});
