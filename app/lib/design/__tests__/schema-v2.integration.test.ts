import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH, seedDesign, seedTask, seedTrack, teardownDesign, type DesignFixture } from './fixtures';

// Designer Portal v2 schema (W1.1): partial unique indexes and teardown order, on the scratch database.
describe.skipIf(!SCRATCH)('design v2 schema (real database)', () => {
  let f: DesignFixture;
  beforeAll(async () => {
    f = await seedDesign(`sv2${Date.now()}`);
  });
  afterAll(async () => {
    await teardownDesign(f);
  });

  it('allows one open track per site and a second one after the first is done', async () => {
    const t = await seedTrack(f);
    await expect(seedTrack(f, { round: 2 })).rejects.toThrow();
    await prisma.designTrack.update({ where: { id: t.id }, data: { stage: 'done' } });
    const t2 = await seedTrack(f, { round: 2 });
    expect(t2.branch).toBe(`design/t-${t2.slug}`);
    expect(t2.slug).toMatch(/^[a-z2-7]{16}$/);
    await prisma.designTrack.update({ where: { id: t2.id }, data: { stage: 'cancelled' } });
  });

  it('allows one live session per track, and one active build job per track', async () => {
    const t = await seedTrack(f, { round: 3 });
    const taskA = await seedTask(f, 'a');
    const taskB = await seedTask(f, 'b');
    const mk = (task_id: string, status: 'active' | 'closed') =>
      prisma.designSession.create({
        data: { task_id, site_id: f.siteId, designer_id: f.designer.userId, track_id: t.id, branch: t.branch, preview_alias: t.preview_alias, model: 'opus', budget_usd: 5, status },
      });
    await mk(taskA, 'closed');
    await mk(taskA, 'active');
    await expect(mk(taskB, 'active')).rejects.toThrow();

    await prisma.designJob.create({ data: { track_id: t.id, kind: 'home_build', payload: {} } });
    await expect(prisma.designJob.create({ data: { track_id: t.id, kind: 'rest_build', payload: {} } })).rejects.toThrow();
    await prisma.designJob.create({ data: { track_id: t.id, kind: 'module', payload: {} } });
  });

  it('enforces one url per track, one draft art direction per track, and tears down clean', async () => {
    await prisma.designTrack.updateMany({ where: { site_id: f.siteId }, data: { stage: 'cancelled' } });
    const t = await seedTrack(f, { round: 4 });
    await prisma.designReference.create({ data: { track_id: t.id, source: 'bast_pick', title: 'a', url: 'https://a.example' } });
    await expect(prisma.designReference.create({ data: { track_id: t.id, source: 'bast_pick', title: 'b', url: 'https://a.example' } })).rejects.toThrow();
    await prisma.designReference.create({ data: { track_id: t.id, source: 'designer_upload', title: 'c' } });
    await prisma.designReference.create({ data: { track_id: t.id, source: 'designer_upload', title: 'd' } });
    await prisma.designArtDirection.create({ data: { track_id: t.id, version: 1, status: 'draft', body: {}, drafted_by: 'worker' } });
    await expect(prisma.designArtDirection.create({ data: { track_id: t.id, version: 2, status: 'draft', body: {}, drafted_by: 'worker' } })).rejects.toThrow();
    const brief = await prisma.designBrief.create({ data: { track_id: t.id, version: 1, status: 'draft', body: {} } });
    await prisma.designBriefReaction.create({ data: { brief_id: brief.id, card_id: 'c1', reaction: 'useful' } });
    const asset = await prisma.designTrackAsset.create({ data: { track_id: t.id, kind: 'ref_fold', content_type: 'image/png', bytes: 1, sha256: 'a'.repeat(64), storage_key: 'k', source: 'runner' } });
    const ref = await prisma.designReference.findFirstOrThrow({ where: { track_id: t.id } });
    await prisma.designMarkup.create({ data: { reference_id: ref.id, asset_id: asset.id, rect: { x: 0, y: 0, w: 1, h: 1 }, sentiment: 'like', category: 'type' } });
    await prisma.designNote.create({
      data: { client_id: f.clientId, site_id: f.siteId, source_kind: 'email', source_ref: 'r', source_date: new Date(), speaker_name: 'x', speaker_role: 'client', quote: 'q', quote_sha: 'b'.repeat(64), category: 'brand', polarity: 'like', subject: 's', confidence: 0.9, extracted_by: 'test' },
    });
    // afterAll teardown must not hit a foreign key error with all of the above present
  });
});
