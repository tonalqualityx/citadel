import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET, DELETE } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    function: {
      findUnique: vi.fn(),
    },
    userFunction: {
      findUnique: vi.fn(),
    },
    projectTeamAssignment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatTeamAssignmentResponse: vi.fn((assignment) => ({
    ...assignment,
    user: assignment.user,
    function: assignment.function,
  })),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockFunctionFindUnique = prisma.function.findUnique as Mock;
const mockUserFunctionFindUnique = prisma.userFunction.findUnique as Mock;
const mockAssignmentFindUnique = prisma.projectTeamAssignment.findUnique as Mock;
const mockAssignmentCreate = prisma.projectTeamAssignment.create as Mock;
const mockAssignmentFindMany = prisma.projectTeamAssignment.findMany as Mock;

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/projects/proj-123/team', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockParams = Promise.resolve({ id: 'proj-123' });

describe('POST /api/projects/[id]/team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('successfully adds a team member with all validations passing', async () => {
    const requestBody = {
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    };

    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer', is_active: true });
    mockUserFunctionFindUnique.mockResolvedValue({ id: 'uf-123', user_id: '550e8400-e29b-41d4-a716-446655440000', function_id: '550e8400-e29b-41d4-a716-446655440001' });
    mockAssignmentFindUnique.mockResolvedValue(null);
    mockAssignmentCreate.mockResolvedValue({
      id: 'assign-123',
      project_id: 'proj-123',
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
      is_lead: false,
      user: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', email: 'test@example.com' },
      function: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer' },
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(201);
    expect(mockAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          project_id: 'proj-123',
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          function_id: '550e8400-e29b-41d4-a716-446655440001',
          is_lead: false,
        }),
      })
    );
  });

  it('successfully adds a team member with is_lead=true', async () => {
    const requestBody = {
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
      is_lead: true,
    };

    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer', is_active: true });
    mockUserFunctionFindUnique.mockResolvedValue({ id: 'uf-123', user_id: '550e8400-e29b-41d4-a716-446655440000', function_id: '550e8400-e29b-41d4-a716-446655440001' });
    mockAssignmentFindUnique.mockResolvedValue(null);
    mockAssignmentCreate.mockResolvedValue({
      id: 'assign-123',
      project_id: 'proj-123',
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
      is_lead: true,
      user: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', email: 'test@example.com' },
      function: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer' },
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(201);
    expect(mockAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          is_lead: true,
        }),
      })
    );
  });

  it('returns 404 when project not found', async () => {
    mockProjectFindUnique.mockResolvedValue(null);

    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(404);
  });

  it('returns 404 when user not found', async () => {
    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue(null);

    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(404);
  });

  it('returns 404 when function not found', async () => {
    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue(null);

    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(404);
  });

  it('returns 400 when user is not qualified for function', async () => {
    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer', is_active: true });
    mockUserFunctionFindUnique.mockResolvedValue(null);

    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('not qualified');
  });

  it('returns 400 when function is already assigned to project', async () => {
    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer', is_active: true });
    mockUserFunctionFindUnique.mockResolvedValue({ id: 'uf-123', user_id: '550e8400-e29b-41d4-a716-446655440000', function_id: '550e8400-e29b-41d4-a716-446655440001' });
    mockAssignmentFindUnique.mockResolvedValue({ id: 'existing-123', project_id: 'proj-123', function_id: '550e8400-e29b-41d4-a716-446655440001' });

    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('already assigned');
  });

  it('requires PM or Admin role', async () => {
    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    await POST(request, { params: mockParams });

    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      ['pm', 'admin']
    );
  });

  it('returns 400 when user exists but has no UserFunction qualification', async () => {
    // This test documents the current behavior where users MUST have
    // a UserFunction record to be assigned to a project team
    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'Unqualified User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Developer', is_active: true });
    // No UserFunction record exists - this is the key issue
    mockUserFunctionFindUnique.mockResolvedValue(null);

    const request = createPostRequest({
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      function_id: '550e8400-e29b-41d4-a716-446655440001',
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('not qualified');
  });

  it('allows assignment when user has UserFunction qualification', async () => {
    // User has the required qualification - use valid UUIDs
    const userId = '550e8400-e29b-41d4-a716-446655440010';
    const functionId = '550e8400-e29b-41d4-a716-446655440011';
    
    mockProjectFindUnique.mockResolvedValue({ id: 'proj-123', name: 'Test Project' });
    mockUserFindUnique.mockResolvedValue({ id: userId, name: 'Qualified User', is_active: true });
    mockFunctionFindUnique.mockResolvedValue({ id: functionId, name: 'Developer', is_active: true });
    // UserFunction record exists - user is qualified
    mockUserFunctionFindUnique.mockResolvedValue({ 
      id: 'uf-123', 
      user_id: userId, 
      function_id: functionId,
      is_primary: true,
    });
    mockAssignmentFindUnique.mockResolvedValue(null);
    mockAssignmentCreate.mockResolvedValue({
      id: 'assign-123',
      project_id: 'proj-123',
      user_id: userId,
      function_id: functionId,
      is_lead: false,
      user: { id: userId, name: 'Qualified User', email: 'qualified@example.com' },
      function: { id: functionId, name: 'Developer' },
    });

    const request = createPostRequest({
      user_id: userId,
      function_id: functionId,
    });
    const response = await POST(request, { params: mockParams });

    expect(response.status).toBe(201);
    expect(mockUserFunctionFindUnique).toHaveBeenCalledWith({
      where: {
        user_id_function_id: {
          user_id: userId,
          function_id: functionId,
        },
      },
    });
  });
});

describe('GET /api/projects/[id]/team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  it('returns team assignments for a project', async () => {
    const mockAssignments = [
      {
        id: 'assign-1',
        project_id: 'proj-123',
        user_id: 'user-1',
        function_id: 'func-1',
        is_lead: true,
        user: { id: 'user-1', name: 'User One', email: 'one@example.com' },
        function: { id: 'func-1', name: 'Developer' },
      },
      {
        id: 'assign-2',
        project_id: 'proj-123',
        user_id: 'user-2',
        function_id: 'func-2',
        is_lead: false,
        user: { id: 'user-2', name: 'User Two', email: 'two@example.com' },
        function: { id: 'func-2', name: 'Designer' },
      },
    ];

    mockAssignmentFindMany.mockResolvedValue(mockAssignments);

    const request = new NextRequest('http://localhost:3000/api/projects/proj-123/team');
    const response = await GET(request, { params: mockParams });

    expect(response.status).toBe(200);
    expect(mockAssignmentFindMany).toHaveBeenCalledWith({
      where: { project_id: 'proj-123' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        function: { select: { id: true, name: true } },
      },
      orderBy: [{ is_lead: 'desc' }, { created_at: 'asc' }],
    });
  });
});
