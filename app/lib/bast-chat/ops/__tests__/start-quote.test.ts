/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));

import { getRunnableOp } from '..';
import { BAST_USER_ID } from '../../gate-mirror';

const OWNER = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const CLIENT = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const ASK = 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5';
const NOW = new Date('2026-11-10T15:00:00Z');
const op = getRunnableOp('start_quote')!;
const ctx = () => ({ db: h.db, ownerId: OWNER, now: NOW });
const MESSAGE = "Start a quote for Andy Honeycutt's second location page";
const WHAT = 'second location page';

let clients: any[];
let asks: any[];
let accords: any[];
let tasks: any[];
let ids: number;

function makeDb() {
  const db: any = {
    client: { findFirst: vi.fn(async ({ where }: any) => clients.find((c) => c.id === where.id && !c.is_deleted) ?? null) },
    emailAsk: { findFirst: vi.fn(async ({ where }: any) => asks.find((a) => a.id === where.id) ?? null) },
    accord: {
      create: vi.fn(async ({ data }: any) => { const a = { id: `d0d0d0d0-0000-4000-8000-${String(++ids).padStart(12, '0')}`, is_deleted: false, ...data }; accords.push(a); return a; }),
      findFirst: vi.fn(async ({ where }: any) => accords.find((a) => a.id === where.id && !a.is_deleted) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const a = accords.find((x) => x.id === where.id && (!where.status || x.status === where.status) && !x.is_deleted); if (!a) return { count: 0 }; Object.assign(a, data); return { count: 1 }; }),
    },
    task: {
      create: vi.fn(async ({ data }: any) => { const t = { is_deleted: false, notes: null, sop_id: null, arc_id: null, needs_review: false, approved: false, client_approved_at: null, lease_until: null, client_visible: false, requested_by_contact_id: null, staging_preview_url: null, updated_at: NOW, priority: 3, is_focus: false, due_date: null, promised_to: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', project: null, blocked_by: [], blocking: [], ...data }; tasks.push(t); return t; }),
      findUnique: vi.fn(async ({ where }: any) => tasks.find((t) => t.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const t = tasks.find((x) => x.id === where.id && (!where.status || x.status === where.status) && (!where.assignee_id || x.assignee_id === where.assignee_id) && !x.is_deleted); if (!t) return { count: 0 }; Object.assign(t, data); return { count: 1 }; }),
    },
    comment: { findFirst: vi.fn(async () => null) },
    proposal: { create: vi.fn(), createMany: vi.fn() },
  };
  db.$transaction = async (fn: any) => {
    const snap = JSON.stringify({ accords, tasks });
    try { return await fn(db); } catch (e) { const s = JSON.parse(snap); accords.splice(0, accords.length, ...s.accords); tasks.splice(0, tasks.length, ...s.tasks.map((t: any) => ({ ...t, updated_at: NOW }))); throw e; }
  };
  return db;
}

async function start(input: object) {
  const v = op.validate(input);
  const prep = await op.prepare(ctx() as any, v, 'chat');
  return { v, prep };
}
const go = async (input: object) => { const { v, prep } = await start(input); return { prep, run: await op.run(ctx() as any, v, prep.expect) }; };
const lines = (t: any) => JSON.parse(t.description).map((b: any) => b.content[0].text) as string[];

beforeEach(() => {
  ids = 0;
  clients = [{ id: CLIENT, name: 'Andy Honeycutt', is_deleted: false }];
  asks = [{ id: ASK, from_name: 'Andy Honeycutt', from_email: 'andy@example.test', subject: 'Second location page', thread_id: 'thr-1', account: 'mike@becomeindelible.com', deep_link: 'https://mail.google.com/mail/u/0/#inbox/thr-1' }];
  accords = [];
  tasks = [];
  h.db = makeDb();
});

describe('start_quote op: input', () => {
  it('is strict, names who it is for, and never takes a price or a status', () => {
    const base = { what: WHAT, message: MESSAGE };
    expect(() => op.validate({ ...base, client_id: CLIENT })).not.toThrow();
    expect(() => op.validate({ ...base, lead_name: 'Andy' })).not.toThrow();
    expect(() => op.validate({ ...base, email_ask_id: ASK })).not.toThrow();
    expect(() => op.validate({ ...base })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, lead_name: 'Andy' })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, total_value: 5000 })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, status: 'proposal' })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, send: true })).toThrow();
    expect(() => op.validate({ client_id: CLIENT, message: MESSAGE })).toThrow();
  });
});

