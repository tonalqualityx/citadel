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
    sop: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    function: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockSopCreate = prisma.sop.create as Mock;
const mockSopFindMany = prisma.sop.findMany as Mock;
const mockSopCount = prisma.sop.count as Mock;
const mockFunctionFindUnique = prisma.function.findUnique as Mock;

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/sops', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/sops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'admin',
      email: 'admin@example.com',
    });
  });

  it('successfully creates a basic SOP with title only (no tags)', async () => {
    const requestBody = {
      title: 'Test SOP',
    };

    mockSopCreate.mockResolvedValue({
      id: 'sop-123',
      title: 'Test SOP',
      content: null,
      function_id: null,
      tags: [],
      default_priority: 3,
      energy_estimate: null,
      mystery_factor: 'none',
      battery_impact: 'average_drain',
      template_requirements: null,
      review_requirements: null,
      next_review_at: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      function: null,
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Test SOP',
          tags: undefined,
          default_priority: 3,
          mystery_factor: 'none',
          battery_impact: 'average_drain',
        }),
      })
    );
  });

  it('successfully creates a SOP with tags provided', async () => {
    const requestBody = {
      title: 'Test SOP With Tags',
      tags: ['onboarding', 'documentation'],
    };

    mockSopCreate.mockResolvedValue({
      id: 'sop-124',
      title: 'Test SOP With Tags',
      content: null,
      function_id: null,
      tags: ['onboarding', 'documentation'],
      default_priority: 3,
      energy_estimate: null,
      mystery_factor: 'none',
      battery_impact: 'average_drain',
      template_requirements: null,
      review_requirements: null,
      next_review_at: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      function: null,
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Test SOP With Tags',
          tags: ['onboarding', 'documentation'],
          default_priority: 3,
          mystery_factor: 'none',
          battery_impact: 'average_drain',
        }),
      })
    );
  });

  it('converts empty tags array to undefined (avoids Prisma 500 error)', async () => {
    const requestBody = {
      title: 'Test SOP With Empty Tags',
      tags: [],
    };

    mockSopCreate.mockResolvedValue({
      id: 'sop-125',
      title: 'Test SOP With Empty Tags',
      content: null,
      function_id: null,
      tags: [],
      default_priority: 3,
      energy_estimate: null,
      mystery_factor: 'none',
      battery_impact: 'average_drain',
      template_requirements: null,
      review_requirements: null,
      next_review_at: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      function: null,
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
    // Empty array should be converted to undefined to avoid Prisma SQLite error
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Test SOP With Empty Tags',
          tags: undefined,
        }),
      })
    );
  });

  it('successfully creates a SOP with all fields', async () => {
    const requestBody = {
      title: 'Complete SOP',
      content: { type: 'doc', content: [] },
      function_id: '550e8400-e29b-41d4-a716-446655440000',
      tags: ['test', 'documentation'],
      template_requirements: [{ id: '1', text: 'Step 1' }],
      review_requirements: [{ id: '2', text: 'Check 1' }],
      next_review_at: '2026-06-01T00:00:00Z',
      default_priority: 2,
      energy_estimate: 5,
      mystery_factor: 'average',
      battery_impact: 'high_drain',
    };

    mockSopCreate.mockResolvedValue({
      id: 'sop-456',
      title: 'Complete SOP',
      content: { type: 'doc', content: [] },
      function_id: '550e8400-e29b-41d4-a716-446655440000',
      tags: ['test', 'documentation'],
      default_priority: 2,
      energy_estimate: 5,
      mystery_factor: 'average',
      battery_impact: 'high_drain',
      template_requirements: [{ id: '1', text: 'Step 1' }],
      review_requirements: [{ id: '2', text: 'Check 1' }],
      next_review_at: new Date('2026-06-01T00:00:00Z'),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      function: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Developer' },
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('returns 400 when title is missing', async () => {
    const requestBody = {};

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Validation failed');
  });

  it('returns 400 when title is empty', async () => {
    const requestBody = { title: '' };

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when title exceeds 255 characters', async () => {
    const requestBody = { title: 'a'.repeat(256) };

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('requires admin or pm role', async () => {
    const request = createPostRequest({ title: 'Test' });
    await POST(request);

    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
      ['pm', 'admin']
    );
  });

  it('successfully creates SOP with valid enum values for mystery_factor', async () => {
    const mysteryFactors = ['none', 'average', 'significant', 'no_idea'];
    
    for (const factor of mysteryFactors) {
      vi.clearAllMocks();
      mockRequireAuth.mockResolvedValue({
        userId: 'user-123',
        role: 'admin',
        email: 'admin@example.com',
      });

      mockSopCreate.mockResolvedValue({
        id: 'sop-123',
        title: 'Test SOP',
        mystery_factor: factor,
        battery_impact: 'average_drain',
        tags: [],
        default_priority: 3,
        content: null,
        function_id: null,
        template_requirements: null,
        review_requirements: null,
        next_review_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        function: null,
      });

      const request = createPostRequest({ title: 'Test SOP', mystery_factor: factor });
      const response = await POST(request);

      expect(response.status).toBe(201);
    }
  });

  it('successfully creates SOP with valid enum values for battery_impact', async () => {
    const batteryImpacts = ['average_drain', 'high_drain', 'energizing'];
    
    for (const impact of batteryImpacts) {
      vi.clearAllMocks();
      mockRequireAuth.mockResolvedValue({
        userId: 'user-123',
        role: 'admin',
        email: 'admin@example.com',
      });

      mockSopCreate.mockResolvedValue({
        id: 'sop-123',
        title: 'Test SOP',
        mystery_factor: 'none',
        battery_impact: impact,
        tags: [],
        default_priority: 3,
        content: null,
        function_id: null,
        template_requirements: null,
        review_requirements: null,
        next_review_at: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        function: null,
      });

      const request = createPostRequest({ title: 'Test SOP', battery_impact: impact });
      const response = await POST(request);

      expect(response.status).toBe(201);
    }
  });

  it('returns 400 for invalid mystery_factor enum value', async () => {
    const requestBody = { title: 'Test', mystery_factor: 'invalid_value' };

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid battery_impact enum value', async () => {
    const requestBody = { title: 'Test', battery_impact: 'invalid_value' };

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('handles null values for optional nullable fields', async () => {
    const requestBody = {
      title: 'Test SOP',
      content: null,
      function_id: null,
      template_requirements: null,
      review_requirements: null,
      next_review_at: null,
      energy_estimate: null,
    };

    mockSopCreate.mockResolvedValue({
      id: 'sop-123',
      title: 'Test SOP',
      content: null,
      function_id: null,
      tags: [],
      default_priority: 3,
      energy_estimate: null,
      mystery_factor: 'none',
      battery_impact: 'average_drain',
      template_requirements: null,
      review_requirements: null,
      next_review_at: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      function: null,
    });

    const request = createPostRequest(requestBody);
    const response = await POST(request);

    expect(response.status).toBe(201);
  });
});

describe('GET /api/sops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'tech',
      email: 'tech@example.com',
    });
  });

  it('returns list of SOPs with pagination', async () => {
    const mockSops = [
      {
        id: 'sop-1',
        title: 'SOP One',
        function: { id: 'func-1', name: 'Developer' },
        tags: ['test'],
        is_active: true,
        default_priority: 3,
        energy_estimate: 4,
        mystery_factor: 'average',
        battery_impact: 'average_drain',
        estimated_minutes: 120,
        _count: { tasks: 2, recipe_tasks: 1 },
        last_reviewed_at: null,
        next_review_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    mockSopFindMany.mockResolvedValue(mockSops);
    mockSopCount.mockResolvedValue(1);

    const request = new NextRequest('http://localhost:3000/api/sops');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sops).toHaveLength(1);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      total_pages: 1,
    });
  });

  it('filters by function_id when provided', async () => {
    mockSopFindMany.mockResolvedValue([]);
    mockSopCount.mockResolvedValue(0);

    const request = new NextRequest('http://localhost:3000/api/sops?function_id=func-123');
    await GET(request);

    expect(mockSopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          function_id: 'func-123',
          is_active: true,
        }),
      })
    );
  });

  it('filters by tag when provided', async () => {
    mockSopFindMany.mockResolvedValue([]);
    mockSopCount.mockResolvedValue(0);

    const request = new NextRequest('http://localhost:3000/api/sops?tag=documentation');
    await GET(request);

    expect(mockSopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tags: { has: 'documentation' },
          is_active: true,
        }),
      })
    );
  });

  it('includes inactive SOPs when include_inactive=true', async () => {
    mockSopFindMany.mockResolvedValue([]);
    mockSopCount.mockResolvedValue(0);

    const request = new NextRequest('http://localhost:3000/api/sops?include_inactive=true');
    await GET(request);

    expect(mockSopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });
});
