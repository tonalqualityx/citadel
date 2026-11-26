// @vitest-environment node
/**
 * Waiting on someone (task 23cd54cf; Mike, 2026-11-26: "this needs to be marked waiting on someone and we need to ensure that
 * the Followup process works in a way that once Dan responds it unlocks my next steps"), against a real scratch Postgres through
 * the real routes. The VCDP shape: Mike's "Client Site Approval" card blocks the QA sweep and the go-live step on an
 * ordering-only project. Marked waiting on the client contact it leaves the waiting-on-me feed; the follow-up list finds it only
 * once the date passes; the yes (status done through PATCH /api/tasks/:id, what the email lane sends) opens both dependents.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { GET as getWaiting, PUT as putWaiting, PATCH as patchWaitingRoute, DELETE as deleteWaiting } from '@/app/api/tasks/[id]/waiting/route';
import { GET as listWaitingRoute } from '@/app/api/tasks/waiting/route';
import { GET as waitingOnMe } from '@/app/api/waiting-on-me/route';
import { GET as getTask, PATCH as patchTask } from '@/app/api/tasks/[id]/route';
import { makeFixture, type Fx } from '@/lib/dox/__tests__/fixture';

const authMock = requireAuth as Mock;
const BAST = BOT_USER_IDS[0];
const mike = (): AuthPayload => ({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@test', via: 'session' });
const worker = (): AuthPayload => ({ userId: BAST, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kb', lane: 'bast', laneEnforced: false });
const tech = (id: string): AuthPayload => ({ userId: id, role: 'tech', email: 't@test', via: 'session' });
const as = (a: AuthPayload) => authMock.mockResolvedValue(a);
const tp = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown, method = 'POST', url = 'http://localhost/api/x') =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

type FeedCard = { id: string };
async function feedIds(): Promise<string[]> {
  as(mike());
  const res = await waitingOnMe(req(undefined, 'GET', `http://localhost/api/waiting-on-me?user_id=${MIKE_USER_ID}`));
  expect(res.status).toBe(200);
  const body = await res.json();
  return [...body.do, ...body.review, ...body.waiting].map((c: FeedCard) => c.id);
}

async function statusOf(id: string) {
  return (await prisma.task.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}

describe.skipIf(!SCRATCH)('waiting on someone (real database)', () => {
  let fx: Fx;
  let projectId: string;
  let approval: string;
  let qa: string;
  let golive: string;
  let other: string;
  let contactId: string;
  let techId: string;

  beforeAll(async () => {
    fx = await makeFixture('wait');
    projectId = await fx.mkProject('Site build', { status: 'in_progress', dependencies_ordering_only: true });
    const due = new Date(Date.now() + 3 * 86400000);
    approval = await fx.mkTask('Client Site Approval', { project_id: projectId, status: 'not_started', assignee_id: MIKE_USER_ID, due_date: due });
    qa = await fx.mkTask('Pre-Launch QA Sweep', { project_id: projectId, status: 'blocked', blocked_by: { connect: [{ id: approval }] } });
    golive = await fx.mkTask('Point Production DNS & Give Go-Live', { project_id: projectId, status: 'blocked', assignee_id: MIKE_USER_ID, due_date: due, blocked_by: { connect: [{ id: approval }] } });
    other = await fx.mkTask('Another task of Mike due soon', { project_id: projectId, status: 'not_started', assignee_id: MIKE_USER_ID, due_date: due });
    contactId = (await prisma.clientContact.create({ data: { client_id: fx.clientId, name: `Dan ${fx.tag}`, email: `dan-${fx.tag}@example.test` } })).id;
    techId = await fx.mkStaff('Tess', 'tech');
  });

  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await prisma.task.updateMany({ where: { id: { in: fx.taskIds } }, data: { waiting_on_contact_id: null } });
    await prisma.clientContact.deleteMany({ where: { client_id: fx.clientId } });
    await fx.cleanup();
  });

  it('starts on Mike\'s feed, like any of his tasks due within two weeks', async () => {
    const ids = await feedIds();
    expect(ids).toContain(approval);
    expect(ids).toContain(other);
  });

  it('refuses a tech user, a mark with no person, and a mark naming both a contact and a user', async () => {
    as(tech(techId));
    expect((await putWaiting(req({ contact_id: contactId }, 'PUT'), tp(approval))).status).toBe(403);
    as(worker());
    expect((await putWaiting(req({ follow_up_at: '2026-12-04' }, 'PUT'), tp(approval))).status).toBe(400);
    expect((await putWaiting(req({ contact_id: contactId, user_id: MIKE_USER_ID }, 'PUT'), tp(approval))).status).toBe(400);
    expect((await putWaiting(req({ name: 'Dan', thread: 'not a thread' }, 'PUT'), tp(approval))).status).toBe(400);
  });

  it('marks the card waiting on the contact with a follow-up date, and the card leaves the feed', async () => {
    as(worker());
    const followUp = new Date(Date.now() + 2 * 86400000).toISOString();
    const res = await putWaiting(
      req({ contact_id: contactId, follow_up_at: followUp, thread: 'mike@becomeindelible.com:1a1ef5baa4830f9a', note: 'your approval of the new site' }, 'PUT'),
      tp(approval),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.waiting_on).toMatchObject({ name: `Dan ${fx.tag}`, contact_id: contactId, active: true, follow_up_due: false, thread: 'mike@becomeindelible.com:1a1ef5baa4830f9a' });
    const ids = await feedIds();
    expect(ids).not.toContain(approval);
    expect(ids).toContain(other);

    // The card read carries the mark, so the front session's list can drop it too.
    as(worker());
    const task = await (await getTask(req(undefined, 'GET'), tp(approval))).json();
    expect((task.task ?? task).waiting_on).toMatchObject({ contact_id: contactId, active: true });
  });

  it('is not on the follow-up list before the date, and is once the date passes; the card then returns to the feed', async () => {
    as(worker());
    let list = await (await listWaitingRoute(req(undefined, 'GET', 'http://localhost/api/tasks/waiting?due=1'))).json();
    expect(list.tasks.map((t: { id: string }) => t.id)).not.toContain(approval);
    list = await (await listWaitingRoute(req(undefined, 'GET', 'http://localhost/api/tasks/waiting'))).json();
    const row = list.tasks.find((t: { id: string }) => t.id === approval);
    expect(row.contact).toMatchObject({ id: contactId, email: `dan-${fx.tag}@example.test` });

    const past = new Date(Date.now() - 60000).toISOString();
    expect((await patchWaitingRoute(req({ follow_up_at: past }, 'PATCH'), tp(approval))).status).toBe(200);
    list = await (await listWaitingRoute(req(undefined, 'GET', 'http://localhost/api/tasks/waiting?due=1'))).json();
    expect(list.tasks.map((t: { id: string }) => t.id)).toContain(approval);
    expect(await feedIds()).toContain(approval);

    // The follow-up job records its send: off the due list, the date stays.
    as(worker());
    const sent = await (await patchWaitingRoute(req({ follow_up_sent_at: new Date().toISOString() }, 'PATCH'), tp(approval))).json();
    expect(sent.waiting_on.follow_up_sent_at).not.toBeNull();
    list = await (await listWaitingRoute(req(undefined, 'GET', 'http://localhost/api/tasks/waiting?due=1'))).json();
    expect(list.tasks.map((t: { id: string }) => t.id)).not.toContain(approval);

    // A new date is a new follow-up: the sent stamp resets and the card leaves the feed again.
    const later = new Date(Date.now() + 86400000).toISOString();
    const redated = await (await patchWaitingRoute(req({ follow_up_at: later }, 'PATCH'), tp(approval))).json();
    expect(redated.waiting_on).toMatchObject({ follow_up_sent_at: null, active: true });
    expect(await feedIds()).not.toContain(approval);
  });

  it('re-marking the same person keeps when the wait started', async () => {
    as(worker());
    const before = (await (await getWaiting(req(undefined, 'GET'), tp(approval))).json()).waiting_on.since;
    const again = await (await putWaiting(req({ contact_id: contactId, follow_up_at: '2026-12-04', thread: 'mike@becomeindelible.com:1a1ef5baa4830f9a' }, 'PUT'), tp(approval))).json();
    expect(again.waiting_on.since).toBe(before);
    // A bare date runs through the end of that day in Eastern time: midnight Dec 5 Eastern is 05:00 UTC.
    expect(again.waiting_on.follow_up_at).toBe('2026-12-05T05:00:00.000Z');
  });

  it("the person's yes (status done, as the email lane sends it) opens the QA sweep and the go-live step", async () => {
    expect(await statusOf(qa)).toBe('blocked');
    expect(await statusOf(golive)).toBe('blocked');
    as(worker());
    const res = await patchTask(req({ status: 'done' }, 'PATCH'), tp(approval));
    expect(res.status).toBe(200);
    expect(await statusOf(approval)).toBe('done');
    expect(await statusOf(qa)).toBe('not_started');
    expect(await statusOf(golive)).toBe('not_started');
    // A closed card is never "waiting": inactive, off the follow-up lists, and further marks are refused.
    as(worker());
    const w = (await (await getWaiting(req(undefined, 'GET'), tp(approval))).json()).waiting_on;
    expect(w.active).toBe(false);
    const list = await (await listWaitingRoute(req(undefined, 'GET', 'http://localhost/api/tasks/waiting'))).json();
    expect(list.tasks.map((t: { id: string }) => t.id)).not.toContain(approval);
    expect((await putWaiting(req({ name: 'Dan' }, 'PUT'), tp(approval))).status).toBe(409);
    // The go-live step is Mike's (due in three days) and now open: it is on his feed.
    expect(await feedIds()).toContain(golive);
  });

  it('DELETE takes the mark off and is idempotent', async () => {
    as(worker());
    expect((await putWaiting(req({ name: 'Lisa', follow_up_at: '2099-01-01' }, 'PUT'), tp(other))).status).toBe(200);
    expect(await feedIds()).not.toContain(other);
    as(worker());
    expect((await deleteWaiting(req(undefined, 'DELETE'), tp(other))).status).toBe(200);
    expect((await deleteWaiting(req(undefined, 'DELETE'), tp(other))).status).toBe(200);
    expect(await feedIds()).toContain(other);
    as(worker());
    expect((await patchWaitingRoute(req({ note: 'x' }, 'PATCH'), tp(other))).status).toBe(409);
  });
});
