import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    function: {
      findUnique: vi.fn(),
    },
    sop: {
      findUnique: vi.fn(),
    },
    projectTeamAssignment: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatTaskResponse: vi.fn((task) => ({
    ...task,
    time_spent_minutes: null,
  })),
}));

// Mock activity logging
vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
}));

// Mock notifications
vi.mock('@/lib/services/notifications', () => ({
  notifyTaskAssigned: vi.fn(),
}));

// Mock energy calculations
vi.mock('@/lib/calculations/energy', () => ({
  calculateEstimatedMinutes: vi.fn((energy, mystery) => energy * 30),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logCreate } from '@/lib/services/activity';
import { notifyTaskAssigned } from '@/lib/services/notifications';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors for Prisma methods
const mockTaskCreate = prisma.task.create as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskCount = prisma.task.count as Mock;
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockFunctionFindUnique = prisma.function.findUnique as Mock;
const mockSopFindUnique = prisma.sop.findUnique as Mock;
const mockProjectTeamAssignment = prisma.projectTeamAssignment.findFirst as Mock;
const mockLogCreate = vi.mocked(logCreate);
const mockNotifyTaskAssigned = vi.mocked(notifyTaskAssigned);

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createGetRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/tasks?${searchParams.toString()}`, {
    method: 'GET',
  });
}

const mockCreatedTask = {
  id: 'task-123',
  title: 'Test Task',
  description: null,
  status: 'not_started',
  priority: 3,
  is_focus: false,
  project_id: null,
  client_id: null,
  site_id: null,
  phase_id: null,
  phase: null,
  sort_order: 0,
  assignee_id: null,
  assignee: null,
  reviewer_id: 'user-123',
  reviewer: null,
  approved: false,
  approved_at: null,
  approved_by_id: null,
  approved_by: null,
  function_id: null,
  function: null,
  sop_id: null,
  sop: null,
  requirements: null,
  review_requirements: null,
  needs_review: true,
  energy_estimate: null,
  mystery_factor: 'none',
  battery_impact: 'average_drain',
  estimated_minutes: null,
  due_date: null,
  started_at: expect.any(Date),
  completed_at: null,
  is_billable: true,
  billing_target: null,
  billing_amount: null,
  is_retainer_work: false,
  is_support: false,
  invoiced: false,
  invoiced_at: null,
  invoiced_by_id: null,
  notes: null,
  created_by_id: 'user-123',
  created_by: null,
  project: null,
  client: null,
  site: null,
  project_phase: null,
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('POST /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockTaskCreate.mockResolvedValue(mockCreatedTask);
  });

  describe('Minimal data - required fields only', () => {
    it('creates a task with only title provided', async () => {
      const request = createPostRequest({ title: 'New Task' });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'New Task',
            status: 'not_started',
            priority: 3,
          }),
        })
      );
    });

    it('logs activity after task creation', async () => {
      const request = createPostRequest({ title: 'New Task' });
      await POST(request);

      expect(mockLogCreate).toHaveBeenCalledWith(
        'user-123',
        'task',
        'task-123',
        'Test Task'
      );
    });
  });

  describe('Task creation with project', () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const clientId = '550e8400-e29b-41d4-a716-446655440001';

    beforeEach(() => {
      mockProjectFindUnique.mockResolvedValue({
        id: projectId,
        client_id: clientId,
        is_retainer: false,
        client: { retainer_hours: null },
        created_by_id: 'user-123',
      });
    });

    it('creates a task with project_id', async () => {
      const request = createPostRequest({
        title: 'Project Task',
        project_id: projectId,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockProjectFindUnique).toHaveBeenCalledWith({
        where: { id: projectId, is_deleted: false },
        select: expect.any(Object),
      });
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            project: { connect: { id: projectId } },
            client: { connect: { id: clientId } }, // Auto-populated from project
          }),
        })
      );
    });

    it('returns 404 when project does not exist', async () => {
      mockProjectFindUnique.mockResolvedValue(null);

      const request = createPostRequest({
        title: 'Project Task',
        project_id: projectId,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Project not found');
    });

    it('marks task as retainer work for retainer projects', async () => {
      mockProjectFindUnique.mockResolvedValue({
        id: projectId,
        client_id: clientId,
        is_retainer: true,
        client: { retainer_hours: 20 },
        created_by_id: 'user-123',
      });

      const request = createPostRequest({
        title: 'Retainer Task',
        project_id: projectId,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_retainer_work: true,
          }),
        })
      );
    });
  });

  describe('Task creation with client (ad-hoc)', () => {
    const clientId = '550e8400-e29b-41d4-a716-446655440001';

    it('creates an ad-hoc task with client_id', async () => {
      const request = createPostRequest({
        title: 'Ad-hoc Task',
        client_id: clientId,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            client: { connect: { id: clientId } },
          }),
        })
      );
    });
  });

  describe('Task creation with assignee', () => {
    const assigneeId = '550e8400-e29b-41d4-a716-446655440002';

    beforeEach(() => {
      mockUserFindUnique.mockResolvedValue({
        id: assigneeId,
        name: 'Test Assignee',
        is_active: true,
      });
    });

    it('creates a task with assignee', async () => {
      const request = createPostRequest({
        title: 'Assigned Task',
        assignee_id: assigneeId,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockUserFindUnique).toHaveBeenCalledWith({
        where: { id: assigneeId, is_active: true },
      });
    });

    it('sends notification when assigned to another user', async () => {
      mockTaskCreate.mockResolvedValue({
        ...mockCreatedTask,
        assignee: { id: assigneeId, name: 'Test Assignee', email: 'assignee@test.com', avatar_url: null },
      });
      mockUserFindUnique.mockResolvedValue({ name: 'Creator Name' });

      const request = createPostRequest({
        title: 'Assigned Task',
        assignee_id: assigneeId,
      });
      await POST(request);

      expect(mockNotifyTaskAssigned).toHaveBeenCalledWith(
        'task-123',
        assigneeId,
        'Creator Name'
      );
    });

    it('returns 404 when assignee does not exist', async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const request = createPostRequest({
        title: 'Assigned Task',
        assignee_id: assigneeId,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Assignee not found');
    });
  });

  describe('Task creation with SOP defaults', () => {
    const sopId = '550e8400-e29b-41d4-a716-446655440003';

    beforeEach(() => {
      mockSopFindUnique.mockResolvedValue({
        id: sopId,
        template_requirements: [{ id: '1', text: 'Requirement 1', completed: false }],
        review_requirements: [{ id: '2', text: 'Review 1', completed: false }],
        energy_estimate: 4,
        mystery_factor: 'average',
        battery_impact: 'high_drain',
        default_priority: 2,
        needs_review: true,
        function_id: null,
      });
    });

    it('applies SOP defaults to task', async () => {
      const request = createPostRequest({
        title: 'SOP Task',
        sop_id: sopId,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sop: { connect: { id: sopId } },
            energy_estimate: 4,
            mystery_factor: 'average',
            battery_impact: 'high_drain',
            priority: 2,
            needs_review: true,
          }),
        })
      );
    });
  });

  describe('Title validation', () => {
    it('rejects empty title', async () => {
      const request = createPostRequest({ title: '' });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects missing title', async () => {
      const request = createPostRequest({});
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects title exceeding 500 characters', async () => {
      const request = createPostRequest({
        title: 'A'.repeat(501),
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Status validation', () => {
    it.each(['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'])(
      'accepts valid status: %s',
      async (status) => {
        const request = createPostRequest({
          title: 'Task with status',
          status,
        });
        const response = await POST(request);

        expect(response.status).toBe(201);
      }
    );

    it('rejects invalid status', async () => {
      const request = createPostRequest({
        title: 'Task',
        status: 'invalid_status',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Priority validation', () => {
    it.each([1, 2, 3, 4, 5])('accepts valid priority: %d', async (priority) => {
      const request = createPostRequest({
        title: 'Task with priority',
        priority,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('rejects priority below 1', async () => {
      const request = createPostRequest({
        title: 'Task',
        priority: 0,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects priority above 5', async () => {
      const request = createPostRequest({
        title: 'Task',
        priority: 6,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Energy estimate validation', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])('accepts valid energy estimate: %d', async (energy) => {
      const request = createPostRequest({
        title: 'Task with energy',
        energy_estimate: energy,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('accepts null energy estimate', async () => {
      const request = createPostRequest({
        title: 'Task',
        energy_estimate: null,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('rejects energy estimate below 1', async () => {
      const request = createPostRequest({
        title: 'Task',
        energy_estimate: 0,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects energy estimate above 8', async () => {
      const request = createPostRequest({
        title: 'Task',
        energy_estimate: 9,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Mystery factor validation', () => {
    it.each(['none', 'average', 'significant', 'no_idea'])(
      'accepts valid mystery factor: %s',
      async (mysteryFactor) => {
        const request = createPostRequest({
          title: 'Task',
          mystery_factor: mysteryFactor,
        });
        const response = await POST(request);

        expect(response.status).toBe(201);
      }
    );

    it('rejects invalid mystery factor', async () => {
      const request = createPostRequest({
        title: 'Task',
        mystery_factor: 'invalid',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Battery impact validation', () => {
    it.each(['average_drain', 'high_drain', 'energizing'])(
      'accepts valid battery impact: %s',
      async (batteryImpact) => {
        const request = createPostRequest({
          title: 'Task',
          battery_impact: batteryImpact,
        });
        const response = await POST(request);

        expect(response.status).toBe(201);
      }
    );

    it('rejects invalid battery impact', async () => {
      const request = createPostRequest({
        title: 'Task',
        battery_impact: 'invalid',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Billing fields', () => {
    it('accepts billing_amount', async () => {
      const request = createPostRequest({
        title: 'Billable Task',
        billing_amount: 150.50,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billing_amount: 150.50,
          }),
        })
      );
    });

    it('accepts is_support flag', async () => {
      const request = createPostRequest({
        title: 'Support Task',
        is_support: true,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_support: true,
          }),
        })
      );
    });
  });

  describe('Full task creation with all fields', () => {
    it('creates task with all optional fields populated', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const assigneeId = '550e8400-e29b-41d4-a716-446655440001';

      mockProjectFindUnique.mockResolvedValue({
        id: projectId,
        client_id: 'client-123',
        is_retainer: false,
        client: { retainer_hours: null },
        created_by_id: 'user-123',
      });
      mockUserFindUnique.mockResolvedValue({
        id: assigneeId,
        name: 'Assignee',
        is_active: true,
      });

      const request = createPostRequest({
        title: 'Full Task',
        description: 'Task description',
        status: 'in_progress',
        priority: 2,
        project_id: projectId,
        assignee_id: assigneeId,
        energy_estimate: 4,
        mystery_factor: 'average',
        battery_impact: 'high_drain',
        due_date: '2026-02-15T00:00:00.000Z',
        notes: 'Some notes',
        billing_amount: 100,
        is_support: false,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Full Task',
            description: 'Task description',
            status: 'in_progress',
            priority: 2,
            project: { connect: { id: projectId } },
            assignee: { connect: { id: assigneeId } },
            energy_estimate: 4,
            mystery_factor: 'average',
            battery_impact: 'high_drain',
            notes: 'Some notes',
            billing_amount: 100,
            is_support: false,
          }),
        })
      );
    });
  });

  describe('Tech user restrictions', () => {
    beforeEach(() => {
      mockRequireAuth.mockResolvedValue({
        userId: 'tech-user-123',
        role: 'tech',
        email: 'tech@example.com',
      });
    });

    it('allows tech user to create task when assigned to project', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockProjectFindUnique.mockResolvedValue({
        id: projectId,
        client_id: 'client-123',
        is_retainer: false,
        client: { retainer_hours: null },
        created_by_id: 'pm-123',
      });
      mockProjectTeamAssignment.mockResolvedValue({
        project_id: projectId,
        user_id: 'tech-user-123',
      });

      const request = createPostRequest({
        title: 'Tech Task',
        project_id: projectId,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('rejects tech user creating task on unassigned project', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockProjectFindUnique.mockResolvedValue({
        id: projectId,
        client_id: 'client-123',
        is_retainer: false,
        client: { retainer_hours: null },
        created_by_id: 'pm-123',
      });
      mockProjectTeamAssignment.mockResolvedValue(null);

      const request = createPostRequest({
        title: 'Tech Task',
        project_id: projectId,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('You are not assigned to this project');
    });
  });
});

describe('GET /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockTaskFindMany.mockResolvedValue([mockCreatedTask]);
    mockTaskCount.mockResolvedValue(1);
  });

  it('returns paginated task list', async () => {
    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('tasks');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('totalPages');
  });

  it('supports status filter', async () => {
    const request = createGetRequest({ status: 'in_progress' });
    await GET(request);

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: 'in_progress' }),
          ]),
        }),
      })
    );
  });

  it('supports multiple statuses filter', async () => {
    const request = createGetRequest({ statuses: 'in_progress,review' });
    await GET(request);

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: { in: ['in_progress', 'review'] } }),
          ]),
        }),
      })
    );
  });

  it('supports project_id filter', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const request = createGetRequest({ project_id: projectId });
    await GET(request);

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ project_id: projectId }),
          ]),
        }),
      })
    );
  });

  it('supports search filter', async () => {
    const request = createGetRequest({ search: 'test' });
    await GET(request);

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ title: { contains: 'test', mode: 'insensitive' } }),
              ]),
            }),
          ]),
        }),
      })
    );
  });

  describe('Tech user access control', () => {
    beforeEach(() => {
      mockRequireAuth.mockResolvedValue({
        userId: 'tech-user-123',
        role: 'tech',
        email: 'tech@example.com',
      });
    });

    it('only shows tasks assigned to tech user', async () => {
      const request = createGetRequest();
      await GET(request);

      expect(mockTaskFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ assignee_id: 'tech-user-123' }),
            ]),
          }),
        })
      );
    });
  });
});
