import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock portal services
vi.mock('@/lib/services/portal', () => ({
  validateContractToken: vi.fn(),
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    contract: {
      update: vi.fn(),
    },
    accord: {
      update: vi.fn(),
    },
  },
}));

// Mock error handler
vi.mock('@/lib/api/errors', () => ({
  handleApiError: vi.fn((error: any) => {
    const status = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }),
  ApiError: class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { GET } from '../../contracts/[token]/route';
import { POST } from '../../contracts/[token]/sign/route';
import { validateContractToken, logPortalSession } from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockValidateToken = vi.mocked(validateContractToken);
const mockLogSession = vi.mocked(logPortalSession);
const mockContractUpdate = prisma.contract.update as Mock;
const mockAccordUpdate = prisma.accord.update as Mock;

// -- Mock Data --

const mockContract = {
  id: 'contract-123',
  accord_id: 'accord-123',
  version: 1,
  content: '<div>Contract content</div>',
  content_snapshot: '<div>Snapshot content</div>',
  status: 'sent',
  pricing_snapshot: [{ ware_name: 'Website', price: 5000, quantity: 1, total: 5000 }],
  sent_at: new Date(),
  signed_at: null,
  msa_version: { id: 'msa-v1', version: '1.0' },
  accord: {
    name: 'Test Accord',
    client: { name: 'Test Client' },
    owner: { name: 'Test Owner', email: 'owner@example.com' },
    charter_items: [],
    commission_items: [
      {
        name_override: null,
        ware: { name: 'Website', type: 'commission' },
        final_price: 5000,
      },
    ],
    keep_items: [],
  },
};

const viewParams = Promise.resolve({ token: 'valid-token' });
const invalidParams = Promise.resolve({ token: 'invalid-token' });

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/contracts/:token', () => {
  it('returns contract data for valid token', async () => {
    mockValidateToken.mockResolvedValue(mockContract as any);

    const request = new NextRequest('http://localhost:3000/api/portal/contracts/valid-token');
    const response = await GET(request, { params: viewParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('contract-123');
    expect(data.content).toBe('<div>Snapshot content</div>');
    expect(data.accord.name).toBe('Test Accord');
    expect(data.accord.commission_items).toHaveLength(1);
    expect(data.msa_version.version).toBe('1.0');
    expect(mockLogSession).toHaveBeenCalledWith({
      tokenType: 'contract',
      entityId: 'contract-123',
      ipAddress: '127.0.0.1',
      userAgent: null,
      action: 'view',
    });
  });

  it('returns 404 for invalid/expired token', async () => {
    mockValidateToken.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/portal/contracts/invalid-token');
    const response = await GET(request, { params: invalidParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Contract not found or link has expired');
    expect(mockLogSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/contracts/:token/sign', () => {
  it('signs contract and advances accord', async () => {
    mockValidateToken.mockResolvedValue(mockContract as any);
    mockContractUpdate.mockResolvedValue({});
    mockAccordUpdate.mockResolvedValue({});

    const request = new NextRequest('http://localhost:3000/api/portal/contracts/valid-token/sign', {
      method: 'POST',
      body: JSON.stringify({ signer_name: 'John Doe', signer_email: 'john@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(request, { params: viewParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Contract signed successfully');
    expect(mockContractUpdate).toHaveBeenCalledWith({
      where: { id: 'contract-123' },
      data: {
        status: 'signed',
        signed_at: expect.any(Date),
        signer_name: 'John Doe',
        signer_email: 'john@example.com',
        signer_ip: '127.0.0.1',
        signer_user_agent: null,
      },
    });
    expect(mockAccordUpdate).toHaveBeenCalledWith({
      where: { id: 'accord-123' },
      data: {
        status: 'signed',
        signed_at: expect.any(Date),
        entered_current_status_at: expect.any(Date),
      },
    });
    expect(mockLogSession).toHaveBeenCalledWith({
      tokenType: 'contract',
      entityId: 'contract-123',
      ipAddress: '127.0.0.1',
      userAgent: null,
      action: 'sign',
      metadata: { signer_name: 'John Doe', signer_email: 'john@example.com' },
    });
  });

  it('rejects already-signed contract', async () => {
    mockValidateToken.mockResolvedValue({ ...mockContract, status: 'signed' } as any);

    const request = new NextRequest('http://localhost:3000/api/portal/contracts/valid-token/sign', {
      method: 'POST',
      body: JSON.stringify({ signer_name: 'John Doe', signer_email: 'john@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(request, { params: viewParams });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('This contract has already been signed');
    expect(mockContractUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for invalid token', async () => {
    mockValidateToken.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/portal/contracts/invalid-token/sign', {
      method: 'POST',
      body: JSON.stringify({ signer_name: 'John Doe', signer_email: 'john@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(request, { params: invalidParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Contract not found or link has expired');
  });
});
