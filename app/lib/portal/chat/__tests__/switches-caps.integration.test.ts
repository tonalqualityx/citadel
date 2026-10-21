import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { cleanup, SCRATCH, seedClient, type Seeded } from '@/lib/engine/__tests__/seed';
import { enqueueJob, claimNextJob } from '@/lib/engine/queue';
import { CAPS, checkCaps, daySince } from '../caps';
import { chatAvailability, getChatSettings, runnerState, updateChatSettings } from '../switches';

// Phase C slice C1: the switches (9.1) and caps (9.3), counted in the database.
describe.skipIf(!SCRATCH)('chat switches and caps (real database)', () => {
  const tag = `s${Date.now()}`;
  let a: Seeded;
  let before: Awaited<ReturnType<typeof getChatSettings>>;

  beforeAll(async () => {
    before = await getChatSettings();
    a = await seedClient(`${tag}a`);
  });
  afterAll(async () => {
    await updateChatSettings({ mode: before.mode, pilot_contact_ids: before.pilot_contact_ids, daily_cap_usd: before.daily_cap_usd });
    await cleanup([a]);
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    // A clean slate for queue-derived state; other tests in this database cleaned up after themselves.
    await prisma.engineRun.deleteMany({ where: { job: { client_id: a.clientId } } });
    await prisma.engineToolCall.deleteMany({ where: { client_id: a.clientId } });
    await prisma.engineJob.deleteMany({ where: { client_id: a.clientId } });
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { jobs_count: 0 } });
    await prisma.site.update({ where: { id: a.siteId }, data: { portal_chat_enabled: true } });
    await updateChatSettings({ mode: 'on', pilot_contact_ids: [], daily_cap_usd: 30 });
  });

  const ask = (now?: Date) => chatAvailability({ contactId: a.ownerId, clientId: a.clientId, siteId: a.siteId, conversationId: a.conversationId, now });

  it('off means off', async () => {
    await updateChatSettings({ mode: 'off' });
    expect(await ask()).toEqual({ available: false, reason: 'mode_off' });
  });

  it('pilot admits only pilot contacts', async () => {
    await updateChatSettings({ mode: 'pilot', pilot_contact_ids: [a.viewerId] });
    expect(await ask()).toEqual({ available: false, reason: 'not_pilot' });
    await updateChatSettings({ pilot_contact_ids: [a.ownerId] });
    expect(await ask()).toEqual({ available: true });
  });

  it('on needs the site switch: the named site, or any site before one is chosen', async () => {
    expect(await ask()).toEqual({ available: true });
    await prisma.site.update({ where: { id: a.siteId }, data: { portal_chat_enabled: false } });
    expect(await ask()).toEqual({ available: false, reason: 'site_off' });
    expect(await chatAvailability({ contactId: a.ownerId, clientId: a.clientId })).toEqual({ available: false, reason: 'site_off' });
    const other = await prisma.site.create({ data: { name: `${tag} other`, client_id: a.clientId, portal_chat_enabled: true } });
    expect(await chatAvailability({ contactId: a.ownerId, clientId: a.clientId })).toEqual({ available: true });
    expect(await ask()).toEqual({ available: false, reason: 'site_off' });
    await prisma.site.delete({ where: { id: other.id } });
  });

  it('a site of another client does not count', async () => {
    const stranger = await prisma.client.create({ data: { name: `Stranger ${tag}`, type: 'direct', status: 'active' } });
    const s = await prisma.site.create({ data: { name: `${tag} stranger`, client_id: stranger.id, portal_chat_enabled: true } });
    expect(await chatAvailability({ contactId: a.ownerId, clientId: a.clientId, siteId: s.id })).toEqual({ available: false, reason: 'site_off' });
    await prisma.site.delete({ where: { id: s.id } });
    await prisma.client.delete({ where: { id: stranger.id } });
  });

  it('a dead runner turns new conversations to tree mode at once; a quiet runner does not', async () => {
    // Quiet: no jobs at all.
    expect((await runnerState()).dead).toBe(false);
    // A job waited unclaimed and expired inside the last ten minutes, and nothing was ever claimed.
    await prisma.engineJob.updateMany({ where: {}, data: { claimed_at: null } });
    await prisma.engineJob.create({ data: { type: 'chat_reply', status: 'expired', client_id: a.clientId, conversation_id: a.conversationId, expired_at: new Date(), queued_at: new Date(Date.now() - 70_000) } });
    const state = await runnerState();
    expect(state.dead).toBe(true);
    expect(await ask()).toEqual({ available: false, reason: 'runner_down' });
    // A claim in the last ten minutes means the runner is alive.
    await prisma.engineJob.create({ data: { type: 'chat_reply', status: 'done', client_id: a.clientId, conversation_id: a.conversationId, claimed_at: new Date(), queued_at: new Date() } });
    expect((await runnerState()).dead).toBe(false);
    expect(await ask()).toEqual({ available: true });
  });

  it('caps: conversation, contact and client job counts', async () => {
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { jobs_count: CAPS.jobs_per_conversation } });
    expect(await checkCaps({ conversationId: a.conversationId, contactId: a.ownerId, clientId: a.clientId })).toEqual({ ok: false, reason: 'conversation_jobs' });
    await prisma.chatConversation.update({ where: { id: a.conversationId }, data: { jobs_count: 0 } });

    const mk = (n: number) => Array.from({ length: n }, () => ({ type: 'chat_reply', status: 'done' as const, client_id: a.clientId, contact_id: a.ownerId, conversation_id: a.conversationId }));
    await prisma.engineJob.createMany({ data: mk(CAPS.jobs_per_contact_day) });
    expect(await checkCaps({ contactId: a.ownerId, clientId: a.clientId })).toEqual({ ok: false, reason: 'contact_jobs' });
    // The same jobs under another contact count against the client, not that contact.
    expect(await checkCaps({ contactId: a.viewerId, clientId: a.clientId })).toEqual({ ok: true });
    await prisma.engineJob.createMany({ data: mk(CAPS.jobs_per_client_day - CAPS.jobs_per_contact_day).map((j) => ({ ...j, contact_id: a.viewerId })) });
    expect(await checkCaps({ contactId: a.viewerId, clientId: a.clientId })).toEqual({ ok: false, reason: 'client_jobs' });
  });

  it('caps: per-client and overall spend come from EngineRun rows, and age out after a day', async () => {
    const job = await prisma.engineJob.create({ data: { type: 'chat_reply', status: 'done', client_id: a.clientId, contact_id: a.ownerId, conversation_id: a.conversationId } });
    await prisma.engineRun.create({ data: { job_id: job.id, attempt: 1, model: 'claude-opus-5-5', prompt_hash: 'h', cost_usd: 2.9 } });
    expect(await checkCaps({ contactId: a.ownerId, clientId: a.clientId })).toEqual({ ok: true });
    await prisma.engineRun.create({ data: { job_id: job.id, attempt: 2, model: 'claude-opus-5-5', prompt_hash: 'h', cost_usd: 0.2 } });
    expect(await checkCaps({ contactId: a.ownerId, clientId: a.clientId })).toEqual({ ok: false, reason: 'client_spend' });
    // Two days on, the day's spend is gone.
    expect(await checkCaps({ contactId: a.ownerId, clientId: a.clientId, now: new Date(Date.now() + 49 * 3600_000) })).toEqual({ ok: true });
    // The overall cap is a setting.
    await updateChatSettings({ daily_cap_usd: 1 });
    await prisma.engineRun.deleteMany({ where: { job_id: job.id } });
    await prisma.engineRun.create({ data: { job_id: job.id, attempt: 1, model: 'claude-opus-5-5', prompt_hash: 'h', cost_usd: 1.5 } });
    const other = await checkCaps({ contactId: a.viewerId, clientId: a.clientId });
    expect(other).toEqual({ ok: false, reason: 'overall_spend' });
    expect(daySince(new Date('2026-10-22T00:00:00Z')).toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('settings round-trip', async () => {
    const s = await updateChatSettings({ mode: 'pilot', pilot_contact_ids: [a.ownerId], daily_cap_usd: 12.5 });
    expect(s).toEqual({ mode: 'pilot', pilot_contact_ids: [a.ownerId], daily_cap_usd: 12.5 });
    void enqueueJob;
    void claimNextJob;
  });
});
