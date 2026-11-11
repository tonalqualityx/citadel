// @vitest-environment node
/**
 * Slice 6a against a real Postgres, through the whole screen: "Not an emergency" rules (save, hide, undo), site down rows
 * (the 10 minute rule, the second check closing a mail), the Monday hands row (Monday on, Saturday off, Not this week) and
 * the proof that other users and every shared record stay as they were.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It seeds its own users, client, sites, asks and
 * tasks and removes only those. Run on its own clean database (other slices' files count global rows):
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s6a_it npx vitest run lib/home/__tests__/slice6a.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { assembleHomeResponse, proposeDay } from '../today';
import { runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { applyWatch, saveNotEmergencyRule, undoNotEmergencyRule, watchBodySchema } from '../emergency/store';
import { siteItemKey } from '../emergency/site';
import { HANDS_ITEM_KEY } from '../emergency/hands';
import { crisisKey, taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
/** Monday 2026-11-09, 10:00 Eastern. */
const MON = new Date('2026-11-09T15:00:00Z');
/** Saturday 2026-11-14, 10:00 Eastern. */
const SAT = new Date('2026-11-14T15:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe.skipIf(!SCRATCH)('Slice 6a: rules, site down rows and the hands row (real database)', () => {
  const tag = `s6a-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const ids = [adminId, techId, overlookAdminId];
  const clientId = randomUUID();
  const kumaSiteId = randomUUID();
  const youngSiteId = randomUUID();
  const mailSiteId = randomUUID();
  const hostKuma = `${tag}-kuma.com`;
  const hostYoung = `${tag}-young.com`;
  const hostMail = `${tag}-mail.com`;
  const sender = `alerts@${tag}-wpmu.example`;
  const askIds: string[] = [];
  const taskIds: string[] = [];
  const decisionKeys: string[] = [];

  const ask = async (from: string, subject: string, over: Record<string, unknown> = {}) => {
    const row = await prisma.emailAsk.create({
      data: {
        message_id: `${tag}-${askIds.length}`,
        thread_id: `${tag}-th-${askIds.length}`,
        account: `owner-${tag}@example.test`,
        from_name: 'Sender',
        from_email: from,
        subject,
        queue: 'do',
        severity: 'internal',
        is_urgent: true,
        state: 'open',
        deep_link: `https://mail.example.test/${tag}/${askIds.length}`,
        received_at: new Date(MON.getTime() - 3 * HOUR),
        ...over,
      },
    });
    askIds.push(row.id);
    return row;
  };
  const task = async (title: string, tags: string[], over: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({
      data: { title, status: 'not_started', tags, assignee_id: adminId, created_by_id: adminId, needs_review: false, estimated_minutes: 10, created_at: new Date(MON.getTime() - 9 * DAY), ...over },
    });
    taskIds.push(t.id);
    return t;
  };

  async function screen(now: Date, userId = adminId) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    const sel = selectHome({ raw, states, now });
    const day = proposeDay(sel, raw.calendar_events, now);
    return { sel, resp: assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now, timezone: TZ, user_id: userId }) };
  }
  const needsKeys = async (now: Date) => (await screen(now)).resp.sections.needs_you_now.map((i) => i.key);
  const kuma = (domain: string, startedMinAgo: number, now: Date) => ({ monitor: `m-${domain}`, domain, client_id: clientId, started: new Date(now.getTime() - startedMinAgo * MIN).toISOString(), escalated: true });
  const body = (b: unknown) => watchBodySchema.parse(b);
  const act = (now: Date, req: Parameters<typeof runHomeAct>[2]) => runHomeAct(prisma, adminId, req, { now, timezone: TZ, date: zonedDateString(now, TZ) });

  /** Everything a rule save, a watch report or a screen load must never change. */
  async function shared() {
    const tasks = await prisma.task.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, tags: true, updated_at: true } });
    const asks = await prisma.emailAsk.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, is_urgent: true, updated_at: true } });
    const sites = await prisma.site.findMany({ orderBy: { id: 'asc' }, select: { id: true, url: true, updated_at: true } });
    const outbox = await prisma.emailOutbox.count();
    return JSON.stringify({ tasks, asks, sites, outbox });
  }
  const otherUsers = async () =>
    JSON.stringify({
      actions: await prisma.homeAction.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      states: await prisma.homeItemState.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      incidents: await prisma.homeSiteIncident.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      days: await prisma.homeDay.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 6a', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 6a', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 6a', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
      ],
    });
    await prisma.client.create({ data: { id: clientId, name: `Client ${tag}`, status: 'active' } });
    await prisma.site.createMany({
      data: [
        { id: kumaSiteId, name: 'Kuma', url: `https://${hostKuma}`, client_id: clientId },
        { id: youngSiteId, name: 'Young', url: `https://${hostYoung}`, client_id: clientId },
        { id: mailSiteId, name: 'Mail', url: `https://www.${hostMail}/`, client_id: clientId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { key: { in: decisionKeys } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeSiteIncident.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.emailAsk.deleteMany({ where: { id: { in: askIds } } });
    await prisma.site.deleteMany({ where: { id: { in: [kumaSiteId, youngSiteId, mailSiteId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  describe('a rule on a crisis sender', () => {
    let first: Awaited<ReturnType<typeof ask>>;
    let actionId = '';
    let sharedBefore = '';

    it('before the rule the crisis is in Needs you now, with the choices', async () => {
      first = await ask(sender, 'Plugin update needed');
      const r = await screen(MON);
      const item = r.resp.sections.needs_you_now.find((i) => i.key === crisisKey(first.id));
      expect(item).toBeDefined();
      expect(item!.not_emergency_scopes?.map((s) => s.scope)).toEqual(['sender', 'domain']);
    });

    it('saving the rule writes one Decision and changes no task, ask, site or outbox row', async () => {
      sharedBefore = await shared();
      const others = await otherUsers();
      const decisionsBefore = await prisma.decision.count();
      const res = await saveNotEmergencyRule(prisma, adminId, { item_key: crisisKey(first.id), scope: 'sender', reason: 'Weekly report' }, MON);
      decisionKeys.push(res.rule.key);
      actionId = res.action_id;
      expect(res.rule).toMatchObject({ kind: 'sender', value: sender, revision: 1 });
      expect(await prisma.decision.count()).toBe(decisionsBefore + 1);
      expect(await prisma.decision.count({ where: { lane: 'home-emergency' } })).toBe(1);
      expect(await shared()).toBe(sharedBefore);
      expect(await otherUsers()).toBe(others);
      // the other users have no rule: their loader reads none
      expect((await loadHomeInputs(prisma, overlookAdminId, MON, { timezone: TZ })).not_emergency_rules).toEqual([]);
    });

    it('the pressed mail and the next crisis from that sender stay out of Needs you now, and the line is under Handled for you', async () => {
      const next = await ask(sender, 'Another notice', { received_at: new Date(MON.getTime() - HOUR) });
      const other = await ask(`boss@${tag}-client.example`, 'Please call me');
      const keys = await needsKeys(MON);
      expect(keys).not.toContain(crisisKey(first.id));
      expect(keys).not.toContain(crisisKey(next.id));
      expect(keys).toContain(crisisKey(other.id));
      const r = await screen(MON);
      const line = r.resp.sections.handled.find((h) => h.text.startsWith('Saved a rule:'));
      expect(line?.text).toBe(`Saved a rule: mail from ${sender} is not an emergency.`);
      expect(line?.undo_action_id).toBe(actionId);
      expect(r.sel.byKey.get(crisisKey(next.id))!.section).toBe('rest');
    });

    it('the generic undo refuses the rule action and the rule stays', async () => {
      await expect(runHomeUndo(prisma, adminId, actionId, MON)).rejects.toMatchObject({ code: 'not_undoable', statusCode: 409 });
      expect((await needsKeys(MON)).includes(crisisKey(first.id))).toBe(false);
    });

    it('undo through the rule store brings the mail back, and the Decision is retracted', async () => {
      await undoNotEmergencyRule(prisma, adminId, actionId, new Date(MON.getTime() + HOUR));
      const keys = await needsKeys(MON);
      expect(keys).toContain(crisisKey(first.id));
      expect((await prisma.decision.findFirstOrThrow({ where: { key: decisionKeys[0] } })).status).toBe('retracted');
      const r = await screen(MON);
      expect(r.resp.sections.handled.some((h) => h.text.startsWith('Saved a rule:'))).toBe(false);
    });

    it('a rule on a task item is refused with the security sentence, and no Task changed', async () => {
      const security = await task('Patch the site (6a)', ['security'], { client_id: clientId });
      const snap = await shared();
      const decisions = await prisma.decision.count();
      const err = await saveNotEmergencyRule(prisma, adminId, { item_key: taskKey(security.id), scope: 'sender' }, MON).catch((e) => e);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('A security flag is never turned into a rule.');
      expect(await prisma.decision.count()).toBe(decisions);
      expect(await shared()).toBe(snap);
      const item = (await screen(MON)).resp.sections.needs_you_now.find((i) => i.key === taskKey(security.id));
      expect(item?.not_emergency_refusal).toBe('A security flag is never turned into a rule.');
      expect(item?.not_emergency_scopes).toBeUndefined();
      await prisma.task.update({ where: { id: security.id }, data: { status: 'done' } });
    });

    it('Decision rows exist only for the pressed rule', async () => {
      const rows = await prisma.decision.findMany({ where: { lane: 'home-emergency' } });
      expect(rows.map((r) => r.key)).toEqual(decisionKeys);
      expect(await prisma.decision.count({ where: { key: { startsWith: 'home-not-emergency:' } } })).toBe(1);
    });

    it('the chat-facing act schema cannot save a rule: a one-time not_emergency writes no Decision', async () => {
      const a = await ask(`x@${tag}-other.example`, 'One more');
      const decisions = await prisma.decision.count();
      await act(MON, { action: 'not_emergency', item_key: crisisKey(a.id) });
      expect(await prisma.decision.count()).toBe(decisions);
      expect(await needsKeys(MON)).not.toContain(crisisKey(a.id));
    });
  });

  describe('site down rows', () => {
    it('a watchdog incident 5 minutes old is not shown, and at 12 minutes it is', async () => {
      const sharedBefore = await shared();
      await applyWatch(prisma, adminId, body({ kuma: [kuma(hostYoung, 5, MON)], checks: [] }), MON);
      expect(await needsKeys(MON)).not.toContain(siteItemKey(youngSiteId));
      const later = new Date(MON.getTime() + 7 * MIN);
      await applyWatch(prisma, adminId, body({ kuma: [kuma(hostYoung, 12, later)], checks: [] }), later);
      expect(await needsKeys(later)).toContain(siteItemKey(youngSiteId));
      const item = (await screen(later)).resp.sections.needs_you_now.find((i) => i.key === siteItemKey(youngSiteId))!;
      expect(item.title).toBe(`${hostYoung} is down.`);
      expect(item.why_now).toMatch(/down 12 minutes/);
      expect(item.default_if_ignored).toMatch(/^The watchdog already told you on Slack/);
      expect(await shared()).toBe(sharedBefore);
    });

    it('when the watchdog stops listing it the row clears and "answers again" shows under Handled for you without an Undo', async () => {
      const later = new Date(MON.getTime() + 30 * MIN);
      await applyWatch(prisma, adminId, body({ kuma: [], checks: [] }), later);
      expect(await needsKeys(later)).not.toContain(siteItemKey(youngSiteId));
      const line = (await screen(later)).resp.sections.handled.find((h) => h.text.includes('answers again'));
      expect(line?.text).toBe(`${hostYoung} answers again. It was down 35 minutes.`);
      expect(line?.undo_action_id).toBeNull();
    });

    it('an uptime mail whose own check found the site down is one row with the mail linked, and an up check clears it', async () => {
      const mail = await ask(`uptime@${tag}-mon.example`, `${hostMail} is DOWN`);
      const at = new Date(MON.getTime() + 40 * MIN);
      // before the check, the mail is the row
      expect(await needsKeys(at)).toContain(crisisKey(mail.id));
      await applyWatch(prisma, adminId, body({ kuma: null, checks: [{ key: siteItemKey(mailSiteId), up: false, summary: 'no answer after 3 tries', checked_at: at.toISOString() }] }), at);
      const down = await screen(at);
      const keys = down.resp.sections.needs_you_now.map((i) => i.key);
      expect(keys).toContain(siteItemKey(mailSiteId));
      expect(keys).not.toContain(crisisKey(mail.id));
      const row = down.resp.sections.needs_you_now.find((i) => i.key === siteItemKey(mailSiteId))!;
      expect(row.opened.links.map((l) => l.href)).toContain(`https://mail.example.test/${tag}/${askIds.indexOf(mail.id)}`);
      const up = new Date(at.getTime() + 10 * MIN);
      await applyWatch(prisma, adminId, body({ kuma: null, checks: [{ key: siteItemKey(mailSiteId), up: true, summary: 'answered 200', checked_at: up.toISOString() }] }), up);
      const after = await screen(up);
      const afterKeys = after.resp.sections.needs_you_now.map((i) => i.key);
      expect(afterKeys).not.toContain(siteItemKey(mailSiteId));
      expect(afterKeys).not.toContain(crisisKey(mail.id));
      expect(after.resp.sections.handled.some((h) => h.text === `${hostMail} answers again. It was down 10 minutes.`)).toBe(true);
    });

    it('a site rule hides the row and one-time Not an emergency on a site row writes no Decision', async () => {
      const t0 = new Date(MON.getTime() + 2 * HOUR);
      await applyWatch(prisma, adminId, body({ kuma: [kuma(hostKuma, 20, t0)], checks: [] }), t0);
      expect(await needsKeys(t0)).toContain(siteItemKey(kumaSiteId));
      const res = await saveNotEmergencyRule(prisma, adminId, { item_key: siteItemKey(kumaSiteId), scope: 'site' }, t0);
      decisionKeys.push(res.rule.key);
      expect(await needsKeys(t0)).not.toContain(siteItemKey(kumaSiteId));
      const d = await prisma.decision.findFirstOrThrow({ where: { key: res.rule.key } });
      expect(d).toMatchObject({ scope: 'site', site_id: kumaSiteId, client_id: clientId });
      await undoNotEmergencyRule(prisma, adminId, res.action_id, new Date(t0.getTime() + HOUR));
      expect(await needsKeys(t0)).toContain(siteItemKey(kumaSiteId));
    });

    it('the other users never see a site row', async () => {
      const later = new Date(MON.getTime() + 2 * HOUR);
      for (const id of [techId, overlookAdminId]) {
        const raw = await loadHomeInputs(prisma, id, later, { timezone: TZ });
        expect(raw.site_incidents).toEqual([]);
      }
    });
  });

  describe('the Monday hands row', () => {
    const handsKeys: string[] = [];

    beforeAll(async () => {
      for (const [title, tags, minutes] of [
        ['Rotate the SFTP password (6a)', ['credential-rotation'], 10],
        ['Update the DNS record (6a)', ['hands'], 15],
        ['Move the domain (6a)', ['hands'], null],
      ] as const) {
        const t = await task(title, [...tags], { estimated_minutes: minutes });
        handsKeys.push(taskKey(t.id));
      }
      // one with a hard date keeps its own row, and a tagged task of another user is not his
      await task('Dated hands job (6a)', ['hands'], { client_id: clientId, promised_to: 'Jill', due_date: new Date('2026-11-10T00:00:00Z') });
      await task('Someone else hands job (6a)', ['hands'], { assignee_id: techId });
    });

    it('appears on a Monday in the first Next slot with the jobs, not one by one', async () => {
      const r = await screen(MON);
      const row = r.resp.sections.next[0];
      expect(row.key).toBe(HANDS_ITEM_KEY);
      expect(row.hands?.count).toBe(3);
      expect(row.title).toBe("This week's hands: 3 jobs, about 35 minutes in all.");
      expect(row.hands?.groups.map((g) => g.label)).toEqual(['No written steps']);
      for (const k of handsKeys) expect(r.resp.sections.next.map((i) => i.key)).not.toContain(k);
      expect(r.resp.sections.next.length).toBeLessThanOrEqual(3);
    });

    it('is not there on a Saturday, and the jobs are counted in Everything else', async () => {
      const r = await screen(SAT);
      expect(r.resp.sections.next.map((i) => i.key)).not.toContain(HANDS_ITEM_KEY);
      expect(r.resp.everything_else.groups.find((g) => g.key === 'hands')?.count).toBe(3);
    });

    it('the keeper never gives a hands task a day', async () => {
      for (const k of handsKeys) expect((await screen(MON)).sel.byKey.get(k)!.restGroup).toBe('hands');
    });

    it('Not this week parks the row to next Monday 00:05 and writes only his own state, and Undo brings it back', async () => {
      const sharedBefore = await shared();
      const others = await otherUsers();
      const res = await act(MON, { action: 'not_this_week', item_key: HANDS_ITEM_KEY });
      expect(res.message).toBe('Back next Monday.');
      const st = await prisma.homeItemState.findFirstOrThrow({ where: { user_id: adminId, item_key: HANDS_ITEM_KEY } });
      expect(st.view_at?.toISOString()).toBe('2026-11-16T05:05:00.000Z');
      expect((await screen(MON)).resp.sections.next.map((i) => i.key)).not.toContain(HANDS_ITEM_KEY);
      expect((await screen(new Date('2026-11-12T15:00:00Z'))).resp.sections.next.map((i) => i.key)).not.toContain(HANDS_ITEM_KEY);
      expect((await screen(new Date('2026-11-16T15:00:00Z'))).resp.sections.next[0].key).toBe(HANDS_ITEM_KEY);
      expect(await shared()).toBe(sharedBefore);
      expect(await otherUsers()).toBe(others);
      await runHomeUndo(prisma, adminId, res.action_id, new Date(MON.getTime() + HOUR));
      expect((await screen(MON)).resp.sections.next[0].key).toBe(HANDS_ITEM_KEY);
    });

    it('another user\'s screen never holds his jobs, and a user with none has no row', async () => {
      const overlook = await loadHomeInputs(prisma, overlookAdminId, MON, { timezone: TZ });
      const o = selectHome({ raw: overlook, states: await loadItemStates(prisma, overlookAdminId), now: MON });
      expect(o.sections.next.map((i) => i.key)).not.toContain(HANDS_ITEM_KEY);
      // the tech user has one hands job of their own: their row holds only that one, never his three
      const tech = await loadHomeInputs(prisma, techId, MON, { timezone: TZ });
      const t = selectHome({ raw: tech, states: await loadItemStates(prisma, techId), now: MON });
      const jobs = t.sections.next.find((i) => i.key === HANDS_ITEM_KEY)?.hands?.groups.flatMap((g) => g.jobs.map((j) => j.title));
      expect(jobs).toEqual(['Someone else hands job (6a)']);
    });
  });

  it('through all of it the tech and overlook users have no home rows, and no mail was queued', async () => {
    expect(await prisma.homeAction.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeItemState.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.homeSiteIncident.count({ where: { user_id: { in: [techId, overlookAdminId] } } })).toBe(0);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });
});
