import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    salesAutomationRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    salesAutomationLog: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatAutomationRuleResponse: vi.fn((rule) => rule),
}));

import { GET, POST } from '../route';
import { GET as GET_BY_ID, PATCH, DELETE } from '../[id]/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

const mockRuleFindMany = prisma.salesAutomationRule.findMany as Mock;
const mockRuleFindUnique = prisma.salesAutomationRule.findUnique as Mock;
const mockRuleCreate = prisma.salesAutomationRule.create as Mock;
const mockRuleUpdate = prisma.salesAutomationRule.update as Mock;
const mockTransaction = prisma.$transaction as Mock;

function createGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/sales-automation-rules', {
    method: 'GET',
  });
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/sales-automation-rules', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/sales-automation-rules/rule-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/sales-automation-rules/rule-123', {
    method: 'DELETE',
  });
}

const mockRule = {
  id: 'rule-123',
  name: 'Follow up on meeting',
  trigger_type: 'status_change',
  trigger_status: 'meeting',
  trigger_from_status: null,
  time_threshold_hours: null,
  action_type: 'create_task',
  task_template: { title: 'Follow up with {accord_name}', description: 'Send recap' },
  assignee_rule: 'accord_owner',
  assignee_user_id: null,
  is_active: true,
  sort_order: 0,
  assignee_user: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const validCreateBody = {
  name: 'Follow up on meeting',
  trigger_type: 'status_change' as const,
  trigger_status: 'meeting' as const,
  task_template: { title: 'Follow up with {accord_name}' },
  assignee_rule: 'accord_owner' as const,
};

describe('GET /api/sales-automation-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('lists rules ordered by sort_order', async () => {
    const rules = [
      { ...mockRule, sort_order: 0 },
      { ...mockRule, id: 'rule-456', sort_order: 1 },
    ];
    mockRuleFindMany.mockResolvedValue(rules);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rules).toHaveLength(2);
    expect(mockRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { sort_order: 'asc' },
        include: expect.objectContaining({
          assignee_user: expect.any(Object),
        }),
      })
    );
  });

  it('returns formatted response', async () => {
    mockRuleFindMany.mockResolvedValue([mockRule]);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rules).toHaveLength(1);
  });
});

describe('POST /api/sales-automation-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockRuleCreate.mockResolvedValue(mockRule);
  });

  it('creates rule with valid data', async () => {
    const request = createPostRequest(validCreateBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Follow up on meeting',
          trigger_type: 'status_change',
          trigger_status: 'meeting',
          action_type: 'create_task',
          assignee_rule: 'accord_owner',
          is_active: true,
          sort_order: 0,
        }),
      })
    );
  });

  it('validates required fields — rejects missing name', async () => {
    const request = createPostRequest({
      trigger_type: 'status_change',
      trigger_status: 'meeting',
      task_template: { title: 'Test' },
      assignee_rule: 'accord_owner',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('validates required fields — rejects missing task_template', async () => {
    const request = createPostRequest({
      name: 'Test rule',
      trigger_type: 'status_change',
      trigger_status: 'meeting',
      assignee_rule: 'accord_owner',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('requires time_threshold_hours for time_based triggers', async () => {
    const request = createPostRequest({
      ...validCreateBody,
      trigger_type: 'time_based',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('requires assignee_user_id for specific_user assignee_rule', async () => {
    const request = createPostRequest({
      ...validCreateBody,
      assignee_rule: 'specific_user',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });

  it('requires pm or admin role', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'member',
      email: 'member@example.com',
    });
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const request = createPostRequest(validCreateBody);
    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'member' }),
      ['pm', 'admin']
    );
  });
});

describe('GET /api/sales-automation-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('returns single rule', async () => {
    mockRuleFindUnique.mockResolvedValue(mockRule);

    const request = new NextRequest('http://localhost:3000/api/sales-automation-rules/rule-123', {
      method: 'GET',
    });
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'rule-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('rule-123');
    expect(mockRuleFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rule-123' },
      })
    );
  });

  it('returns 404 for non-existent rule', async () => {
    mockRuleFindUnique.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/sales-automation-rules/rule-999', {
      method: 'GET',
    });
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'rule-999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Automation rule not found');
  });
});

describe('PATCH /api/sales-automation-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockRuleUpdate.mockResolvedValue({ ...mockRule, name: 'Updated name' });
  });

  it('updates rule with valid data', async () => {
    const request = createPatchRequest({ name: 'Updated name' });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'rule-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rule-123' },
        data: expect.objectContaining({ name: 'Updated name' }),
      })
    );
  });

  it('only allows pm or admin role', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'member',
      email: 'member@example.com',
    });
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const request = createPatchRequest({ name: 'Updated' });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'rule-123' }),
    });

    expect(response.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'member' }),
      ['pm', 'admin']
    );
  });
});

describe('DELETE /api/sales-automation-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockReset();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'admin',
      email: 'admin@example.com',
    });
    mockTransaction.mockResolvedValue([]);
  });

  it('hard deletes rule and its automation logs', async () => {
    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'rule-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('requires admin role', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'rule-123' }),
    });

    expect(response.status).toBe(403);
    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'pm' }),
      ['admin']
    );
  });
});
