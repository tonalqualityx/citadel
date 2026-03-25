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
    proposal: {
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
  formatProposalResponse: vi.fn((p) => p),
}));

// Mock portal services
vi.mock('@/lib/services/portal', () => ({
  generatePortalToken: vi.fn(() => 'portal-token-abc123'),
  getTokenExpiry: vi.fn(() => new Date('2026-05-18T00:00:00.000Z')),
}));

// Mock email service
vi.mock('@/lib/services/email', () => ({
  sendEmail: vi.fn(),
}));

import { GET, POST } from '../route';
import { GET as GET_DETAIL, PATCH, DELETE } from '../[proposalId]/route';
import { POST as POST_SEND } from '../[proposalId]/send/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProposalCreate = prisma.proposal.create as Mock;
const mockProposalFindMany = prisma.proposal.findMany as Mock;
const mockProposalFindFirst = prisma.proposal.findFirst as Mock;
const mockProposalUpdate = prisma.proposal.update as Mock;
const mockAccordFindFirst = prisma.accord.findFirst as Mock;
const mockSendEmail = vi.mocked(sendEmail);

// -- Helpers --

function createGetRequest(url = 'http://localhost:3000/api/accords/accord-123/proposals'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function createPostRequest(body: object, url = 'http://localhost:3000/api/accords/accord-123/proposals'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/proposals/proposal-123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/proposals/proposal-123', {
    method: 'DELETE',
  });
}

function createSendRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/accords/accord-123/proposals/proposal-123/send', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });
}

// -- Mock Data --

const mockProposal = {
  id: 'proposal-123',
  accord_id: 'accord-123',
  version: 1,
  content: '<p>Proposal content</p>',
  status: 'draft',
  pricing_snapshot: [{ ware_name: 'Website', price: 5000, quantity: 1, total: 5000 }],
  sent_at: null,
  client_responded_at: null,
  client_note: null,
  portal_token: null,
  portal_token_expires_at: null,
  created_by_id: 'user-123',
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
  accord: { id: 'accord-123', name: 'Test Accord', status: 'proposal' },
  created_by: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
};

const mockAccord = {
  id: 'accord-123',
  name: 'Test Accord',
  status: 'proposal',
  is_deleted: false,
  lead_email: 'client@example.com',
  lead_name: 'Client Name',
  client: null,
  owner: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
  charter_items: [],
  commission_items: [
    {
      id: 'item-1',
      ware_id: 'ware-1',
      ware: { id: 'ware-1', name: 'Website', type: 'commission' },
      name_override: null,
      estimated_price: 5000,
      final_price: 5000,
      sort_order: 1,
      is_deleted: false,
    },
  ],
  keep_items: [],
};

const listParams = Promise.resolve({ id: 'accord-123' });
const detailParams = Promise.resolve({ id: 'accord-123', proposalId: 'proposal-123' });
const missingAccordParams = Promise.resolve({ id: 'nonexistent' });
const missingProposalParams = Promise.resolve({ id: 'accord-123', proposalId: 'nonexistent' });

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    userId: 'user-123',
    role: 'admin',
    email: 'admin@example.com',
  });
});