describe('start_quote op: the write', () => {
  it('for an existing client writes a lead deal and a pricing task, and a true record', async () => {
    const { prep, run } = await go({ client_id: CLIENT, what: WHAT, message: MESSAGE });
    expect(prep.reach.needs_tap).toBe(false);
    expect(accords).toHaveLength(1);
    expect(accords[0]).toMatchObject({ name: `Andy Honeycutt: ${WHAT}`, status: 'lead', owner_id: OWNER, client_id: CLIENT, notes: MESSAGE, lead_name: null, lead_email: null });
    for (const k of ['total_value', 'proposals', 'signed_at', 'kpi_proposal']) expect(accords[0]).not.toHaveProperty(k);
    const t = tasks[0];
    expect(t).toMatchObject({ title: `Price ${WHAT} for Andy Honeycutt`, status: 'not_started', assignee_id: OWNER, client_id: CLIENT, accord_id: accords[0].id, project_id: null, tags: ['from-chat', 'quote'], created_by_id: BAST_USER_ID });
    expect(t.requirements.map((i: any) => i.text)).toEqual(['Price it from the offer catalog and past invoices', 'Write the quote as a draft note here', 'Hand it back to Mike']);
    expect(lines(t)).toContain(`Deal id: ${accords[0].id}`);
    expect(lines(t)[lines(t).length - 1]).toBe(MESSAGE);
    expect(run.target_id).toBe(accords[0].id);
    expect(run.before).toEqual({});
    expect(run.after).toEqual({ deal_id: accords[0].id, task_id: t.id, client_id: CLIENT });
    expect(run.result).toEqual(run.after);
    expect(run.summary).toBe(`Started a quote for Andy Honeycutt: ${WHAT}. Nothing is priced or sent.`);
  });
  it('for a lead with no client record keeps the lead details on the deal', async () => {
    await go({ lead_name: 'Pat Lee', lead_business: 'Lee Pies', lead_email: 'pat@example.test', what: 'new menu', message: 'quote this' });
    expect(accords[0]).toMatchObject({ name: 'Pat Lee: new menu', client_id: null, lead_name: 'Pat Lee', lead_business_name: 'Lee Pies', lead_email: 'pat@example.test' });
    expect(tasks[0]).toMatchObject({ client_id: null, title: 'Price new menu for Pat Lee' });
    expect(tasks[0].requirements.map((i: any) => i.text)).not.toContain('Put the same draft, unsent, in Gmail on the thread');
  });
  it('an email card: the sender and thread come from the server, and the thread line is added', async () => {
    clients = [];
    await go({ email_ask_id: ASK, what: WHAT, message: 'quote this' });
    expect(h.db.emailAsk.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ASK } }));
    expect(accords[0]).toMatchObject({ client_id: null, lead_name: 'Andy Honeycutt', lead_email: 'andy@example.test', name: `Andy Honeycutt: ${WHAT}` });
    const l = lines(tasks[0]);
    expect(l).toContain('Email subject: Second location page');
    expect(l).toContain('From: Andy Honeycutt <andy@example.test>');
    expect(l).toContain('Thread id: thr-1');
    expect(l).toContain('Thread link: https://mail.google.com/mail/u/0/#inbox/thr-1');
    asks[0].deep_link = '';
    await go({ email_ask_id: ASK, what: WHAT, message: 'again' });
    expect(lines(tasks[1])).toContain('Thread link: https://mail.google.com/mail/u/?authuser=mike%40becomeindelible.com#all/thr-1');
    expect(tasks[0].requirements.map((i: any) => i.text)).toEqual(['Price it from the offer catalog and past invoices', 'Write the quote as a draft note here', 'Put the same draft, unsent, in Gmail on the thread', 'Hand it back to Mike']);
  });
  it('an email card with a known client links the client, not the lead fields', async () => {
    await go({ client_id: CLIENT, email_ask_id: ASK, what: WHAT, message: 'quote this' });
    expect(accords[0]).toMatchObject({ client_id: CLIENT, lead_name: null, lead_email: null });
    expect(lines(tasks[0])).toContain('Thread id: thr-1');
  });
  it('a missing client or email is 404', async () => {
    await expect(start({ client_id: 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', what: WHAT, message: MESSAGE })).rejects.toMatchObject({ statusCode: 404 });
    await expect(start({ email_ask_id: 'a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6', what: WHAT, message: MESSAGE })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('a stale write is refused: the email lost its thread after the prepare', async () => {
    const { v, prep } = await start({ email_ask_id: ASK, what: WHAT, message: MESSAGE });
    asks[0].thread_id = null;
    await expect(op.run(ctx() as any, v, prep.expect)).rejects.toMatchObject({ statusCode: 409 });
    expect(accords).toHaveLength(0);
  });
  it('never touches a proposal', async () => {
    await go({ client_id: CLIENT, what: WHAT, message: MESSAGE });
    expect(h.db.proposal.create).not.toHaveBeenCalled();
    expect(h.db.proposal.createMany).not.toHaveBeenCalled();
  });
});

describe('start_quote op: Undo', () => {
  const record = (run: any) => ({ before: run.before, after: run.after }) as any;
  it('marks the deal lost with a reason and abandons the task', async () => {
    const { run } = await go({ client_id: CLIENT, what: WHAT, message: MESSAGE });
    const u = await op.prepareUndo(ctx() as any, record(run));
    expect(u.reach.needs_tap).toBe(false);
    expect(await op.undo(ctx() as any, record(run), u.expect)).toEqual({ ok: true });
    expect(accords[0]).toMatchObject({ status: 'lost', lost_at: NOW, rejection_reason: 'Started by mistake from the chat', is_deleted: false });
    expect(tasks[0].status).toBe('abandoned');
  });
  it('refuses unless the deal is still a lead and the task still the owner\'s and not started', async () => {
    const { run } = await go({ client_id: CLIENT, what: WHAT, message: MESSAGE });
    const changed = { statusCode: 409, message: 'Changed since. Open the deal.' };
    accords[0].status = 'meeting';
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
    accords[0].status = 'lead';
    tasks[0].status = 'in_progress';
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
    tasks[0].status = 'not_started';
    tasks[0].assignee_id = BAST_USER_ID;
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
  });
  it('a miss on either compare-and-set undoes nothing', async () => {
    const { run } = await go({ client_id: CLIENT, what: WHAT, message: MESSAGE });
    const u = await op.prepareUndo(ctx() as any, record(run));
    tasks[0].status = 'in_progress';
    expect(await op.undo(ctx() as any, record(run), u.expect)).toMatchObject({ ok: false, reason: 'changed_since' });
    expect(accords[0].status).toBe('lead');
  });
  it('the lines it writes have no dash and none of the banned words', async () => {
    const { prep, run } = await go({ lead_name: 'Pat \u2014 Lee', what: 'a \u2013 b', message: MESSAGE });
    const u = await op.prepareUndo(ctx() as any, record(run));
    const all = [run.summary, prep.copy.clause, u.copy.clause].join(' ');
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(all).not.toMatch(/priorit|overdue/i);
  });
});
