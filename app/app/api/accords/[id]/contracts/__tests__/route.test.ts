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
    contract: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    accord: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatContractResponse: vi.fn((c) => c),
}));

// Mock contract generator
vi.mock('@/lib/services/contract-generator', () => ({
  generateContractContent: vi.fn(),
}));

// Mock portal services
vi.mock('@/lib/services/portal', () => ({
  generatePortalToken: vi.fn(() => 'portal-token-contract-123'),
  getTokenExpiry: vi.fn(() => new Date('2026-05-18T00:00:00.000Z')),
}));

// Mock email service
vi.mock('@/lib/services/email', () => ({
  sendEmail: vi.fn(),
}));

import { GET, POST } from '../route';
import { GET as GET_DETAIL, PATCH, DELETE } from '../[contractId]/route';
import { POST as POST_SEND } from '../[contractId]/send/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { generateContractContent } from '@/lib/services/contract-generator';
import { sendEmail } from '@/lib/services/email';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockContractCreate = prisma.contract.create as Mock;
const mockContractFindMany = prisma.contract.findMany as Mock;
const mockContractFindFirst = prisma.contract.findFirst as Mock;
const mockContractUpdate = prisma.contract.update as Mock;
const mockAccordFindFirst = prisma.accord.findFirst as Mock;
const mockGenerateContent = vi.mocked(generateContractContent);
const mockSendEmail = vi.mocked(sendEmail);

// -- Helpers --

function createGetRequest(url = 'http://localhost:3000/api/accords/accord-123/contracts'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function createPostRequest(body: object, url = 'http://localhost:3000/api/accords/accord-123/contracts'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/contracts/contract-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/contracts/contract-123', {
    method: 'DELETE',
  });
}

function createSendRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/contracts/contract-123/send', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });
}

// -- Mock Data --

const mockContract = {
  id: 'contract-123',
  accord_id: 'accord-123',
  version: 1,
  content: '<div>Contract content</div>',
  msa_version_id: 'msa-v1',
  status: 'draft',
  pricing_snapshot: [{ ware_name: 'Website', price: 5000, quantity: 1, total: 5000 }],
  sent_at: null,
  signed_at: null,
  signer_name: null,
  signer_email: null,
  signer_ip: null,
  signer_user_agent: null,
  content_snapshot: null,
  portal_token: null,
  portal_token_expires_at: null,
  created_by_id: 'user-123',
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
  accord: { id: 'accord-123', name: 'Test Accord', status: 'contract' },
  msa_version: { id: 'msa-v1', version: '1.0' },
  created_by: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
};

const mockAccord = {
  id: 'accord-123',
  name: 'Test Accord',
  status: 'contract',
  is_deleted: false,
  lead_email: 'client@example.com',
  lead_name: 'Client Name',
  client: null,
  owner: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
};

const listParams = Promise.resolve({ id: 'accord-123' });
const detailParams = Promise.resolve({ id: 'accord-123', contractId: 'contract-123' });
const missingAccordParams = Promise.resolve({ id: 'nonexistent' });
const missingContractParams = Promise.resolve({ id: 'accord-123', contractId: 'nonexistent' });

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    userId: 'user-123',
    role: 'admin',
    email: 'admin@example.com',
  });
});

