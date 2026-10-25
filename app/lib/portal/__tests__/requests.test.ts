import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: { task: { findMany: vi.fn(), findFirst: vi.fn() } } }));

import { prisma } from '@/lib/db/prisma';
import { taskAccessWhere, type PortalAccess } from '../access';
import { clientVisibleTaskWhere } from '../visibility';
import { firstName, loadRequests, loadWorkItem, requestsScope, sortRequests, toRequestItem } from '../requests';

const findMany = prisma.task.findMany as Mock;
const findFirst = prisma.task.findFirst as Mock;

const owner: PortalAccess = { contactId: 'c1', clientId: 'cl1', role: 'owner' };
const viewer: PortalAccess = { contactId: 'c2', clientId: 'cl1', role: 'viewer' };
const grantOnly: PortalAccess = { contactId: 'c3', clientId: 'cl1', role: 'none' };

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `internal ${id}`,
  client_title: null,
  status: 'not_started',
  tags: ['portal-chat', 'needs-mike', 'kind:site-change'],
  staging_preview_url: null,
  approved: false,
  client_approved_at: null,
  created_at: new Date('2026-10-20T00:00:00Z'),
  updated_at: new Date('2026-10-20T00:00:00Z'),
  project_id: null,
  charter_id: null,
  project: null,
  charter: null,
  site: { id: 's1', name: 'example.com' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe('requestsScope', () => {
  it('scopes to the client, the contact\'s project access, and ad hoc-visible OR contact-filed', () => {
    const scope = requestsScope(owner) as { is_deleted: boolean; AND: Array<Record<string, unknown>> };
    expect(scope.is_deleted).toBe(false);
    expect(scope.AND[0]).toEqual({ OR: [{ client_id: 'cl1' }, { site: { client_id: 'cl1' } }] });
    expect(scope.AND[1]).toEqual(taskAccessWhere(owner));
    expect(scope.AND[2]).toEqual({
      OR: [
        { project_id: null, charter_id: null, AND: [clientVisibleTaskWhere()] },
        { requested_by_contact_id: { not: null } },
      ],
    });
  });

  it('a hidden or restricted project never appears: the project access scope is part of the filter', () => {
    const text = JSON.stringify(requestsScope(viewer));
    expect(text).toContain('"portal_visibility":{"not":"hidden"}');
    expect(text).toContain('"is_deleted":false');
  });

  it('a viewer gets the same shape as an owner on the client scope (any role may read)', () => {
    const o = requestsScope(owner) as { AND: unknown[] };
    const v = requestsScope(viewer) as { AND: unknown[] };
    expect(v.AND[0]).toEqual(o.AND[0]);
    expect(v.AND[2]).toEqual(o.AND[2]);
  });

  it('a grant-only contact is limited to granted projects (no client-level tasks)', () => {
    const scope = requestsScope(grantOnly) as { AND: unknown[] };
    expect(scope.AND[1]).toEqual(taskAccessWhere(grantOnly));
    expect(JSON.stringify(scope.AND[1])).toContain('contact_grants');
    expect(JSON.stringify(scope.AND[1])).not.toContain('"project_id":null');
  });

  it('a revoked contact matches nothing', () => {
    const scope = requestsScope({ ...owner, revoked: true }) as { AND: unknown[] };
    expect(scope.AND[1]).toEqual({ id: { in: [] } });
  });
});

describe('loadRequests', () => {
  it('runs an open query and a recently-closed query with the site filter and a 30 day window', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    await loadRequests(owner, { site_id: 's1', now });
    expect(findMany).toHaveBeenCalledTimes(2);
    const [open, closed] = findMany.mock.calls.map((c) => c[0]);
    expect(JSON.stringify(open.where)).toContain('"site_id":"s1"');
    expect(JSON.stringify(open.where)).toContain('"client_approved_at":null');
    expect(JSON.stringify(closed.where)).toContain('"status":"abandoned"');
    const since = JSON.stringify(closed.where).match(/"updated_at":\{"gte":"([^"]+)"/)?.[1];
    expect(since).toBe('2026-09-21T12:00:00.000Z');
  });

  it('clamps closed_days', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    await loadRequests(owner, { closed_days: 100000, now });
    const closed = findMany.mock.calls[1][0];
    expect(JSON.stringify(closed.where)).toContain('2025-10-21T12:00:00.000Z');
  });

  it('selects an allow-list: no assignee, estimate or notes columns', async () => {
    await loadRequests(owner);
    const select = Object.keys(findMany.mock.calls[0][0].select);
    for (const forbidden of ['assignee_id', 'assignee', 'estimated_minutes', 'notes', 'billing_amount', 'description', 'client_intake', 'portal_token']) {
      expect(select).not.toContain(forbidden);
    }
  });

  it('puts requests that need the client first, then newest, and uses the client label', async () => {
    findMany
      .mockResolvedValueOnce([
        row('old-attn', { tags: ['awaiting-clarification'], updated_at: new Date('2026-10-01T00:00:00Z') }),
        row('new-plain', { client_title: 'Site change: hours', updated_at: new Date('2026-10-20T00:00:00Z') }),
        row('mid-plain', { updated_at: new Date('2026-10-10T00:00:00Z') }),
      ])
      .mockResolvedValueOnce([]);
    const { open } = await loadRequests(owner);
    expect(open.map((o) => o.id)).toEqual(['old-attn', 'new-plain', 'mid-plain']);
    expect(open[1].title).toBe('Site change: hours');
    expect(open[0].title).toBe('internal old-attn');
  });

  it('never returns tags, even the ones that drive the state', async () => {
    findMany.mockResolvedValueOnce([row('a', { tags: ['quote', 'needs-mike'] })]).mockResolvedValueOnce([]);
    const { open } = await loadRequests(owner);
    expect(open[0].state).toEqual({ label: 'We will quote this', tone: 'quote' });
    expect(JSON.stringify(open)).not.toMatch(/needs-mike|portal-chat|kind:|"tags"/);
  });

  it('reads ad hoc and project-chain items alike, with their engagement chips', async () => {
    findMany
      .mockResolvedValueOnce([
        row('adhoc'),
        row('proj', { project_id: 'p1', project: { id: 'p1', name: 'Relaunch' } }),
        row('ret', { charter_id: 'ch1', charter: { id: 'ch1', charter_wares: [{ ware: { name: 'SEO' } }] } }),
      ])
      .mockResolvedValueOnce([]);
    const { open } = await loadRequests(viewer);
    const kinds = Object.fromEntries(open.map((o) => [o.id, o.engagement]));
    expect(kinds.adhoc).toMatchObject({ kind: 'request', label: 'example.com' });
    expect(kinds.proj).toMatchObject({ kind: 'project', label: 'Relaunch' });
    expect(kinds.ret).toMatchObject({ kind: 'retainer', label: 'SEO' });
  });
});

