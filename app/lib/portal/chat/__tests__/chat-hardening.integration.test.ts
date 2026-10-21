import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

process.env.PORTAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-uploads-test-'));

vi.mock('next/headers', async () => {
  const { auth } = await import('./harness/auth-state');
  return { headers: async () => new Headers(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}), cookies: async () => ({ get: () => undefined }) };
});
vi.mock('@/lib/services/client-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/services/client-auth')>();
  const { auth } = await import('./harness/auth-state');
  return { ...real, requireClientAuth: async () => auth.session };
});

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { auth } from './harness/auth-state';
import { cleanupStrays, seedWorld, cleanupWorld, type World } from './harness/world';
import { mintEngineKey } from './harness/run';
import { resetGateListsCache } from '@/lib/portal/chat/gate-context';
import { enqueueJob, claimNextJob, expireStaleJobs, heartbeatJob, LEASE_MS, HEARTBEAT_MS } from '@/lib/engine/queue';
import { POST as startRoute } from '@/app/api/portal/chat/route';
import { POST as messagesRoute } from '@/app/api/portal/chat/[id]/messages/route';
import { POST as claimRoute } from '@/app/api/engine/claim/route';
import { POST as completeRoute } from '@/app/api/engine/jobs/[id]/complete/route';
import { GET as quotaRoute } from '@/app/api/engine/jobs/[id]/tool-quota/route';
import { handOff, handBack } from '@/lib/portal/chat/handoff';
import { closeUnconfirmed, sweepUnconfirmed, UNCONFIRMED_FILE_HOURS, QUESTION_CLOSE_HOURS } from '@/lib/portal/chat/confirm';
import { stageUpload } from '@/lib/portal/chat/upload-service';

