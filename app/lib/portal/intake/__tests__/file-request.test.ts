import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';

const tx = {
  $executeRaw: vi.fn(),
  task: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
  site: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
  charter: { findMany: vi.fn() },
  user: { findFirst: vi.fn() },
};
vi.mock('@/lib/db/prisma', () => ({ prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } }));
vi.mock('@/lib/portal/waits', () => ({ onRequestFiled: vi.fn(async () => []) }));
vi.mock('@/lib/services/notification-dispatcher', () => ({ dispatchNotification: vi.fn(async () => ({})) }));
vi.mock('@/lib/services/notifications', () => ({ createInAppNotificationOnly: vi.fn(async () => ({})) }));

import { onRequestFiled } from '@/lib/portal/waits';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { createInAppNotificationOnly } from '@/lib/services/notifications';
import { fileRequest, LIMITS, WORDPRESS_ASSIGNEE_EMAIL, type FileRequestBody } from '../file-request';
import { RATE_LIMIT_MESSAGE } from '../tree';

const NOW = new Date('2026-10-21T15:00:00Z');
const INTAKE = '11111111-1111-4111-8111-111111111111';
const access = { contactId: 'ct1', clientId: 'cl1', role: 'owner' as const };
const contact = { id: 'ct1', name: 'Dana Reyes' };

const SITE = { id: 's1', name: 'example.com', site_type: null, platform: null, maintenance_plan_id: null, hosting_plan_id: null };
const BUILD = { id: 'b1', name: 'Relaunch', site_id: 's1', status: 'in_progress', scope_locked: false };
const CHARTER = { id: 'ch1', name: 'internal', site_id: null, status: 'active', start_date: new Date('2026-01-01'), end_date: null, created_at: new Date('2026-01-01') };

const siteChange: FileRequestBody = {
  intake_id: INTAKE,
  type: 'site_change',
  site_id: 's1',
  answers: [
    { key: 'q1', value: 'Update the hours' },
    { key: 'q2', value: '/contact' },
  ],
};
const brokenUrgent: FileRequestBody = {
  intake_id: INTAKE,
  type: 'broken',
  site_id: 's1',
  answers: [{ key: 'q1', value: 'site_down' }],
};

function created(data: Record<string, unknown>) {
  return {
    id: 't1',
    title: data.title,
    client_title: data.client_title,
    status: 'not_started',
    tags: data.tags,
    staging_preview_url: null,
    approved: false,
    client_approved_at: null,
    project_id: data.project_id ?? null,
    charter_id: data.charter_id ?? null,
    assignee_id: data.assignee_id,
    client_id: data.client_id,
    site_id: data.site_id ?? null,
    project: null,
    charter: null,
    site: { id: 's1', name: 'example.com' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.task.findFirst.mockResolvedValue(null);
  tx.task.count.mockResolvedValue(0);
  tx.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => created(data));
  tx.site.findMany.mockResolvedValue([SITE]);
  tx.project.findMany.mockResolvedValue([]);
  tx.charter.findMany.mockResolvedValue([]);
  tx.user.findFirst.mockResolvedValue({ id: 'sabeen-id' });
});

const createdData = () => (tx.task.create as Mock).mock.calls[0][0].data as Record<string, unknown> & { tags: string[]; client_intake: unknown };

