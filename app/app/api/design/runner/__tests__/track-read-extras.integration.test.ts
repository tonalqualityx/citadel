// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, seedTrack, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { readBrief } from '@/lib/design/track-board';
import * as track from '../tracks/[id]/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, include: string) => new NextRequest(`http://localhost:3000/api/design/runner/tracks/${id}?include=${include}`);
const sha = (c: string) => c.repeat(64);

const DESIGNER_STATEMENT_KEYS = ['category', 'id', 'is_paraphrase', 'polarity', 'quote', 'source_date', 'source_kind', 'speaker_name', 'speaker_role', 'status', 'subject'];
const RUNNER_STATEMENT_KEYS = [...DESIGNER_STATEMENT_KEYS, 'reference_url', 'source_ref', 'superseded_by_id'].sort();

describe.skipIf(!SCRATCH)('runner track read: statements with superseded notes, brand_profile (W3.3d)', () => {
  let f: DesignFixture;
  let other: DesignFixture;
  let t: { id: string };
  let t2: { id: string };
  let runner: Record<string, unknown>;

  const note = (clientId: string, ref: string, status: string, extra: Record<string, unknown> = {}, date = '2026-01-01') =>
    prisma.designNote.create({
      data: {
        client_id: clientId, source_kind: 'email', source_ref: ref, source_date: new Date(date), speaker_name: 'Pat', speaker_role: 'client',
        quote: `quote ${ref}`, quote_sha: sha(ref.slice(-1)), category: 'colour', polarity: 'avoid', subject: `s-${ref}`, confidence: 0.9, extracted_by: 'test', status, ...extra,
      },
    });

  beforeAll(async () => {
    f = await seedDesign('w33dA');
    other = await seedDesign('w33dB');
    t = await seedTrack(f);
    t2 = await seedTrack(other);
    const bast = await prisma.user.create({ data: { email: `dp-w33d-bast@example.test`, password_hash: 'x', name: 'bast w33d', role: 'pm' } });
    runner = { userId: bast.id, email: bast.email, role: 'pm', via: 'api_key', apiKeyId: 'k-run', lane: 'design-track', laneEnforced: true };
  });
  afterAll(async () => {
    await prisma.brandProfile.deleteMany({ where: { client_id: { in: [f.clientId, other.clientId] } } });
    await prisma.designTrack.deleteMany({ where: { id: { in: [t.id, t2.id] } } });
    await prisma.user.deleteMany({ where: { id: runner.userId as string } });
    await teardownDesign(f);
    await teardownDesign(other);
  });

  it('returns active and superseded notes with the three extra fields; withdrawn and other clients are excluded', async () => {
    const newer = await note(f.clientId, 'e-new', 'active', { reference_url: 'https://example.com/ref' }, '2026-02-01');
    const older = await note(f.clientId, 'e-old', 'superseded', { superseded_by_id: newer.id }, '2026-01-01');
    await note(f.clientId, 'e-wd', 'withdrawn');
    await note(f.clientId, 'e-odd', 'rejected');
    const foreign = await note(other.clientId, 'e-foreign', 'active');
    as.mockResolvedValue(runner);
    const res = await track.GET(get(t.id, 'client_statements'), ctx(t.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client_statements.map((n: { id: string }) => n.id)).toEqual([older.id, newer.id]); // source_date asc
    for (const n of body.client_statements) expect(Object.keys(n).sort()).toEqual(RUNNER_STATEMENT_KEYS);
    const [o, n] = body.client_statements;
    expect(o).toMatchObject({ status: 'superseded', superseded_by_id: newer.id, source_ref: 'e-old', reference_url: null });
    expect(n).toMatchObject({ status: 'active', superseded_by_id: null, source_ref: 'e-new', reference_url: 'https://example.com/ref' });
    expect(JSON.stringify(body)).not.toContain(foreign.id);

    // the designer-facing brief response is unchanged: same keys, active notes only, no superseded note
    const d = await readBrief({ id: t.id, project_id: f.projectId, brief_id: null }, 'sess', f.designer.userId);
    expect(Object.keys(d).sort()).toEqual(['assets', 'brief', 'client_statements', 'reactions']);
    expect(d.client_statements.map((x) => x.id)).toEqual([newer.id]);
    expect(d.client_statements.map((x) => x.id)).not.toContain(older.id);
    expect(Object.keys(d.client_statements[0]).sort()).toEqual(DESIGNER_STATEMENT_KEYS);
  });

  it('brand_profile: null when absent, the client\'s own fields when present, never another client\'s, nothing internal', async () => {
    as.mockResolvedValue(runner);
    const none = await (await track.GET(get(t.id, 'brand_profile'), ctx(t.id))).json();
    expect(none.brand_profile).toBeNull();

    await prisma.brandProfile.create({ data: { client_id: other.clientId, brand_tokens: { colors: ['#000'] }, notes: 'foreign' } });
    expect((await (await track.GET(get(t.id, 'brand_profile'), ctx(t.id))).json()).brand_profile).toBeNull();

    await prisma.brandProfile.create({
      data: { client_id: f.clientId, brand_tokens: { colors: ['#112233'], fonts: ['Inter'] }, voice_profile: 'plain and warm', figma_url: 'https://figma.com/x', component_library_ref: 'lib-1', notes: 'INTERNAL SECRET NOTE' },
    });
    const res = await track.GET(get(t.id, 'brand_profile'), ctx(t.id));
    const text = JSON.stringify(await res.clone().json());
    const body = await res.json();
    expect(body.brand_profile).toEqual({ voice_profile: 'plain and warm', brand_tokens: { colors: ['#112233'], fonts: ['Inter'] }, figma_url: 'https://figma.com/x', component_library_ref: 'lib-1' });
    expect(text).not.toContain('INTERNAL SECRET NOTE');
    expect(text).not.toContain(other.clientId);
    expect(text).not.toContain(f.clientId);

    await prisma.brandProfile.updateMany({ where: { client_id: f.clientId }, data: { is_deleted: true } });
    expect((await (await track.GET(get(t.id, 'brand_profile'), ctx(t.id))).json()).brand_profile).toBeNull();
  });

  it('an unknown include is 400 and a designer session cannot call the route', async () => {
    as.mockResolvedValue(runner);
    expect((await track.GET(get(t.id, 'client_statements,brand_profiles'), ctx(t.id))).status).toBe(400);
    as.mockResolvedValue({ userId: f.designer.userId, email: 'd@example.test', role: 'designer', via: 'session' });
    expect((await track.GET(get(t.id, 'brand_profile'), ctx(t.id))).status).toBe(403);
  });
});
