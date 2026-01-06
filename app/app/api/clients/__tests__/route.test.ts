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
    client: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatClientResponse: vi.fn((client) => client),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockPrisma = vi.mocked(prisma);

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/clients', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockCreatedClient = {
  id: 'client-123',
  name: 'Test Client',
  type: 'direct',
  status: 'active',
  primary_contact: null,
  email: null,
  phone: null,
  retainer_hours: null,
  hourly_rate: null,
  parent_agency_id: null,
  notes: null,
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
  _count: { sites: 0, sub_clients: 0 },
};

describe('POST /api/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockPrisma.client.create.mockResolvedValue(mockCreatedClient);
  });

  describe('Minimal data - required fields only', () => {
    it('creates a client with only name provided', async () => {
      const request = createPostRequest({ name: 'New Client' });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Client',
            type: 'direct', // Default value
          }),
        })
      );
    });
  });

  describe('Null value handling - optional fields', () => {
    it('rejects null for parent_agency_id (use undefined instead)', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        parent_agency_id: null,
      });
      const response = await POST(request);
      const body = await response.json();

      // API schema uses .optional() not .nullable(), so null should fail validation
      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('accepts undefined (omitted) parent_agency_id', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        // parent_agency_id is not included
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalled();
    });

    it('rejects null for retainer_hours', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        retainer_hours: null,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects null for hourly_rate', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        hourly_rate: null,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Zero value handling - number fields', () => {
    it('accepts zero for retainer_hours', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        retainer_hours: 0,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Client',
            retainer_hours: 0,
          }),
        })
      );
    });

    it('accepts zero for hourly_rate', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        hourly_rate: 0,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Client',
            hourly_rate: 0,
          }),
        })
      );
    });

    it('accepts positive values for retainer_hours', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        retainer_hours: 20.5,
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            retainer_hours: 20.5,
          }),
        })
      );
    });

    it('rejects negative values for retainer_hours', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        retainer_hours: -5,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects negative values for hourly_rate', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        hourly_rate: -100,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Empty string handling', () => {
    it('accepts empty string for email', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        email: '',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      // Empty email should be converted to null
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
          }),
        })
      );
    });

    it('accepts valid email', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        email: 'client@example.com',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'client@example.com',
          }),
        })
      );
    });

    it('rejects invalid email format', async () => {
      const request = createPostRequest({
        name: 'Test Client',
        email: 'not-an-email',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Full client creation with all fields', () => {
    it('creates client with all optional fields populated', async () => {
      const agencyId = '550e8400-e29b-41d4-a716-446655440000';
      mockPrisma.client.findUnique.mockResolvedValue({
        id: agencyId,
        type: 'agency_partner',
      } as any);

      const request = createPostRequest({
        name: 'Full Client',
        type: 'sub_client',
        status: 'active',
        primary_contact: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        retainer_hours: 40,
        hourly_rate: 150.50,
        parent_agency_id: agencyId,
        notes: 'Important client notes',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPrisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Full Client',
            type: 'sub_client',
            status: 'active',
            primary_contact: 'John Doe',
            email: 'john@example.com',
            phone: '555-1234',
            retainer_hours: 40,
            hourly_rate: 150.50,
            parent_agency_id: agencyId,
            notes: 'Important client notes',
          }),
        })
      );
    });
  });

  describe('Client type validation', () => {
    it('accepts valid type: direct', async () => {
      const request = createPostRequest({
        name: 'Direct Client',
        type: 'direct',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('accepts valid type: agency_partner', async () => {
      const request = createPostRequest({
        name: 'Agency Partner',
        type: 'agency_partner',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('accepts valid type: sub_client', async () => {
      const request = createPostRequest({
        name: 'Sub Client',
        type: 'sub_client',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('rejects invalid type', async () => {
      const request = createPostRequest({
        name: 'Invalid Type Client',
        type: 'invalid_type',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Status validation', () => {
    it('accepts valid status: active', async () => {
      const request = createPostRequest({
        name: 'Active Client',
        status: 'active',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('accepts valid status: inactive', async () => {
      const request = createPostRequest({
        name: 'Inactive Client',
        status: 'inactive',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('accepts valid status: delinquent', async () => {
      const request = createPostRequest({
        name: 'Delinquent Client',
        status: 'delinquent',
      });
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it('rejects invalid status', async () => {
      const request = createPostRequest({
        name: 'Invalid Status Client',
        status: 'invalid_status',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Parent agency validation', () => {
    it('validates parent agency exists', async () => {
      const nonExistentAgencyId = '550e8400-e29b-41d4-a716-446655440001';
      mockPrisma.client.findUnique.mockResolvedValue(null);

      const request = createPostRequest({
        name: 'Sub Client',
        parent_agency_id: nonExistentAgencyId,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid parent agency');
    });

    it('validates parent is agency_partner type', async () => {
      const directClientId = '550e8400-e29b-41d4-a716-446655440002';
      mockPrisma.client.findUnique.mockResolvedValue({
        id: directClientId,
        type: 'direct', // Not agency_partner
      } as any);

      const request = createPostRequest({
        name: 'Sub Client',
        parent_agency_id: directClientId,
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid parent agency');
    });
  });

  describe('Name validation', () => {
    it('rejects empty name', async () => {
      const request = createPostRequest({
        name: '',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects missing name', async () => {
      const request = createPostRequest({});
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects name exceeding 255 characters', async () => {
      const request = createPostRequest({
        name: 'A'.repeat(256),
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });
});
