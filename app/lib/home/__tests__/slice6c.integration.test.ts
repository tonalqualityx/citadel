// @vitest-environment node
/**
 * Slice 6c against a real Postgres: the automatic read-only outside scan. The switch off, on without the "scan" cap, on with
 * it; the host coming only from the Site record; a result showing on the row (and under Handled for you for a site that
 * answers again); the 6-hour repeat guard; an unrequested result ignored; a bad summary refused; inactive-client and noise
 * sites never scanned; other users untouched; no Task, EmailAsk, Site or outbox row written.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It seeds its own rows and removes only those.
 * Run on its own clean database (other slices' files count global rows):
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s6c_it npx vitest run lib/home/__tests__/slice6c.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { proposeDay, assembleHomeResponse } from '../today';
import { applyWatch, watchBodySchema, watchPlan } from '../emergency/store';
import { scanBodySchema } from '../emergency/scan';
import { recordScan } from '../emergency/scan-store';
import { siteItemKey } from '../emergency/site';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Tuesday 2026-11-10 on his wall clock (Eastern standard time, UTC-5). */
const at = (h: number, mi = 0, d = 10) => new Date(Date.UTC(2026, 10, d, h + 5, mi));

describe.skipIf(!SCRATCH)('Slice 6c: the outside scan (real database)', () => {
  const tag = `s6c-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const userIds = [adminId, techId, overlookAdminId];
  const clientId = randomUUID();
  const inactiveClientId = randomUUID();
  const noiseClientId = randomUUID();
  const kumaSiteId = randomUUID();
  const secSiteId = randomUUID();
  const inactiveSiteId = randomUUID();
  const noiseSiteId = randomUUID();
  const hostKuma = `kuma-${tag}.example`;
  const hostSec = `sec-${tag}.example`;
  const hostInactive = `inactive-${tag}.example`;
  const hostNoise = `noise-${tag}.example`;
  const taskIds: string[] = [];

  const body = (b: unknown) => watchBodySchema.parse(b);
  const post = (now: Date, kuma: unknown[] | null, caps: string[] | null = ['slack', 'scan']) =>
    applyWatch(prisma, adminId, body({ kuma, checks: [], ...(caps ? { caps } : {}) }), now);
  const kumaEntry = (domain: string, startedMinAgo: number, now: Date) => ({
    monitor: `m-${domain}`,
    domain,
    client_id: clientId,
    started: new Date(now.getTime() - startedMinAgo * MIN).toISOString(),
    escalated: true,
  });
  const setSwitch = (on: boolean) =>
    prisma.homeKeeperSettings.upsert({ where: { user_id: adminId }, create: { user_id: adminId, outside_scan: on }, update: { outside_scan: on } });
  const rowOf = (key: string) => prisma.homeEmergencyWatch.findUniqueOrThrow({ where: { user_id_item_key: { user_id: adminId, item_key: key } } });
  const record = (now: Date, key: string, summary: string, findings: Record<string, unknown> = { home_status: 200 }) =>
    recordScan(prisma, adminId, scanBodySchema.parse({ key, summary, findings }), now, TZ);
  async function screen(now: Date) {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, adminId, now, { timezone: TZ }), loadItemStates(prisma, adminId)]);
    const sel = selectHome({ raw, states, now });
    const day = proposeDay(sel, raw.calendar_events, now);
    return assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now, timezone: TZ, user_id: adminId });
  }
  const secTask = async (title: string, siteId: string, clientRef: string) => {
    const t = await prisma.task.create({
      data: { title, status: 'not_started', tags: ['security'], assignee_id: adminId, created_by_id: adminId, needs_review: false, estimated_minutes: 10, site_id: siteId, client_id: clientRef, created_at: new Date(at(9).getTime() - 3 * DAY) },
    });
    taskIds.push(t.id);
    return t;
  };

  /** Everything a scan hand-out or result must never change. */
  async function shared() {
    const tasks = await prisma.task.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, tags: true, site_id: true, updated_at: true } });
    const asks = await prisma.emailAsk.findMany({ orderBy: { id: 'asc' }, select: { id: true, state: true, updated_at: true } });
    const sites = await prisma.site.findMany({ orderBy: { id: 'asc' }, select: { id: true, url: true, updated_at: true } });
    return JSON.stringify({ tasks, asks, sites, counts: [await prisma.task.count(), await prisma.emailAsk.count(), await prisma.emailOutbox.count(), await prisma.notification.count()] });
  }
  const otherUsers = async () =>
    JSON.stringify({
      watch: await prisma.homeEmergencyWatch.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      actions: await prisma.homeAction.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      settings: await prisma.homeKeeperSettings.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } }),
    });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 6c', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 6c', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 6c', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
      ],
    });
    await prisma.client.createMany({
      data: [
        { id: clientId, name: `Client ${tag}`, status: 'active' },
        { id: inactiveClientId, name: `Gone ${tag}`, status: 'inactive' },
        { id: noiseClientId, name: 'Balloon Guild', status: 'active' },
      ],
    });
    await prisma.site.createMany({
      data: [
        { id: kumaSiteId, name: 'Kuma', url: `https://${hostKuma}`, client_id: clientId },
        { id: secSiteId, name: 'Sec', url: `https://www.${hostSec}/`, client_id: clientId },
        { id: inactiveSiteId, name: 'Inactive', url: `https://${hostInactive}`, client_id: inactiveClientId },
        { id: noiseSiteId, name: 'Noise', url: `https://${hostNoise}`, client_id: noiseClientId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.homeEmergencyWatch.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.homeSiteIncident.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.homeKeeperSettings.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: userIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.site.deleteMany({ where: { id: { in: [kumaSiteId, secSiteId, inactiveSiteId, noiseSiteId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, inactiveClientId, noiseClientId] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  let secKey = '';
  const sharedStart: { v: string } = { v: '' };

  describe('the switch', () => {
    it('off: a security task on a site is tracked, no scans are listed or handed out, nothing is marked', async () => {
      const t = await secTask('Clean up the hacked site', secSiteId, clientId);
      secKey = taskKey(t.id);
      sharedStart.v = await shared();
      const res = await post(at(10), null);
      expect(res.scans).toEqual([]);
      expect((await post(at(10, 1), null, ['slack'])).scans).toBeUndefined();
      const plan = await watchPlan(prisma, adminId, at(10, 2));
      expect(plan.would_scan).toEqual([]);
      const row = await rowOf(secKey);
      expect(row.scan_requested_at).toBeNull();
      expect(row.scan_site_id).toBeNull();
      expect((await screen(at(10, 2))).sections.needs_you_now.map((i) => i.key)).toContain(secKey);
    });

    it('on, but the request does not say "scan": none handed out and nothing marked', async () => {
      await setSwitch(true);
      for (const caps of [null, ['slack'], ['something_else']] as Array<string[] | null>) {
        const res = await post(at(10, 3), null, caps);
        expect(res.scans).toBeUndefined();
      }
      expect((await rowOf(secKey)).scan_requested_at).toBeNull();
    });

    it('the dry run lists what a real run would hand out (host from the Site record) and writes nothing', async () => {
      const before = JSON.stringify(await prisma.homeEmergencyWatch.findMany({ where: { user_id: adminId } }));
      const plan = await watchPlan(prisma, adminId, at(10, 4));
      expect(plan.would_scan).toEqual([{ key: secKey, host: hostSec }]);
      expect(JSON.stringify(await prisma.homeEmergencyWatch.findMany({ where: { user_id: adminId } }))).toBe(before);
    });

    it('on with the cap: the scan is handed out with the Site host and no previous result, and the row is marked', async () => {
      const res = await post(at(10, 5), null);
      expect(res.scans).toEqual([{ key: secKey, host: hostSec, previous: null }]);
      const row = await rowOf(secKey);
      expect(row.scan_requested_at?.toISOString()).toBe(at(10, 5).toISOString());
      expect(row.scan_site_id).toBe(secSiteId);
      expect(row.scan_at).toBeNull();
    });

    it('is not handed out twice (once per landing, once per site per 6 hours)', async () => {
      expect((await post(at(10, 6), null)).scans).toEqual([]);
      expect((await post(at(10, 11), null)).scans).toEqual([]);
      expect((await post(at(17, 0), null)).scans).toEqual([]);
      expect((await watchPlan(prisma, adminId, at(10, 7))).would_scan).toEqual([]);
    });
  });

  describe('the result', () => {
    it('a result for a key that was not requested is ignored and changes nothing', async () => {
      const other = await secTask('Another security job', secSiteId, clientId);
      const before = JSON.stringify(await prisma.homeEmergencyWatch.findMany({ where: { user_id: adminId }, orderBy: { item_key: 'asc' } }));
      expect(await record(at(10, 8), taskKey(other.id), 'nothing new found from outside.')).toEqual({ recorded: false });
      expect(await record(at(10, 8), siteItemKey(randomUUID()), 'nothing new found from outside.')).toEqual({ recorded: false });
      expect(await record(at(10, 8), 'task:not-a-key', 'nothing new found from outside.')).toEqual({ recorded: false });
      expect(JSON.stringify(await prisma.homeEmergencyWatch.findMany({ where: { user_id: adminId }, orderBy: { item_key: 'asc' } }))).toBe(before);
    });

    it('a bad summary or oversized findings are refused by the body schema', () => {
      const dash = String.fromCharCode(0x2014);
      const ok = { key: secKey, summary: 'fine.', findings: {} };
      expect(scanBodySchema.safeParse(ok).success).toBe(true);
      for (const summary of ['', 'x'.repeat(501), 'a\n\nb', `a ${dash} b`, 'a priority', 'overdue', 'see https://a.example/x', 'a.example/wp-login.php']) {
        expect(scanBodySchema.safeParse({ ...ok, summary }).success, summary).toBe(false);
      }
      expect(scanBodySchema.safeParse({ ...ok, findings: { a: 'y'.repeat(9000) } }).success).toBe(false);
      expect(scanBodySchema.safeParse({ ...ok, extra: true }).success).toBe(false);
    });

    it('a good result is stored (markup neutralised) and shows on the row and card', async () => {
      const res = await record(at(10, 42), secKey, '2 links to outside sites are new since the last check: ki-system.org, *other*.example.', { new_link_hosts: ['ki-system.org'] });
      expect(res).toEqual({ recorded: true });
      const row = await rowOf(secKey);
      expect(row.scan_summary).toBe('2 links to outside sites are new since the last check: ki-system.org, other.example.');
      expect(row.scan_json).toEqual({ new_link_hosts: ['ki-system.org'] });
      const item = (await screen(at(10, 43))).sections.needs_you_now.find((i) => i.key === secKey)!;
      expect(item.outside_check).toBe('Outside check 10:42: 2 links to outside sites are new since the last check: ki-system.org, other.example.');
    });

    it('a second result for the same request is ignored', async () => {
      expect(await record(at(10, 50), secKey, 'something else entirely.')).toEqual({ recorded: false });
      expect((await rowOf(secKey)).scan_summary).toMatch(/^2 links/);
    });
  });

  describe('a site that answers again', () => {
    const closeAt = at(12, 20);
    it('the watchdog row is shown, and when the site answers again a scan is handed out for it (not before)', async () => {
      const open = at(12, 0);
      expect((await post(open, [kumaEntry(hostKuma, 12, open)])).scans).toEqual([]);
      expect((await screen(open)).sections.needs_you_now.map((i) => i.key)).toContain(siteItemKey(kumaSiteId));
      const still = at(12, 10);
      expect((await post(still, [kumaEntry(hostKuma, 22, still)])).scans).toEqual([]);
      const res = await post(closeAt, []);
      expect(res.scans).toEqual([{ key: siteItemKey(kumaSiteId), host: hostKuma, previous: null }]);
    });

    it('the result goes under Handled for you (its row is gone) with the site named, and no Undo', async () => {
      expect(await record(at(12, 24), siteItemKey(kumaSiteId), 'the home page answers. Nothing new found from outside.', { home_status: 200, link_hosts: ['a.example'] })).toEqual({ recorded: true });
      const line = (await screen(at(12, 25))).sections.handled.find((h) => h.text.startsWith('Outside check of'));
      expect(line?.text).toBe(`Outside check of ${hostKuma} 12:24: the home page answers. Nothing new found from outside.`);
      expect(line?.undo_action_id).toBeNull();
    });

    it('a second incident within 6 hours is not scanned', async () => {
      const open = at(14, 0);
      await post(open, [kumaEntry(hostKuma, 12, open)]);
      const res = await post(at(14, 20), []);
      expect(res.scans).toEqual([]);
      expect((await watchPlan(prisma, adminId, at(14, 21))).would_scan).toEqual([]);
    });

    it('after 6 hours it is scanned again and carries the previous result', async () => {
      const open = at(19, 0);
      await post(open, [kumaEntry(hostKuma, 12, open)]);
      const res = await post(at(19, 20), []);
      expect(res.scans).toEqual([{ key: siteItemKey(kumaSiteId), host: hostKuma, previous: { home_status: 200, link_hosts: ['a.example'] } }]);
    });

    it('a scan is only handed out within 30 minutes of the close', async () => {
      const open = at(21, 0);
      await post(open, [kumaEntry(hostKuma, 12, open)]);
      // keep the incident open until after the window by reporting it still listed, then close it much later without a scan call
      expect((await post(at(21, 40), [kumaEntry(hostKuma, 52, at(21, 40))], ['slack'])).scans).toBeUndefined();
      const closed = await post(at(22, 0), [], ['slack']);
      expect(closed.scans).toBeUndefined();
      const late = await post(at(22, 45), []);
      expect(late.scans).toEqual([]);
    });
  });

  describe('sites that are never scanned', () => {
    it('a security task on a site of an inactive client, or of a noise client, is never listed or handed out', async () => {
      const inactiveTask = await secTask('Fix the inactive site', inactiveSiteId, inactiveClientId);
      const noiseTask = await secTask('Fix the noise site', noiseSiteId, noiseClientId);
      await post(at(23, 0, 11), null);
      const res = await post(at(23, 1, 11), null);
      expect(res.scans).toEqual([]);
      expect((await watchPlan(prisma, adminId, at(23, 2, 11))).would_scan).toEqual([]);
      expect((await rowOf(taskKey(inactiveTask.id))).scan_requested_at).toBeNull();
      expect((await rowOf(taskKey(noiseTask.id))).scan_requested_at).toBeNull();
    });

    it('at most two scans in one run, even with several sites due', async () => {
      const ids: string[] = [];
      const sites: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        sites.push(id);
        await prisma.site.create({ data: { id, name: `Many ${i}`, url: `https://many${i}-${tag}.example`, client_id: clientId } });
        ids.push((await secTask(`Many ${i}`, id, clientId)).id);
      }
      const res = await post(at(8, 0, 12), null); // tracked and handed out in the same run
      expect(res.scans).toHaveLength(2);
      expect(new Set(res.scans!.map((s) => s.host)).size).toBe(2);
      for (const s of res.scans!) expect(s.host).toMatch(new RegExp(`^many\\d-${tag}\\.example$`));
      const next = await post(at(8, 2, 12), null);
      expect(next.scans).toHaveLength(1); // the third, still inside the same landing
      const left = await post(at(8, 3, 12), null);
      expect(left.scans).toEqual([]);
      await prisma.homeEmergencyWatch.deleteMany({ where: { user_id: adminId, scan_site_id: { in: sites } } });
      await prisma.task.deleteMany({ where: { id: { in: ids } } });
      await prisma.site.deleteMany({ where: { id: { in: sites } } });
    });
  });

  it('the switch off again hands out nothing, and another user gets nothing', async () => {
    await setSwitch(false);
    const t = await secTask('One more security job', secSiteId, clientId);
    await post(at(10, 0, 13), null);
    const res = await post(at(10, 1, 13), null);
    expect(res.scans).toEqual([]);
    expect((await rowOf(taskKey(t.id))).scan_requested_at).toBeNull();
  });

  it('through all of it no Task, EmailAsk, Site or outbox row was written, and the other users have no home rows', async () => {
    // the tasks this file created are the only change in the shared tables
    const ours = [kumaSiteId, secSiteId, inactiveSiteId, noiseSiteId];
    const now = JSON.parse(await shared());
    const start = JSON.parse(sharedStart.v);
    expect(now.counts[1]).toBe(start.counts[1]);
    expect(now.counts[2]).toBe(start.counts[2]);
    expect(now.counts[3]).toBe(start.counts[3]);
    expect(now.asks).toEqual(start.asks);
    expect(now.sites.filter((s: { id: string }) => (ours as string[]).includes(s.id))).toEqual(
      start.sites.filter((s: { id: string }) => (ours as string[]).includes(s.id))
    );
    for (const id of [secKey]) expect((await prisma.task.findUniqueOrThrow({ where: { id: id.slice(5) } })).status).toBe('not_started');
    expect(await otherUsers()).toBe(JSON.stringify({ watch: [], actions: [], settings: [] }));
    const rows = await prisma.homeEmergencyWatch.findMany({ where: { user_id: { in: [techId, overlookAdminId] } } });
    expect(rows).toEqual([]);
  });
});
