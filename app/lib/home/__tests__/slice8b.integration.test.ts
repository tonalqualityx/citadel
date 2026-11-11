// @vitest-environment node
/**
 * Slice 8b against a real Postgres: a project's next step as a row in Decisions ready. Through the loader, the selection, the
 * act route's reducer (step_done and its Undo), the keeper's plan, and the proof that no Project field, no shared record and
 * no other user's rows change.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s8b_it npx vitest run lib/home/__tests__/slice8b.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { assembleHomeResponse, proposeDay } from '../today';
import { runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { planStagger } from '../keeper/stagger';
import { stepKey, taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
/** Tuesday 2026-11-10, 10:00 Eastern. */
const NOW = new Date('2026-11-10T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!SCRATCH)('Slice 8b: project next steps (real database)', () => {
  const tag = `s8b-${Date.now()}`;
  const adminId = randomUUID();
  const sabeenId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const users = [adminId, sabeenId, techId, overlookAdminId];
  let clientId = '';
  const P: Record<string, string> = {};
  const taskIds: string[] = [];
  const STEP_TEXT = 'Mike, email Jack to accept the seven pages on the review site.';

  const screen = async (now: Date, userId = adminId) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    const sel = selectHome({ raw, states, now });
    const day = proposeDay(sel, raw.calendar_events, now);
    return { raw, states, sel, resp: assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now, timezone: TZ, user_id: userId }) };
  };
  const stepKeysIn = async (now: Date, userId = adminId) => {
    const { sel } = await screen(now, userId);
    return sel.candidates.filter((c) => c.kind === 'step').map((c) => c.key).sort();
  };
  const act = (now: Date, req: Parameters<typeof runHomeAct>[2], userId = adminId) => runHomeAct(prisma, userId, req, { now, timezone: TZ, date: zonedDateString(now, TZ) });

  const mkTask = async (assignee: string, project: string, title: string, updated: Date, over: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({
      data: { title, assignee_id: assignee, created_by_id: assignee, status: 'not_started', needs_review: false, tags: [tag], client_id: clientId, project_id: project, estimated_minutes: 20, created_at: updated, updated_at: updated, ...over },
    });
    taskIds.push(t.id);
    return t;
  };
  const mkProject = async (key: string, over: Record<string, unknown>) => {
    P[key] = (await prisma.project.create({ data: { name: `${key} ${tag}`, client_id: clientId, status: 'in_progress', ...over } })).id;
  };

  /** Every field of a project that "I did this" must leave alone, and every shared record around it. */
  async function snapshot() {
    const projects = await prisma.project.findMany({ where: { id: { in: Object.values(P) } }, orderBy: { id: 'asc' } });
    const tasks = await prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } });
    return JSON.stringify({ projects, tasks, outbox: await prisma.emailOutbox.count(), asks: await prisma.emailAsk.count(), waits: await prisma.wait.count(), comments: await prisma.comment.count() });
  }
  const otherUsers = async () =>
    JSON.stringify({
      actions: await prisma.homeAction.findMany({ where: { user_id: { in: [sabeenId, techId, overlookAdminId] } }, orderBy: { id: 'asc' } }),
      states: await prisma.homeItemState.findMany({ where: { user_id: { in: [sabeenId, techId, overlookAdminId] } }, orderBy: { id: 'asc' } }),
      days: await prisma.homeDay.findMany({ where: { user_id: { in: [sabeenId, techId, overlookAdminId] } }, orderBy: { id: 'asc' } }),
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 8B', role: 'admin' },
        { id: sabeenId, email: `sabeen-${tag}@example.test`, password_hash: 'x', name: 'Sabeen 8B', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 8B', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 8B', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: sabeenId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
      ],
    });
    clientId = (await prisma.client.create({ data: { name: `Client ${tag}`, status: 'active' } })).id;
    const stepAt = new Date('2026-11-10T08:00:00Z');
    const mine = { next_step_owner_id: adminId, next_step_source: 'bast' as const, next_step_text: STEP_TEXT, next_step_at: stepAt };
    await mkProject('shows', mine);
    await mkProject('showsMike', { ...mine, next_step_source: 'mike', next_step_text: 'Send Jack the invoice.' });
    await mkProject('hasTask', mine);
    await mkProject('sabeen', { ...mine, next_step_owner_id: sabeenId });
    await mkProject('graph', { ...mine, next_step_source: 'graph' });
    await mkProject('review', { ...mine, status: 'review' });
    await mkProject('noOwner', { next_step_owner_id: null, next_step_source: 'bast', next_step_text: 'Someone call the client.', next_step_at: stepAt });
    // The last task activity (the clock). Other people's tasks, so they are none of his items.
    await mkTask(sabeenId, P.shows, 'Quiet one', new Date('2026-10-20T15:00:00Z'));
    await mkTask(sabeenId, P.showsMike, 'Quiet two', new Date('2026-11-02T15:00:00Z'));
    await mkTask(sabeenId, P.sabeen, 'Quiet three', new Date('2026-10-20T15:00:00Z'));
    const contactId = (await prisma.clientContact.create({ data: { client_id: clientId, name: 'Jack Test', email: `jack-${tag}@client.example` } })).id;
    // His own task in view on hasTask: the step stays out.
    await mkTask(adminId, P.hasTask, 'His real task', new Date('2026-10-15T15:00:00Z'), { requested_by_contact_id: contactId });
  });

  afterAll(async () => {
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: Object.values(P) } } });
    await prisma.clientContact.deleteMany({ where: { client_id: clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('a step row shows for each in-progress project whose step is his, written by Bast or by him, and for no other', async () => {
    const keys = await stepKeysIn(NOW);
    expect(keys).toEqual([stepKey(P.shows), stepKey(P.showsMike)].sort());
    const { resp } = await screen(NOW);
    const row = resp.sections.next.find((i) => i.key === stepKey(P.shows))!;
    expect(row.title).toBe('Email Jack to accept the seven pages on the review site.');
    expect(row.why_now).toBe(`shows ${tag} · quiet 21 days`);
    expect(row.actions.map((a) => a.label)).toEqual(['Open the project', 'I did this', 'Not now']);
    expect(row.more_actions.map((a) => a.label)).toEqual(['This matters more', 'Snooze', 'Do it on a day']);
    expect(row.reason).toBe(`The next step on shows ${tag} is yours.`);
    // The quieter, older project reads as the longer wait, so it comes first.
    expect(resp.sections.next.map((i) => i.key).slice(0, 2)).toContain(stepKey(P.shows));
    // Nothing from scoring reaches the browser.
    expect(JSON.stringify(resp)).not.toMatch(/"(score|klass|class|urgency|importance|weight)"/);
  });

  it('a step of Sabeen\'s, a graph step, a project in review and a step with no owner never show; Sabeen sees her own', async () => {
    const keys = await stepKeysIn(NOW);
    for (const k of ['sabeen', 'graph', 'review', 'noOwner']) expect(keys).not.toContain(stepKey(P[k]));
    expect(await stepKeysIn(NOW, sabeenId)).toEqual([stepKey(P.sabeen)]);
  });

  it('a task of that project in view hides the step; parked, the step shows', async () => {
    expect(await stepKeysIn(NOW)).not.toContain(stepKey(P.hasTask));
    const { sel } = await screen(NOW);
    expect(sel.byKey.get(taskKey(taskIds[taskIds.length - 1]))!.inView).toBe(true);
    const res = await act(NOW, { action: 'not_now', item_key: taskKey(taskIds[taskIds.length - 1]) });
    expect(await stepKeysIn(NOW)).toContain(stepKey(P.hasTask));
    await runHomeUndo(prisma, adminId, res.action_id, new Date(NOW.getTime() + 60_000));
    expect(await stepKeysIn(NOW)).not.toContain(stepKey(P.hasTask));
  });

  it('step_done writes only his state row, hides the row, and changes no Project field or shared record', async () => {
    const sharedBefore = await snapshot();
    const others = await otherUsers();
    const res = await act(NOW, { action: 'step_done', item_key: stepKey(P.shows) });
    expect(res.message).toBe('Bast will read the project again in a few minutes.');
    const st = await prisma.homeItemState.findFirstOrThrow({ where: { user_id: adminId, item_key: stepKey(P.shows) } });
    expect(st.step_done_at?.toISOString()).toBe(NOW.toISOString());
    expect(st.step_done_text).toBe(STEP_TEXT);
    expect(await snapshot()).toBe(sharedBefore);
    expect(await otherUsers()).toBe(others);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P.shows } })).next_step_refresh_requested_at).toBeNull();
    expect(await stepKeysIn(NOW)).not.toContain(stepKey(P.shows));
    // Undo within the day brings the row back and removes the state row it made.
    await runHomeUndo(prisma, adminId, res.action_id, new Date(NOW.getTime() + 3_600_000));
    expect(await stepKeysIn(NOW)).toContain(stepKey(P.shows));
    expect(await prisma.homeItemState.count({ where: { user_id: adminId, item_key: stepKey(P.shows) } })).toBe(0);
    expect(await snapshot()).toBe(sharedBefore);
  });

  it('step_done refuses a step that is not his, a project in review, and writes nothing', async () => {
    const before = await prisma.homeAction.count({ where: { user_id: adminId } });
    for (const k of ['sabeen', 'review', 'graph', 'noOwner']) {
      await expect(act(NOW, { action: 'step_done', item_key: stepKey(P[k]) })).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(await prisma.homeAction.count({ where: { user_id: adminId } })).toBe(before);
    expect(await prisma.homeItemState.count({ where: { user_id: adminId, item_key: { startsWith: 'step:' } } })).toBe(0);
  });

  it('after I did this the row hides until Bast rewrites the step or two business days pass; the same text shows the "still" line', async () => {
    await act(NOW, { action: 'step_done', item_key: stepKey(P.shows) });
    const wed = new Date(NOW.getTime() + DAY);
    expect(await stepKeysIn(wed)).not.toContain(stepKey(P.shows));
    // Thursday after 5 pm: the second business day has completed. Same text, so the "still" line.
    const thu = new Date('2026-11-12T22:30:00Z');
    const { resp } = await screen(thu);
    const back = [...resp.sections.next, ...resp.everything_else.groups.flatMap((g) => g.items)].find((i) => i.key === stepKey(P.shows));
    expect(back).toBeTruthy();
    const full = resp.sections.next.find((i) => i.key === stepKey(P.shows));
    if (full) expect(full.why_now).toContain('Bast still reads this as the next step.');
    // A rewrite after the tap brings it back at once, with the new words and no "still" line.
    await prisma.project.update({ where: { id: P.shows }, data: { next_step_text: 'Mike, book the launch call with Jack.', next_step_at: new Date(NOW.getTime() + 60_000) } });
    const r2 = (await screen(new Date(NOW.getTime() + 120_000))).resp.sections.next.find((i) => i.key === stepKey(P.shows));
    expect(r2?.title).toBe('Book the launch call with Jack.');
    expect(r2?.why_now).not.toContain('still');
    // A rewrite to the same words as before: the "still" line.
    await prisma.homeItemState.update({ where: { user_id_item_key: { user_id: adminId, item_key: stepKey(P.shows) } }, data: { step_done_text: 'Mike, book the launch call with Jack.' } });
    const r3 = (await screen(new Date(NOW.getTime() + 120_000))).resp.sections.next.find((i) => i.key === stepKey(P.shows));
    expect(r3?.why_now).toContain('Bast still reads this as the next step.');
    await prisma.project.update({ where: { id: P.shows }, data: { next_step_text: STEP_TEXT, next_step_at: new Date('2026-11-10T08:00:00Z') } });
    await prisma.homeItemState.deleteMany({ where: { user_id: adminId, item_key: stepKey(P.shows) } });
  });

  it('the keeper gives a step no day and never lists it in its pool; it is never a Today step or Quick', async () => {
    const { sel, states, resp } = await screen(NOW);
    const changes = planStagger(sel, states, NOW, TZ);
    expect(changes.some((c) => c.item_key.startsWith('step:'))).toBe(false);
    for (const c of sel.candidates.filter((x) => x.kind === 'step')) {
      expect(c.restGroup).not.toBe('waiting_turn');
      expect(c.state?.view_set_by ?? null).not.toBe('keeper');
    }
    const today = resp.today;
    const todayKeys = today ? [...today.quick.map((i) => i.key), ...today.steps.map((i) => i.key)] : [];
    expect(todayKeys.some((k) => k.startsWith('step:'))).toBe(false);
    expect(await prisma.homeItemState.count({ where: { user_id: adminId, view_set_by: 'keeper' } })).toBe(0);
  });

  it('Not now parks a step in Parked by you with its day, and This matters more puts it first', async () => {
    const res = await act(NOW, { action: 'not_now', item_key: stepKey(P.showsMike) });
    const { sel } = await screen(NOW);
    expect(sel.byKey.get(stepKey(P.showsMike))!.restGroup).toBe('parked');
    await runHomeUndo(prisma, adminId, res.action_id, new Date(NOW.getTime() + 1000));
    await act(NOW, { action: 'matters_more', item_key: stepKey(P.showsMike) });
    expect((await screen(NOW)).resp.sections.next[0].key).toBe(stepKey(P.showsMike));
    await prisma.homeItemState.deleteMany({ where: { user_id: adminId, item_key: stepKey(P.showsMike) } });
  });

  it('other users are untouched: no rows for the tech, overlook or Sabeen screens, and the tech and overlook users get no step rows', async () => {
    expect(await prisma.homeAction.count({ where: { user_id: { in: [sabeenId, techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeItemState.count({ where: { user_id: { in: [sabeenId, techId, overlookAdminId] } } })).toBe(0);
    expect(await stepKeysIn(NOW, techId)).toEqual([]);
    expect(await stepKeysIn(NOW, overlookAdminId)).toEqual([]);
  });
});