describe('GET /api/accords/:id/contracts', () => {
  it('returns contracts list', async () => {
    const contracts = [mockContract, { ...mockContract, id: 'contract-456', version: 2 }];
    mockContractFindMany.mockResolvedValue(contracts);

    const response = await GET(createGetRequest(), { params: listParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.contracts).toHaveLength(2);
    expect(data.total).toBe(2);
  });

  it('returns empty list', async () => {
    mockContractFindMany.mockResolvedValue([]);

    const response = await GET(createGetRequest(), { params: listParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.contracts).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});

describe('POST /api/accords/:id/contracts', () => {
  it('generates contract with auto version increment', async () => {
    mockAccordFindFirst.mockResolvedValue(mockAccord);
    mockGenerateContent.mockResolvedValue({
      content: '<div>Generated content</div>',
      pricingSnapshot: [{ ware_name: 'Website', price: 5000, quantity: 1, total: 5000 }],
      msaVersionId: 'msa-v1',
    });
    mockContractFindFirst.mockResolvedValue({ version: 2 });
    mockContractCreate.mockResolvedValue({ ...mockContract, version: 3 });

    const response = await POST(
      createPostRequest({}),
      { params: listParams }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(mockGenerateContent).toHaveBeenCalledWith('accord-123');
    expect(mockContractCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accord_id: 'accord-123',
          version: 3,
          msa_version_id: 'msa-v1',
        }),
      })
    );
  });

  it('returns 404 for missing accord', async () => {
    mockAccordFindFirst.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({}),
      { params: missingAccordParams }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Accord not found');
  });
});

describe('GET /api/accords/:id/contracts/:contractId', () => {
  it('returns contract detail', async () => {
    mockContractFindFirst.mockResolvedValue(mockContract);

    const response = await GET_DETAIL(
      createGetRequest('http://localhost:3000/api/accords/accord-123/contracts/contract-123'),
      { params: detailParams }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('contract-123');
  });

  it('returns 404 when not found', async () => {
    mockContractFindFirst.mockResolvedValue(null);

    const response = await GET_DETAIL(
      createGetRequest('http://localhost:3000/api/accords/accord-123/contracts/nonexistent'),
      { params: missingContractParams }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Contract not found');
  });
});

describe('PATCH /api/accords/:id/contracts/:contractId', () => {
  it('updates draft contract', async () => {
    mockContractFindFirst.mockResolvedValue(mockContract);
    const updated = { ...mockContract, content: '<div>Updated</div>' };
    mockContractUpdate.mockResolvedValue(updated);

    const response = await PATCH(
      createPatchRequest({ content: '<div>Updated</div>' }),
      { params: detailParams }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.content).toBe('<div>Updated</div>');
  });

  it('rejects non-draft editing', async () => {
    mockContractFindFirst.mockResolvedValue({ ...mockContract, status: 'sent' });

    const response = await PATCH(
      createPatchRequest({ content: '<div>Nope</div>' }),
      { params: detailParams }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Only draft contracts can be edited');
    expect(mockContractUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when not found', async () => {
    mockContractFindFirst.mockResolvedValue(null);

    const response = await PATCH(
      createPatchRequest({ content: '<div>Missing</div>' }),
      { params: missingContractParams }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Contract not found');
  });
});

describe('DELETE /api/accords/:id/contracts/:contractId', () => {
  it('soft deletes contract', async () => {
    mockContractFindFirst.mockResolvedValue(mockContract);
    mockContractUpdate.mockResolvedValue({ ...mockContract, is_deleted: true });

    const response = await DELETE(createDeleteRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Contract deleted');
  });

  it('returns 404 when not found', async () => {
    mockContractFindFirst.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), { params: missingContractParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Contract not found');
  });
});

describe('POST /api/accords/:id/contracts/:contractId/send', () => {
  it('sends draft contract with portal token and email', async () => {
    const contractWithAccord = {
      ...mockContract,
      accord: {
        ...mockAccord,
        client: null,
      },
    };
    mockContractFindFirst.mockResolvedValue(contractWithAccord);
    const sentContract = {
      ...mockContract,
      status: 'sent',
      sent_at: new Date(),
      portal_token: 'portal-token-contract-123',
      portal_token_expires_at: new Date('2026-05-18T00:00:00.000Z'),
      content_snapshot: mockContract.content,
    };
    mockContractUpdate.mockResolvedValue(sentContract);

    const response = await POST_SEND(createSendRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('sent');
    expect(mockContractUpdate).toHaveBeenCalledWith({
      where: { id: 'contract-123' },
      data: {
        status: 'sent',
        sent_at: expect.any(Date),
        portal_token: 'portal-token-contract-123',
        portal_token_expires_at: new Date('2026-05-18T00:00:00.000Z'),
        content_snapshot: '<div>Contract content</div>',
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        msa_version: { select: { id: true, version: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@example.com',
        subject: 'Contract: Test Accord',
      })
    );
  });

  it('rejects non-draft contract', async () => {
    const sentContract = {
      ...mockContract,
      status: 'sent',
      accord: { ...mockAccord },
    };
    mockContractFindFirst.mockResolvedValue(sentContract);

    const response = await POST_SEND(createSendRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Only draft contracts can be sent');
    expect(mockContractUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects when no email available', async () => {
    const noEmailAccord = {
      ...mockContract,
      accord: {
        ...mockAccord,
        lead_email: null,
        client: null,
      },
    };
    mockContractFindFirst.mockResolvedValue(noEmailAccord);

    const response = await POST_SEND(createSendRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('No email address available for this lead/client');
    expect(mockContractUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 404 when not found', async () => {
    mockContractFindFirst.mockResolvedValue(null);

    const response = await POST_SEND(createSendRequest(), { params: missingContractParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Contract not found');
  });
});