const req = (url = '/x', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const json = (o: unknown) => JSON.stringify(o);
const SEND = { method: 'POST' } as const;
const HOUR = 3600_000;

describe.skipIf(!SCRATCH)('chat hardening (real database)', () => {
  let key = { raw: '', id: '' };
  let w: World;

  const asOwner = () => {
    auth.session = { clientId: w.clientId, contactId: w.ownerId, contactIds: [w.ownerId], role: 'owner', email: w.email, sessionId: 's', moved: false };
    auth.bearer = null;
  };
  const accessOf = (contactId: string, role: 'owner' | 'viewer' = 'owner') => ({ contactId, contactIds: [contactId], clientId: w.clientId, role });
  async function start(text = 'Please add this picture to the website', extra: Record<string, unknown> = {}) {
    asOwner();
    const res = await startRoute(req('/x', { ...SEND, body: json({ intake_id: crypto.randomUUID(), client_ref: crypto.randomUUID(), text, ...extra }) }));
    return { res, body: await res.json() };
  }
  async function claim() {
    auth.bearer = key.raw;
    const r = await claimRoute(req('/x', { ...SEND, body: '{}' }));
    expect(r.status).toBe(200);
    return (await r.json()) as { job: { id: string } };
  }
  const complete = async (jobId: string, result: unknown) => {
    auth.bearer = key.raw;
    return completeRoute(req('/x', { ...SEND, body: json({ result, runs: [] }) }), ctx(jobId));
  };
  const reply = (text: string, actions: unknown[] = []) => ({ reply: text, actions, sources: [] });
  const ageThread = async (taskId: string, convoId: string, hours: number) => {
    const old = new Date(Date.now() - hours * HOUR);
    await prisma.comment.updateMany({ where: { task_id: taskId }, data: { created_at: old } });
    await prisma.chatConversation.update({ where: { id: convoId }, data: { updated_at: old } });
  };

  beforeAll(async () => {
    key = await mintEngineKey();
  });
  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { id: key.id } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await cleanupStrays();
    resetGateListsCache();
    w = await seedWorld({ sites: 1, role: 'owner', analytics: true, pages: [{ title: 'Home', path: '/' }, { title: 'Menu', path: '/menu/', sections: [{ key: 'prices', heading: 'Prices' }] }] });
    // A runner that claimed a job a minute ago is alive: a second queued job is then not read as a dead runner.
    await prisma.engineJob.create({ data: { type: 'chat_reply', status: 'done', client_id: w.clientId, claimed_at: new Date(Date.now() - 60_000), finished_at: new Date() } });
  });
  afterEach(async () => {
    await cleanupWorld(w);
    auth.session = null;
    auth.bearer = null;
  });

  // ---- 1. every client-visible model field is gated ---------------------------------------------

  describe('the gate covers every model-written field the client can see', () => {
    const summary = (over: Record<string, unknown>) => ({
      type: 'propose_summary', summary: 'Replace the photo on the Menu page.', request_type: 'site_change', site_id: '', change: 'Replace the photo.', attachment_ids: [], ...over,
    });

    async function refused(action: Record<string, unknown>, rule?: string, text = 'Add a photo') {
      const { body } = await start(text);
      const { job } = await claim();
      const before = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      const res = await complete(job.id, reply('Here is your request as I have it.', [{ ...action, site_id: action.site_id === '' ? w.sites[0].id : action.site_id }]));
      const out = await res.json();
      expect(res.status, JSON.stringify(out)).toBe(422);
      if (rule) expect(out.rule).toBe(rule);
      // Nothing was applied: the job is still claimed, the slots and the thread are untouched.
      expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('claimed');
      const after = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect(after.slots).toEqual(before.slots);
      expect(await prisma.comment.count({ where: { task_id: body.task_id, source: 'assistant' } })).toBe(0);
    }

    it('propose_summary.change with a promise is refused', async () => {
      await refused(summary({ change: 'Replace the photo, free of charge, by Friday.' }));
    });
    it('propose_summary.section with an approval word is refused', async () => {
      await refused(summary({ section: 'approved and covered' }), 'approval');
    });
    it('record.change with a price the client never wrote is refused', async () => {
      await refused({ type: 'record', attachment_ids: [], change: 'Do the work for $500.' });
    });
    it('record.page_text and record.section_text with a promise are refused', async () => {
      await refused({ type: 'record', attachment_ids: [], page_text: 'The page, done tomorrow' });
      await refused({ type: 'record', attachment_ids: [], section_text: 'a free section' });
    });
    it('an internal word or another client in a field is refused', async () => {
      await refused({ type: 'record', attachment_ids: [], change: 'Tag it needs-mike and tell the ticket owner.' });
      await refused({ type: 'record', attachment_ids: [], page_text: 'Bast said this page' });
    });

    it("the client's own sentence, verbatim, is theirs to say even with a price in it", async () => {
      const text = 'Please change the price on the menu to $20.';
      const { body } = await start(text);
      const { job } = await claim();
      const res = await complete(job.id, reply('Which part of the Menu page should change?', [{ type: 'record', attachment_ids: [], change: text }]));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect((convo.slots as { change: string }).change).toBe(text);
    });

    it('a paraphrase that drops the client number into the field unquoted is refused', async () => {
      await refused({ type: 'record', attachment_ids: [], change: 'Update the menu price to $20 as asked.' }, undefined, 'Please change the price on the menu to $20.');
    });

    it('the title on confirm is built from a gated change', async () => {
      const { body } = await start('Replace the photo on the Menu page');
      const { job } = await claim();
      const page = await prisma.sitePage.findFirstOrThrow({ where: { site_id: w.sites[0].id, title: 'Menu' } });
      const res = await complete(
        job.id,
        reply("Here's your request as I have it. Check it before it goes to the team.", [
          summary({ site_id: w.sites[0].id, page_id: page.id, change: 'Replace the photo on the Menu page.' }),
        ])
      );
      expect(res.status).toBe(200);
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect((convo.slots as { summary: { change: string } }).summary.change).toBe('Replace the photo on the Menu page.');
    });
  });

  // ---- 2. the chat-clarifying tag and the unconfirmed sweep -------------------------------------

  describe('chat-clarifying and walking away', () => {
    it('a handoff drops chat-clarifying (needs-mike parks it) and hand-back puts it back while unconfirmed', async () => {
      const { body } = await start('Help me');
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } })).tags).toContain('chat-clarifying');
      await handOff(convo.id, { reason: 'other', draft: '', say: 'A person on the team will read this and reply here.' });
      const parked = (await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } })).tags;
      expect(parked).toEqual(expect.arrayContaining(['needs-mike', 'chat-handoff']));
      expect(parked).not.toContain('chat-clarifying');
      expect(await handBack(body.task_id)).toBe(true);
      const back = (await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } })).tags;
      expect(back).toContain('chat-clarifying');
      expect(back).not.toContain('chat-handoff');
    });

    it('a hand-back of a confirmed request does not re-add chat-clarifying', async () => {
      const { body } = await start('Help me');
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      await prisma.chatConversation.update({ where: { id: convo.id }, data: { confirmed_at: new Date() } });
      await handOff(convo.id, { reason: 'other', draft: '', say: null });
      await handBack(body.task_id);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } })).tags).not.toContain('chat-clarifying');
    });

    it("pressing an urgent choice drops chat-clarifying so the parked emergency reaches the gate", async () => {
      const { body } = await start('Our site is down');
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect((convo.slots as { urgent_offered: boolean }).urgent_offered).toBe(true);
      await prisma.engineJob.updateMany({ where: { conversation_id: convo.id }, data: { status: 'expired' } });
      asOwner();
      const res = await messagesRoute(req('/x', { ...SEND, body: json({ client_ref: crypto.randomUUID(), choice: { slot: 'urgent', id: 'site_down' } }) }), ctx(convo.id));
      expect(res.status).toBe(201);
      const tags = (await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } })).tags;
      expect(tags).toEqual(expect.arrayContaining(['emergency', 'needs-mike']));
      expect(tags).not.toContain('chat-clarifying');
    });

    it('a request the client never confirmed is filed after 48 hours with what is known, and not before', async () => {
      const { body } = await start('Please swap the photo on the Menu page');
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      await prisma.engineJob.updateMany({ where: { conversation_id: convo.id }, data: { status: 'expired' } });
      await ageThread(body.task_id, convo.id, UNCONFIRMED_FILE_HOURS - 2);
      expect(await closeUnconfirmed(convo.id)).toBe('skipped');
      await ageThread(body.task_id, convo.id, UNCONFIRMED_FILE_HOURS + 1);
      expect(await closeUnconfirmed(convo.id)).toBe('filed_unconfirmed');

      const task = await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } });
      expect(task.tags).toEqual(expect.arrayContaining(['unconfirmed-chat', 'needs-mike', 'kind:other']));
      expect(task.tags).not.toContain('chat-clarifying');
      expect(task.title).toContain('Please swap the photo on the Menu page');
      const after = await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } });
      expect(after.state).toBe('filed');
      expect(after.confirmed_at).toBeNull();
      expect(task.client_intake).toMatchObject({ confirmed: false, unconfirmed: true });
      const comments = await prisma.comment.findMany({ where: { task_id: body.task_id } });
      expect(comments.some((c) => c.is_internal && c.content.includes('left the chat before sending this'))).toBe(true);
      // The client is not told "Request sent." for something they did not send.
      expect(comments.some((c) => !c.is_internal && c.content.includes('Request sent.'))).toBe(false);
      expect((await prisma.wait.findMany({ where: { task_id: body.task_id } })).length).toBeGreaterThan(0);
      // Idempotent.
      expect(await closeUnconfirmed(convo.id)).toBe('skipped');
      expect(await prisma.wait.count({ where: { task_id: body.task_id } })).toBeGreaterThan(0);
    });

    it('it files with the recorded summary when the model had proposed one', async () => {
      const { body } = await start('Replace the photo on the Menu page');
      const { job } = await claim();
      const page = await prisma.sitePage.findFirstOrThrow({ where: { site_id: w.sites[0].id, title: 'Menu' } });
      await complete(
        job.id,
        reply("Here's your request as I have it. Check it before it goes to the team.", [
          { type: 'propose_summary', summary: 'Replace the photo on the Menu page.', request_type: 'site_change', site_id: w.sites[0].id, page_id: page.id, change: 'Replace the photo on the Menu page.', attachment_ids: [] },
        ])
      );
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect(convo.state).toBe('confirming');
      await ageThread(body.task_id, convo.id, UNCONFIRMED_FILE_HOURS + 1);
      expect(await closeUnconfirmed(convo.id)).toBe('filed_unconfirmed');
      const task = await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } });
      expect(task.tags).toEqual(expect.arrayContaining(['kind:site-change', 'unconfirmed-chat']));
      expect(task.title).toMatch(/^Site change:/);
    });

    it('an answered question closes as done after a day, and is never filed', async () => {
      const { body } = await start('How many people visited last month?');
      const { job } = await claim();
      await complete(job.id, reply('I do not have that number. Would you like me to pass the question to the team?', [{ type: 'close_question' }]));
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      expect((convo.slots as { question_closed_at: string }).question_closed_at).toBeTruthy();
      expect(await closeUnconfirmed(convo.id)).toBe('skipped');
      await prisma.chatConversation.update({ where: { id: convo.id }, data: { slots: { ...(convo.slots as object), question_closed_at: new Date(Date.now() - (QUESTION_CLOSE_HOURS + 1) * HOUR).toISOString() } } });
      await prisma.comment.updateMany({ where: { task_id: body.task_id }, data: { created_at: new Date(Date.now() - (QUESTION_CLOSE_HOURS + 2) * HOUR) } });
      expect(await closeUnconfirmed(convo.id)).toBe('closed_question');
      const task = await prisma.task.findUniqueOrThrow({ where: { id: body.task_id } });
      expect(task.status).toBe('done');
      expect(task.tags).toEqual(expect.arrayContaining(['chat-question']));
      expect(task.tags).not.toContain('needs-mike');
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } })).state).toBe('closed');
      expect(await prisma.wait.count({ where: { task_id: body.task_id } })).toBe(0);
    });

    it('a conversation with a job in flight, or one with a person, is left alone', async () => {
      const { body } = await start('Please swap the photo');
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      await ageThread(body.task_id, convo.id, UNCONFIRMED_FILE_HOURS + 5);
      expect(await closeUnconfirmed(convo.id)).toBe('skipped'); // the job is still queued
      await prisma.engineJob.updateMany({ where: { conversation_id: convo.id }, data: { status: 'expired' } });
      await handOff(convo.id, { reason: 'other', draft: '', say: null });
      expect(await closeUnconfirmed(convo.id)).toBe('skipped');
    });

    it('sweepUnconfirmed finds the due conversations and reports what it did', async () => {
      const a = await start('Please swap the photo on the Menu page');
      const b = await start('Another request about the home page');
      const ca = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: a.body.task_id } });
      const cb = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: b.body.task_id } });
      await prisma.engineJob.updateMany({ where: { conversation_id: { in: [ca.id, cb.id] } }, data: { status: 'expired' } });
      await ageThread(a.body.task_id, ca.id, UNCONFIRMED_FILE_HOURS + 1);
      const counts = await sweepUnconfirmed();
      expect(counts.filed_unconfirmed).toBeGreaterThanOrEqual(1);
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: ca.id } })).state).toBe('filed');
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: cb.id } })).state).toBe('clarifying');
    });
  });

  // ---- 3. expiry only touches rows it actually expired ---------------------------------------------

  describe('expireStaleJobs', () => {
    async function convoWithJob(mode: 'model' | 'tree' = 'model') {
      const { body } = await start('Please swap the photo');
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      await prisma.chatConversation.update({ where: { id: convo.id }, data: { mode } });
      const job = await prisma.engineJob.findFirstOrThrow({ where: { conversation_id: convo.id } });
      return { convo, job };
    }

    it('leaves a fresh queued job and its conversation alone', async () => {
      const { convo } = await convoWithJob();
      expect(await expireStaleJobs(new Date(), { conversationId: convo.id })).toEqual([]);
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } })).mode).toBe('model');
    });

    it('expires a stale queued job, returns exactly it, and flips only that conversation', async () => {
      const { convo, job } = await convoWithJob();
      const other = await start('A second request');
      const otherConvo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: other.body.task_id } });
      await prisma.engineJob.update({ where: { id: job.id }, data: { queued_at: new Date(Date.now() - 61_000) } });
      expect(await expireStaleJobs(new Date(), { conversationId: convo.id })).toEqual([job.id]);
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } })).mode).toBe('tree');
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: otherConvo.id } })).mode).toBe('model');
    });

    it('the heartbeat race: a lease extended just before the check is not expired', async () => {
      const { convo } = await convoWithJob();
      await claim();
      const claimed = await prisma.engineJob.findFirstOrThrow({ where: { conversation_id: convo.id } });
      const lapseAt = new Date(claimed.lease_until!.getTime() + 1000);
      // Without a heartbeat the lease has lapsed at this instant...
      const probe = await prisma.engineJob.count({ where: { id: claimed.id, lease_until: { lt: lapseAt } } });
      expect(probe).toBe(1);
      // ...the heartbeat lands first, and the very same instant finds nothing to expire.
      expect((await heartbeatJob(claimed.id, new Date(claimed.lease_until!.getTime() - 5000))).ok).toBe(true);
      expect(await expireStaleJobs(lapseAt, { conversationId: convo.id })).toEqual([]);
      expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: claimed.id } })).status).toBe('claimed');
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } })).mode).toBe('model');
      // And once the extended lease really lapses, it expires.
      const later = new Date(claimed.lease_until!.getTime() + HEARTBEAT_MS + 1000);
      expect(await expireStaleJobs(later, { conversationId: convo.id })).toEqual([claimed.id]);
      expect(LEASE_MS).toBe(120_000);
    });

    it('a job that completed inside the window is never expired and never flips the conversation', async () => {
      const { convo, job } = await convoWithJob();
      await claim();
      expect((await complete(job.id, reply('Which page is it on?'))).status).toBe(200);
      const done = await prisma.engineJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(done.status).toBe('done');
      // Even when its old timestamps would make it look stale to a stale read.
      await prisma.engineJob.update({ where: { id: job.id }, data: { queued_at: new Date(Date.now() - 10 * 60_000), lease_until: new Date(Date.now() - 5 * 60_000) } });
      expect(await expireStaleJobs(new Date())).not.toContain(job.id);
      expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('done');
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } })).mode).toBe('model');
    });

    it('with nothing expired it never touches a conversation, scoped or not', async () => {
      const { convo } = await convoWithJob('tree');
      await prisma.chatConversation.update({ where: { id: convo.id }, data: { mode: 'model' } });
      await expireStaleJobs(new Date());
      await expireStaleJobs(new Date(), { conversationId: convo.id });
      expect((await prisma.chatConversation.findUniqueOrThrow({ where: { id: convo.id } })).mode).toBe('model');
    });

    it('two concurrent expirers expire a job once', async () => {
      const { job } = await convoWithJob();
      await prisma.engineJob.update({ where: { id: job.id }, data: { queued_at: new Date(Date.now() - 61_000) } });
      const [a, b] = await Promise.all([expireStaleJobs(new Date()), expireStaleJobs(new Date())]);
      expect([...a, ...b].filter((id) => id === job.id)).toHaveLength(1);
      void enqueueJob;
      void claimNextJob;
    });
  });

  // ---- 5. the preflight quota ---------------------------------------------------------------------

  describe('tool-quota preflight', () => {
    it('is 200 under the caps, 429 at 40 analytics calls a client a day, 409 for a dead job, 400 for a bad tool', async () => {
      const { body } = await start('How many visitors last month?');
      const { job } = await claim();
      const call = (tool: string) => quotaRoute(req(`/x?tool=${tool}`), ctx(job.id));
      expect((await call('ga4_report')).status).toBe(200);
      expect((await call('nope')).status).toBe(400);
      const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: body.task_id } });
      const earlier = await prisma.engineJob.create({ data: { type: 'chat_reply', status: 'done', client_id: w.clientId, conversation_id: convo.id } });
      await prisma.engineToolCall.createMany({
        data: Array.from({ length: 40 }, () => ({ job_id: earlier.id, conversation_id: convo.id, client_id: w.clientId, tool: 'ga4_report', args: {} })),
      });
      expect((await call('ga4_report')).status).toBe(429);
      expect((await call('search_console')).status).toBe(429);
      expect((await call('site_pages')).status).toBe(200); // not an analytics tool
      await prisma.engineJob.update({ where: { id: job.id }, data: { lease_until: new Date(Date.now() - 1000) } });
      expect((await call('site_pages')).status).toBe(409);
    });

    it('refuses a caller without the engine scope', async () => {
      const { body } = await start('x');
      void body;
      const { job } = await claim();
      auth.bearer = null;
      expect([401, 403]).toContain((await quotaRoute(req('/x?tool=ga4_report'), ctx(job.id))).status);
    });
  });

  // ---- 7. attachments belong to the person who staged them ----------------------------------------

  describe('attachments', () => {
    it("a file another contact of the same client staged cannot be sent as my message", async () => {
      const intake = crypto.randomUUID();
      const theirs = await stageUpload(accessOf(w.viewerId, 'viewer'), { buffer: PNG, name: 'theirs.png', intake_id: intake });
      asOwner();
      const res = await startRoute(req('/x', { ...SEND, body: json({ intake_id: intake, client_ref: crypto.randomUUID(), text: 'Add this', attachment_ids: [theirs.id] }) }));
      expect(res.status).toBe(400);
      expect(await prisma.chatConversation.count({ where: { intake_id: intake } })).toBe(0);
      const mine = await stageUpload(accessOf(w.ownerId), { buffer: PNG, name: 'mine.png', intake_id: intake });
      const ok = await startRoute(req('/x', { ...SEND, body: json({ intake_id: intake, client_ref: crypto.randomUUID(), text: 'Add this', attachment_ids: [mine.id] }) }));
      expect(ok.status).toBe(201);
    });

    it("the model can only name this conversation's files, and unsent ones only if the same person staged them", async () => {
      const a = await start('First request');
      const b = await start('Second request');
      const convoA = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: a.body.task_id } });
      const convoB = await prisma.chatConversation.findUniqueOrThrow({ where: { task_id: b.body.task_id } });
      // A sent file in conversation A, and in B: one staged by the owner (unsent), one by the viewer (unsent).
      const inA = await stageUpload(accessOf(w.ownerId), { buffer: PNG, name: 'a.png', conversation_id: convoA.id });
      const ownerUnsent = await stageUpload(accessOf(w.ownerId), { buffer: PNG, name: 'b1.png', conversation_id: convoB.id });
      const viewerUnsent = await stageUpload(accessOf(w.viewerId, 'viewer'), { buffer: PNG, name: 'b2.png', conversation_id: convoB.id });
      const unbound = await stageUpload(accessOf(w.ownerId), { buffer: PNG, name: 'loose.png', intake_id: crypto.randomUUID() });
      // Job for B (the second claimed is whichever is oldest; claim until it is B's).
      await prisma.engineJob.updateMany({ where: { conversation_id: convoA.id }, data: { status: 'expired' } });
      const { job } = await claim();
      expect((await prisma.engineJob.findUniqueOrThrow({ where: { id: job.id } })).conversation_id).toBe(convoB.id);
      const res = await complete(job.id, reply('Which page is it on?', [{ type: 'record', attachment_ids: [inA.id, ownerUnsent.id, viewerUnsent.id, unbound.id] }]));
      expect(res.status).toBe(200);
      const slots = (await prisma.chatConversation.findUniqueOrThrow({ where: { id: convoB.id } })).slots as { attachment_ids: string[] };
      expect(slots.attachment_ids).toEqual([ownerUnsent.id]);
      const errs = ((await prisma.engineJob.findUniqueOrThrow({ where: { id: job.id } })).action_errors as Array<{ error: string; detail: string }>).filter((e) => e.error === 'unknown_attachment').map((e) => e.detail);
      expect(errs.sort()).toEqual([inA.id, viewerUnsent.id, unbound.id].sort());
    });
  });
});