describe('GET /api/accords/:id/proposals', () => {
  it('returns proposals list', async () => {
    const proposals = [mockProposal, { ...mockProposal, id: 'proposal-456', version: 2 }];
    mockProposalFindMany.mockResolvedValue(proposals);

    const response = await GET(createGetRequest(), { params: listParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.proposals).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(mockProposalFindMany).toHaveBeenCalledWith({
      where: {
        accord_id: 'accord-123',
        is_deleted: false,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
      orderBy: { version: 'desc' },
    });
  });

  it('returns empty list', async () => {
    mockProposalFindMany.mockResolvedValue([]);

    const response = await GET(createGetRequest(), { params: listParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.proposals).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});

describe('POST /api/accords/:id/proposals', () => {
  it('creates with auto version increment', async () => {
    mockAccordFindFirst.mockResolvedValue(mockAccord);
    mockProposalFindFirst.mockResolvedValue({ version: 2 });
    mockProposalCreate.mockResolvedValue({ ...mockProposal, version: 3 });

    const response = await POST(
      createPostRequest({ content: '<p>Proposal content</p>' }),
      { params: listParams }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe('proposal-123');
    expect(mockProposalFindFirst).toHaveBeenCalledWith({
      where: { accord_id: 'accord-123' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    expect(mockProposalCreate).toHaveBeenCalledWith({
      data: {
        accord_id: 'accord-123',
        version: 3,
        content: '<p>Proposal content</p>',
        pricing_snapshot: [
          {
            id: 'item-1',
            type: 'commission',
            ware_name: 'Website',
            name_override: null,
            estimated_price: 5000,
            final_price: 5000,
          },
        ],
        created_by_id: 'user-123',
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
  });

  it('snapshots pricing from accord line items', async () => {
    mockAccordFindFirst.mockResolvedValue(mockAccord);
    mockProposalFindFirst.mockResolvedValue(null);
    mockProposalCreate.mockResolvedValue(mockProposal);

    const response = await POST(
      createPostRequest({ content: '<p>New proposal</p>' }),
      { params: listParams }
    );

    expect(response.status).toBe(201);
    expect(mockProposalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          pricing_snapshot: [
            expect.objectContaining({
              type: 'commission',
              ware_name: 'Website',
              final_price: 5000,
            }),
          ],
        }),
      })
    );
  });

  it('returns 404 for missing accord', async () => {
    mockAccordFindFirst.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({ content: '<p>Proposal</p>' }),
      { params: missingAccordParams }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Accord not found');
    expect(mockProposalCreate).not.toHaveBeenCalled();
  });
});

describe('GET /api/accords/:id/proposals/:proposalId', () => {
  it('returns proposal detail', async () => {
    mockProposalFindFirst.mockResolvedValue(mockProposal);

    const response = await GET_DETAIL(
      createGetRequest('http://localhost:3000/api/accords/accord-123/proposals/proposal-123'),
      { params: detailParams }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe('proposal-123');
    expect(data.version).toBe(1);
    expect(mockProposalFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'proposal-123',
        accord_id: 'accord-123',
        is_deleted: false,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
  });

  it('returns 404 when not found', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    const response = await GET_DETAIL(
      createGetRequest('http://localhost:3000/api/accords/accord-123/proposals/nonexistent'),
      { params: missingProposalParams }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Proposal not found');
  });
});

describe('PATCH /api/accords/:id/proposals/:proposalId', () => {
  it('updates draft proposal', async () => {
    mockProposalFindFirst.mockResolvedValue(mockProposal);
    const updated = { ...mockProposal, content: '<p>Updated content</p>' };
    mockProposalUpdate.mockResolvedValue(updated);

    const response = await PATCH(
      createPatchRequest({ content: '<p>Updated content</p>' }),
      { params: detailParams }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.content).toBe('<p>Updated content</p>');
    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: 'proposal-123' },
      data: { content: '<p>Updated content</p>' },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
  });

  it('rejects non-draft editing', async () => {
    mockProposalFindFirst.mockResolvedValue({ ...mockProposal, status: 'sent' });

    const response = await PATCH(
      createPatchRequest({ content: '<p>Nope</p>' }),
      { params: detailParams }
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Only draft proposals can be edited');
    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when not found', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    const response = await PATCH(
      createPatchRequest({ content: '<p>Missing</p>' }),
      { params: missingProposalParams }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Proposal not found');
    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/accords/:id/proposals/:proposalId', () => {
  it('soft deletes proposal', async () => {
    mockProposalFindFirst.mockResolvedValue(mockProposal);
    mockProposalUpdate.mockResolvedValue({ ...mockProposal, is_deleted: true });

    const response = await DELETE(createDeleteRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Proposal deleted');
    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: 'proposal-123' },
      data: { is_deleted: true },
    });
  });

  it('returns 404 when not found', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    const response = await DELETE(createDeleteRequest(), { params: missingProposalParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Proposal not found');
    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /api/accords/:id/proposals/:proposalId/send', () => {
  it('sends draft proposal with portal token and email', async () => {
    const proposalWithAccord = {
      ...mockProposal,
      accord: {
        ...mockAccord,
        client: null,
      },
    };
    mockProposalFindFirst.mockResolvedValue(proposalWithAccord);
    const sentProposal = {
      ...mockProposal,
      status: 'sent',
      sent_at: new Date(),
      portal_token: 'portal-token-abc123',
      portal_token_expires_at: new Date('2026-05-18T00:00:00.000Z'),
    };
    mockProposalUpdate.mockResolvedValue(sentProposal);

    const response = await POST_SEND(createSendRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('sent');
    expect(mockProposalUpdate).toHaveBeenCalledWith({
      where: { id: 'proposal-123' },
      data: {
        status: 'sent',
        sent_at: expect.any(Date),
        portal_token: 'portal-token-abc123',
        portal_token_expires_at: new Date('2026-05-18T00:00:00.000Z'),
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@example.com',
        subject: 'Proposal: Test Accord',
      })
    );
  });

  it('rejects non-draft proposal', async () => {
    const sentProposal = {
      ...mockProposal,
      status: 'sent',
      accord: { ...mockAccord },
    };
    mockProposalFindFirst.mockResolvedValue(sentProposal);

    const response = await POST_SEND(createSendRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Only draft proposals can be sent');
    expect(mockProposalUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects when no email available', async () => {
    const noEmailAccord = {
      ...mockProposal,
      accord: {
        ...mockAccord,
        lead_email: null,
        client: null,
      },
    };
    mockProposalFindFirst.mockResolvedValue(noEmailAccord);

    const response = await POST_SEND(createSendRequest(), { params: detailParams });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('No email address available for this lead/client');
    expect(mockProposalUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 404 when not found', async () => {
    mockProposalFindFirst.mockResolvedValue(null);

    const response = await POST_SEND(createSendRequest(), { params: missingProposalParams });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Proposal not found');
    expect(mockProposalUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
