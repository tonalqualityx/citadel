import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/portal', () => ({
  validateMsaToken: vi.fn(),
  logPortalSession: vi.fn(),
  getClientIp: vi.fn(() => '192.168.1.1'),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientMsaSignature: { update: vi.fn() },
  },
}));

import { GET } from '../[token]/route';
import { POST } from '../[token]/sign/route';
import { validateMsaToken, logPortalSession } from '@/lib/services/portal';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockValidateMsaToken = validateMsaToken as Mock;
const mockLogPortalSession = logPortalSession as Mock;
const mockSignatureUpdate = prisma.clientMsaSignature.update as Mock;

const mockMsaSignature = {
  id: 'sig-123',
  client_id: 'client-1',
  msa_version_id: 'msa-1',
  signed_at: null,
  signer_name: null,
  signer_email: null,
  signer_ip: null,
  signer_user_agent: null,
  portal_token: 'msa-token-123',
  client: { id: 'client-1', name: 'Test Client' },
  msa_version: {
    version: '1.0',
    content: '<p>Terms</p>',
    effective_date: new Date('2026-01-01'),
  },
};

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), options as any);
}

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe('Portal MSA Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/portal/msa/:token', () => {
    it('returns MSA data for valid token', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);

      const request = makeRequest('http://localhost/api/portal/msa/valid-token');
      const response = await GET(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('sig-123');
      expect(data.client.name).toBe('Test Client');
      expect(data.msa_version.version).toBe('1.0');
      expect(data.msa_version.content).toBe('<p>Terms</p>');
      expect(data.msa_version.effective_date).toBe(new Date('2026-01-01').toISOString());
      expect(data.already_signed).toBe(false);
      expect(data.signed_at).toBeNull();

      expect(mockValidateMsaToken).toHaveBeenCalledWith('valid-token');
    });

    it('returns 404 for invalid token', async () => {
      mockValidateMsaToken.mockResolvedValue(null);

      const request = makeRequest('http://localhost/api/portal/msa/bad-token');
      const response = await GET(request, makeParams('bad-token'));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('MSA signing link not found or has expired');
    });

    it('logs portal session on successful view', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);

      const request = makeRequest('http://localhost/api/portal/msa/valid-token');
      await GET(request, makeParams('valid-token'));

      expect(mockLogPortalSession).toHaveBeenCalledWith({
        tokenType: 'msa',
        entityId: 'sig-123',
        ipAddress: '192.168.1.1',
        userAgent: null,
        action: 'view',
      });
    });

    it('returns already_signed true when MSA was previously signed', async () => {
      mockValidateMsaToken.mockResolvedValue({
        ...mockMsaSignature,
        signer_name: 'Jane Doe',
        signed_at: '2026-03-15T10:00:00Z',
      });

      const request = makeRequest('http://localhost/api/portal/msa/valid-token');
      const response = await GET(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.already_signed).toBe(true);
      expect(data.signed_at).toBe('2026-03-15T10:00:00Z');
    });
  });

  describe('POST /api/portal/msa/:token/sign', () => {
    it('signs MSA successfully', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);
      mockSignatureUpdate.mockResolvedValue({});

      const request = makeRequest('http://localhost/api/portal/msa/valid-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_name: 'Jane Doe',
          signer_email: 'jane@acme.com',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('MSA signed successfully');
      expect(data.signed_at).toBeDefined();

      expect(mockSignatureUpdate).toHaveBeenCalledWith({
        where: { id: 'sig-123' },
        data: expect.objectContaining({
          signer_name: 'Jane Doe',
          signer_email: 'jane@acme.com',
          signer_ip: '192.168.1.1',
        }),
      });
    });

    it('returns 400 for already-signed MSA', async () => {
      mockValidateMsaToken.mockResolvedValue({
        ...mockMsaSignature,
        signer_name: 'Jane Doe',
        signed_at: '2026-03-15T10:00:00Z',
      });

      const request = makeRequest('http://localhost/api/portal/msa/valid-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_name: 'Jane Doe',
          signer_email: 'jane@acme.com',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('This MSA has already been signed');
    });

    it('returns 404 for invalid token', async () => {
      mockValidateMsaToken.mockResolvedValue(null);

      const request = makeRequest('http://localhost/api/portal/msa/bad-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_name: 'Jane Doe',
          signer_email: 'jane@acme.com',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('bad-token'));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('MSA signing link not found or has expired');
    });

    it('returns 400 when signer_name is missing', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);

      const request = makeRequest('http://localhost/api/portal/msa/valid-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_email: 'jane@acme.com',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Validation failed');
    });

    it('returns 400 when signer_email is missing', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);

      const request = makeRequest('http://localhost/api/portal/msa/valid-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_name: 'Jane Doe',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Validation failed');
    });

    it('returns 400 when signer_email is invalid', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);

      const request = makeRequest('http://localhost/api/portal/msa/valid-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_name: 'Jane Doe',
          signer_email: 'not-an-email',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request, makeParams('valid-token'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Validation failed');
    });

    it('logs portal session on successful sign', async () => {
      mockValidateMsaToken.mockResolvedValue(mockMsaSignature);
      mockSignatureUpdate.mockResolvedValue({});

      const request = makeRequest('http://localhost/api/portal/msa/valid-token/sign', {
        method: 'POST',
        body: JSON.stringify({
          signer_name: 'Jane Doe',
          signer_email: 'jane@acme.com',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(request, makeParams('valid-token'));

      expect(mockLogPortalSession).toHaveBeenCalledWith({
        tokenType: 'msa',
        entityId: 'sig-123',
        ipAddress: '192.168.1.1',
        userAgent: null,
        action: 'sign',
        metadata: { signer_name: 'Jane Doe', signer_email: 'jane@acme.com' },
      });
    });
  });
});