describe('fileRequest: permissions and validation', () => {
  it('refuses a grant-only contact with 403 and writes nothing', async () => {
    await expect(fileRequest({ ...access, role: 'none' }, contact, siteChange, { now: NOW })).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.task.create).not.toHaveBeenCalled();
  });
  it('refuses a revoked contact', async () => {
    await expect(fileRequest({ ...access, revoked: true }, contact, siteChange, { now: NOW })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('lets a viewer file (any client role may request)', async () => {
    const r = await fileRequest({ ...access, role: 'viewer' }, contact, siteChange, { now: NOW });
    expect(r.created).toBe(true);
  });
  it('rejects bad answers with 400 before touching the database', async () => {
    await expect(fileRequest(access, contact, { ...siteChange, answers: [{ key: 'q1', value: 'x' }] }, { now: NOW })).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('fileRequest: filing', () => {
  it('takes the advisory lock on the source_ref, then files one task with the composed fields', async () => {
    const r = await fileRequest(access, contact, siteChange, { now: NOW });
    // Tagged template calls: [strings, ...values]. First the intake lock on the source_ref, then the person lock.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect((tx.$executeRaw as Mock).mock.calls[0][1]).toBe(`portal-intake:${INTAKE}`);
    expect((tx.$executeRaw as Mock).mock.calls[1][1]).toBe('portal-intake-person:ct1');
    expect(tx.task.create).toHaveBeenCalledTimes(1);
    const d = createdData();
    expect(d).toMatchObject({
      title: 'Site change: Update the hours',
      client_title: 'Site change: Update the hours',
      client_id: 'cl1',
      site_id: 's1',
      source: 'portal',
      source_ref: `portal-intake:${INTAKE}`,
      requested_by_contact_id: 'ct1',
      is_billable: false,
      status: 'not_started',
      priority: 3,
      assignee_id: BAST_USER_ID,
    });
    expect(d.tags).toEqual(['portal-chat', 'kind:site-change', 'quote', 'needs-mike']); // no build, no retainer, no plan
    expect(typeof d.description).toBe('string');
    expect(d.description as string).toContain('Update the hours');
    expect(d.client_intake).toMatchObject({ v: 1, intake_id: INTAKE, type: 'site_change', placement: { chain: 'site' } });
    expect(r).toMatchObject({ created: true, urgent: false });
    expect(r.task).toMatchObject({ id: 't1', client_title: 'Site change: Update the hours', state: { label: 'We will quote this', tone: 'quote' } });
  });

  it('opens the waits in the same transaction with the quote flag', async () => {
    await fileRequest(access, contact, siteChange, { now: NOW });
    const [dbArg, task, effects] = (onRequestFiled as Mock).mock.calls[0];
    expect(dbArg).toBe(tx);
    expect(task).toMatchObject({ id: 't1', client_id: 'cl1', site_id: 's1', assignee_id: BAST_USER_ID });
    expect(effects).toEqual({ intake_id: INTAKE, quote: true, emergency: false });
  });

  it('places in scope on an open build: project chain, no quote, support flag untouched', async () => {
    tx.project.findMany.mockResolvedValue([BUILD]);
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(createdData()).toMatchObject({ project_id: 'b1', charter_id: null, is_retainer_work: false });
    expect(createdData().tags).toEqual(['portal-chat', 'kind:site-change']);
    expect((onRequestFiled as Mock).mock.calls[0][2].quote).toBe(false);
  });

  it('places a blog request on the retainer: charter chain and retainer work', async () => {
    tx.charter.findMany.mockResolvedValue([CHARTER]);
    await fileRequest(
      access,
      contact,
      {
        intake_id: INTAKE,
        type: 'content_article',
        site_id: 's1',
        answers: [{ key: 'q1', value: 'Spring tips' }, { key: 'q2', value: 'blog' }],
      },
      { now: NOW }
    );
    expect(createdData()).toMatchObject({ charter_id: 'ch1', project_id: null, is_retainer_work: true });
  });

  it('marks in-scope site work on a planned site as support work', async () => {
    tx.site.findMany.mockResolvedValue([{ ...SITE, maintenance_plan_id: 'mp1' }]);
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(createdData()).toMatchObject({ is_support: true });
    expect(createdData().tags).not.toContain('quote');
  });

  it('assigns WordPress requests to Sabeen (looked up by email), never to the aspirational maintainer', async () => {
    tx.site.findMany.mockResolvedValue([{ ...SITE, site_type: 'wordpress', maintenance_assignee_id: 'maint-1' }]);
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(createdData().assignee_id).toBe('sabeen-id');
    expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { email: WORDPRESS_ASSIGNEE_EMAIL, is_active: true }, select: { id: true } });
    expect(WORDPRESS_ASSIGNEE_EMAIL).toBe('sabeen@becomeindelible.com');
    // The site query does not even read the aspirational field.
    expect(JSON.stringify((tx.site.findMany as Mock).mock.calls[0][0].select)).not.toContain('maintenance_assignee_id');
  });

  it('falls back to Mike when Sabeen cannot be found', async () => {
    tx.site.findMany.mockResolvedValue([{ ...SITE, platform: 'WordPress' }]);
    tx.user.findFirst.mockResolvedValue(null);
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(createdData().assignee_id).toBe(MIKE_USER_ID);
  });

  it('does not look Sabeen up for a non-WordPress site', async () => {
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(tx.user.findFirst).not.toHaveBeenCalled();
  });

  it('gives a marketing question with nowhere to go to Mike', async () => {
    await fileRequest(
      access,
      contact,
      { intake_id: INTAKE, type: 'marketing_question', site_id: 's1', answers: [{ key: 'q1', value: 'How are we doing?' }, { key: 'q2', value: 'plan_report' }] },
      { now: NOW }
    );
    expect(createdData().assignee_id).toBe(MIKE_USER_ID);
  });
});

describe('fileRequest: idempotency', () => {
  it('returns the existing task and changes nothing on a repeat intake_id', async () => {
    tx.task.findFirst.mockResolvedValue({ ...created({ title: 'T', client_title: 'Site change: Update the hours', tags: [], client_id: 'cl1' }), id: 'existing' });
    const r = await fileRequest(access, contact, siteChange, { now: NOW });
    expect(r.created).toBe(false);
    expect(r.task.id).toBe('existing');
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(onRequestFiled).not.toHaveBeenCalled();
    expect(dispatchNotification).not.toHaveBeenCalled();
  });
  it('a repeat is not counted against the rate limit', async () => {
    tx.task.findFirst.mockResolvedValue({ ...created({ title: 'T', client_title: 'T', tags: [], client_id: 'cl1' }), id: 'existing' });
    tx.task.count.mockResolvedValue(999);
    await expect(fileRequest(access, contact, siteChange, { now: NOW })).resolves.toMatchObject({ created: false });
    expect(tx.task.count).not.toHaveBeenCalled();
  });
  it('an intake_id already used by another client is a 404, never a leak', async () => {
    tx.task.findFirst.mockResolvedValue({ ...created({ title: 'T', client_title: 'T', tags: [], client_id: 'someone-else' }), id: 'x' });
    await expect(fileRequest(access, contact, siteChange, { now: NOW })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('fileRequest: rate limits', () => {
  it('429s at 6 an hour with the plain-language message', async () => {
    tx.task.count.mockResolvedValueOnce(LIMITS.per_hour).mockResolvedValueOnce(LIMITS.per_hour);
    const err = await fileRequest(access, contact, siteChange, { now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ statusCode: 429, code: 'rate_limited', message: RATE_LIMIT_MESSAGE });
    expect(tx.task.create).not.toHaveBeenCalled();
  });
  it('429s at 20 a day', async () => {
    tx.task.count.mockResolvedValueOnce(2).mockResolvedValueOnce(LIMITS.per_day);
    await expect(fileRequest(access, contact, siteChange, { now: NOW })).rejects.toMatchObject({ statusCode: 429 });
  });
  it('lets 5 an hour and 19 a day through', async () => {
    tx.task.count.mockResolvedValueOnce(LIMITS.per_hour - 1).mockResolvedValueOnce(LIMITS.per_day - 1);
    await expect(fileRequest(access, contact, siteChange, { now: NOW })).resolves.toMatchObject({ created: true });
  });
  it('counts per person across all of their contact rows, in the database, over the right windows', async () => {
    await fileRequest({ ...access, contactIds: ['ct1', 'ct9'] }, contact, siteChange, { now: NOW });
    const calls = (tx.task.count as Mock).mock.calls.map((c) => c[0].where);
    expect(calls[0]).toMatchObject({ source: 'portal', requested_by_contact_id: { in: ['ct1', 'ct9'] } });
    expect(calls[0].created_at.gte).toEqual(new Date(NOW.getTime() - 60 * 60 * 1000));
    expect(calls[1].created_at.gte).toEqual(new Date(NOW.getTime() - 24 * 60 * 60 * 1000));
  });
});

describe('fileRequest: emergencies', () => {
  it('files priority 1 with the tags, opens the emergency clock and alerts Mike after the commit', async () => {
    await fileRequest(access, contact, brokenUrgent, { now: NOW });
    const d = createdData();
    expect(d.priority).toBe(1);
    expect(d.tags).toEqual(['portal-chat', 'kind:troubleshoot', 'emergency', 'needs-mike']);
    expect((onRequestFiled as Mock).mock.calls[0][2]).toEqual({ intake_id: INTAKE, quote: false, emergency: true });
    expect(dispatchNotification).toHaveBeenCalledTimes(1);
    expect((dispatchNotification as Mock).mock.calls[0][0]).toMatchObject({
      userId: MIKE_USER_ID,
      type: 'portal_emergency',
      priority: 'critical',
      entityType: 'task',
      entityId: 't1',
    });
  });

  it('the fourth emergency a day files priority 2 with needs-mike, no emergency clock and no alert', async () => {
    tx.task.count
      .mockResolvedValueOnce(0) // hour
      .mockResolvedValueOnce(3) // day
      .mockResolvedValueOnce(LIMITS.emergencies_per_day); // emergencies today
    const r = await fileRequest(access, contact, brokenUrgent, { now: NOW });
    const d = createdData();
    expect(d.priority).toBe(2);
    expect(d.tags).toContain('needs-mike');
    expect(d.tags).not.toContain('emergency');
    expect((onRequestFiled as Mock).mock.calls[0][2].emergency).toBe(false);
    expect(dispatchNotification).not.toHaveBeenCalled();
    // The client is NOT told the team was alerted: no alert went out.
    expect(r.urgent).toBe(false);
    // But Mike still gets an in-app notification (no Slack) so a real outage after three false alarms reaches him.
    expect(createInAppNotificationOnly).toHaveBeenCalledTimes(1);
    expect((createInAppNotificationOnly as Mock).mock.calls[0][0]).toMatchObject({
      userId: MIKE_USER_ID,
      type: 'portal_emergency',
      priority: 'high',
      entityType: 'task',
      entityId: 't1',
    });
  });

  it('a real emergency reports urgent true and sends no in-app-only extra', async () => {
    const r = await fileRequest(access, contact, brokenUrgent, { now: NOW });
    expect(r.urgent).toBe(true);
    expect(createInAppNotificationOnly).not.toHaveBeenCalled();
  });

  it('a repeat of a real emergency still reports urgent (from the stored tag) and alerts nobody again', async () => {
    tx.task.findFirst.mockResolvedValue({ ...created({ title: 'T', client_title: 'T', tags: ['emergency'], client_id: 'cl1' }), id: 'existing' });
    const r = await fileRequest(access, contact, brokenUrgent, { now: NOW });
    expect(r).toMatchObject({ created: false, urgent: true });
    expect(dispatchNotification).not.toHaveBeenCalled();
    expect(createInAppNotificationOnly).not.toHaveBeenCalled();
  });

  it('a failed in-app notification for a downgraded emergency never loses the request', async () => {
    tx.task.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3).mockResolvedValueOnce(LIMITS.emergencies_per_day);
    (createInAppNotificationOnly as Mock).mockRejectedValueOnce(new Error('db hiccup'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(fileRequest(access, contact, brokenUrgent, { now: NOW })).resolves.toMatchObject({ created: true, urgent: false });
    spy.mockRestore();
  });

  it('counts emergencies per client over the last day', async () => {
    await fileRequest(access, contact, brokenUrgent, { now: NOW });
    const where = (tx.task.count as Mock).mock.calls[2][0].where;
    expect(where).toMatchObject({ client_id: 'cl1', tags: { has: 'emergency' } });
    expect(where.created_at.gte).toEqual(new Date(NOW.getTime() - 24 * 60 * 60 * 1000));
  });

  it('does not alert for a non-urgent broken request', async () => {
    await fileRequest(access, contact, { ...brokenUrgent, answers: [{ key: 'q1', value: 'page_link' }, { key: 'q2', value: '/about' }] }, { now: NOW });
    expect(createdData().priority).toBe(2);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('a failed alert never loses the request', async () => {
    (dispatchNotification as Mock).mockRejectedValueOnce(new Error('slack down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(fileRequest(access, contact, brokenUrgent, { now: NOW })).resolves.toMatchObject({ created: true, urgent: true });
    spy.mockRestore();
  });
});

describe('fileRequest: scope re-checks', () => {
  it('404s a site that is not the client\'s', async () => {
    await expect(fileRequest(access, contact, { ...siteChange, site_id: 'other-site' }, { now: NOW })).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.task.create).not.toHaveBeenCalled();
  });
  it('404s a project the contact may not see (hidden and restricted builds are never loaded)', async () => {
    await expect(fileRequest(access, contact, { ...siteChange, project_id: 'hidden-1' }, { now: NOW })).rejects.toMatchObject({ statusCode: 404 });
    const where = (tx.project.findMany as Mock).mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"portal_visibility":{"not":"hidden"}');
  });
  it('a project prefill sets the site from the project and chooses it', async () => {
    tx.project.findMany.mockResolvedValue([BUILD, { ...BUILD, id: 'b2', name: 'Other' }]);
    await fileRequest(access, contact, { ...siteChange, site_id: undefined, project_id: 'b2' }, { now: NOW });
    expect(createdData()).toMatchObject({ project_id: 'b2', site_id: 's1' });
  });
  it('rejects a project that is not on the named site', async () => {
    tx.site.findMany.mockResolvedValue([SITE, { ...SITE, id: 's2' }]);
    tx.project.findMany.mockResolvedValue([BUILD]);
    await expect(fileRequest(access, contact, { ...siteChange, site_id: 's2', project_id: 'b1' }, { now: NOW })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('422s when two builds match and none was chosen; a choice settles it', async () => {
    tx.project.findMany.mockResolvedValue([BUILD, { ...BUILD, id: 'b2', name: 'Other' }]);
    await expect(fileRequest(access, contact, siteChange, { now: NOW })).rejects.toMatchObject({ statusCode: 422, code: 'choose_project' });
    await fileRequest(access, contact, { ...siteChange, chosen_project_id: 'b2' }, { now: NOW });
    expect(createdData().project_id).toBe('b2');
  });
  it('404s a chosen project that is not among the visible ones', async () => {
    tx.project.findMany.mockResolvedValue([BUILD]);
    await expect(fileRequest(access, contact, { ...siteChange, chosen_project_id: 'nope' }, { now: NOW })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('files against the client when there are no sites at all', async () => {
    tx.site.findMany.mockResolvedValue([]);
    await fileRequest(access, contact, { ...siteChange, site_id: null }, { now: NOW });
    expect(createdData()).toMatchObject({ site_id: null, project_id: null, charter_id: null, client_id: 'cl1' });
  });
});

describe('fileRequest: queries are scoped to the client', () => {
  it('reads sites, projects, charters and hidden builds only for the session client', async () => {
    tx.project.findMany.mockResolvedValue([BUILD]);
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect((tx.site.findMany as Mock).mock.calls[0][0].where).toEqual({ client_id: 'cl1', is_deleted: false });
    expect((tx.charter.findMany as Mock).mock.calls[0][0].where).toEqual({ client_id: 'cl1', is_deleted: false, status: { in: ['active', 'paused'] } });
    const projectCalls = (tx.project.findMany as Mock).mock.calls.map((c) => c[0].where);
    expect(projectCalls).toHaveLength(2);
    for (const w of projectCalls) expect(w.client_id).toBe('cl1');
    // The visible-projects query carries the contact's access scope; the hidden-builds query is a plain open-builds-on-this-site read.
    expect(JSON.stringify(projectCalls[0])).toContain('"portal_visibility":{"not":"hidden"}');
    expect(projectCalls[1]).toMatchObject({ client_id: 'cl1', site_id: 's1', is_deleted: false, status: { in: ['ready', 'in_progress', 'review'] } });
  });

  it('never takes the client from the body: the rate-limit, emergency and idempotency reads use the session client', async () => {
    await fileRequest(access, contact, { ...brokenUrgent, client_id: 'another' } as unknown as FileRequestBody, { now: NOW });
    expect((tx.task.count as Mock).mock.calls[2][0].where.client_id).toBe('cl1');
    expect(createdData()).toMatchObject({ client_id: 'cl1' });
  });
});

describe('fileRequest: open builds the contact cannot see still gate scope', () => {
  it('reads their lock state only and quotes when a hidden build is locked, without placing on it', async () => {
    tx.project.findMany
      .mockResolvedValueOnce([BUILD]) // visible
      .mockResolvedValueOnce([{ id: 'b1', scope_locked: false }, { id: 'hidden-1', scope_locked: true }]); // all open builds on the site
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(createdData()).toMatchObject({ project_id: 'b1' });
    expect(createdData().tags).toContain('quote');
    const select = (tx.project.findMany as Mock).mock.calls[1][0].select;
    expect(Object.keys(select).sort()).toEqual(['id', 'scope_locked']);
  });

  it('with no visible build and one hidden locked build: site ad hoc, quote, no project id stored', async () => {
    tx.project.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'hidden-1', scope_locked: true }]);
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(createdData()).toMatchObject({ project_id: null, site_id: 's1' });
    expect(createdData().tags).toContain('quote');
    expect(JSON.stringify(createdData())).not.toContain('hidden-1');
  });

  it('does not look for hidden builds when no site was chosen', async () => {
    tx.site.findMany.mockResolvedValue([]);
    await fileRequest(access, contact, { ...siteChange, site_id: null }, { now: NOW });
    expect(tx.project.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('fileRequest: locks are taken before any count', () => {
  it('locks the intake, then each contact row sorted, then (for an emergency) the client, all before counting', async () => {
    const order: string[] = [];
    (tx.$executeRaw as Mock).mockImplementation(async (_s: unknown, key: string) => { order.push(`lock:${key}`); });
    (tx.task.count as Mock).mockImplementation(async () => { order.push('count'); return 0; });
    await fileRequest({ ...access, contactIds: ['ct9', 'ct1'] }, contact, brokenUrgent, { now: NOW });
    expect(order.slice(0, 4)).toEqual([
      `lock:portal-intake:${INTAKE}`,
      'lock:portal-intake-person:ct1',
      'lock:portal-intake-person:ct9',
      'count',
    ]);
    const clientLock = order.indexOf('lock:portal-intake-client:cl1');
    expect(clientLock).toBeGreaterThan(order.indexOf('count')); // hour and day counts first
    expect(order.slice(clientLock + 1)[0]).toBe('count'); // then the lock, then the emergency count
  });

  it('takes no client lock for a non-urgent request', async () => {
    const keys: string[] = [];
    (tx.$executeRaw as Mock).mockImplementation(async (_s: unknown, key: string) => { keys.push(key); });
    await fileRequest(access, contact, siteChange, { now: NOW });
    expect(keys).toEqual([`portal-intake:${INTAKE}`, 'portal-intake-person:ct1']);
  });
});
