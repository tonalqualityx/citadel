/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));

import { getRunnableOp } from '..';
import { opSummary } from '../../actions';
import { BAST_USER_ID } from '../../gate-mirror';

const OWNER = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
const CLIENT = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
const SITE_A = '51515151-5151-4515-8515-515151515151';
const SITE_B = '52525252-5252-4525-8525-525252525252';
const NOW = new Date('2026-11-10T15:00:00Z');
const op = getRunnableOp('start_project')!;
const ctx = () => ({ db: h.db, ownerId: OWNER, now: NOW });
const MESSAGE = 'Start a project for Jill\'s Cafe to rebuild the menu pages.';

let clients: any[];
let sites: any[];
let projects: any[];
let tasks: any[];
let ids: number;

function makeDb() {
  const db: any = {
    client: {
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = clients.filter((c) => !c.is_deleted && (where.id ? c.id === where.id : true) && (where.name ? c.name.toLowerCase() === where.name.equals.toLowerCase() : true) && (where.status ? c.status === where.status : true));
        const c = rows[0];
        return c ? { ...c, sites: sites.filter((s) => s.client_id === c.id) } : null;
      }),
      create: vi.fn(async ({ data }: any) => { const c = { id: `c0c0c0c0-0000-4000-8000-${String(++ids).padStart(12, '0')}`, status: 'active', is_deleted: false, ...data }; clients.push(c); return c; }),
    },
    project: {
      create: vi.fn(async ({ data }: any) => { const p = { id: `d0d0d0d0-0000-4000-8000-${String(++ids).padStart(12, '0')}`, is_deleted: false, ...data }; projects.push(p); return p; }),
      findFirst: vi.fn(async ({ where }: any) => projects.find((p) => p.id === where.id && !p.is_deleted) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const p = projects.find((x) => x.id === where.id && (!where.status || x.status === where.status) && !x.is_deleted); if (!p) return { count: 0 }; Object.assign(p, data); return { count: 1 }; }),
    },
    task: {
      create: vi.fn(async ({ data }: any) => { const t = { is_deleted: false, notes: null, sop_id: null, arc_id: null, needs_review: false, approved: false, client_approved_at: null, lease_until: null, client_visible: false, requested_by_contact_id: null, staging_preview_url: null, updated_at: NOW, priority: 3, is_focus: false, due_date: null, promised_to: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', project: null, blocked_by: [], blocking: [], ...data }; tasks.push(t); return t; }),
      findUnique: vi.fn(async ({ where }: any) => tasks.find((t) => t.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const t = tasks.find((x) => x.id === where.id && (!where.status || x.status === where.status) && (!where.assignee_id || x.assignee_id === where.assignee_id) && !x.is_deleted); if (!t) return { count: 0 }; Object.assign(t, data); return { count: 1 }; }),
    },
    comment: { findFirst: vi.fn(async () => null) },
    emailAsk: { findFirst: vi.fn(async () => null) }, // Work stage A: the closure's cheap look for open linked emails
  };
  // A transaction that rolls the tables back when it throws.
  db.$transaction = async (fn: any) => {
    const snap = JSON.stringify({ projects, tasks });
    try { return await fn(db); } catch (e) { const s = JSON.parse(snap); projects.splice(0, projects.length, ...s.projects); tasks.splice(0, tasks.length, ...s.tasks.map((t: any) => ({ ...t, updated_at: NOW }))); throw e; }
  };
  return db;
}

async function start(input: object) {
  const v = op.validate(input);
  const prep = await op.prepare(ctx() as any, v, 'chat');
  return { v, prep };
}
const go = async (input: object) => { const { v, prep } = await start(input); return { prep, run: await op.run(ctx() as any, v, prep.expect) }; };

beforeEach(() => {
  ids = 0;
  clients = [{ id: CLIENT, name: "Jill's Cafe", status: 'active', is_deleted: false }];
  sites = [{ id: SITE_A, name: 'jillscafe.com', client_id: CLIENT }];
  projects = [];
  tasks = [];
  h.db = makeDb();
});

describe('start_project op: input', () => {
  it('is strict and needs exactly one of client_id and new_client, plus what and the message', () => {
    const base = { what: 'Rebuild the menu pages', message: MESSAGE };
    expect(() => op.validate({ ...base, client_id: CLIENT })).not.toThrow();
    expect(() => op.validate({ ...base, new_client: 'Harbor Dental' })).not.toThrow();
    expect(() => op.validate({ ...base })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, new_client: 'Harbor Dental' })).toThrow();
    expect(() => op.validate({ client_id: CLIENT, message: MESSAGE })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, user_id: OWNER })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, status: 'ready' })).toThrow();
    expect(() => op.validate({ ...base, client_id: CLIENT, budget: 5000 })).toThrow();
  });
});

