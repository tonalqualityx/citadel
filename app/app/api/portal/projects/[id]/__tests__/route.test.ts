import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';
import { FakePortalDb } from '@/lib/portal/__tests__/fake-portal-db';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockAuth = requireClientAuth as Mock;
const db = new FakePortalDb();

function req() {
  return new NextRequest(new URL('http://localhost/api/portal/projects/x'));
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function session(role: 'owner' | 'member' | 'viewer' | 'none', contactId = 'contact-1') {
  mockAuth.mockResolvedValue({ clientId: 'client-acme', contactId, role });
}

// A project row as Prisma would return it for the route's select, with phases and links.
function projectRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Project ${id}`,
    status: 'in_progress',
    target_date: new Date('2026-12-01T00:00:00Z'),
    completed_date: null,
    phases: [
      { id: 'ph1', name: 'Design', sort_order: 1 },
      { id: 'ph2', name: 'Build', sort_order: 2 },
    ],
    resource_links: [
      { name: 'Figma file', url: 'https://figma.com/internal', icon: 'figma' },
      { name: 'Review site copy', url: 'https://review.example/p1', icon: 'review' },
    ],
    ...extra,
  };
}

const T = (over: Record<string, unknown>) => ({
  id: 't?',
  title: 'A task',
  status: 'in_progress',
  phase_id: 'ph2',
  tags: [],
  completed_at: null,
  updated_at: new Date('2026-10-10T00:00:00Z'),
  requested_by_contact_id: 'contact-1',
  client_visible: false,
  staging_preview_url: null,
  staging_deployed_at: null,
  approved: false,
  client_approved_at: null,
  comments: [],
  // Internal fields a careless projection would leak. The route must never copy these.
  estimated_minutes: 120,
  energy_estimate: 5,
  assignee_id: 'user-9',
  notes: 'Bast internal note',
  billing_amount: 900,
  ...over,
});

let tasks: ReturnType<typeof T>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.addClient({ id: 'client-acme', name: 'Acme' });
  db.addClient({ id: 'client-other', name: 'Other' });
  db.addProject({ id: 'p-open', client_id: 'client-acme' });
  db.addProject({ id: 'p-hidden', client_id: 'client-acme', portal_visibility: 'hidden' });
  db.addProject({ id: 'p-restricted', client_id: 'client-acme', portal_visibility: 'restricted' });
  db.addProject({ id: 'p-quote', client_id: 'client-acme', status: 'quote' });
  db.addProject({ id: 'p-deleted', client_id: 'client-acme', is_deleted: true });
  db.addProject({ id: 'p-foreign', client_id: 'client-other' });
  tasks = [];
  // The route's project lookup is evaluated by the REAL projectAccessWhere against the fake store.
  (prisma.project.findFirst as Mock).mockImplementation(async ({ where }: { where: object }) => {
    const [idPart] = (where as { AND: [{ id: string }] }).AND;
    return db.visibleProjectIds(where).includes(idPart.id) ? projectRow(idPart.id) : null;
  });
  (prisma.task.findMany as Mock).mockImplementation(async () => tasks);
});

describe('GET /api/portal/projects/:id access', () => {
  it('401 without a session', async () => {
    mockAuth.mockRejectedValue(new AuthError('Client authentication required', 401));
    const res = await GET(req(), params('p-open'));
    expect(res.status).toBe(401);
  });

  it('200 for an accessible project', async () => {
    session('owner');
    const res = await GET(req(), params('p-open'));
    expect(res.status).toBe(200);
  });

  it.each([
    ['hidden project', 'owner', 'p-hidden'],
    ['quote-stage project', 'owner', 'p-quote'],
    ['deleted project', 'owner', 'p-deleted'],
    ['another client\'s project', 'owner', 'p-foreign'],
    ['restricted project for a member', 'member', 'p-restricted'],
    ['restricted project for a viewer', 'viewer', 'p-restricted'],
    ['unknown id', 'owner', 'nope'],
  ] as const)('404 for %s', async (_label, role, id) => {
    session(role);
    const res = await GET(req(), params(id));
    expect(res.status).toBe(404);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('owner sees a restricted project', async () => {
    session('owner');
    const res = await GET(req(), params('p-restricted'));
    expect(res.status).toBe(200);
  });

  it('a project-only contact sees only the projects they were granted', async () => {
    db.addGrant({ project_id: 'p-restricted', contact_id: 'contact-1', role: 'viewer' });
    session('none');
    expect((await GET(req(), params('p-restricted'))).status).toBe(200);
    expect((await GET(req(), params('p-open'))).status).toBe(404);
    expect((await GET(req(), params('p-hidden'))).status).toBe(404);
  });

  it('a grant never opens a hidden project', async () => {
    db.addGrant({ project_id: 'p-hidden', contact_id: 'contact-1', role: 'member' });
    session('none');
    expect((await GET(req(), params('p-hidden'))).status).toBe(404);
  });

  it('a revoked-session contact (role none, no grant) gets 404 everywhere', async () => {
    session('none');
    expect((await GET(req(), params('p-open'))).status).toBe(404);
  });

  it('scopes the task query to the project and to the A1/A3 rules', async () => {
    session('member');
    await GET(req(), params('p-open'));
    const where = (prisma.task.findMany as Mock).mock.calls[0][0].where;
    expect(where.project_id).toBe('p-open');
    expect(where.is_deleted).toBe(false);
    expect(where.AND).toHaveLength(2);
  });
});

describe('GET /api/portal/projects/:id payload', () => {
  it('shapes status, progress, phases, tasks, needs, links and history in client words', async () => {
    tasks = [
      T({ id: 't1', title: 'Wireframes', status: 'done', phase_id: 'ph1', completed_at: new Date('2026-10-01T00:00:00Z') }),
      T({ id: 't2', title: 'Build home page', status: 'blocked' }),
      T({
        id: 't3',
        title: 'Footer',
        status: 'done',
        staging_preview_url: 'https://preview.example/footer',
        staging_deployed_at: new Date('2026-10-12T00:00:00Z'),
      }),
      T({
        id: 't4',
        title: 'Pick a logo',
        tags: ['awaiting-clarification', 'bast-doable'],
        comments: [
          { content: 'Internal: Bast tried twice', created_at: new Date('2026-10-12'), is_internal: true },
          { content: 'Which logo do you prefer?', created_at: new Date('2026-10-11'), is_internal: false },
        ],
      }),
    ];
    session('member');
    const res = await GET(req(), params('p-open'));
    const body = await res.json();

    expect(body.project).toMatchObject({
      id: 'p-open',
      status_label: 'In progress',
      progress: { done: 1, total: 4 },
      current_phase: 'Build',
    });
    expect(body.phases).toEqual([
      { id: 'ph1', name: 'Design', state: 'done' },
      { id: 'ph2', name: 'Build', state: 'current' },
    ]);
    const byId = Object.fromEntries(body.tasks.map((t: { id: string }) => [t.id, t]));
    expect(byId.t2.status_label).toBe('In progress');
    expect(byId.t3).toMatchObject({ status_label: 'Ready for your review', awaiting_you: true, is_done: false });
    expect(body.needs_from_you.approvals).toEqual([
      expect.objectContaining({ id: 't3', staging_preview_url: 'https://preview.example/footer' }),
    ]);
    expect(body.needs_from_you.requests).toEqual([
      { task_id: 't4', title: 'Pick a logo', question: 'Which logo do you prefer?', asked_at: expect.anything() },
    ]);
    expect(body.needs_from_you.review_link).toBe('https://review.example/p1');
    // Only client-marked links plus the staging preview; the Figma link stays internal.
    expect(body.links.map((l: { name: string }) => l.name)).toEqual(['Review site copy', 'Preview: Footer']);
    expect(body.history.map((h: { id: string }) => h.id)).toEqual(['t1']);
  });

  it('never includes estimates, internal fields, billing or staff names in the payload', async () => {
    tasks = [
      T({ id: 't1', status: 'done', completed_at: new Date() }),
      T({
        id: 't2',
        tags: ['awaiting-clarification'],
        comments: [{ content: 'Internal: Bast note', created_at: new Date(), is_internal: true }],
      }),
    ];
    session('owner');
    const text = JSON.stringify(await (await GET(req(), params('p-open'))).json());
    for (const forbidden of [
      'estimated_minutes',
      'energy_estimate',
      'assignee',
      'billing_amount',
      'tags',
      'bast-doable',
      'Bast',
      'figma.com/internal',
      '"notes"',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    // The query itself never asks for estimate or assignee columns.
    const select = (prisma.task.findMany as Mock).mock.calls[0][0].select;
    expect(Object.keys(select)).not.toContain('estimated_minutes');
    expect(Object.keys(select)).not.toContain('assignee_id');
  });

  it('does not list a phase that holds no client-visible task', async () => {
    tasks = [T({ id: 't1', phase_id: 'ph1' })];
    session('owner');
    const body = await (await GET(req(), params('p-open'))).json();
    expect(body.phases.map((p: { name: string }) => p.name)).toEqual(['Design']);
  });

  it('shows the review link as null when the project has none', async () => {
    (prisma.project.findFirst as Mock).mockImplementation(async () => projectRow('p-open', { resource_links: [] }));
    session('owner');
    const body = await (await GET(req(), params('p-open'))).json();
    expect(body.needs_from_you.review_link).toBeNull();
    expect(body.links).toEqual([]);
  });
});
