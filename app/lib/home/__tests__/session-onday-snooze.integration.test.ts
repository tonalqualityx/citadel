// @vitest-environment node
/**
 * Session card "Clear it", "Do it on a day" and "Snooze" against a real Postgres. Through the loader, the selection, the act
 * reducer and its Undo, the keeper's plan and the Slack planner, with a fake clock, and the proof that no OracleSession row, no
 * Task row and no other user's row changes.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/sfix_it npx vitest run lib/home/__tests__/session-onday-snooze.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs, loadSessionAsksFor } from '../load';
import { getHomeDay, loadItemStates } from '../state';
import { ensureHomeDay } from '../ensure-day';
import { selectHome } from '../select';
import { assembleHomeResponse, proposeDay } from '../today';
import { runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { applyWatch, watchBodySchema } from '../emergency/store';
import { planStagger } from '../keeper/stagger';
import { sessionKey, taskKey } from '../item-key';
import { sessionAskHash } from '../session-clear';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const HOUR = 3_600_000;
const MIN = 60_000;
/** November 2026 on his wall clock (Eastern standard time, UTC-5). Tuesday is the 10th. */
const at = (d: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, d, h + 5, mi));

describe.skipIf(!SCRATCH)('session clear, on_day and snooze (real database)', () => {
  const tag = `sos-${Date.now()}`;
  const adminId = randomUUID();
  const otherId = randomUUID();
  const users = [adminId, otherId];
  const taskIds: string[] = [];
  const sessionIds: string[] = [];
  let machineId = '';
  const clientIds: string[] = [];
  let emergencyId = '';
  let certId = '';
  let nextId = '';
  const extId = `sess-${tag}`;

  const screen = async (now: Date, userId = adminId) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    const sel = selectHome({ raw, states, now });
    // As GET /api/home does: the stored day for today when there is one, else the proposal.
    const stored = await getHomeDay(prisma, userId, zonedDateString(now, TZ));
    const day = stored ?? proposeDay(sel, raw.calendar_events, now);
    const resp = assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now, timezone: TZ, user_id: userId });
    return { raw, states, sel, resp };
  };
  const where = async (now: Date, key: string) => {
    const { resp, sel } = await screen(now);
    const parked = resp.everything_else.groups.find((g) => g.key === 'parked')?.items.find((i) => i.key === key);
    return {
      needs: resp.sections.needs_you_now.some((i) => i.key === key),
      next: resp.sections.next.some((i) => i.key === key),
      working: resp.sections.working_on.some((i) => i.key === key),
      quick: !!resp.today?.quick.some((i) => i.key === key),
      steps: !!resp.today?.steps.some((i) => i.key === key),
      parked: parked?.check_text ?? null,
      item: [...resp.sections.needs_you_now, ...resp.sections.next, ...(resp.today?.quick ?? [])].find((i) => i.key === key) ?? null,
      cand: sel.byKey.get(key),
    };
  };
  const act = (now: Date, req: Parameters<typeof runHomeAct>[2], userId = adminId) => runHomeAct(prisma, userId, req, { now, timezone: TZ, date: zonedDateString(now, TZ) });
  const undo = (now: Date, id: string) => runHomeUndo(prisma, adminId, id, now);
  const stateOf = (key: string, userId = adminId) => prisma.homeItemState.findUnique({ where: { user_id_item_key: { user_id: userId, item_key: key } } });
  const watch = (now: Date) => applyWatch(prisma, adminId, watchBodySchema.parse({ kuma: null, checks: [], caps: ['slack'] }), now);

  const sharedSnapshot = async () =>
    JSON.stringify({
      tasks: await prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' } }),
      sessions: await prisma.oracleSession.findMany({ where: { id: { in: sessionIds } }, orderBy: { id: 'asc' } }),
    });
  const otherUserRows = async () =>
    JSON.stringify({
      actions: await prisma.homeAction.findMany({ where: { user_id: otherId }, orderBy: { id: 'asc' } }),
      states: await prisma.homeItemState.findMany({ where: { user_id: otherId }, orderBy: { id: 'asc' } }),
      days: await prisma.homeDay.findMany({ where: { user_id: otherId }, orderBy: { id: 'asc' } }),
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin SOS', role: 'admin' },
        { id: otherId, email: `other-${tag}@example.test`, password_hash: 'x', name: 'Other SOS', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: otherId, home_view: 'home', timezone: TZ },
      ],
    });
    await prisma.homeKeeperSettings.create({ data: { user_id: adminId, emergency_slack: true } });
    // A lifeline task with a hard date (an emergency: Needs you now and Quick), and a fresh plain task (Next).
    // Two lifelines of two clients. The checkout form is the day's top item, so it sits in today's steps; the certificate (the other client) lands in Quick.
    const [ca, cb] = await Promise.all([prisma.client.create({ data: { name: `A ${tag}`, status: 'active' } }), prisma.client.create({ data: { name: `B ${tag}`, status: 'active' } })]);
    clientIds.push(ca.id, cb.id);
    const mk = (title: string, client: string, due: string) =>
      prisma.task.create({
        data: { title, status: 'not_started', tags: ['lifeline'], assignee_id: adminId, created_by_id: adminId, needs_review: false, estimated_minutes: 10, client_id: client, due_date: new Date(`${due}T00:00:00Z`), created_at: at(2, 9), updated_at: at(2, 9) },
      });
    const cert = await mk('Renew the certificate', ca.id, '2026-11-11');
    const e = await mk('Fix the checkout form', cb.id, '2026-11-12');
    certId = e.id;
    taskIds.push(e.id);
    const n = await prisma.task.create({
      data: { title: 'Reply to the printer', status: 'not_started', tags: [tag], assignee_id: adminId, created_by_id: adminId, needs_review: false, estimated_minutes: 20, created_at: at(10, 9), updated_at: at(10, 9) },
    });
    emergencyId = cert.id;
    nextId = n.id;
    taskIds.push(cert.id, n.id);
    // "This matters more" on the checkout form makes it the top item whatever else is in view, so the day's group is its client.
    await prisma.homeItemState.create({ data: { user_id: adminId, item_key: taskKey(e.id), boosted_at: at(1, 9) } });
    machineId = (await prisma.oracleMachine.create({ data: { name: `m-${tag}`, hostname: `h-${tag}` } as never })).id;
    const s = await prisma.oracleSession.create({
      data: { machine_id: machineId, external_id: extId, source: 'claude_code', title: 'Griswold chatbot', status: 'running', waiting_on: 'Pick the tone for the welcome message.', ask_queue: 'decide', last_event_at: at(10, 8) },
    });
    sessionIds.push(s.id);
  });

  afterAll(async () => {
    await prisma.homeEmergencyWatch.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperSettings.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } });
    await prisma.oracleSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.oracleMachine.deleteMany({ where: { id: machineId } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  describe('session card: Clear it', () => {
    const KEY = () => sessionKey(extId);
    it('a waiting session shows, with Clear it beside Open the session and Not now', async () => {
      const w = await where(at(10, 10), KEY());
      const row = w.cand;
      expect(row).toBeTruthy();
      expect(row?.item.actions.map((a) => a.id)).toContain('clear_session');
      expect(row?.item.actions.map((a) => a.label)).toContain('Clear it');
    });

    let clearedAction = '';
    it('clear_session hides it at once, says the line, and writes no OracleSession change', async () => {
      const before = await sharedSnapshot();
      const res = await act(at(10, 10, 5), { action: 'clear_session', item_key: KEY() });
      clearedAction = res.action_id;
      expect(res.message).toBe('Cleared. It comes back if the session asks something new.');
      expect((await loadSessionAsksFor(prisma, adminId)).some((a) => a.external_id === extId)).toBe(false);
      expect((await screen(at(10, 10, 6))).raw.session_asks).toEqual([]);
      expect(await sharedSnapshot()).toBe(before);
      const st = await stateOf(KEY());
      expect(st?.session_cleared_hash).toBe(sessionAskHash('Pick the tone for the welcome message.'));
    });

    it('the same text stays hidden after a simulated heartbeat that re-sends it', async () => {
      await prisma.oracleSession.update({ where: { id: sessionIds[0] }, data: { waiting_on: 'Pick the tone for the welcome message.', last_event_at: at(10, 11), updated_at: at(10, 11) } });
      expect((await screen(at(10, 11, 5))).raw.session_asks).toEqual([]);
    });

    it('measures, keeper and Slack see it as gone: it is in no list and no candidate', async () => {
      const { sel } = await screen(at(10, 11, 5));
      expect(sel.byKey.has(KEY())).toBe(false);
      expect((await watch(at(10, 11, 5))).lines.some((l) => l.text.includes('tone'))).toBe(false);
    });

    it('a new text shows again', async () => {
      await prisma.oracleSession.update({ where: { id: sessionIds[0] }, data: { waiting_on: 'Pick the tone, and the sender name.', last_event_at: at(10, 12) } });
      const { raw } = await screen(at(10, 12, 5));
      expect(raw.session_asks.map((a) => a.external_id)).toEqual([extId]);
    });

    it('Undo brings the old state back (the cleared text is forgotten)', async () => {
      await prisma.oracleSession.update({ where: { id: sessionIds[0] }, data: { waiting_on: 'Pick the tone for the welcome message.' } });
      expect((await screen(at(10, 12, 6))).raw.session_asks).toEqual([]);
      await undo(at(10, 12, 7), clearedAction);
      expect((await screen(at(10, 12, 8))).raw.session_asks.map((a) => a.external_id)).toEqual([extId]);
      expect(await stateOf(KEY())).toBeNull();
    });

    it('other users are untouched: they still see it, and nothing of theirs changed', async () => {
      const otherBefore = await otherUserRows();
      await act(at(10, 13), { action: 'clear_session', item_key: KEY() });
      expect((await screen(at(10, 13, 1), otherId)).raw.session_asks.map((a) => a.external_id)).toEqual([extId]);
      expect(await otherUserRows()).toBe(otherBefore);
      expect(await stateOf(KEY(), otherId)).toBeNull();
    });
  });

  describe('on_day', () => {
    const KEY = () => taskKey(emergencyId);
    let actionId = '';
    it('before: the emergency is in Needs you now and Quick', async () => {
      await ensureHomeDay(prisma, adminId, at(10, 10), TZ);
      const w = await where(at(10, 10), KEY());
      expect(w.needs).toBe(true);
      expect(w.quick).toBe(true);
    });

    it('refuses today, the past and 61 days out with 400 and a plain line', async () => {
      await expect(act(at(10, 10), { action: 'on_day', item_key: KEY(), date: '2026-11-10' })).rejects.toMatchObject({ statusCode: 400, message: 'Pick a day after today.' });
      await expect(act(at(10, 10), { action: 'on_day', item_key: KEY(), date: '2026-11-01' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(act(at(10, 10), { action: 'on_day', item_key: KEY(), date: '2027-01-10' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('leaves Needs you now, Quick, today steps, People and Next until that day; no Task change; park count and weights untouched', async () => {
      await screen(at(10, 10)); // store nothing; make sure today's day row exists as the screen would
      const before = await sharedSnapshot();
      const res = await act(at(10, 10, 5), { action: 'on_day', item_key: KEY(), date: '2026-11-19' });
      actionId = res.action_id;
      expect(res.message).toBe('Set for Thursday, November 19. Its date is Wednesday, 8 days before.');
      const w = await where(at(10, 10, 6), KEY());
      expect([w.needs, w.quick, w.steps, w.next, w.working]).toEqual([false, false, false, false, false]);
      expect(w.parked).toBe('Back Thursday, November 19. You picked the day.');
      expect(await sharedSnapshot()).toBe(before);
      const st = await stateOf(KEY());
      expect(st?.park_count).toBe(0);
      expect(st?.view_set_by).toBe('user');
      expect(st?.parked_at).toBeTruthy();
      expect(st?.on_day?.toISOString().slice(0, 10)).toBe('2026-11-19');
      expect(st?.view_at?.toISOString()).toBe(at(19, 0, 5).toISOString());
    });

    it('the Slack "still waiting" line is suppressed while it is held, and so is a repeat first line', async () => {
      const first = await watch(at(10, 11));
      expect(first.lines.filter((l) => l.kind === 'first' || l.kind === 'again').some((l) => l.text.includes('certificate'))).toBe(false);
    });

    it('the keeper never moves a user-parked item', async () => {
      const { sel, states } = await screen(at(10, 22));
      const plan = planStagger(sel, states, at(10, 22), TZ);
      expect(JSON.stringify(plan)).not.toContain(emergencyId);
    });

    it('the day before: still out. On the day it returns at the top with "You said today."', async () => {
      expect((await where(at(18, 12), KEY())).needs).toBe(false);
      const w = await where(at(19, 9), KEY());
      expect(w.needs).toBe(true);
      expect(w.item?.why_now).toBe('You said today.');
      expect(w.item?.reason).toBe('You said you would do this today.');
      const { resp } = await screen(at(19, 9));
      expect(resp.sections.needs_you_now[0].key).toBe(KEY());
    });

    it('the next day it is an ordinary emergency again', async () => {
      const w = await where(at(20, 9), KEY());
      expect(w.needs).toBe(true);
      expect(w.item?.why_now).not.toBe('You said today.');
    });

    it('Undo restores exactly what was there', async () => {
      await undo(at(10, 12), actionId);
      const w = await where(at(10, 12, 1), KEY());
      expect(w.needs).toBe(true);
      expect(w.quick).toBe(true);
      expect(await stateOf(KEY())).toBeNull();
    });

    it('a step in today\'s arc leaves the steps and the stored day row (no arc_removed marker), and Undo puts it back', async () => {
      const ck = taskKey(certId);
      const date = zonedDateString(at(10, 13), TZ);
      expect((await getHomeDay(prisma, adminId, date))?.step_item_keys).toContain(ck);
      const r = await act(at(10, 13), { action: 'on_day', item_key: ck, date: '2026-11-13' });
      expect((await getHomeDay(prisma, adminId, date))?.step_item_keys).not.toContain(ck);
      expect((await where(at(10, 13, 1), ck)).steps).toBe(false);
      expect((await stateOf(ck))?.arc_removed_at).toBeNull();
      await undo(at(10, 13, 2), r.action_id);
      expect((await getHomeDay(prisma, adminId, date))?.step_item_keys).toContain(ck);
    });

    it('other users are untouched', async () => {
      const otherBefore = await otherUserRows();
      const r = await act(at(10, 13), { action: 'on_day', item_key: taskKey(nextId), date: '2026-11-12' });
      expect(await otherUserRows()).toBe(otherBefore);
      expect((await screen(at(10, 13, 1), otherId)).raw.session_asks.length).toBeGreaterThanOrEqual(0);
      await undo(at(10, 13, 2), r.action_id);
    });
  });

  describe('snooze', () => {
    const KEY = () => taskKey(nextId);
    const EKEY = () => taskKey(emergencyId);
    it('refuses under 15 minutes and over 24 hours', async () => {
      await expect(act(at(10, 14), { action: 'snooze', item_key: KEY(), until: at(10, 14, 10).toISOString() })).rejects.toMatchObject({ statusCode: 400 });
      await expect(act(at(10, 14), { action: 'snooze', item_key: KEY(), until: new Date(at(10, 14).getTime() + 25 * HOUR).toISOString() })).rejects.toMatchObject({ statusCode: 400, message: 'Pick a day instead.' });
    });

    let first = '';
    it('leaves every list incl. Quick until the instant, then returns to its place with "Back from a snooze." and no boost', async () => {
      const before = await sharedSnapshot();
      const start = at(10, 14);
      const wBefore = await where(start, EKEY());
      expect(wBefore.quick).toBe(true);
      const r = await act(start, { action: 'snooze', item_key: EKEY(), hours: 3 });
      first = r.action_id;
      expect(r.message).toBe('Snoozed until 5:00.');
      const during = await where(new Date(start.getTime() + 2 * HOUR), EKEY());
      expect([during.needs, during.quick, during.steps]).toEqual([false, false, false]);
      expect(during.parked).toBe('Back at 5:00 today. Snoozed.');
      const back = await where(new Date(start.getTime() + 3 * HOUR + MIN), EKEY());
      expect(back.needs).toBe(true);
      expect(back.quick).toBe(true);
      expect(back.item?.why_now).toBe('Back from a snooze.');
      expect(back.cand?.boosted).toBe(false);
      expect(await sharedSnapshot()).toBe(before);
      const st = await stateOf(EKEY());
      expect(st?.park_count).toBe(0);
      expect(st?.snooze_count).toBe(1);
    });

    it('Slack: no first or still-waiting line during the snooze; the lifeline daily line is unchanged', async () => {
      const mid = await watch(at(10, 15, 30));
      expect(mid.lines.filter((l) => l.kind !== 'lifeline' && l.text.includes('certificate'))).toEqual([]);
    });

    it('the third snooze of the same item on the same day adds the sentence; the first two do not', async () => {
      const t1 = at(11, 9);
      const a = await act(t1, { action: 'snooze', item_key: KEY(), hours: 1 });
      expect(a.message).toBe('Snoozed until 10:00.');
      const b = await act(new Date(t1.getTime() + 61 * MIN), { action: 'snooze', item_key: KEY(), hours: 1 });
      expect(b.message).toBe('Snoozed until 11:01.');
      const c = await act(new Date(t1.getTime() + 123 * MIN), { action: 'snooze', item_key: KEY(), hours: 1 });
      expect(c.message).toBe('Snoozed until 12:03. That is the third time today.');
      expect((await stateOf(KEY()))?.snooze_count).toBe(3);
      first = c.action_id;
    });

    it('Undo puts the previous state back (window ends with the snooze)', async () => {
      const t = new Date(at(11, 9).getTime() + 124 * MIN);
      const row = await prisma.homeAction.findUniqueOrThrow({ where: { id: first } });
      expect(row.undo_until && row.undo_until.getTime() <= new Date(at(11, 9).getTime() + 123 * MIN + HOUR).getTime()).toBe(true);
      await undo(t, first);
      expect((await stateOf(KEY()))?.snooze_count).toBe(2);
    });

    it('it does not count as a Not now for the learner', async () => {
      const rows = await prisma.homeAction.findMany({ where: { user_id: adminId, action: 'snooze' } });
      expect(rows.length).toBeGreaterThan(0);
      const { DOWN_ACTIONS } = await import('../learn/signals');
      expect((DOWN_ACTIONS as readonly string[]).includes('snooze')).toBe(false);
      expect((DOWN_ACTIONS as readonly string[]).includes('on_day')).toBe(false);
    });

    it('a date before the snooze ends is said plainly, and it still applies', async () => {
      const r = await act(at(10, 14, 30), { action: 'snooze', item_key: EKEY(), until: at(11, 13, 30).toISOString() });
      expect(r.message).toBe('Snoozed until Wednesday 1:30. Its date is tomorrow.');
      await undo(at(10, 14, 31), r.action_id);
      expect((await stateOf(EKEY()))?.snooze_count).toBe(1);
    });

    it('other users are untouched', async () => {
      const otherBefore = await otherUserRows();
      await act(at(12, 9), { action: 'snooze', item_key: KEY(), hours: 2 });
      expect(await otherUserRows()).toBe(otherBefore);
      expect(await stateOf(KEY(), otherId)).toBeNull();
    });
  });
});
