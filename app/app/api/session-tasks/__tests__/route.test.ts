import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    arc: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskUpdate = prisma.task.update as Mock;
const mockTaskCreate = prisma.task.create as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockArcFindUnique = prisma.arc.findUnique as Mock;
const mockArcFindMany = prisma.arc.findMany as Mock;
const mockArcCreate = prisma.arc.create as Mock;

const ASSIGNEE_ID = '550e8400-e29b-41d4-a716-446655440002';
const ARC_ID = '550e8400-e29b-41d4-a716-446655440003';
const CLIENT_ID = '550e8400-e29b-41d4-a716-446655440004';

function postRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/session-tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'A quest',
    description: null,
    status: 'not_started',
    priority: 3,
    is_focus: false,
    project_id: null,
    client_id: null,
    client: null,
    site_id: null,
    site: null,
    charter_id: null,
    charter: null,
    is_maintenance_task: false,
    maintenance_period: null,
    phase: null,
    phase_id: null,
    project_phase: null,
    sort_order: 0,
    assignee_id: ASSIGNEE_ID,
    assignee: { id: ASSIGNEE_ID, name: 'Mike', email: 'mike@example.com', avatar_url: null },
    function_id: null,
    function: null,
    energy_estimate: null,
    mystery_factor: 'none',
    estimated_minutes: null,
    battery_impact: 'average_drain',
    due_date: null,
    started_at: null,
    completed_at: null,
    requirements: null,
    review_requirements: null,
    needs_review: false,
    reviewer_id: null,
    reviewer: null,
    approved: false,
    approved_at: null,
    approved_by_id: null,
    approved_by: null,
    sop_id: null,
    sop: null,
    is_billable: true,
    billing_target: null,
    billing_amount: null,
    is_retainer_work: false,
    is_support: false,
    invoiced: false,
    invoiced_at: null,
    invoiced_by_id: null,
    tags: [],
    source: 'session',
    source_ref: null,
    source_session_external_id: 'sess-abc',
    origin_url: null,
    arc_id: null,
    arc: null,
    requested_by_contact_id: null,
    staging_preview_url: null,
    staging_deployed_at: null,
    client_approved_at: null,
    approved_by_contact_id: null,
    is_deleted: false,
    created_at: new Date(),
    updated_at: new Date(),
    created_by_id: 'user-123',
    created_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
  mockTaskFindMany.mockResolvedValue([]);
  mockUserFindUnique.mockResolvedValue({ id: ASSIGNEE_ID, name: 'Mike', is_active: true });
});

describe('POST /api/session-tasks — validation', () => {
  it('rejects a missing session_external_id', async () => {
    const res = await POST(postRequest({ title: 'Quest', assignee_id: ASSIGNEE_ID }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing title', async () => {
    const res = await POST(postRequest({ session_external_id: 'sess-1', assignee_id: ASSIGNEE_ID }));
    expect(res.status).toBe(400);
  });

  it('rejects a title over 500 chars', async () => {
    const res = await POST(
      postRequest({ session_external_id: 'sess-1', title: 'A'.repeat(501), assignee_id: ASSIGNEE_ID })
    );
    expect(res.status).toBe(400);
  });

  it('rejects both arc_id and arc_name provided together (XOR violation)', async () => {
    const res = await POST(
      postRequest({
        session_external_id: 'sess-1',
        title: 'Quest',
        assignee_id: ASSIGNEE_ID,
        arc_id: ARC_ID,
        arc_name: 'Some Arc',
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/session-tasks — assignee defaults', () => {
  it('400s when no assignee_id is given and no default is configured', async () => {
    const originalEnv = process.env.CLARITY_DEFAULT_ASSIGNEE_ID;
    delete process.env.CLARITY_DEFAULT_ASSIGNEE_ID;

    const res = await POST(postRequest({ session_external_id: 'sess-1', title: 'Quest' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/assignee_id/);

    if (originalEnv !== undefined) process.env.CLARITY_DEFAULT_ASSIGNEE_ID = originalEnv;
  });

  it('falls back to CLARITY_DEFAULT_ASSIGNEE_ID when assignee_id is absent', async () => {
    const originalEnv = process.env.CLARITY_DEFAULT_ASSIGNEE_ID;
    process.env.CLARITY_DEFAULT_ASSIGNEE_ID = ASSIGNEE_ID;
    mockTaskCreate.mockResolvedValue(mockTask());

    const res = await POST(postRequest({ session_external_id: 'sess-1', title: 'Quest' }));

    expect(res.status).toBe(201);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignee_id: ASSIGNEE_ID }) })
    );

    if (originalEnv !== undefined) {
      process.env.CLARITY_DEFAULT_ASSIGNEE_ID = originalEnv;
    } else {
      delete process.env.CLARITY_DEFAULT_ASSIGNEE_ID;
    }
  });

  it('404s when the resolved assignee does not exist / is inactive', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(
      postRequest({ session_external_id: 'sess-1', title: 'Quest', assignee_id: ASSIGNEE_ID })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Assignee not found');
  });
});

describe('POST /api/session-tasks — create (no dedup match)', () => {
  it('creates a new task with defaults: source=session, needs_review=false, priority=3', async () => {
    mockTaskCreate.mockResolvedValue(mockTask());

    const res = await POST(
      postRequest({ session_external_id: 'sess-abc', title: 'A quest', assignee_id: ASSIGNEE_ID })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.deduped).toBe(false);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'session',
          source_session_external_id: 'sess-abc',
          needs_review: false,
          priority: 3,
          status: 'not_started',
        }),
      })
    );
  });

  it.each([
    ['client_blocking', 1],
    ['launch_blocking', 2],
    ['internal', 3],
  ])('maps severity %s to priority %d', async (severity, expectedPriority) => {
    mockTaskCreate.mockResolvedValue(mockTask({ priority: expectedPriority }));

    await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        severity,
      })
    );

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: expectedPriority }) })
    );
  });

  it('defaults priority to 3 when severity is absent', async () => {
    mockTaskCreate.mockResolvedValue(mockTask());
    await POST(postRequest({ session_external_id: 'sess-abc', title: 'A quest', assignee_id: ASSIGNEE_ID }));

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: 3 }) })
    );
  });

  it('404s when client_id does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        client_id: CLIENT_ID,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Client not found');
  });
});

