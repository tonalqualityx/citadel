// @vitest-environment node
/**
 * Slice 2b against a real Postgres: card summaries written by Bast, end to end on a scratch database. It calls the
 * same functions the route calls (listSummaryWork, saveSummaries), builds the screen the way GET /api/home does, and
 * checks what was written and what was not.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It removes only the rows it made.
 * Run: DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s2b npx vitest run lib/home/__tests__/slice2b.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { assembleHomeResponse } from '../today';
import { runHomeUndo } from '../act';
import { listSummaryWork, saveSummaries } from '../keeper/summaries';
import { taskKey } from '../item-key';
import type { HomeResponse } from '../types';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const NOW = new Date('2026-11-11T07:35:00Z');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const EM = '—';

const longText = (seed: string, n = 140) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');
const doc = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text }] }]);
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe.skipIf(!SCRATCH)('Slice 2b: card summaries (real database)', () => {
  const tag = `s2b-${Date.now()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const offId = randomUUID();
  const userIds = [ownerId, otherId, offId];
  const taskIds: string[] = [];
  const by = new Map<string, { id: string; description: string | null }>();
  let bastCreated = false;

  const mk = async (assignee: string, title: string, over: Record<string, unknown> = {}) => {
    const description = 'description' in over ? (over.description as string | null) : doc(longText(title.replace(/\W/g, '')));
    const row = await prisma.task.create({
      data: { title, assignee_id: assignee, created_by_id: assignee, status: 'not_started', needs_review: false, tags: [tag], created_at: new Date('2026-10-05T14:00:00Z'), ...over, description },
    });
    taskIds.push(row.id);
    by.set(title, { id: row.id, description });
    return row;
  };
  const key = (t: string) => taskKey(by.get(t)!.id);
  const hash = (t: string) => sha(by.get(t)!.description as string);

  async function screen(now = NOW) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, ownerId, now, { timezone: TZ }), loadItemStates(prisma, ownerId)]);
    const sel = selectHome({ raw, states, now });
    const resp: HomeResponse = assembleHomeResponse({ sel, day: null, calendar: raw.calendar_events, now, timezone: TZ, user_id: ownerId });
    return { sel, resp };
  }
  const card = async (t: string) => (await screen()).sel.byKey.get(key(t))?.item.opened;

  const counts = async () => ({
    task: await prisma.task.count(),
    arc: await prisma.arc.count(),
    ask: await prisma.emailAsk.count(),
    wait: await prisma.wait.count(),
    comment: await prisma.comment.count(),
    notification: await prisma.notification.count(),
  });
  let baseline: Awaited<ReturnType<typeof counts>>;
  let taskSnapshot: Map<string, number>;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `o-${tag}@example.test`, password_hash: 'x', name: 'Owner S2B', role: 'admin' },
        { id: otherId, email: `x-${tag}@example.test`, password_hash: 'x', name: 'Other S2B', role: 'admin' },
        { id: offId, email: `f-${tag}@example.test`, password_hash: 'x', name: 'Off S2B', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: ownerId, home_view: 'home', timezone: TZ },
        { user_id: otherId, home_view: 'overlook', timezone: TZ },
        { user_id: offId, home_view: 'overlook', timezone: TZ },
      ],
    });
    if (!(await prisma.user.findUnique({ where: { id: BAST_USER_ID }, select: { id: true } }))) {
      await prisma.user.create({ data: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast S2B', role: 'tech' } });
      bastCreated = true;
    }
    await mk(ownerId, 'Alpha long');
    await mk(ownerId, 'Bravo toolong');
    await mk(ownerId, 'Charlie dash');
    await mk(ownerId, 'Delta banned');
    await mk(ownerId, 'Echo stale');
    await mk(ownerId, 'Foxtrot own list', { requirements: [{ text: 'Own one', completed: false }, { text: 'Own two', completed: true }] });
    await mk(ownerId, 'Golf held');
    await mk(ownerId, 'Hotel short', { description: doc(words(40)) });
    await mk(ownerId, 'India nodesc', { description: null });
    await mk(ownerId, 'Juliet bot', { assignee_id: BAST_USER_ID, tags: [tag, 'needs-mike'] });
    await mk(otherId, 'Kilo other');
    await mk(ownerId, 'Lima four', { description: doc(longText('lima')) });
    // Golf is under a keeper hold.
    await prisma.homeItemState.create({ data: { user_id: ownerId, item_key: key('Golf held'), keeper_hold_until: new Date('2026-12-01T00:00:00Z') } });
    const rows = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, updated_at: true } });
    taskSnapshot = new Map(rows.map((r) => [r.id, r.updated_at.getTime()]));
    baseline = await counts();
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (bastCreated) await prisma.user.deleteMany({ where: { id: BAST_USER_ID } });
    await prisma.$disconnect();
  });

  it('GET lists the long own tasks with their hash, and leaves out short, empty, held, Bast and other people', async () => {
    const r = await listSummaryWork(prisma, ownerId, NOW, 40);
    const ks = r.items.map((i) => i.item_key);
    for (const t of ['Alpha long', 'Bravo toolong', 'Charlie dash', 'Delta banned', 'Echo stale', 'Foxtrot own list', 'Lima four']) expect(ks).toContain(key(t));
    for (const t of ['Golf held', 'Hotel short', 'India nodesc', 'Juliet bot', 'Kilo other']) expect(ks).not.toContain(key(t));
    const alpha = r.items.find((i) => i.item_key === key('Alpha long'))!;
    expect(alpha).toEqual({ item_key: key('Alpha long'), task_id: by.get('Alpha long')!.id, title: 'Alpha long', text: expect.stringContaining('Alphalong0'), hash: hash('Alpha long'), has_checklist: false });
    expect(r.items.find((i) => i.item_key === key('Foxtrot own list'))!.has_checklist).toBe(true);
    expect((await listSummaryWork(prisma, ownerId, NOW, 2)).items).toHaveLength(2);
  });

  it('with no summary yet the card is exactly as before', async () => {
    const o = await card('Alpha long');
    expect(o?.summary_by).toBeNull();
    expect(o?.summary).toContain('Alphalong0');
    expect(o?.done_when).toEqual([]);
  });

  let actionId = '';

  it('POST saves valid summaries and refuses one over 60 words, one with a dash and one with a banned word; a stale hash is skipped', async () => {
    const before = await counts();
    const r = await saveSummaries(prisma, ownerId, NOW, [
      { item_key: key('Alpha long'), hash: hash('Alpha long'), summary: 'Short version of the long note.', done_when: ['Send the draft', 'Get the sign off', 'Publish the page'] },
      { item_key: key('Bravo toolong'), hash: hash('Bravo toolong'), summary: words(61) },
      { item_key: key('Charlie dash'), hash: hash('Charlie dash'), summary: `Two parts ${EM} one answer.` },
      { item_key: key('Delta banned'), hash: hash('Delta banned'), summary: 'This is the top Priority this week.' },
      { item_key: key('Echo stale'), hash: sha('some older description'), summary: 'Fine summary.' },
      { item_key: key('Foxtrot own list'), hash: hash('Foxtrot own list'), summary: 'Has its own list.', done_when: ['One thing', 'Another thing'] },
      { item_key: key('Golf held'), hash: hash('Golf held'), summary: 'Held one.' },
      { item_key: key('Kilo other'), hash: hash('Kilo other'), summary: 'Not his.' },
    ]);
    expect(r.saved).toBe(2);
    expect(r.refused).toEqual([
      { item_key: key('Bravo toolong'), reason: 'too_long' },
      { item_key: key('Charlie dash'), reason: 'dash' },
      { item_key: key('Delta banned'), reason: 'banned_word' },
    ]);
    expect(r.skipped).toEqual([
      { item_key: key('Echo stale'), reason: 'stale_hash' },
      { item_key: key('Golf held'), reason: 'held' },
      { item_key: key('Kilo other'), reason: 'not_found' },
    ]);
    expect(r.line).toBe('Wrote short versions of 2 long cards. The full notes stay one click away.');
    actionId = r.action_id!;
    const states = await prisma.homeItemState.findMany({ where: { user_id: ownerId, card_summary: { not: null } } });
    expect(states.map((s) => s.item_key).sort()).toEqual([key('Alpha long'), key('Foxtrot own list')].sort());
    const a = states.find((s) => s.item_key === key('Alpha long'))!;
    expect(a.card_summary_hash).toBe(hash('Alpha long'));
    expect(a.card_checklist).toEqual(['Send the draft', 'Get the sign off', 'Publish the page']);
    expect(a.card_summary_at?.toISOString()).toBe(NOW.toISOString());
    expect(states.find((s) => s.item_key === key('Foxtrot own list'))!.card_checklist).toBeNull();
    const act = await prisma.homeAction.findMany({ where: { user_id: ownerId, source: 'keeper' } });
    expect(act).toHaveLength(1);
    expect(act[0].action).toBe('keeper_summaries');
    expect(act[0].undo_until!.getTime() - NOW.getTime()).toBe(72 * 3600 * 1000);
    const after = act[0].after as { states: unknown[]; line: string; details: string[] };
    expect(after.states).toHaveLength(2);
    expect(after.details).toHaveLength(2);
    expect((act[0].before as { states: unknown[] }).states).toHaveLength(2);
    expect(await prisma.homeItemState.count({ where: { user_id: ownerId, item_key: { in: [key('Bravo toolong'), key('Charlie dash'), key('Delta banned'), key('Echo stale')] } } })).toBe(0);
    const c = await counts();
    expect({ ...c, task: before.task }).toEqual({ ...before });
  });

  it('a second POST of the same item is skipped as unchanged and writes nothing', async () => {
    const r = await saveSummaries(prisma, ownerId, NOW, [{ item_key: key('Alpha long'), hash: hash('Alpha long'), summary: 'Again.' }]);
    expect(r.saved).toBe(0);
    expect(r.skipped).toEqual([{ item_key: key('Alpha long'), reason: 'unchanged' }]);
    expect(r.action_id).toBeNull();
    expect(await prisma.homeAction.count({ where: { user_id: ownerId } })).toBe(1);
  });

  it('GET no longer lists the summarised cards', async () => {
    const ks = (await listSummaryWork(prisma, ownerId, NOW, 40)).items.map((i) => i.item_key);
    expect(ks).not.toContain(key('Alpha long'));
    expect(ks).not.toContain(key('Foxtrot own list'));
    expect(ks).toContain(key('Bravo toolong'));
  });

  it('the screen shows the summary, the muted marker data and the Done when list from the checklist', async () => {
    const a = await card('Alpha long');
    expect(a?.summary).toBe('Short version of the long note.');
    expect(a?.summary_by).toBe('bast');
    expect(a?.done_when.map((d) => d.text)).toEqual(['Send the draft', 'Get the sign off', 'Publish the page']);
    expect(a?.task_id).toBe(by.get('Alpha long')!.id);
    // A task with its own checklist keeps it.
    const f = await card('Foxtrot own list');
    expect(f?.summary).toBe('Has its own list.');
    expect(f?.done_when.map((d) => d.text)).toEqual(['Own one', 'Own two']);
  });

  it('the summary shows only while the hash matches: an edited description falls back and GET lists it again', async () => {
    const original = by.get('Alpha long')!.description!;
    await prisma.task.update({ where: { id: by.get('Alpha long')!.id }, data: { description: doc(longText('edited')) } });
    const o = await card('Alpha long');
    expect(o?.summary_by).toBeNull();
    expect(o?.summary).toContain('edited0');
    expect(o?.done_when).toEqual([]);
    const ks = (await listSummaryWork(prisma, ownerId, NOW, 40)).items.map((i) => i.item_key);
    expect(ks).toContain(key('Alpha long'));
    // Putting it back brings the summary back.
    await prisma.task.update({ where: { id: by.get('Alpha long')!.id }, data: { description: original } });
    expect((await card('Alpha long'))?.summary_by).toBe('bast');
  });

  it('the quiet line appears with Undo', async () => {
    const { resp } = await screen();
    const line = resp.sections.handled.find((h) => h.undo_action_id === actionId);
    expect(line?.text).toBe('Wrote short versions of 2 long cards. The full notes stay one click away.');
    expect(line?.details).toHaveLength(2);
  });

  it('Undo clears the summaries and holds the items so they are not summarised again', async () => {
    const r = await runHomeUndo(prisma, ownerId, actionId, NOW);
    expect(r.ok).toBe(true);
    for (const t of ['Alpha long', 'Foxtrot own list']) {
      const s = await prisma.homeItemState.findFirst({ where: { user_id: ownerId, item_key: key(t) } });
      expect(s?.card_summary).toBeNull();
      expect(s?.card_checklist).toBeNull();
      expect(s?.card_summary_hash).not.toBeNull();
      expect(s?.keeper_hold_until!.getTime()).toBe(NOW.getTime() + 30 * 24 * 3600 * 1000);
      const o = await card(t);
      expect(o?.summary_by).toBeNull();
    }
    const ks = (await listSummaryWork(prisma, ownerId, NOW, 40)).items.map((i) => i.item_key);
    expect(ks).not.toContain(key('Alpha long'));
    const again = await saveSummaries(prisma, ownerId, NOW, [{ item_key: key('Alpha long'), hash: hash('Alpha long'), summary: 'Back again.' }]);
    expect(again.saved).toBe(0);
    expect(again.skipped[0].reason).toBe('held');
    const { resp } = await screen();
    expect(resp.sections.handled.filter((h) => h.undo_action_id === actionId)).toHaveLength(0);
  });

  it('a single card says "a short version of 1 long card"', async () => {
    const r = await saveSummaries(prisma, ownerId, NOW, [{ item_key: key('Lima four'), hash: hash('Lima four'), summary: 'Lima in brief.' }]);
    expect(r.saved).toBe(1);
    expect(r.line).toBe('Wrote a short version of 1 long card. The full notes stay one click away.');
  });

  it('an owner who is not on the home view gets nothing and writes nothing', async () => {
    const before = await prisma.homeItemState.count();
    await prisma.userPreference.update({ where: { user_id: ownerId }, data: { home_view: 'overlook' } });
    expect(await listSummaryWork(prisma, ownerId, NOW, 40)).toEqual({ skipped: 'home_off', items: [] });
    const r = await saveSummaries(prisma, ownerId, NOW, [{ item_key: key('Bravo toolong'), hash: hash('Bravo toolong'), summary: 'Nope.' }]);
    expect(r.skipped_all).toBe('home_off');
    await prisma.userPreference.update({ where: { user_id: ownerId }, data: { home_view: 'home' } });
    expect(await prisma.homeItemState.count()).toBe(before);
    for (const id of [otherId, offId]) {
      expect((await listSummaryWork(prisma, id, NOW, 40)).skipped).toBe('home_off');
    }
  });

  it('other users have zero rows, and no Task or shared row changed', async () => {
    for (const id of [otherId, offId]) {
      expect(await prisma.homeItemState.count({ where: { user_id: id } })).toBe(0);
      expect(await prisma.homeAction.count({ where: { user_id: id } })).toBe(0);
    }
    const rows = await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, updated_at: true, description: true } });
    for (const r of rows) {
      if (r.id === by.get('Alpha long')!.id) continue; // this file edited it itself
      expect(r.updated_at.getTime()).toBe(taskSnapshot.get(r.id));
    }
    expect(await counts()).toEqual(baseline);
  });
});
