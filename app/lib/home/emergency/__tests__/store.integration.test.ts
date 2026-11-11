// @vitest-environment node
/**
 * Slice 6a stores against a real Postgres: the rule press and its undo, the Decision row reuse, and the home-watch
 * plan and report. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Removes only its own rows.
 * Run: DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s6a npx vitest run lib/home/emergency/__tests__/store.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { applyWatch, loadNotEmergencyRules, saveNotEmergencyRule, undoNotEmergencyRule, watchBodySchema, watchPlan } from '../store';
import { matchesNotEmergencyRule } from '../rule';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const NOW = new Date('2026-11-11T15:00:00Z');
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);
const DAY = 86_400_000;

describe.skipIf(!SCRATCH)('Slice 6a: rules and home-watch (real database)', () => {
  const tag = `s6a${Date.now()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const offId = randomUUID();
  const clientId = randomUUID();
  const inactiveClientId = randomUUID();
  const noiseClientId = randomUUID();
  const siteA = randomUUID(); // active client
  const siteB = randomUUID(); // inactive client
  const siteC = randomUUID(); // noise client
  const siteK = randomUUID(); // kuma site
  const hostA = `${tag}-cafe.com`;
  const hostB = `${tag}-gone.com`;
  const hostC = `${tag}-balloons.org`;
  const hostK = `${tag}-kuma.com`;
  const askIds: string[] = [];
  const mkAsk = async (from: string, subject: string, over: Record<string, unknown> = {}) => {
    const row = await prisma.emailAsk.create({
      data: { message_id: `${tag}-${askIds.length}`, account: 'mike@becomeindelible.com', from_email: from, subject, deep_link: 'https://mail.example.test/x', received_at: min(30), is_urgent: true, state: 'open', ...over },
    });
    askIds.push(row.id);
    return row;
  };
  const cnt = async () => ({
    ask: await prisma.emailAsk.count(),
    task: await prisma.task.count(),
    site: await prisma.site.count(),
    client: await prisma.client.count(),
    decision: await prisma.decision.count(),
    incident: await prisma.homeSiteIncident.count(),
    action: await prisma.homeAction.count(),
  });
  const body = (b: unknown) => watchBodySchema.parse(b);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `o-${tag}@example.test`, password_hash: 'x', name: 'Owner S6A', role: 'admin' },
        { id: otherId, email: `x-${tag}@example.test`, password_hash: 'x', name: 'Other S6A', role: 'admin' },
        { id: offId, email: `f-${tag}@example.test`, password_hash: 'x', name: 'Off S6A', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: ownerId, home_view: 'home', timezone: 'America/New_York' },
        { user_id: otherId, home_view: 'overlook', timezone: 'America/New_York' },
        { user_id: offId, home_view: 'overlook', timezone: 'America/New_York' },
      ],
    });
    await prisma.client.createMany({
      data: [
        { id: clientId, name: `Jills ${tag}`, status: 'active' },
        { id: inactiveClientId, name: `Gone ${tag}`, status: 'inactive' },
        { id: noiseClientId, name: `Balloon Guild ${tag}`, status: 'active' },
      ],
    });
    await prisma.site.createMany({
      data: [
        { id: siteA, name: 'A', url: `https://www.${hostA}/`, client_id: clientId },
        { id: siteB, name: 'B', url: `https://${hostB}`, client_id: inactiveClientId },
        { id: siteC, name: 'C', url: `https://${hostC}`, client_id: noiseClientId },
        { id: siteK, name: 'K', url: `https://${hostK}`, client_id: clientId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { key: { startsWith: 'home-not-emergency:' }, created_by_id: ownerId } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: [ownerId, otherId, offId] } } });
    await prisma.homeSiteIncident.deleteMany({ where: { user_id: { in: [ownerId, otherId, offId] } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: [ownerId, otherId, offId] } } });
    await prisma.emailAsk.deleteMany({ where: { id: { in: askIds } } });
    await prisma.site.deleteMany({ where: { id: { in: [siteA, siteB, siteC, siteK] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, inactiveClientId, noiseClientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId, offId] } } });
    await prisma.$disconnect();
  });

  describe('rules', () => {
    let ask1: Awaited<ReturnType<typeof mkAsk>>;
    let action1 = '';
    let decisionId = '';

    it('a sender rule writes a confirmed Decision with its link, the item state and one action', async () => {
      ask1 = await mkAsk(`Alerts@${tag}-wpmu.com`, 'Plugin update needed');
      const before = await cnt();
      const r = await saveNotEmergencyRule(prisma, ownerId, { item_key: `crisis:${ask1.id}`, scope: 'sender', reason: '  Weekly   digest ' }, NOW);
      action1 = r.action_id;
      expect(r.rule).toMatchObject({ kind: 'sender', value: `alerts@${tag}-wpmu.com`, revision: 1 });
      expect(r.undo_until).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
      const d = await prisma.decision.findUniqueOrThrow({ where: { key: r.rule.key }, include: { links: true } });
      decisionId = d.id;
      expect(d).toMatchObject({
        kind: 'ruling',
        status: 'confirmed',
        scope: 'lane',
        lane: 'home-emergency',
        confirmed_by_user_id: ownerId,
        created_by_id: ownerId,
        text: 'Weekly digest',
        tags: ['home-screen', 'not-emergency'],
        site_id: null,
        revision: 1,
      });
      expect(d.title).toBe(`Not an emergency: mail from alerts@${tag}-wpmu.com is not an emergency`);
      expect(d.links).toHaveLength(1);
      expect(d.links[0]).toMatchObject({ entity_kind: 'email_ask', entity_id: ask1.id, relation: 'ruled_on' });
      const st = await prisma.homeItemState.findFirstOrThrow({ where: { user_id: ownerId, item_key: `crisis:${ask1.id}` } });
      expect(st.not_emergency_at?.toISOString()).toBe(NOW.toISOString());
      const after = await cnt();
      expect(after.decision).toBe(before.decision + 1);
      expect(after.action).toBe(before.action + 1);
      expect({ ...after, decision: 0, action: 0 }).toEqual({ ...before, decision: 0, action: 0 });
    });

    it('the loader reads it for that user only, and it hides the next mail from that sender', async () => {
      const rules = await loadNotEmergencyRules(prisma, ownerId);
      expect(rules).toContainEqual({ kind: 'sender', value: `alerts@${tag}-wpmu.com` });
      expect(await loadNotEmergencyRules(prisma, otherId)).toEqual([]);
      expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: `alerts@${tag}-wpmu.com` }, rules)).toBe(true);
      expect(matchesNotEmergencyRule({ kind: 'crisis', from_email: `billing@${tag}-wpmu.com` }, rules)).toBe(false);
    });

    it('pressing it again while confirmed reuses the row and keeps the revision', async () => {
      const r = await saveNotEmergencyRule(prisma, ownerId, { item_key: `crisis:${ask1.id}`, scope: 'sender' }, NOW);
      expect(r.rule.revision).toBe(1);
      expect(await prisma.decision.count({ where: { key: r.rule.key } })).toBe(1);
      const links = await prisma.decisionLink.count({ where: { decision_id: decisionId } });
      expect(links).toBe(1);
      // retire that second action so the first one stays the one we undo
      await prisma.homeAction.update({ where: { id: r.action_id }, data: { undone_at: NOW } });
    });

    it('undo retracts the rule, clears not_emergency_at and the rule stops applying', async () => {
      const u = await undoNotEmergencyRule(prisma, ownerId, action1, new Date(NOW.getTime() + DAY));
      expect(u.ok).toBe(true);
      expect((await prisma.decision.findUniqueOrThrow({ where: { id: decisionId } })).status).toBe('retracted');
      const st = await prisma.homeItemState.findFirstOrThrow({ where: { user_id: ownerId, item_key: `crisis:${ask1.id}` } });
      expect(st.not_emergency_at).toBeNull();
      expect(await loadNotEmergencyRules(prisma, ownerId)).not.toContainEqual({ kind: 'sender', value: `alerts@${tag}-wpmu.com` });
    });

    it('undo twice is 409, and another user gets 404', async () => {
      await expect(undoNotEmergencyRule(prisma, ownerId, action1, NOW)).rejects.toMatchObject({ statusCode: 409 });
      await expect(undoNotEmergencyRule(prisma, otherId, action1, NOW)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('a re-save after the undo reuses the same row with revision 2', async () => {
      const r = await saveNotEmergencyRule(prisma, ownerId, { item_key: `crisis:${ask1.id}`, scope: 'sender' }, new Date(NOW.getTime() + DAY));
      expect(r.rule.revision).toBe(2);
      const rows = await prisma.decision.findMany({ where: { key: r.rule.key } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: decisionId, status: 'confirmed', revision: 2 });
      expect(await prisma.decisionLink.count({ where: { decision_id: decisionId } })).toBe(1);
      action1 = r.action_id;
    });

    it('undo after seven days is 409 and the rule stays', async () => {
      await expect(undoNotEmergencyRule(prisma, ownerId, action1, new Date(NOW.getTime() + 9 * DAY))).rejects.toMatchObject({ statusCode: 409 });
      expect((await prisma.decision.findUniqueOrThrow({ where: { id: decisionId } })).status).toBe('confirmed');
    });

    it('an undo of a rule changed since (revision moved) is 409 and leaves it alone', async () => {
      await prisma.decision.update({ where: { id: decisionId }, data: { revision: { increment: 1 } } });
      await expect(undoNotEmergencyRule(prisma, ownerId, action1, new Date(NOW.getTime() + DAY))).rejects.toMatchObject({ statusCode: 409 });
      expect((await prisma.decision.findUniqueOrThrow({ where: { id: decisionId } })).status).toBe('confirmed');
    });

    it('a domain rule works for a company domain and not for free mail or our own domain', async () => {
      const a = await mkAsk(`x@${tag}-corp.com`, 'Heads up');
      const r = await saveNotEmergencyRule(prisma, ownerId, { item_key: `crisis:${a.id}`, scope: 'domain' }, NOW);
      expect(r.rule).toMatchObject({ kind: 'domain', value: `${tag}-corp.com` });
      const free = await mkAsk(`someone${tag}@gmail.com`, 'Hi');
      await expect(saveNotEmergencyRule(prisma, ownerId, { item_key: `crisis:${free.id}`, scope: 'domain' }, NOW)).rejects.toMatchObject({ statusCode: 400 });
      const own = await mkAsk('noreply@becomeindelible.com', 'Digest');
      await expect(saveNotEmergencyRule(prisma, ownerId, { item_key: `crisis:${own.id}`, scope: 'domain' }, NOW)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('a site rule is scoped to the site and carries the client', async () => {
      const r = await saveNotEmergencyRule(prisma, ownerId, { item_key: `site:${siteA}`, scope: 'site' }, NOW);
      expect(r.rule).toMatchObject({ kind: 'site', value: hostA });
      const d = await prisma.decision.findUniqueOrThrow({ where: { key: r.rule.key }, include: { links: true } });
      expect(d).toMatchObject({ scope: 'site', site_id: siteA, client_id: clientId });
      expect(d.links[0]).toMatchObject({ entity_kind: 'site', entity_id: siteA });
    });

    it('a task item is refused with the security sentence and writes nothing', async () => {
      const before = await cnt();
      const err = await saveNotEmergencyRule(prisma, ownerId, { item_key: `task:${randomUUID()}`, scope: 'sender' }, NOW).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('A security flag is never turned into a rule.');
      expect(await cnt()).toEqual(before);
    });
  });

  describe('home-watch', () => {
    it('GET lists only active-client sites named in open urgent mail, never noise or inactive ones, and writes nothing', async () => {
      await mkAsk(`uptime@${tag}-mon.com`, `Uptime alert: ${hostA} is DOWN`);
      await mkAsk(`uptime@${tag}-mon.com`, `${hostB} is down`);
      await mkAsk(`uptime@${tag}-mon.com`, `${hostC} is down`);
      await mkAsk(`uptime@${tag}-mon.com`, `attacker-${tag}.example is down`);
      await mkAsk(`uptime@${tag}-mon.com`, `${hostK} is down`, { state: 'handled' });
      await mkAsk(`uptime@${tag}-mon.com`, `${hostK} is down`, { received_at: new Date(NOW.getTime() - 5 * DAY) });
      const before = await cnt();
      const plan = await watchPlan(prisma, ownerId, NOW);
      expect(plan.dry_run).toBe(true);
      expect(plan.checks).toEqual([{ key: `site:${siteA}`, site_id: siteA, domain: hostA }]);
      expect(plan.open).toEqual([]);
      expect(await cnt()).toEqual(before);
    });

    it('home_off: a user not on the home view is skipped on GET and POST', async () => {
      for (const id of [otherId, offId]) {
        expect(await watchPlan(prisma, id, NOW)).toEqual({ dry_run: true, skipped: 'home_off', checks: [], open: [], would_post: [], would_scan: [] });
        const before = await cnt();
        const r = await applyWatch(prisma, id, body({ kuma: [{ monitor: 'm', domain: hostK, started: min(30).toISOString() }], checks: [] }), NOW);
        expect(r.skipped).toBe('home_off');
        expect(await cnt()).toEqual(before);
      }
    });

    it('kuma null closes nothing; a kuma list opens an incident; a later list without it closes it', async () => {
      const r1 = await applyWatch(prisma, ownerId, body({ kuma: [{ monitor: 'Kuma K', domain: hostK, client_id: clientId, started: min(35).toISOString(), escalated: true }], checks: [] }), NOW);
      expect(r1.counts.opened).toBe(1);
      const inc = await prisma.homeSiteIncident.findFirstOrThrow({ where: { user_id: ownerId, site_id: siteK, closed_at: null } });
      expect(inc).toMatchObject({ source: 'kuma', domain: hostK, client_id: clientId, watchdog_escalated: true, monitor: 'Kuma K' });
      expect(inc.started_at.toISOString()).toBe(min(35).toISOString());

      const r2 = await applyWatch(prisma, ownerId, body({ kuma: null, checks: [] }), new Date(NOW.getTime() + 60_000));
      expect(r2.counts.closed).toBe(0);
      expect((await prisma.homeSiteIncident.findUniqueOrThrow({ where: { id: inc.id } })).closed_at).toBeNull();

      const r3 = await applyWatch(prisma, ownerId, body({ kuma: [{ monitor: 'Kuma K', domain: hostK, started: min(35).toISOString() }], checks: [] }), new Date(NOW.getTime() + 120_000));
      expect(r3.counts).toMatchObject({ opened: 0, updated: 1, closed: 0 });
      expect(await prisma.homeSiteIncident.count({ where: { user_id: ownerId, site_id: siteK } })).toBe(1);

      const when = new Date(NOW.getTime() + 23 * 60_000 + 60_000);
      const r4 = await applyWatch(prisma, ownerId, body({ kuma: [], checks: [] }), when);
      expect(r4.counts.closed).toBe(1);
      const closed = await prisma.homeSiteIncident.findUniqueOrThrow({ where: { id: inc.id } });
      expect(closed.close_reason).toBe('watchdog_closed');
      const line = await prisma.homeAction.findFirstOrThrow({ where: { user_id: ownerId, action: 'watch_site_cleared', item_key: `site:${siteK}` } });
      expect(line.source).toBe('keeper');
      expect((line.after as { line: string }).line).toBe(`${hostK} answers again. It was down 59 minutes.`);
    });

    it('an unknown kuma domain is ignored', async () => {
      const r = await applyWatch(prisma, ownerId, body({ kuma: [{ monitor: 'm', domain: `nope-${tag}.com`, started: min(30).toISOString() }], checks: [] }), NOW);
      expect(r.counts.ignored).toBe(1);
    });

    it('a down check opens a mail incident; GET keeps listing it; an up check closes it and writes the line', async () => {
      const r1 = await applyWatch(prisma, ownerId, body({ kuma: null, checks: [{ key: `site:${siteA}`, up: false, summary: 'no answer after 3 tries', checked_at: NOW.toISOString() }] }), NOW);
      expect(r1.counts.opened).toBe(1);
      const inc = await prisma.homeSiteIncident.findFirstOrThrow({ where: { user_id: ownerId, site_id: siteA, closed_at: null } });
      expect(inc).toMatchObject({ source: 'uptime_mail', last_check_up: false, check_summary: 'no answer after 3 tries', domain: hostA });
      expect(inc.ask_ids.length).toBeGreaterThan(0);
      const plan = await watchPlan(prisma, ownerId, NOW);
      expect(plan.checks.map((c) => c.site_id)).toContain(siteA);
      expect(plan.open.map((o) => o.site_id)).toContain(siteA);

      const later = new Date(NOW.getTime() + 10 * 60_000);
      const r2 = await applyWatch(prisma, ownerId, body({ kuma: null, checks: [{ key: `site:${siteA}`, up: true, summary: 'answered 200', checked_at: later.toISOString() }] }), later);
      expect(r2.counts.closed).toBe(1);
      const closed = await prisma.homeSiteIncident.findUniqueOrThrow({ where: { id: inc.id } });
      expect(closed).toMatchObject({ close_reason: 'answered', last_check_up: true });
      expect(closed.closed_at).not.toBeNull();
      const line = await prisma.homeAction.findFirstOrThrow({ where: { user_id: ownerId, action: 'watch_site_cleared', item_key: `site:${siteA}` } });
      expect((line.after as { line: string }).line).toBe(`${hostA} answers again. It was down 10 minutes.`);
    });

    it('after an answered check the same mail is not checked again, and a new mail is', async () => {
      const plan = await watchPlan(prisma, ownerId, new Date(NOW.getTime() + 11 * 60_000));
      expect(plan.checks.map((c) => c.site_id)).not.toContain(siteA);
      await mkAsk(`uptime@${tag}-mon.com`, `${hostA} is down again`, { received_at: new Date(NOW.getTime() + 12 * 60_000) });
      const plan2 = await watchPlan(prisma, ownerId, new Date(NOW.getTime() + 13 * 60_000));
      expect(plan2.checks.map((c) => c.site_id)).toContain(siteA);
    });

    it('a first check that finds the site up leaves a closed record and the "answers again" line', async () => {
      const k = `${tag}-first.com`;
      const site = randomUUID();
      await prisma.site.create({ data: { id: site, name: 'F', url: `https://${k}`, client_id: clientId } });
      try {
        await mkAsk(`uptime@${tag}-mon.com`, `${k} is down`);
        const plan = await watchPlan(prisma, ownerId, NOW);
        expect(plan.checks.map((c) => c.site_id)).toContain(site);
        const r = await applyWatch(prisma, ownerId, body({ kuma: null, checks: [{ key: `site:${site}`, up: true, summary: 'ok', checked_at: new Date('2026-11-11T15:42:00Z').toISOString() }] }), new Date('2026-11-11T15:42:30Z'));
        expect(r.counts.closed).toBe(1);
        const inc = await prisma.homeSiteIncident.findFirstOrThrow({ where: { user_id: ownerId, site_id: site } });
        expect(inc).toMatchObject({ close_reason: 'answered', last_check_up: true });
        const line = await prisma.homeAction.findFirstOrThrow({ where: { user_id: ownerId, item_key: `site:${site}` } });
        expect((line.after as { line: string }).line).toBe(`${k} answers again (checked 10:42).`);
      } finally {
        await prisma.homeSiteIncident.deleteMany({ where: { site_id: site } });
        await prisma.homeAction.deleteMany({ where: { item_key: `site:${site}` } });
        await prisma.emailAsk.deleteMany({ where: { subject: `${k} is down` } });
        await prisma.site.delete({ where: { id: site } });
      }
    });

    it('a check for a site Citadel did not ask about, or a bad key, is ignored and writes nothing', async () => {
      const before = await cnt();
      const r = await applyWatch(prisma, ownerId, body({ kuma: null, checks: [{ key: `site:${siteC}`, up: false, checked_at: NOW.toISOString() }, { key: `site:${randomUUID()}`, up: false, checked_at: NOW.toISOString() }, { key: 'task:x', up: false, checked_at: NOW.toISOString() }] }), NOW);
      expect(r.counts).toEqual({ opened: 0, updated: 0, closed: 0, ignored: 3 });
      expect(await cnt()).toEqual(before);
    });

    it('writes no Decision, no task, no ask, no site and no client change, and touches no other user', async () => {
      const decisions = await prisma.decision.count({ where: { lane: 'home-emergency', key: { not: { startsWith: 'home-not-emergency:' } } } });
      expect(decisions).toBe(0);
      expect(await prisma.homeSiteIncident.count({ where: { user_id: { in: [otherId, offId] } } })).toBe(0);
      expect(await prisma.homeAction.count({ where: { user_id: { in: [otherId, offId] } } })).toBe(0);
    });
  });
});
