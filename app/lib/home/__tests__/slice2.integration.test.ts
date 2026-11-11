// @vitest-environment node
/**
 * Slice 2a against a real Postgres: the nightly keeper end to end on a scratch database. It builds the screen
 * the way GET /api/home does (loadHomeInputs, selectHome, assembleHomeResponse), runs the keeper, and checks what it
 * wrote and, as important, everything it did not write.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433 (it writes rows, and removes only the rows it made).
 * Run: DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s2a npx vitest run lib/home/__tests__/slice2.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { assembleHomeResponse } from '../today';
import { runHomeAct, runHomeUndo } from '../act';
import { runKeeper } from '../keeper/run';
import { taskKey } from '../item-key';
import type { HomeResponse } from '../types';

const URL = process.env.DATABASE_URL ?? '';
const SCRATCH = /localhost:55433/.test(URL);
const TZ = 'America/New_York';
/** Wednesday 2026-11-11, 02:35 Eastern. */
const NOW = new Date('2026-11-11T07:35:00Z');
const NEXT_NIGHT = new Date('2026-11-12T07:35:00Z');
const iso = (s: string) => new Date(s);

describe.skipIf(!SCRATCH)('Slice 2a: the nightly keeper (real database)', () => {
  const tag = `s2a-${Date.now()}`;
  const ownerId = randomUUID();
  const overlookId = randomUUID();
  const techId = randomUUID();
  const userIds = [ownerId, overlookId, techId];
  const taskIds: string[] = [];
  const byTitle = new Map<string, string>();

  const mk = async (assignee: string, title: string, over: Record<string, unknown> = {}) => {
    const row = await prisma.task.create({
      data: { title, assignee_id: assignee, created_by_id: assignee, status: 'not_started', needs_review: false, tags: [tag], created_at: iso('2026-10-05T14:00:00Z'), ...over },
    });
    taskIds.push(row.id);
    byTitle.set(title, row.id);
    return row;
  };
  const key = (title: string) => taskKey(byTitle.get(title) as string);

  async function screen(now: Date, forUser = ownerId) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, forUser, now, { timezone: TZ }), loadItemStates(prisma, forUser)]);
    const sel = selectHome({ raw, states, now });
    const resp: HomeResponse = assembleHomeResponse({ sel, day: null, calendar: raw.calendar_events, now, timezone: TZ, user_id: forUser });
    return { raw, states, sel, resp };
  }

  async function counts() {
    const [item, action, run, task, arc, ask, wait, comment, notification] = await Promise.all([
      prisma.homeItemState.count({ where: { user_id: { in: userIds } } }),
      prisma.homeAction.count({ where: { user_id: { in: userIds } } }),
      prisma.homeKeeperRun.count({ where: { user_id: { in: userIds } } }),
      prisma.task.count(),
      prisma.arc.count(),
      prisma.emailAsk.count(),
      prisma.wait.count(),
      prisma.comment.count(),
      prisma.notification.count(),
    ]);
    return { item, action, run, task, arc, ask, wait, comment, notification };
  }
  const otherTables = (c: Awaited<ReturnType<typeof counts>>) => ({ task: c.task, arc: c.arc, ask: c.ask, wait: c.wait, comment: c.comment, notification: c.notification });

  let taskSnapshot: Map<string, number>;
  let baseline: ReturnType<typeof otherTables>;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner S2A', role: 'admin' },
        { id: overlookId, email: `overlook-${tag}@example.test`, password_hash: 'x', name: 'Overlook S2A', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech S2A', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: ownerId, home_view: 'home', timezone: TZ },
        { user_id: overlookId, home_view: 'overlook', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
      ],
    });

    // Fresh tasks the chat just made.
    await mk(ownerId, 'Kickoff for the fixture client', { tags: [tag, 'from-chat'], created_at: iso('2026-11-10T15:00:00Z') });
    await mk(ownerId, 'Quote for the fixture client', { tags: [tag, 'from-chat'], created_at: iso('2026-11-10T16:00:00Z') });
    // Twelve undated chores.
    for (let i = 1; i <= 12; i++) await mk(ownerId, `Chore ${String(i).padStart(2, '0')}`, { created_at: iso(`2026-10-${String(5 + i).padStart(2, '0')}T14:00:00Z`) });
    // Dates to read: a 5-day default, 40 days past, and a 10-day date that reads.
    await mk(ownerId, 'Five day default', { created_at: iso('2026-11-04T15:00:00Z'), due_date: iso('2026-11-09T00:00:00Z') });
    await mk(ownerId, 'Forty days past', { created_at: iso('2026-09-01T15:00:00Z'), due_date: iso('2026-10-02T00:00:00Z') });
    await mk(ownerId, 'Ten day date', { created_at: iso('2026-11-10T15:00:00Z'), due_date: iso('2026-11-20T00:00:00Z') });
    // A real outside date.
    await mk(ownerId, 'Renew the fixture domain', { hard_due_at: iso('2026-11-13T00:00:00Z'), hard_due_source: 'domain renews', created_at: iso('2026-11-02T15:00:00Z') });
    // His own Not now, landing Thursday.
    const notNow = await mk(ownerId, 'Parked by him');
    await prisma.homeItemState.create({ data: { user_id: ownerId, item_key: taskKey(notNow.id), view_at: iso('2026-11-12T14:00:00Z'), view_set_by: null, park_count: 1 } });
    // Tasks for the other two users, old and dated: the keeper must not touch them.
    await mk(overlookId, 'Overlook chore', { due_date: iso('2026-10-01T00:00:00Z') });
    await mk(techId, 'Tech chore', { due_date: iso('2026-11-30T00:00:00Z') });
    await mk(techId, 'Tech chore two');

    const rows = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, updated_at: true } });
    taskSnapshot = new Map(rows.map((r) => [r.id, r.updated_at.getTime()]));
    baseline = otherTables(await counts());
  });

  afterAll(async () => {
    // Only what this file made: its users (their home rows cascade) and its tasks.
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('before any run, the kickoff and quote tasks are in Next with the fresh why line', async () => {
    const { resp } = await screen(NOW);
    const next = resp.sections.next;
    const kickoff = next.find((i) => i.key === key('Kickoff for the fixture client'));
    const quote = next.find((i) => i.key === key('Quote for the fixture client'));
    expect(kickoff?.why_now).toBe('New from the chat.');
    expect(quote?.why_now).toBe('New from the chat.');
  });

  it('the domain task is in Needs you now with its chip', async () => {
    const { resp } = await screen(NOW);
    const item = resp.sections.needs_you_now.find((i) => i.key === key('Renew the fixture domain'));
    expect(item).toBeTruthy();
    expect(item?.hard_date).toContain('(domain renews)');
  });

  it('a dry run returns a plan and writes nothing', async () => {
    const before = await counts();
    const r = await runKeeper(prisma, ownerId, NOW, { dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(r.plan?.counts.stagger).toBeGreaterThanOrEqual(12);
    expect(r.plan?.counts.dates_read).toBe(1);
    expect(r.plan?.counts.dates_set_aside).toBe(2);
    expect(r.action_ids).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  let staggerActionId = '';
  let datesActionId = '';
  let staggerKeys: string[] = [];

  it('the first run gives the waiting tasks days, 3 per business day, at 00:05 Eastern, and reads the dates', async () => {
    const r = await runKeeper(prisma, ownerId, NOW, { dryRun: false });
    expect(r.already_ran).toBeUndefined();
    expect(r.skipped).toBeUndefined();
    expect(r.action_ids).toHaveLength(2);
    expect(r.plan?.lines.map((l) => l.action)).toEqual(['keeper_stagger', 'keeper_dates']);
    staggerKeys = r.plan!.stagger.map((s) => s.item_key);

    // Every one of the 12 chores has a keeper day.
    const chores = await prisma.homeItemState.findMany({ where: { user_id: ownerId, item_key: { in: Array.from({ length: 12 }, (_, i) => key(`Chore ${String(i + 1).padStart(2, '0')}`)) } } });
    expect(chores).toHaveLength(12);
    for (const c of chores) {
      expect(c.view_set_by).toBe('keeper');
      expect(c.view_at?.toISOString().endsWith('T05:05:00.000Z')).toBe(true); // 00:05 EST
      expect([0, 6]).not.toContain(c.view_at!.getUTCDay());
    }
    // At most 3 a zoned day, his own Not now return counted.
    const all = await prisma.homeItemState.findMany({ where: { user_id: ownerId, view_at: { not: null } } });
    const perDay = new Map<string, number>();
    for (const s of all) {
      const day = s.view_at!.toLocaleDateString('en-CA', { timeZone: TZ });
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(perDay.size).toBeGreaterThan(1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(3);
    expect(perDay.get('2026-11-12')).toBeLessThanOrEqual(3);

    const actions = await prisma.homeAction.findMany({ where: { user_id: ownerId, source: 'keeper' } });
    expect(actions).toHaveLength(2);
    for (const a of actions) {
      expect(a.undo_until!.getTime() - NOW.getTime()).toBe(72 * 3600 * 1000);
      const after = a.after as { states: unknown[]; line: string; details: string[] };
      const before = a.before as { states: unknown[] };
      expect(after.line.length).toBeGreaterThan(10);
      expect(Array.isArray(after.details)).toBe(true);
      expect(before.states).toHaveLength(after.states.length);
    }
    staggerActionId = actions.find((a) => a.action === 'keeper_stagger')!.id;
    datesActionId = actions.find((a) => a.action === 'keeper_dates')!.id;
  });

  it("his Not now item keeps its date and 'user' setter", async () => {
    const s = await prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: key('Parked by him') } });
    expect(s?.view_at?.toISOString()).toBe('2026-11-12T14:00:00.000Z');
    expect(s?.view_set_by).toBeNull();
    expect(staggerKeys).not.toContain(key('Parked by him'));
  });

  it('the dates: 5-day and 40-days-past set aside, the 10-day one read with the source text', async () => {
    const st = (title: string) => prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: key(title) } });
    for (const title of ['Five day default', 'Forty days past']) {
      const s = await st(title);
      expect(s?.dates_read_at).not.toBeNull();
      expect(s?.read_hard_due_at).toBeNull();
    }
    const read = await st('Ten day date');
    expect(read?.dates_read_at).not.toBeNull();
    expect(read?.read_hard_due_at?.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(read?.read_hard_due_source).toBe('date from the task, source unclear');
    const { sel } = await screen(NOW);
    expect(sel.byKey.get(key('Ten day date'))?.item.hard_date).toContain('(date from the task, source unclear)');
    // The domain task keeps its real source and is untouched by the reading.
    expect(await st('Renew the fixture domain')).toBeNull();
  });

  it('a second run the same day says already_ran and changes no row', async () => {
    const before = await counts();
    const r = await runKeeper(prisma, ownerId, NOW, { dryRun: false });
    expect(r.already_ran).toBe(true);
    expect(r.plan).toBeUndefined();
    expect(r.action_ids).toEqual([]);
    expect(await counts()).toEqual(before);
  });

  it('every Everything else item has an owner and a check text, and the counts add up', async () => {
    const { resp } = await screen(NOW);
    const ee = resp.everything_else;
    expect(ee.count).toBe(ee.groups.reduce((n, g) => n + g.count, 0));
    for (const g of ee.groups) {
      for (const item of g.items) {
        expect(item.owner.trim()).not.toBe('');
        expect(item.check_text.trim()).not.toBe('');
      }
    }
    const rows = ee.groups.flatMap((g) => g.items);
    expect(ee.with_day).toBe(rows.filter((r) => r.check_at !== null).length);
    expect(ee.past_day).toBe(rows.filter((r) => r.past_check).length);
    const scheduled = ee.groups.find((g) => g.key === 'scheduled');
    expect(scheduled?.count).toBeGreaterThan(0);
  });

  it('Handled for you has the two keeper lines, each with an undo id', async () => {
    const { resp } = await screen(NOW);
    const lines = resp.sections.handled.filter((h) => h.undo_action_id);
    expect(lines.map((l) => l.undo_action_id).sort()).toEqual([staggerActionId, datesActionId].sort());
    expect(lines.find((l) => l.undo_action_id === staggerActionId)?.text).toMatch(/^Gave \d+ waiting tasks a day to come back, at most 3 a day, starting today\.$/);
    expect(lines.find((l) => l.undo_action_id === datesActionId)?.text).toBe('Read the dates on 3 tasks: 1 now show as real dates, 2 were set aside.');
  });

  it('Undo puts back the unchanged items, skips the one he changed, and sets the hold', async () => {
    const mine = key('Chore 12');
    const moved = key('Chore 11');
    // He moved one of them after the keeper ran.
    await prisma.homeItemState.update({ where: { user_id_item_key: { user_id: ownerId, item_key: moved } }, data: { view_at: iso('2026-12-01T14:00:00Z'), view_set_by: 'user' } });
    const r = await runHomeUndo(prisma, ownerId, staggerActionId, NOW);
    expect(r.ok).toBe(true);
    const a = await prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: mine } });
    expect(a?.view_at).toBeNull();
    expect(a?.view_set_by).toBeNull();
    expect(a?.keeper_hold_until!.getTime()).toBe(NOW.getTime() + 30 * 24 * 3600 * 1000);
    const b = await prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: moved } });
    expect(b?.view_at?.toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(b?.view_set_by).toBe('user');
    expect(b?.keeper_hold_until).not.toBeNull();
    // Undoing the dates puts the reading back but leaves the marker.
    await runHomeUndo(prisma, ownerId, datesActionId, NOW);
    const read = await prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: key('Ten day date') } });
    expect(read?.read_hard_due_at).toBeNull();
    expect(read?.dates_read_at).not.toBeNull();
    const { resp } = await screen(NOW);
    expect(resp.sections.handled.filter((h) => h.undo_action_id)).toHaveLength(0);
  });

  it('the next night leaves undone items alone and does not redo the dates', async () => {
    const r = await runKeeper(prisma, ownerId, NEXT_NIGHT, { dryRun: false });
    expect(r.already_ran).toBeUndefined();
    expect(r.plan?.stagger.map((s) => s.item_key)).not.toContain(key('Chore 12'));
    expect(r.plan?.stagger.map((s) => s.item_key)).not.toContain(key('Chore 11'));
    expect(r.plan?.dates).toEqual([]);
    const a = await prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: key('Chore 12') } });
    expect(a?.view_at).toBeNull();
  });

  it('Bring it forward puts a waiting item at the top of Next', async () => {
    const { sel } = await screen(NEXT_NIGHT);
    const rest = sel.everything_else.groups.flatMap((g) => g.items).find((i) => i.key && i.can_bring_forward && i.key === key('Chore 12'));
    expect(rest).toBeTruthy();
    await runHomeAct(prisma, ownerId, { action: 'bring_forward', item_key: key('Chore 12') }, { now: NEXT_NIGHT, timezone: TZ, date: '2026-11-12' });
    const after = await screen(NEXT_NIGHT);
    expect(after.resp.sections.next[0].key).toBe(key('Chore 12'));
  });

  it('a run for an owner who is not on the home view writes zero rows', async () => {
    const before = await counts();
    for (const id of [overlookId, techId]) {
      const r = await runKeeper(prisma, id, NOW, { dryRun: false });
      expect(r).toEqual({ dry_run: false, skipped: 'home_off', action_ids: [] });
      const g = await runKeeper(prisma, id, NOW, { dryRun: true });
      expect(g.skipped).toBe('home_off');
    }
    // The real owner switched off.
    await prisma.userPreference.update({ where: { user_id: ownerId }, data: { home_view: 'overlook' } });
    const r = await runKeeper(prisma, ownerId, new Date('2026-11-13T07:35:00Z'), { dryRun: false });
    expect(r.skipped).toBe('home_off');
    await prisma.userPreference.update({ where: { user_id: ownerId }, data: { home_view: 'home' } });
    expect(await counts()).toEqual(before);
  });

  it('wrote only the owner\'s own rows: others have none, and no task or shared row changed', async () => {
    for (const id of [overlookId, techId]) {
      expect(await prisma.homeItemState.count({ where: { user_id: id } })).toBe(0);
      expect(await prisma.homeAction.count({ where: { user_id: id } })).toBe(0);
      expect(await prisma.homeKeeperRun.count({ where: { user_id: id } })).toBe(0);
    }
    const rows = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, updated_at: true, assignee_id: true } });
    expect(rows).toHaveLength(taskIds.length);
    for (const r of rows) expect(r.updated_at.getTime()).toBe(taskSnapshot.get(r.id));
    // Every state row the owner has is for one of the owner's own tasks.
    const states = await prisma.homeItemState.findMany({ where: { user_id: ownerId }, select: { item_key: true } });
    const ownerTasks = new Set(rows.filter((r) => r.assignee_id === ownerId).map((r) => taskKey(r.id)));
    for (const s of states) expect(ownerTasks.has(s.item_key)).toBe(true);
    // Runs: the owner has the two nightly rows (11-11 and 11-12), both finished.
    const runs = await prisma.homeKeeperRun.findMany({ where: { user_id: ownerId } });
    expect(runs).toHaveLength(2);
    for (const run of runs) expect(run.finished_at).not.toBeNull();
  });

  it('the row counts of Task, Arc, EmailAsk, Wait, Comment and Notification are what they were before the first run', async () => {
    expect(otherTables(await counts())).toEqual(baseline);
  });
});