describe('sortRequests / toRequestItem', () => {
  it('is stable on ties and does not mutate its input', () => {
    const a = toRequestItem(row('a') as never);
    const b = toRequestItem(row('b') as never);
    const input = [a, b];
    const out = sortRequests(input);
    expect(input).toEqual([a, b]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('loadWorkItem', () => {
  const workRow = (over: Record<string, unknown> = {}) => ({
    ...row('t1', { client_title: 'Site change: hours', tags: ['portal-chat', 'needs-mike'] }),
    client_intake: {
      v: 1,
      answers: [{ key: 'q1', prompt: 'What should change?', value: 'The hours', extra: 'x' }],
      placement: { chain: 'site', rule: 'secret-rule' },
    },
    requested_by_contact: { name: 'Dana Reyes' },
    ...over,
  });

  it('returns null (a 404 upstream) when the task is not visible', async () => {
    findFirst.mockResolvedValue(null);
    expect(await loadWorkItem(owner, 't1')).toBeNull();
  });

  it('applies the client scope, the visibility rule and the project access scope', async () => {
    findFirst.mockResolvedValue(null);
    await loadWorkItem(viewer, 't1');
    const where = findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('t1');
    expect(where.is_deleted).toBe(false);
    expect(where.AND).toEqual([
      { OR: [{ client_id: 'cl1' }, { site: { client_id: 'cl1' } }] },
      clientVisibleTaskWhere(),
      taskAccessWhere(viewer),
    ]);
  });

  it('returns client words, the first name only and the answers without internals', async () => {
    findFirst.mockResolvedValue(workRow());
    const w = await loadWorkItem(owner, 't1');
    expect(w).toMatchObject({
      id: 't1',
      title: 'Site change: hours',
      state: { label: 'Received', tone: 'quiet' },
      requested_by: { first_name: 'Dana' },
      answers: [{ prompt: 'What should change?', value: 'The hours' }],
      staged: null,
      approved_at: null,
      can_act: true,
    });
    const text = JSON.stringify(w);
    expect(text).not.toMatch(/secret-rule|needs-mike|portal-chat|Reyes|"extra"/);
  });

  it('shows the staged preview, and a viewer can act on it (any portal user may approve)', async () => {
    findFirst.mockResolvedValue(workRow({ status: 'review', staging_preview_url: 'https://staging.example.com' }));
    const w = await loadWorkItem(viewer, 't1');
    expect(w?.staged).toEqual({ preview_url: 'https://staging.example.com', staging_deployed_at: null, awaiting_approval: true });
    expect(w?.state.label).toBe('Ready for your review');
    expect(w?.can_act).toBe(true);
  });

  it('approved and not live: Approved label, approval date, no review block', async () => {
    findFirst.mockResolvedValue(
      workRow({ status: 'review', staging_preview_url: 'https://staging.example.com', client_approved_at: new Date('2026-10-21T15:00:00Z'), tags: ['client-approved'] })
    );
    const w = await loadWorkItem(viewer, 't1');
    expect(w?.state).toEqual({ label: 'Approved. Going live soon.', tone: 'moving' });
    expect(w?.approved_at).toEqual(new Date('2026-10-21T15:00:00Z'));
    expect(w?.staged?.awaiting_approval).toBe(false);
  });

  it('copes with work that has no intake block or no requester', async () => {
    findFirst.mockResolvedValue(workRow({ client_intake: null, requested_by_contact: null }));
    const w = await loadWorkItem(owner, 't1');
    expect(w?.answers).toEqual([]);
    expect(w?.requested_by).toBeNull();
  });
});

describe('firstName', () => {
  it('takes the first word and tolerates blanks', () => {
    expect(firstName('Dana Reyes')).toBe('Dana');
    expect(firstName('  ')).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
