import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { claimNextJob, enqueueJob } from '../queue';
import { capResult, logToolCall, loadJobProvenance, MAX_ANALYTICS_PER_CLIENT_DAY, MAX_CALLS_PER_JOB, RESULT_CAP_BYTES } from '../tool-calls';
import { gateReply } from '@/lib/portal/chat/gate';
import { cleanup, SCRATCH, seedClient, type Seeded } from './seed';

const GA4 = {
  label: 'Google Analytics, Oct 1 to Oct 20, 2026 (data through Oct 20)',
  totals: { sessions: 1234, engagementRate: 0.456 },
  rows: [{ pagePath: '/', sessions: '600' }],
};

describe('capResult', () => {
  it('keeps a small result whole', () => {
    expect(capResult({ a: 1 })).toEqual({ a: 1 });
  });
  it('replaces a result over 20 KB with a marker that keeps the label', () => {
    const big = { label: 'Google Analytics, Oct 1 to Oct 20, 2026', rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: 'x'.repeat(20) })) };
    const out = capResult(big) as { truncated: boolean; bytes: number; label: string; preview: string };
    expect(JSON.stringify(big).length).toBeGreaterThan(RESULT_CAP_BYTES);
    expect(out.truncated).toBe(true);
    expect(out.label).toBe(big.label);
    expect(out.preview.length).toBeLessThanOrEqual(2000);
  });
});

describe.skipIf(!SCRATCH)('tool-call log (real database)', () => {
  const tag = `t${Date.now()}`;
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    a = await seedClient(`${tag}a`);
    b = await seedClient(`${tag}b`);
  });
  afterAll(async () => {
    await cleanup([a, b]);
    await prisma.$disconnect();
  });

  async function liveJob(s: Seeded) {
    await enqueueJob({ type: 'chat_reply', conversationId: s.conversationId, taskId: s.taskId, clientId: s.clientId, contactId: s.ownerId });
    return (await claimNextJob())!;
  }

  it('stores the call with its numbers, and the gate can use them', async () => {
    const job = await liveJob(a);
    const row = await logToolCall(job, { tool: 'ga4_report', args: { site_id: a.siteId }, row_count: 1, latency_ms: 120, result: GA4 });
    expect(row.result_numbers).toContain('1234');
    expect(row.result_numbers).toContain('600');
    expect(row.task_id).toBe(a.taskId);
    expect(row.client_id).toBe(a.clientId);

    const prov = await loadJobProvenance(job.id, []);
    const ctx = { provenance: prov, staffNames: [], otherClientNames: [], clientDomains: [], portalOrigins: [], reportUrls: [], contactEmail: null };
    expect(gateReply('Google Analytics, Oct 1 to Oct 20, 2026: 1,234 sessions.', ctx)).toEqual({ ok: true });
    expect(gateReply('Google Analytics, Oct 1 to Oct 20, 2026: 1,235 sessions.', ctx).ok).toBe(false);
    await prisma.engineJob.update({ where: { id: job.id }, data: { status: 'done' } });
  });

  it('a failed call keeps its error and contributes no numbers', async () => {
    const job = await liveJob(a);
    const row = await logToolCall(job, { tool: 'search_console', args: {}, error: 'quota', result: { totals: { clicks: 77 } } });
    expect(row.error).toBe('quota');
    expect(row.result_numbers).toEqual([]);
    await prisma.engineJob.update({ where: { id: job.id }, data: { status: 'done' } });
  });

  it('refuses a seventh call in one job', async () => {
    const job = await liveJob(b);
    for (let i = 0; i < MAX_CALLS_PER_JOB; i++) await logToolCall(job, { tool: 'site_pages', args: { i } });
    await expect(logToolCall(job, { tool: 'site_pages', args: {} })).rejects.toMatchObject({ statusCode: 429 });
    await prisma.engineJob.update({ where: { id: job.id }, data: { status: 'done' } });
  });

  it('refuses the 41st analytics call for a client in a day, but not other tools or other clients', async () => {
    const seedCalls = Array.from({ length: MAX_ANALYTICS_PER_CLIENT_DAY }, () => ({
      job_id: '', task_id: a.taskId, conversation_id: a.conversationId, client_id: a.clientId, tool: 'ga4_report', args: {}, result_numbers: [] as string[],
    }));
    const job = await liveJob(a);
    // Earlier tests used two analytics calls for client A; fill up to exactly the cap.
    const already = await prisma.engineToolCall.count({ where: { client_id: a.clientId, tool: { in: ['ga4_report', 'search_console'] } } });
    await prisma.engineToolCall.createMany({ data: seedCalls.slice(0, MAX_ANALYTICS_PER_CLIENT_DAY - already).map((c) => ({ ...c, job_id: job.id })) });
    await expect(logToolCall(job, { tool: 'ga4_report', args: {} })).rejects.toMatchObject({ statusCode: 429 });
    await expect(logToolCall(job, { tool: 'search_console', args: {} })).rejects.toMatchObject({ statusCode: 429 });
    await prisma.engineJob.update({ where: { id: job.id }, data: { status: 'done' } });
    const jobB = await liveJob(b);
    // A different client is unaffected (its own job allowance is separate from the day count).
    await prisma.engineToolCall.deleteMany({ where: { job_id: jobB.id } });
    await expect(logToolCall(jobB, { tool: 'ga4_report', args: {} })).resolves.toBeTruthy();
    await prisma.engineJob.update({ where: { id: jobB.id }, data: { status: 'done' } });
  });
});
