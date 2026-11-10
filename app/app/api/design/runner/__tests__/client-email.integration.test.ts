// @vitest-environment node
// W6.1 F7: one client brief email per signed art direction version, recorded in Citadel. The runner claims the send
// with a conditional update queued -> sending before it sends; exactly one of two concurrent claims wins.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { SCRATCH, seedDesign, seedTrack, teardownDesign, type DesignFixture } from '@/lib/design/__tests__/fixtures';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import * as route from '../jobs/[id]/client-email/route';

const as = requireAuth as ReturnType<typeof vi.fn>;
const post = (jobId: string, body: unknown, raw = false) =>
  route.POST(
    new NextRequest(`http://localhost:3000/api/design/runner/jobs/${jobId}/client-email`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: jobId }) },
  );

describe.skipIf(!SCRATCH)('POST /api/design/runner/jobs/:id/client-email (real database)', () => {
  let f: DesignFixture;
  let trackId: string;
  let version = 0;
  let runner: Record<string, unknown>;

  /** A signed direction whose client email job is queued, as `freeze` leaves it. */
  async function signedWithEmail(status: string | null = 'queued') {
    const job = await prisma.designJob.create({ data: { track_id: trackId, kind: 'client_brief_email', payload: {} } });
    version += 1;
    const d = await prisma.designArtDirection.create({
      data: {
        track_id: trackId, version, status: 'signed', body: {}, drafted_by: 'designer', signed_at: new Date(),
        client_email_job_id: job.id, client_email_status: status,
      },
    });
    return { jobId: job.id, directionId: d.id };
  }
  const row = (id: string) => prisma.designArtDirection.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    f = await seedDesign(`w63ce${Date.now()}`);
    trackId = (await seedTrack(f, { stage: 'refine' })).id;
    const bast = await prisma.user.create({ data: { email: `dp-${f.tag}-bast@example.test`, password_hash: 'x', name: `bast ${f.tag}`, role: 'pm' } });
    runner = { userId: bast.id, email: bast.email, role: 'pm', via: 'api_key', apiKeyId: 'k-run', lane: 'design-track', laneEnforced: true };
    as.mockResolvedValue(runner);
  });
  afterAll(async () => {
    await prisma.designArtDirection.deleteMany({ where: { track_id: trackId } });
    await prisma.designJob.deleteMany({ where: { track_id: trackId } });
    await prisma.designTrack.deleteMany({ where: { id: trackId } });
    await prisma.user.deleteMany({ where: { id: runner.userId as string } });
    await teardownDesign(f);
  });

  it('claim, then sent: queued -> sending -> sent with the time; a second claim or sent is 409', async () => {
    const { jobId, directionId } = await signedWithEmail();
    const c = await post(jobId, { action: 'claim' });
    expect(c.status).toBe(200);
    expect(await c.json()).toEqual({ claimed: true });
    expect((await row(directionId)).client_email_status).toBe('sending');
    const again = await post(jobId, { action: 'claim' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'email_already_claimed', client_email_status: 'sending' });
    const s = await post(jobId, { action: 'sent' });
    expect(s.status).toBe(200);
    expect(await s.json()).toEqual({ ok: true });
    const after = await row(directionId);
    expect(after.client_email_status).toBe('sent');
    expect(after.client_email_sent_at).toBeInstanceOf(Date);
    const late = await post(jobId, { action: 'claim' });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'email_already_claimed', client_email_status: 'sent' });
    const twice = await post(jobId, { action: 'sent' });
    expect(twice.status).toBe(409);
    expect(await twice.json()).toMatchObject({ code: 'email_not_claimed', client_email_status: 'sent' });
    expect((await post(jobId, { action: 'held', reason: 'late' })).status).toBe(409);
  });

  it('two concurrent claims: exactly one 200, the other 409 email_already_claimed', async () => {
    for (let round = 0; round < 5; round++) {
      const { jobId, directionId } = await signedWithEmail();
      const results = await Promise.all([post(jobId, { action: 'claim' }), post(jobId, { action: 'claim' }), post(jobId, { action: 'claim' })]);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect((await r.json()).code).toBe('email_already_claimed');
      expect((await row(directionId)).client_email_status).toBe('sending');
    }
  });

  it('sent without a claim is 409 email_not_claimed and changes nothing', async () => {
    const { jobId, directionId } = await signedWithEmail();
    const s = await post(jobId, { action: 'sent' });
    expect(s.status).toBe(409);
    expect(await s.json()).toMatchObject({ code: 'email_not_claimed', client_email_status: 'queued' });
    const r = await row(directionId);
    expect(r.client_email_status).toBe('queued');
    expect(r.client_email_sent_at).toBeNull();
  });

  it('held only from queued, with the reason cut at 2,000 characters; a held email cannot be held again, and can be claimed once', async () => {
    const a = await signedWithEmail();
    const h = await post(a.jobId, { action: 'held', reason: 'x'.repeat(2500) });
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ ok: true });
    const ra = await row(a.directionId);
    expect(ra.client_email_status).toBe('held');
    expect(ra.client_email_held_reason).toHaveLength(2000);
    const again = await post(a.jobId, { action: 'held', reason: 'again' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'email_not_holdable', client_email_status: 'held' });
    // Held means nothing was sent: exactly one of two later claims gets it, and once sent it is final.
    const later = await Promise.all([post(a.jobId, { action: 'claim' }), post(a.jobId, { action: 'claim' })]);
    expect(later.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await post(a.jobId, { action: 'sent' })).status).toBe(200);
    expect((await post(a.jobId, { action: 'claim' })).status).toBe(409);
    expect((await post(a.jobId, { action: 'held', reason: 'late' })).status).toBe(409);

    // W6.4 M1: a claimed row can never be held, so it never returns to a claimable state.
    const b = await signedWithEmail();
    expect((await post(b.jobId, { action: 'claim' })).status).toBe(200);
    const hb = await post(b.jobId, { action: 'held', reason: 'recipient_domain_unverified' });
    expect(hb.status).toBe(409);
    expect(await hb.json()).toMatchObject({ code: 'email_not_holdable', client_email_status: 'sending' });
    expect(await row(b.directionId)).toMatchObject({ client_email_status: 'sending', client_email_held_reason: null, client_email_sent_at: null });
    expect((await post(b.jobId, { action: 'claim' })).status).toBe(409);
    expect((await post(b.jobId, { action: 'sent' })).status).toBe(200);
  });

  it('W6.4 M1: run A claims, run B reports held while the row is sending, run C claims: B and C are 409, one send only', async () => {
    // Sequence 1: A claims and sends, its sent report is lost; B (another state folder) holds; C claims.
    const one = await signedWithEmail();
    expect((await post(one.jobId, { action: 'claim' })).status).toBe(200); // run A
    const heldB = await post(one.jobId, { action: 'held', reason: 'sender_not_installed' }); // run B
    expect(heldB.status).toBe(409);
    expect(await heldB.json()).toMatchObject({ code: 'email_not_holdable', client_email_status: 'sending' });
    const claimC = await post(one.jobId, { action: 'claim' }); // run C
    expect(claimC.status).toBe(409);
    expect(await claimC.json()).toMatchObject({ code: 'email_already_claimed', client_email_status: 'sending' });
    expect(await row(one.directionId)).toMatchObject({ client_email_status: 'sending', client_email_held_reason: null, client_email_sent_at: null });

    // Sequence 2: B's hold lands between A's claim and A's sent; A's sent still lands, C cannot claim.
    const two = await signedWithEmail();
    expect((await post(two.jobId, { action: 'claim' })).status).toBe(200);
    expect((await post(two.jobId, { action: 'held', reason: 'sender_not_installed' })).status).toBe(409);
    expect((await post(two.jobId, { action: 'sent' })).status).toBe(200);
    const c2 = await post(two.jobId, { action: 'claim' });
    expect(c2.status).toBe(409);
    expect(await c2.json()).toMatchObject({ code: 'email_already_claimed', client_email_status: 'sent' });
    expect((await row(two.directionId)).client_email_status).toBe('sent');
  });

  it('404 for a job that is no direction\'s client email job (another job, a random id, a bad id); 400 for a bad body', async () => {
    const other = await prisma.designJob.create({ data: { track_id: trackId, kind: 'capture', payload: {} } });
    expect((await post(other.id, { action: 'claim' })).status).toBe(404);
    expect((await post(crypto.randomUUID(), { action: 'claim' })).status).toBe(404);
    expect((await post('not-a-uuid', { action: 'claim' })).status).toBe(404);
    const { jobId, directionId } = await signedWithEmail();
    for (const bad of [{}, { action: 'send' }, { action: 'claim', status: 'sent' }, { action: 'claim', client_email_status: 'sent' }]) {
      expect((await post(jobId, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post(jobId, '{nope', true)).status).toBe(400);
    expect((await row(directionId)).client_email_status).toBe('queued');
  });

  it('a row that is not queued (an older direction with no status) cannot be claimed', async () => {
    const { jobId } = await signedWithEmail(null);
    const c = await post(jobId, { action: 'claim' });
    expect(c.status).toBe(409);
    expect(await c.json()).toMatchObject({ code: 'email_already_claimed', client_email_status: null });
  });
});
