// @vitest-environment node
/**
 * start_project and start_quote against a real Postgres: the rows they write, the one transaction, Undo and its refusals.
 * Runs only on a local scratch database (the name must contain "scratch"):
 *   DATABASE_URL='postgresql://citadel:citadel@localhost:55433/<scratch db>' npx vitest run lib/bast-chat/ops/__tests__/start.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '../../gate-mirror';
import { undoAction } from '../../actions';
import { getRunnableOp } from '..';
import { applyChatOp } from '../apply';

const URL = process.env.DATABASE_URL ?? '';
const RUN = /scratch/i.test(URL) && /localhost|127\.0\.0\.1/.test(URL);
const CAP = 1_000_000;

describe.skipIf(!RUN)('start_project and start_quote (real database)', () => {
  const tag = `start-${Date.now()}`;
  const ownerId = randomUUID();
  let conversationId = '';
  let clientId = '';
  let siteId = '';

  const apply = (name: string, rawInput: object, conv = conversationId) =>
    applyChatOp({ ownerId, conversationId: conv, op: getRunnableOp(name)!, rawInput, dailyWriteCap: CAP, now: new Date(), db: prisma });
  const applied = async (name: string, rawInput: object) => {
    const r = await apply(name, rawInput);
    if (r.kind !== 'applied') throw new Error('expected applied');
    return r;
  };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner Start', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast Start', role: 'pm' } });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: ownerId, enabled: true, daily_write_cap: CAP }, create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: CAP } });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
    clientId = (await prisma.client.create({ data: { name: `Jill's Cafe ${tag}` } })).id;
    siteId = (await prisma.site.create({ data: { name: `jillscafe-${tag}.test`, client_id: clientId } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('start_project: a hidden queue project and a kickoff task for the owner, no project on the task, one record', async () => {
    const r = await applied('start_project', { client_id: clientId, what: 'Rebuild the menu pages', message: 'Start a project for Jill to rebuild the menu pages.' });
    expect(r.run.summary).toContain('It is hidden from the client until you say it is live.');
    const res = r.run.result as { project_id: string; task_id: string; client_created: boolean; site_id: string };
    expect(res.client_created).toBe(false);
    expect(res.site_id).toBe(siteId); // the client's only site
    const p = await prisma.project.findUniqueOrThrow({ where: { id: res.project_id } });
    expect(p).toMatchObject({ status: 'queue', type: 'project', client_id: clientId, site_id: siteId, created_by_id: BAST_USER_ID, name: 'Rebuild the menu pages' });
    expect(p.billing_type).toBeNull();
    expect(p.budget_amount).toBeNull();
    expect(p.hourly_rate).toBeNull();
    expect(p.plan_folder).toBeNull();
    const t = await prisma.task.findUniqueOrThrow({ where: { id: res.task_id } });
    expect(t).toMatchObject({ title: 'Kick off Rebuild the menu pages', status: 'not_started', assignee_id: ownerId, client_id: clientId, site_id: siteId, project_id: null, due_date: null, created_by_id: BAST_USER_ID });
    expect(t.tags).toEqual(['from-chat', 'kickoff']);
    expect((t.requirements as { text: string }[]).map((i) => i.text)).toHaveLength(3);
    expect(t.description).toContain(res.project_id);
    expect(t.description).toContain('Start a project for Jill to rebuild the menu pages.');
    const rec = await prisma.bastChatAction.findUniqueOrThrow({ where: { id: r.row.id } });
    expect(rec).toMatchObject({ tool: 'start_project', target_type: 'project_start', target_id: res.project_id, status: 'applied' });
    expect(rec.undo_until).not.toBeNull();
  });

  it('start_project with a new client: the client is made with its name only; a second with the same name is refused and writes nothing', async () => {
    const name = `Harbor Dental ${tag}`;
    const r = await applied('start_project', { new_client: name, what: 'Build a new site', message: 'new client please' });
    expect(r.run.summary).toContain(`Added ${name} as a new client.`);
    const c = await prisma.client.findFirstOrThrow({ where: { name } });
    expect(c).toMatchObject({ status: 'active', email: null, hourly_rate: null, retainer_hours: null });
    const before = await prisma.project.count({ where: { client_id: c.id } });
    await expect(apply('start_project', { new_client: name.toLowerCase(), what: 'again', message: 'again' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.project.count({ where: { client_id: c.id } })).toBe(before);
    expect(await prisma.client.count({ where: { name: { equals: name, mode: 'insensitive' } } })).toBe(1);
  });

  it('one transaction: when the chat record fails, nothing the op wrote stays', async () => {
    const name = `Rolled Back ${tag}`;
    await expect(apply('start_project', { new_client: name, what: 'x', message: 'x' }, randomUUID())).rejects.toBeTruthy();
    expect(await prisma.client.count({ where: { name } })).toBe(0);
    expect(await prisma.project.count({ where: { name: 'x' } })).toBe(0);
  });

  it('Undo of start_project cancels the project, abandons the task, keeps the new client, and cannot run twice', async () => {
    const name = `Undo Client ${tag}`;
    const r = await applied('start_project', { new_client: name, what: 'Undo me', message: 'm' });
    const res = r.run.result as { project_id: string; task_id: string };
    const v = await undoAction(r.row.id, ownerId, new Date(), prisma);
    expect(v.status).toBe('undone');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: res.project_id } })).status).toBe('cancelled');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: res.task_id } })).status).toBe('abandoned');
    expect(await prisma.client.count({ where: { name } })).toBe(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: res.project_id } })).is_deleted).toBe(false);
    await expect(undoAction(r.row.id, ownerId, new Date(), prisma)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('Undo of start_project is refused once the project moved on or the task started, and changes nothing', async () => {
    const a = await applied('start_project', { client_id: clientId, what: 'Moved on', message: 'm' });
    const ar = a.run.result as { project_id: string; task_id: string };
    await prisma.project.update({ where: { id: ar.project_id }, data: { status: 'ready' } });
    await expect(undoAction(a.row.id, ownerId, new Date(), prisma)).rejects.toMatchObject({ statusCode: 409, message: 'Changed since. Open the project.' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ar.task_id } })).status).toBe('not_started');

    const b = await applied('start_project', { client_id: clientId, what: 'Started task', message: 'm' });
    const br = b.run.result as { project_id: string; task_id: string };
    await prisma.task.update({ where: { id: br.task_id }, data: { status: 'in_progress' } });
    await expect(undoAction(b.row.id, ownerId, new Date(), prisma)).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: br.project_id } })).status).toBe('queue');

    const c = await applied('start_project', { client_id: clientId, what: 'Something waits', message: 'm' });
    const cr = c.run.result as { project_id: string; task_id: string };
    const waiting = await prisma.task.create({ data: { title: `waits ${tag}`, assignee_id: ownerId, blocked_by: { connect: { id: cr.task_id } } } });
    await expect(undoAction(c.row.id, ownerId, new Date(), prisma)).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: cr.task_id } })).status).toBe('not_started');
    expect(waiting.id).toBeTruthy();
  });

  it('start_quote from an email card: a lead deal with the sender read on the server, a pricing task, no Proposal, no value', async () => {
    const ask = await prisma.emailAsk.create({
      data: { message_id: `msg-${tag}`, thread_id: `thread-${tag}`, account: 'mike@becomeindelible.com', from_name: 'Andy Honeycutt', from_email: `andy-${tag}@example.test`, subject: 'Second location page', deep_link: `https://mail.google.com/mail/u/0/#inbox/thread-${tag}`, received_at: new Date() },
    });
    const proposalsBefore = await prisma.proposal.count();
    const r = await applied('start_quote', { email_ask_id: ask.id, what: 'second location page', message: 'quote this' });
    expect(r.run.summary).toBe('Started a quote for Andy Honeycutt: second location page. Nothing is priced or sent.');
    const res = r.run.result as { deal_id: string; task_id: string };
    const d = await prisma.accord.findUniqueOrThrow({ where: { id: res.deal_id } });
    expect(d).toMatchObject({ status: 'lead', owner_id: ownerId, client_id: null, lead_name: 'Andy Honeycutt', lead_email: `andy-${tag}@example.test`, name: 'Andy Honeycutt: second location page', notes: 'quote this' });
    expect(d.total_value).toBeNull();
    expect(await prisma.proposal.count()).toBe(proposalsBefore);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: res.task_id } });
    expect(t).toMatchObject({ title: 'Price second location page for Andy Honeycutt', assignee_id: ownerId, accord_id: res.deal_id, project_id: null, status: 'not_started' });
    expect(t.tags).toEqual(['from-chat', 'quote']);
    expect((t.requirements as { text: string }[]).map((i) => i.text)).toContain('Put the same draft, unsent, in Gmail on the thread');
    expect(t.description).toContain(`Thread id: thread-${tag}`);
    expect(t.description).toContain('Second location page');
    expect(t.description).toContain(`https://mail.google.com/mail/u/0/#inbox/thread-${tag}`);
    expect(await prisma.project.count({ where: { status: 'quote', client_id: clientId } })).toBe(0);
    const rec = await prisma.bastChatAction.findUniqueOrThrow({ where: { id: r.row.id } });
    expect(rec).toMatchObject({ tool: 'start_quote', target_type: 'quote_start', target_id: res.deal_id });

    const v = await undoAction(r.row.id, ownerId, new Date(), prisma);
    expect(v.status).toBe('undone');
    const lost = await prisma.accord.findUniqueOrThrow({ where: { id: res.deal_id } });
    expect(lost).toMatchObject({ status: 'lost', rejection_reason: 'Started by mistake from the chat', is_deleted: false });
    expect(lost.lost_at).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: res.task_id } })).status).toBe('abandoned');
  });

  it('start_quote for a client: Undo is refused once the deal left lead, and nothing changes', async () => {
    const r = await applied('start_quote', { client_id: clientId, what: 'new menu', message: 'quote' });
    const res = r.run.result as { deal_id: string; task_id: string };
    await prisma.accord.update({ where: { id: res.deal_id }, data: { status: 'meeting' } });
    await expect(undoAction(r.row.id, ownerId, new Date(), prisma)).rejects.toMatchObject({ statusCode: 409, message: 'Changed since. Open the deal.' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: res.task_id } })).status).toBe('not_started');
  });
});
