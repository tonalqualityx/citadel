import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    addendum: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock portal services
vi.mock('@/lib/services/portal', () => ({
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { GET } from '../[token]/route';
import { POST } from '../[token]/respond/route';
import { prisma } from '@/lib/db/prisma';
import { logPortalSession, getClientIp } from '@/lib/services/portal';
import type { Mock } from 'vitest';

const mockAddendumFindFirst = prisma.addendum.findFirst as Mock;
const mockAddendumUpdate = prisma.addendum.update as Mock;
const mockLogPortalSession = logPortalSession as Mock;
const mockGetClientIp = getClientIp as Mock;

const mockAddendumData = {
  id: 'addendum-123',
  version: 1,
  title: 'Scope Change v1',
  description: 'Adding new feature',
  contract_content: '<p>Updated terms</p>',
  content_snapshot: null,
  status: 'sent',
  pricing_snapshot: { total: 5000 },
  changes: { added: ['Feature X'] },
  sent_at: new Date('2026-03-15'),
  client_responded_at: null,
  portal_token: 'valid-token-abc',
  portal_token_expires_at: new Date('2027-01-01'),
  is_deleted: false,
  accord: {
    name: 'Test Accord',
    client: { id: 'client-1', name: 'Acme Corp' },
    owner: { id: 'user-1', name: 'Mike', email: 'mike@example.com' },
    charter_items: [],
    commission_items: [
      {
        name_override: 'Website Design',
        ware: null,
        final_price: 2500,
        is_deleted: false,
        sort_order: 0,
      },
    ],
    keep_items: [],
  },
  created_by: { id: 'user-1', name: 'Mike', email: 'mike@example.com' },
  charter_items: [],
  commission_items: [
    {
      name_override: 'Additional Feature',
      ware: null,
      final_price: 2000,
      is_deleted: false,
      sort_order: 0,
    },
  ],
  keep_items: [],
};

describe('GET /api/portal/addendums/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientIp.mockReturnValue('127.0.0.1');
  });

  it('validates token and returns formatted data', async () => {
    mockAddendumFindFirst.mockResolvedValue(mockAddendumData);

    const request = new NextRequest('http://localhost:3000/api/portal/addendums/valid-token-abc', {
      method: 'GET',
      headers: { 'user-agent': 'TestBrowser/1.0' },
    });
    const response = await GET(request, {
      params: Promise.resolve({ token: 'valid-token-abc' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('addendum-123');
    expect(body.title).toBe('Scope Change v1');
    expect(body.accord.name).toBe('Test Accord');
    expect(body.accord.client.name).toBe('Acme Corp');
    expect(body.accord.owner.name).toBe('Mike');
  });

  it('logs portal session on view', async () => {
    mockAddendumFindFirst.mockResolvedValue(mockAddendumData);

    const request = new NextRequest('http://localhost:3000/api/portal/addendums/valid-token-abc', {
      method: 'GET',
      headers: { 'user-agent': 'TestBrowser/1.0' },
    });
    await GET(request, {
      params: Promise.resolve({ token: 'valid-token-abc' }),
    });

    expect(mockLogPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenType: 'addendum',
        entityId: 'addendum-123',
        ipAddress: '127.0.0.1',
        action: 'view',
      })
    );
  });

  it('returns 404 for invalid token', async () => {
    mockAddendumFindFirst.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/portal/addendums/invalid-token', {
      method: 'GET',
    });
    const response = await GET(request, {
      params: Promise.resolve({ token: 'invalid-token' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Addendum not found or link has expired');
  });

  it('returns 404 for expired token', async () => {
    const expiredAddendum = {
      ...mockAddendumData,
      portal_token_expires_at: new Date('2020-01-01'),
    };
    mockAddendumFindFirst.mockResolvedValue(expiredAddendum);

    const request = new NextRequest('http://localhost:3000/api/portal/addendums/expired-token', {
      method: 'GET',
    });
    const response = await GET(request, {
      params: Promise.resolve({ token: 'expired-token' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Addendum not found or link has expired');
  });
});

describe('POST /api/portal/addendums/[token]/respond', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientIp.mockReturnValue('127.0.0.1');
    mockAddendumUpdate.mockResolvedValue({});
  });

  it('accepts addendum with signer info', async () => {
    // The respond route uses its own inline validateAddendumToken, which calls findFirst
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendumData, status: 'sent' });

    const request = new NextRequest(
      'http://localhost:3000/api/portal/addendums/valid-token-abc/respond',
      {
        method: 'POST',
        body: JSON.stringify({
          response: 'accepted',
          signer_name: 'John Client',
          signer_email: 'john@client.com',
        }),
        headers: {
          'Content-Type': 'application/json',
          'user-agent': 'TestBrowser/1.0',
        },
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({ token: 'valid-token-abc' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Addendum accepted');
    expect(body.status).toBe('accepted');
    expect(mockAddendumUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'addendum-123' },
        data: expect.objectContaining({
          status: 'accepted',
          client_responded_at: expect.any(Date),
          signed_at: expect.any(Date),
          signer_name: 'John Client',
          signer_email: 'john@client.com',
          signer_ip: '127.0.0.1',
        }),
      })
    );
  });

  it('rejects addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendumData, status: 'sent' });

    const request = new NextRequest(
      'http://localhost:3000/api/portal/addendums/valid-token-abc/respond',
      {
        method: 'POST',
        body: JSON.stringify({
          response: 'rejected',
          note: 'Price too high',
        }),
        headers: {
          'Content-Type': 'application/json',
          'user-agent': 'TestBrowser/1.0',
        },
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({ token: 'valid-token-abc' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Addendum rejected');
    expect(body.status).toBe('rejected');
    expect(mockAddendumUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          client_note: 'Price too high',
        }),
      })
    );
  });

  it('handles changes_requested response', async () => {
    mockAddendumFindFirst.mockResolvedValue({ ...mockAddendumData, status: 'sent' });

    const request = new NextRequest(
      'http://localhost:3000/api/portal/addendums/valid-token-abc/respond',
      {
        method: 'POST',
        body: JSON.stringify({
          response: 'changes_requested',
          note: 'Need to adjust scope',
        }),
        headers: {
          'Content-Type': 'application/json',
          'user-agent': 'TestBrowser/1.0',
        },
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({ token: 'valid-token-abc' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Addendum changes_requested');
    expect(body.status).toBe('changes_requested');
    expect(mockLogPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'changes_requested',
        metadata: { note: 'Need to adjust scope' },
      })
    );
  });

  it('returns 404 for invalid token', async () => {
    mockAddendumFindFirst.mockResolvedValue(null);

    const request = new NextRequest(
      'http://localhost:3000/api/portal/addendums/invalid-token/respond',
      {
        method: 'POST',
        body: JSON.stringify({ response: 'accepted' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({ token: 'invalid-token' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Addendum not found or link has expired');
  });

  it('rejects response for already-responded addendum', async () => {
    mockAddendumFindFirst.mockResolvedValue({
      ...mockAddendumData,
      status: 'accepted',
    });

    const request = new NextRequest(
      'http://localhost:3000/api/portal/addendums/valid-token-abc/respond',
      {
        method: 'POST',
        body: JSON.stringify({ response: 'rejected' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({ token: 'valid-token-abc' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('This addendum has already been responded to');
  });
});
