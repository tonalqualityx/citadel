import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/portal', () => ({
  validateProposalToken: vi.fn(),
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '192.168.1.1'),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    proposal: { update: vi.fn() },
    accord: { update: vi.fn() },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatAccordCharterItemResponse: vi.fn((item) => item),
  formatAccordCommissionItemResponse: vi.fn((item) => item),
  formatAccordKeepItemResponse: vi.fn((item) => item),
}));

import { GET } from '../[token]/route';
import { POST } from '../[token]/respond/route';
import { validateProposalToken, logPortalSession } from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockValidateProposalToken = validateProposalToken as Mock;
const mockLogPortalSession = logPortalSession as Mock;
const mockProposalUpdate = prisma.proposal.update as Mock;
const mockAccordUpdate = prisma.accord.update as Mock;

const mockPortalProposal = {
  id: 'proposal-123',
  accord_id: 'accord-123',
  version: 1,
  content: '<p>Content</p>',
  status: 'sent',
  pricing_snapshot: [{ name: 'Website', price: 5000, quantity: 1 }],
  sent_at: new Date('2026-03-18T12:00:00Z'),
  client_responded_at: null,
  client_note: null,
  portal_token: 'valid-token-123',
  portal_token_expires_at: new Date(Date.now() + 86400000),
  is_deleted: false,
  accord: {
    name: 'Test Accord',
    client: { id: 'client-1', name: 'Test Client' },
    owner: { id: 'user-1', name: 'Owner', email: 'owner@test.com' },
    charter_items: [],
    commission_items: [
      {
        name_override: null,
        estimated_price: 5000,
        final_price: 5000,
        ware: { id: 'w1', name: 'Website', type: 'commission' },
      },
    ],
    keep_items: [],
  },
};

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), options as any);
}

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe('Portal Proposal Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/portal/proposals/:token', () => {
    it('returns proposal data for valid token', async () => {
      mockValidateProposalToken.mockResolvedValue(mockPortalProposal);

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token');
      const response = await GET(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('proposal-123');
      expect(data.version).toBe(1);
      expect(data.content).toBe('<p>Content</p>');
      expect(data.status).toBe('sent');
      expect(data.pricing_snapshot).toEqual([{ name: 'Website', price: 5000, quantity: 1 }]);
      expect(data.accord.name).toBe('Test Accord');
      expect(data.accord.client.name).toBe('Test Client');
      expect(data.accord.owner.name).toBe('Owner');
      expect(data.accord.owner.email).toBe('owner@test.com');
      expect(data.accord.commission_items).toHaveLength(1);
      expect(data.accord.commission_items[0].name).toBe('Website');
      expect(data.accord.commission_items[0].final_price).toBe(5000);

      expect(mockValidateProposalToken).toHaveBeenCalledWith('valid-token');
    });

    it('returns 404 for invalid/expired token', async () => {
      mockValidateProposalToken.mockResolvedValue(null);

      const request = makeRequest('http://localhost/api/portal/proposals/bad-token');
      const response = await GET(request, makeParams('bad-token'));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Proposal not found or link has expired');
    });

    it('logs portal session on successful view', async () => {
      mockValidateProposalToken.mockResolvedValue(mockPortalProposal);

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token');
      await GET(request, makeParams('valid-token'));

      expect(mockLogPortalSession).toHaveBeenCalledWith({
        tokenType: 'proposal',
        entityId: 'proposal-123',
        ipAddress: '192.168.1.1',
        userAgent: null,
        action: 'view',
      });
    });
  });

  describe('POST /api/portal/proposals/:token/respond', () => {
    it('accepts proposal and advances accord to contract', async () => {
      mockValidateProposalToken.mockResolvedValue({ ...mockPortalProposal, status: 'sent' });
      mockProposalUpdate.mockResolvedValue({});
      mockAccordUpdate.mockResolvedValue({});

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('accepted');
      expect(data.message).toBe('Proposal accepted');

      expect(mockProposalUpdate).toHaveBeenCalledWith({
        where: { id: 'proposal-123' },
        data: expect.objectContaining({
          status: 'accepted',
          client_note: null,
        }),
      });

      expect(mockAccordUpdate).toHaveBeenCalledWith({
        where: { id: 'accord-123' },
        data: expect.objectContaining({
          status: 'contract',
        }),
      });
    });

    it('rejects proposal', async () => {
      mockValidateProposalToken.mockResolvedValue({ ...mockPortalProposal, status: 'sent' });
      mockProposalUpdate.mockResolvedValue({});

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'reject', note: 'Too expensive' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('rejected');

      expect(mockProposalUpdate).toHaveBeenCalledWith({
        where: { id: 'proposal-123' },
        data: expect.objectContaining({
          status: 'rejected',
          client_note: 'Too expensive',
        }),
      });

      // Should NOT advance accord status on rejection
      expect(mockAccordUpdate).not.toHaveBeenCalled();
    });

    it('requests changes on proposal', async () => {
      mockValidateProposalToken.mockResolvedValue({ ...mockPortalProposal, status: 'sent' });
      mockProposalUpdate.mockResolvedValue({});

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'changes_requested', note: 'Need more detail' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('changes_requested');

      expect(mockProposalUpdate).toHaveBeenCalledWith({
        where: { id: 'proposal-123' },
        data: expect.objectContaining({
          status: 'changes_requested',
          client_note: 'Need more detail',
        }),
      });

      expect(mockAccordUpdate).not.toHaveBeenCalled();
    });

    it('returns 404 for invalid token', async () => {
      mockValidateProposalToken.mockResolvedValue(null);

      const request = makeRequest('http://localhost/api/portal/proposals/bad-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('bad-token'));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Proposal not found or link has expired');
    });

    it('returns 400 for already-responded proposal', async () => {
      mockValidateProposalToken.mockResolvedValue({
        ...mockPortalProposal,
        status: 'accepted',
      });

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('This proposal has already been responded to');
    });

    it('returns 400 for invalid action enum', async () => {
      mockValidateProposalToken.mockResolvedValue({ ...mockPortalProposal, status: 'sent' });

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'invalid_action' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Validation failed');
    });

    it('logs portal session with the correct action', async () => {
      mockValidateProposalToken.mockResolvedValue({ ...mockPortalProposal, status: 'sent' });
      mockProposalUpdate.mockResolvedValue({});

      const request = makeRequest('http://localhost/api/portal/proposals/valid-token/respond', {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(request, makeParams('valid-token'));

      expect(mockLogPortalSession).toHaveBeenCalledWith({
        tokenType: 'proposal',
        entityId: 'proposal-123',
        ipAddress: '192.168.1.1',
        userAgent: null,
        action: 'accept',
        metadata: { note: undefined },
      });
    });
  });
});