describe('POST /api/session-tasks — dedup', () => {
  it('updates the existing task (deduped: true) on a case/whitespace-insensitive title match', async () => {
    const existing = mockTask({ id: 'existing-task', title: '  A Quest  ', status: 'in_progress' });
    mockTaskFindMany.mockResolvedValue([existing]);
    mockTaskUpdate.mockResolvedValue({ ...existing, title: '  A Quest  ' });

    const res = await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'a quest',
        assignee_id: ASSIGNEE_ID,
        description: 'Updated description',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deduped).toBe(true);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-task' } })
    );
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('does not dedup against a done task with the same title (creates a new one instead)', async () => {
    // The dedup query itself is status-scoped to not_started/in_progress, so a done task
    // for this session+title never comes back as a candidate.
    mockTaskFindMany.mockResolvedValue([]);
    mockTaskCreate.mockResolvedValue(mockTask());

    const res = await POST(
      postRequest({ session_external_id: 'sess-abc', title: 'A quest', assignee_id: ASSIGNEE_ID })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.deduped).toBe(false);
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['not_started', 'in_progress'] } }),
      })
    );
  });

  it('does not dedup against a different session_external_id', async () => {
    mockTaskFindMany.mockResolvedValue([]);
    mockTaskCreate.mockResolvedValue(mockTask());

    await POST(
      postRequest({ session_external_id: 'sess-other', title: 'A quest', assignee_id: ASSIGNEE_ID })
    );

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source_session_external_id: 'sess-other' }),
      })
    );
    expect(mockTaskCreate).toHaveBeenCalled();
  });
});

describe('POST /api/session-tasks — arc resolution', () => {
  it('404s when arc_id does not exist', async () => {
    mockArcFindUnique.mockResolvedValue(null);
    const res = await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        arc_id: ARC_ID,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Arc not found');
  });

  it('uses arc_id as-is when it exists', async () => {
    mockArcFindUnique.mockResolvedValue({ id: ARC_ID });
    mockTaskCreate.mockResolvedValue(mockTask({ arc_id: ARC_ID }));

    const res = await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        arc_id: ARC_ID,
      })
    );

    expect(res.status).toBe(201);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: ARC_ID }) })
    );
  });

  it('reuses an existing open arc that matches arc_name exactly', async () => {
    mockArcFindMany.mockResolvedValue([
      { id: 'open-arc', name: 'Growth Roadmap', closed_at: null, tasks: [{ status: 'in_progress' }], created_at: new Date() },
    ]);
    mockTaskCreate.mockResolvedValue(mockTask({ arc_id: 'open-arc' }));

    const res = await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        arc_name: 'Growth Roadmap',
      })
    );

    expect(res.status).toBe(201);
    expect(mockArcCreate).not.toHaveBeenCalled();
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: 'open-arc' }) })
    );
  });

  it('skips a complete arc with the same name and creates a new one instead', async () => {
    mockArcFindMany.mockResolvedValue([
      { id: 'complete-arc', name: 'Growth Roadmap', closed_at: new Date(), tasks: [{ status: 'done' }], created_at: new Date() },
    ]);
    mockArcCreate.mockResolvedValue({ id: 'new-arc' });
    mockTaskCreate.mockResolvedValue(mockTask({ arc_id: 'new-arc' }));

    const res = await POST(
      postRequest({
        session_external_id: 'sess-xyz',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        arc_name: 'Growth Roadmap',
      })
    );

    expect(res.status).toBe(201);
    expect(mockArcCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Growth Roadmap',
          origin_session_external_id: 'sess-xyz',
        }),
      })
    );
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: 'new-arc' }) })
    );
  });

  it('creates a new arc when no arc of that name exists at all', async () => {
    mockArcFindMany.mockResolvedValue([]);
    mockArcCreate.mockResolvedValue({ id: 'brand-new-arc' });
    mockTaskCreate.mockResolvedValue(mockTask({ arc_id: 'brand-new-arc' }));

    const res = await POST(
      postRequest({
        session_external_id: 'sess-abc',
        title: 'A quest',
        assignee_id: ASSIGNEE_ID,
        arc_name: 'Never Seen Before',
      })
    );

    expect(res.status).toBe(201);
    expect(mockArcCreate).toHaveBeenCalled();
  });

  it('leaves arc_id null when neither arc_id nor arc_name is given', async () => {
    mockTaskCreate.mockResolvedValue(mockTask());

    await POST(postRequest({ session_external_id: 'sess-abc', title: 'A quest', assignee_id: ASSIGNEE_ID }));

    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: null }) })
    );
    expect(mockArcFindUnique).not.toHaveBeenCalled();
    expect(mockArcFindMany).not.toHaveBeenCalled();
  });
});