describe('start_project op: the write', () => {
  it('for an existing client writes the project, the kickoff task and a true record', async () => {
    const { prep, run } = await go({ client_id: CLIENT, what: 'Rebuild the menu pages', message: MESSAGE });
    expect(prep.reach.needs_tap).toBe(false);
    expect(clients).toHaveLength(1);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'Rebuild the menu pages', status: 'queue', type: 'project', client_id: CLIENT, site_id: SITE_A, created_by_id: BAST_USER_ID });
    for (const k of ['billing_type', 'budget_hours', 'budget_amount', 'hourly_rate', 'plan_folder', 'accord_id', 'recipe_id', 'target_date']) expect(projects[0]).not.toHaveProperty(k);
    expect(JSON.parse(projects[0].description).map((b: any) => b.content[0].text)).toEqual(['Rebuild the menu pages', "Started from Mike's chat on November 10, 2026."]);
    const t = tasks[0];
    expect(t).toMatchObject({ title: 'Kick off Rebuild the menu pages', status: 'not_started', assignee_id: OWNER, client_id: CLIENT, site_id: SITE_A, project_id: null, tags: ['from-chat', 'kickoff'], created_by_id: BAST_USER_ID });
    expect(h.db.task.create.mock.calls[0][0].data).not.toHaveProperty('due_date');
    expect(t.requirements.map((i: any) => i.text)).toEqual(['Set up the plan folder for the project', 'Write the goal and the first tasks into the plan, each filed to Mike', 'Tell Mike the plan is ready to make live']);
    const text = JSON.parse(t.description).map((b: any) => b.content[0].text);
    expect(text).toContain(`Project id: ${projects[0].id}`);
    expect(text.some((l: string) => l.startsWith('Project link: ') && l.endsWith(`/projects/${projects[0].id}`))).toBe(true);
    expect(text[text.length - 1]).toBe(MESSAGE);
    expect(run.target_id).toBe(projects[0].id);
    expect(run.before).toEqual({});
    expect(run.after).toEqual({ project_id: projects[0].id, task_id: t.id, client_id: CLIENT, client_created: false, site_id: SITE_A });
    expect(run.result).toEqual(run.after);
    expect(run.summary).toBe('Started "Rebuild the menu pages" for Jill\'s Cafe. It is hidden from the client until you say it is live.');
    expect(run.undoable).toBe(true);
  });
  it('a new client is made with its name only, and the line says so', async () => {
    const { run } = await go({ new_client: 'Harbor Dental', what: 'Build a new site', name: 'Harbor Dental site', message: MESSAGE });
    expect(clients).toHaveLength(2);
    expect(clients[1]).toEqual({ id: expect.any(String), status: 'active', is_deleted: false, name: 'Harbor Dental' });
    expect(projects[0]).toMatchObject({ name: 'Harbor Dental site', client_id: clients[1].id, site_id: null });
    expect(run.result).toMatchObject({ client_created: true, client_id: clients[1].id });
    expect(run.summary).toBe('Started "Harbor Dental site" for Harbor Dental. It is hidden from the client until you say it is live. Added Harbor Dental as a new client.');
  });
  it('refuses a new client when an active one has that name', async () => {
    await expect(start({ new_client: "jill's cafe", what: 'x', message: MESSAGE })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('already an active client') });
    expect(h.db.client.create).not.toHaveBeenCalled();
  });
  it('a missing client is 404', async () => {
    await expect(start({ client_id: 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', what: 'x', message: MESSAGE })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('the name is the first 80 characters of what it is for, with no dash', async () => {
    const what = 'Rebuild the menu pages \u2014 and the catering page, the gift card page, the events page, and more besides';
    await go({ client_id: CLIENT, what, message: MESSAGE });
    expect(projects[0].name.length).toBeLessThanOrEqual(80);
    expect(projects[0].name).not.toMatch(/[\u2013\u2014]/);
  });
  it('site: the named one among several, the only one, or none', async () => {
    sites.push({ id: SITE_B, name: 'catering.jillscafe.com', client_id: CLIENT });
    await go({ client_id: CLIENT, what: 'a', message: MESSAGE, site: 'catering' });
    expect(projects[0].site_id).toBe(SITE_B);
    expect(tasks[0].site_id).toBe(SITE_B);
    await go({ client_id: CLIENT, what: 'b', message: MESSAGE });
    expect(projects[1].site_id).toBeNull(); // two sites and none named
    await expect(start({ client_id: CLIENT, what: 'c', message: MESSAGE, site: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(start({ client_id: CLIENT, what: 'c', message: MESSAGE, site: 'jillscafe' })).rejects.toMatchObject({ statusCode: 409 });
    await go({ client_id: CLIENT, what: 'd', message: MESSAGE, site: SITE_A });
    expect(projects[2].site_id).toBe(SITE_A);
  });
  it('a stale write is refused: the site changed after the prepare', async () => {
    const { v, prep } = await start({ client_id: CLIENT, what: 'a', message: MESSAGE });
    sites.push({ id: SITE_B, name: 'other', client_id: CLIENT });
    await expect(op.run(ctx() as any, v, prep.expect)).rejects.toMatchObject({ statusCode: 409 });
    expect(projects).toHaveLength(0);
  });
  it('keeps the owner\'s words with brackets and dashes as written', async () => {
    const m = '[1] rebuild \u2014 menu';
    await go({ client_id: CLIENT, what: 'a', message: m });
    const text = JSON.parse(tasks[0].description).map((b: any) => b.content[0].text);
    expect(text[text.length - 1]).toBe(m);
  });
});

describe('start_project op: Undo', () => {
  const record = (run: any) => ({ before: run.before, after: run.after }) as any;
  it('cancels the project and abandons the task, in one step, and keeps a new client', async () => {
    const { run } = await go({ new_client: 'Harbor Dental', what: 'Build a site', message: MESSAGE });
    const u = await op.prepareUndo(ctx() as any, record(run));
    expect(u.reach.needs_tap).toBe(false);
    expect(await op.undo(ctx() as any, record(run), u.expect)).toEqual({ ok: true });
    expect(projects[0].status).toBe('cancelled');
    expect(tasks[0].status).toBe('abandoned');
    expect(clients).toHaveLength(2);
    expect(h.db.project.findFirst).toBeDefined();
  });
  it('refuses when the project has moved on, the task was handed on or started, or something waits on it', async () => {
    const { run } = await go({ client_id: CLIENT, what: 'a', message: MESSAGE });
    const changed = { statusCode: 409, message: 'Changed since. Open the project.' };
    projects[0].status = 'ready';
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
    projects[0].status = 'queue';
    tasks[0].status = 'in_progress';
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
    tasks[0].status = 'not_started';
    tasks[0].assignee_id = BAST_USER_ID;
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
    tasks[0].assignee_id = OWNER;
    tasks[0].blocking = [{ ...tasks[0], id: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', blocked_by: [], blocking: [] }];
    await expect(op.prepareUndo(ctx() as any, record(run))).rejects.toMatchObject(changed);
    tasks[0].blocking = [];
    await expect(op.prepareUndo(ctx() as any, record(run))).resolves.toBeTruthy();
  });
  it('a miss on either compare-and-set undoes nothing', async () => {
    const { run } = await go({ client_id: CLIENT, what: 'a', message: MESSAGE });
    const u = await op.prepareUndo(ctx() as any, record(run));
    tasks[0].status = 'in_progress'; // moves between the check and the write
    expect(await op.undo(ctx() as any, record(run), u.expect)).toMatchObject({ ok: false, reason: 'changed_since' });
    expect(projects[0].status).toBe('queue'); // rolled back with the task
    expect(await op.undo(ctx() as any, { after: { nope: 1 } } as any, u.expect)).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('nothing is ever deleted', async () => {
    const { run } = await go({ new_client: 'Harbor Dental', what: 'a', message: MESSAGE });
    const u = await op.prepareUndo(ctx() as any, record(run));
    await op.undo(ctx() as any, record(run), u.expect);
    expect(Object.keys(h.db.project)).not.toContain('delete');
    expect(projects.every((p) => p.is_deleted === false)).toBe(true);
  });
});

describe('start_project op: words', () => {
  it('every line it writes is plain, with no dash and none of the banned words', async () => {
    const { prep, run } = await go({ new_client: 'Harbor Dental', what: 'Build a site', message: MESSAGE });
    const all = [run.summary, prep.copy.clause, ...(await Promise.all([op.prepareUndo(ctx() as any, { after: run.after } as any)])).map((u) => u.copy.clause), opSummary({ op: 'start_project', name: 'a \u2014 b', client_name: 'c \u2013 d', client_created: true })].join(' ');
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(all).not.toMatch(/priorit|overdue/i);
  });
});
