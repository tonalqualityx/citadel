import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/services/client-auth', () => ({
  createContactPortalLoginLink: vi.fn(),
}));

vi.mock('@/lib/services/portal', () => ({
  getClientIp: vi.fn(() => '1.2.3.4'),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { createContactPortalLoginLink } from '@/lib/services/client-auth';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockCreateLink = createContactPortalLoginLink as Mock;

const ID = 'contact-1';
const params = Promise.resolve({ id: ID });

function postReq(body?: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/contacts/${ID}/portal-login-link`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  });
}

const link = {
  url: 'http://localhost:3000/api/portal/login/abc123',
  expiresAt: new Date('2026-06-28T00:00:00Z'),
  sent: false,
  contact: { id: ID, name: 'Ann', email: 'ann@acme.com', clientId: 'client-acme' },
};

describe('POST /api/contacts/[id]/portal-login-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
  });

  it('returns the URL to copy (send omitted → false, no email)', async () => {
    mockCreateLink.mockResolvedValue({ ...link, sent: false });
    const response = await POST(postReq({}), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe(link.url);
    expect(body.sent).toBe(false);
    expect(body.contact).toEqual({ id: ID, name: 'Ann', email: 'ann@acme.com' });
    expect(mockCreateLink).toHaveBeenCalledWith(expect.objectContaining({ contactId: ID, send: false }));
  });

  it('emails the contact when send=true', async () => {
    mockCreateLink.mockResolvedValue({ ...link, sent: true });
    const response = await POST(postReq({ send: true }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toBe(true);
    expect(mockCreateLink).toHaveBeenCalledWith(expect.objectContaining({ contactId: ID, send: true }));
  });

  it('enforces pm/admin role', async () => {
    mockCreateLink.mockResolvedValue(link);
    await POST(postReq({}), { params });
    expect(mockRequireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
  });

  it('404s when the contact is unknown/deleted (service returns null)', async () => {
    mockCreateLink.mockResolvedValue(null);
    const response = await POST(postReq({ send: true }), { params });
    expect(response.status).toBe(404);
  });
});
