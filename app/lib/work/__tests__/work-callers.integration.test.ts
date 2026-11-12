// @vitest-environment node
/**
 * The machine keys on the work routes, through the REAL key-to-auth path against a real Postgres. Only `next/headers` is replaced (it
 * supplies the Authorization header; there is no Next request scope in a test). requireAuth, authenticateApiKey, hashApiKey, laneScopesOf,
 * the Prisma lookup of the key row and the route handlers are all the real code. What this does NOT run: proxy.ts (it writes the
 * x-citadel-route header, which an unlaned key never reads). Production's oracle key has no lane: scope, so these keys carry none.
 * Also covers the security guard exemption on POST /api/email-asks/:id/create-task. Skips unless DATABASE_URL names localhost:55433.
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_callers_int npx vitest run lib/work/__tests__/work-callers.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const hdr = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => ({ get: (n: string) => hdr.headers[n.toLowerCase()] ?? null })),
}));

import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { ORACLE_SERVICE_EMAIL } from '@/lib/oracle/helpers';
import { GET as indexGet } from '@/app/api/oracle/work-index/route';
import { POST as linksPost } from '@/app/api/oracle/sessions/[id]/links/route';
import { POST as evidencePost } from '@/app/api/oracle/sessions/[id]/evidence/route';
import { POST as closePost } from '@/app/api/oracle/sessions/[id]/close-task/route';
import { POST as trackPost } from '@/app/api/oracle/sessions/[id]/track/route';
import { POST as stalePost } from '@/app/api/oracle/sessions/stale-asks/route';
import { POST as clocksPost } from '@/app/api/oracle/clocks/route';
import { GET as stateGet } from '@/app/api/work/[key]/state/route';
import { POST as attachPost } from '@/app/api/work/attach/route';
import { POST as workEvidencePost } from '@/app/api/work/evidence/route';
import { POST as createTaskPost } from '@/app/api/email-asks/[id]/create-task/route';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('work routes through the real key-to-auth path', () => {
  const tag = `wc-${Date.now()}`;
  const keys = { bast: `ck_${tag}_bast`, bastLaned: `ck_${tag}_bastlaned`, oracle: `ck_${tag}_oracle`, other: `ck_${tag}_other`, courier: `ck_${tag}_courier`, admin: `ck_${tag}_admin` };
  const userIds: string[] = [];
  let createdOracleUser = false;
  let createdBastUser = false;
  let bastUserId = '';
  let createdOwnerId = '';
  let oracleUserId = '';
  let adminId = '';
  let openTaskId = '';
  const taskIds: string[] = [];
  const as = (k: keyof typeof keys, extra: Record<string, string> = {}) => {
    hdr.headers = { authorization: `Bearer ${keys[k]}`, ...extra };
  };
  const jreq = (url: string, method: string, body: unknown = {}) => new NextRequest(`http://localhost:3000${url}`, { method, body: method === 'GET' ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const sid = (s: string) => ({ params: Promise.resolve({ id: s }) });

  const mkKey = async (userId: string, raw: string, scopes: string[] = []) => {
    await prisma.apiKey.create({ data: { user_id: userId, name: raw, key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 12), scopes } });
  };

  beforeAll(async () => {
    const existing = await prisma.user.findUnique({ where: { email: ORACLE_SERVICE_EMAIL } });
    if (existing) oracleUserId = existing.id;
    else {
      oracleUserId = randomUUID();
      createdOracleUser = true;
      await prisma.user.create({ data: { id: oracleUserId, email: ORACLE_SERVICE_EMAIL, password_hash: 'x', name: 'Oracle WC', role: 'pm' } });
    }
    // the route's default assignee
    if (!(await prisma.user.findUnique({ where: { email: 'mike@becomeindelible.com' } }))) {
      createdOwnerId = randomUUID();
      await prisma.user.create({ data: { id: createdOwnerId, email: 'mike@becomeindelible.com', password_hash: 'x', name: 'Owner WC', role: 'admin' } });
    }
    const bastExisting = await prisma.user.findUnique({ where: { email: 'bast@becomeindelible.com' } });
    if (bastExisting) bastUserId = bastExisting.id;
    else {
      bastUserId = randomUUID();
      createdBastUser = true;
      await prisma.user.create({ data: { id: bastUserId, email: 'bast@becomeindelible.com', password_hash: 'x', name: 'Bast WC', role: 'pm' } });
    }
    const otherId = randomUUID();
    adminId = randomUUID();
    await prisma.user.createMany({
      data: [
        { id: otherId, email: `bastlike-${tag}@example.test`, password_hash: 'x', name: 'Other WC', role: 'pm' },
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WC', role: 'admin' },
      ],
    });
    userIds.push(otherId, adminId);
    await mkKey(oracleUserId, keys.oracle); // no lane: scope, as in production
    await mkKey(otherId, keys.other); // another service user, no lane
    await mkKey(oracleUserId, keys.courier, ['lane:courier']); // a different lane
    await mkKey(adminId, keys.admin);
    await mkKey(bastUserId, keys.bast); // no lane: scope, as in production
    await mkKey(bastUserId, keys.bastLaned, ['lane:courier']);
    const t = await prisma.task.create({ data: { title: `Open work ${tag}`, status: 'in_progress', assignee_id: adminId, tags: [] } as never });
    openTaskId = t.id;
    taskIds.push(t.id);
  });

  afterAll(async () => {
    const asks = await prisma.emailAsk.findMany({ where: { message_id: { startsWith: tag } }, select: { id: true, task_id: true } });
    for (const a of asks) if (a.task_id && !taskIds.includes(a.task_id)) taskIds.push(a.task_id);
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.workEvidence.deleteMany({ where: { target_key: { in: taskIds.map((i) => `task:${i}`) } } });
    await prisma.workLink.deleteMany({ where: { target_key: { in: taskIds.map((i) => `task:${i}`) } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: [...userIds, oracleUserId, createdOwnerId || adminId] } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.apiKey.deleteMany({ where: { name: { startsWith: `ck_${tag}` } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (createdOwnerId) await prisma.user.deleteMany({ where: { id: createdOwnerId } });
    if (createdOracleUser) await prisma.user.deleteMany({ where: { id: oracleUserId } });
    if (createdBastUser) await prisma.user.deleteMany({ where: { id: bastUserId } });
    await prisma.$disconnect();
  });

  const sessionRoutes: Array<[string, () => Promise<Response>]> = [
    ['work-index', () => indexGet(jreq('/api/oracle/work-index', 'GET'))],
    ['links', () => linksPost(jreq('/api/oracle/sessions/s1/links', 'POST'), sid('s1'))],
    ['evidence', () => evidencePost(jreq('/api/oracle/sessions/s1/evidence', 'POST'), sid('s1'))],
    ['close-task', () => closePost(jreq('/api/oracle/sessions/s1/close-task', 'POST'), sid('s1'))],
    ['track', () => trackPost(jreq('/api/oracle/sessions/s1/track', 'POST'), sid('s1'))],
    ['stale-asks', () => stalePost(jreq('/api/oracle/sessions/stale-asks', 'POST'))],
    // Work stage F: the clocks the session hooks post
    ['clocks', () => clocksPost(jreq('/api/oracle/clocks', 'POST'))],
  ];

  describe('an unlaned oracle service user key (as production has it)', () => {
    it.each(sessionRoutes)('passes auth on the %s route (an empty body then fails validation, 400, never 401 or 403)', async (name, call) => {
      as('oracle');
      const res = await call();
      expect([401, 403]).not.toContain(res.status);
      if (name !== 'work-index' && name !== 'stale-asks') expect(res.status).toBe(400);
    });

    it('reads the work index (200) and a task state (200)', async () => {
      as('oracle');
      expect((await indexGet(jreq('/api/oracle/work-index', 'GET'))).status).toBe(200);
      const res = await stateGet(jreq('/x', 'GET'), { params: Promise.resolve({ key: `task:${openTaskId}` }) });
      expect(res.status).toBe(200);
    });

    it('passes auth on attach and work evidence (400 on an empty body)', async () => {
      as('oracle');
      expect((await attachPost(jreq('/api/work/attach', 'POST'))).status).toBe(400);
      expect((await workEvidencePost(jreq('/api/work/evidence', 'POST'))).status).toBe(400);
    });
  });

  describe('Work stage F: the clocks, posted by the unlaned oracle service key', () => {
    it('the real key-to-auth path accepts the unlaned key, saves a row for the owner, and refuses the other service user and a courier-lane key', async () => {
      const ownerSettings = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
      await prisma.userPreference.upsert({ where: { user_id: adminId }, create: { user_id: adminId, home_view: 'home', timezone: 'America/New_York' }, update: { home_view: 'home' } });
      await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
      const dedupe = `${tag}-clock`;
      const started = new Date(Date.now() - 3 * 3_600_000);
      const row = { kind: 'bast_run', target_key: `task:${openTaskId}`, session_external_id: `sess-${tag}`, source: 'citadel-worker', started_at: started.toISOString(), ended_at: new Date(started.getTime() + 20 * 60_000).toISOString(), minutes: 20, cost_usd: 1.25, model: 'sonnet', basis: 'worker pass', dedupe_key: dedupe };
      try {
        as('oracle');
        const ok = await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows: [row] }));
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ result: 'saved', created: 1, updated: 0, refused: [] });
        expect(await prisma.workClock.findUniqueOrThrow({ where: { dedupe_key: dedupe } })).toMatchObject({ kind: 'bast_run', task_id: openTaskId, user_id: null, time_entry_id: null });
        expect(await prisma.timeEntry.count({ where: { task_id: openTaskId } })).toBe(0);
        as('other');
        expect((await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows: [{ ...row, dedupe_key: `${dedupe}-2` }] }))).status).toBe(403);
        as('courier', { 'x-citadel-route': 'POST /api/oracle/clocks' });
        expect((await clocksPost(jreq('/api/oracle/clocks', 'POST', { rows: [{ ...row, dedupe_key: `${dedupe}-3` }] }))).status).toBe(403);
        expect(await prisma.workClock.count({ where: { dedupe_key: { startsWith: dedupe } } })).toBe(1);
      } finally {
        await prisma.workClock.deleteMany({ where: { dedupe_key: { startsWith: dedupe } } });
        if (ownerSettings) await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: ownerSettings.owner_user_id } });
        else await prisma.bastChatSettings.deleteMany({ where: { id: 1 } });
        await prisma.userPreference.deleteMany({ where: { user_id: adminId } });
      }
    });
  });

  describe('the Bast service user unlaned key (as production has it)', () => {
    const stateKey = () => ({ params: Promise.resolve({ key: `task:${openTaskId}` }) });
    it('reads a task state (200) through the real key-to-auth path', async () => {
      as('bast');
      expect((await stateGet(jreq('/x', 'GET'), stateKey())).status).toBe(200);
    });
    it('is refused where the lane list has no bast (session routes, attach), and a courier-laned Bast key is refused on state', async () => {
      as('bast');
      expect((await trackPost(jreq('/api/oracle/sessions/s1/track', 'POST'), sid('s1'))).status).toBe(403);
      expect((await attachPost(jreq('/api/work/attach', 'POST'))).status).toBe(403);
      as('bastLaned', { 'x-citadel-route': 'GET /api/work/task:x/state' });
      expect((await stateGet(jreq('/x', 'GET'), stateKey())).status).toBe(403);
    });
    it('another service user unlaned key is refused on state', async () => {
      as('other');
      expect((await stateGet(jreq('/x', 'GET'), stateKey())).status).toBe(403);
    });
  });

  describe('everything else is still refused', () => {
    it.each(sessionRoutes)('an unlaned key of another service user: 403 on the %s route', async (_n, call) => {
      as('other');
      expect((await call()).status).toBe(403);
    });
    it('a key with a different lane (courier, shadow mode) is refused on the oracle session routes and on attach', async () => {
      as('courier', { 'x-citadel-route': 'POST /api/oracle/sessions/s1/track' });
      expect((await trackPost(jreq('/api/oracle/sessions/s1/track', 'POST'), sid('s1'))).status).toBe(403);
      as('courier', { 'x-citadel-route': 'POST /api/work/attach' });
      expect((await attachPost(jreq('/api/work/attach', 'POST'))).status).toBe(403);
    });
  });

  describe('security mail and the already-tracked guard (POST /api/email-asks/:id/create-task)', () => {
    const mkAsk = async (suffix: string, over: Record<string, unknown>) =>
      prisma.emailAsk.create({
        data: { message_id: `${tag}-${suffix}`, thread_id: `${tag}-th`, account: 'mike@becomeindelible.com', from_name: 'Provider', from_email: `p-${tag}@provider.test`, subject: 'Notice', gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', received_at: new Date(), deep_link: `https://mail.google.com/mail/u/0/#all/${tag}-${suffix}`, ...over } as never,
      });
    const create = async (id: string) => {
      as('admin');
      const res = await createTaskPost(jreq(`/api/email-asks/${id}/create-task`, 'POST'), { params: Promise.resolve({ id }) });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };

    it('a security-worded, non-urgent ask whose conversation is linked to an ordinary open task creates a task tagged security; an ordinary ask in the same state is answered already_tracked', async () => {
      // the conversation is carried by an ordinary open task through an earlier ask on the same thread
      await mkAsk('first', { task_id: openTaskId, conversation_key: `${tag}-conv` });
      const sec = await mkAsk('sec', { subject: 'Security alert: unusual sign-in on your hosting account', gist: 'Provider notice', conversation_key: `${tag}-conv` });
      const plain = await mkAsk('plain', { subject: 'Invoice question', gist: 'About the invoice', conversation_key: `${tag}-conv` });

      const ordinary = await create(plain.id);
      expect(ordinary.status).toBe(200);
      expect(ordinary.body.already_tracked).toBe(true);

      const made = await create(sec.id);
      expect(made.status).toBe(201);
      expect(made.body.already_tracked).toBeUndefined();
      const row = await prisma.task.findFirstOrThrow({ where: { source: 'email', source_ref: `${tag}-sec` } });
      taskIds.push(row.id);
      expect(row.tags).toEqual(['security']);
    });
  });
});
