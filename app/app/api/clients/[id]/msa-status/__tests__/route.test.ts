import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1', role: 'admin' }),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    msaVersion: { findFirst: vi.fn() },
    clientMsaSignature: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatClientMsaSignatureResponse: vi.fn((s) => s),
}));

import { GET } from '../route';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockMsaVersionFindFirst = prisma.msaVersion.findFirst as Mock;
const mockSignatureFindUnique = prisma.clientMsaSignature.findUnique as Mock;

const mockCurrentMsa = {
  id: 'msa-v1',
  version: '2.0',
  is_current: true,
  content: '<p>Terms v2</p>',
  effective_date: '2026-01-01',
};

const mockSignature = {
  id: 'sig-456',
  client_id: 'client-123',
  client: { id: 'client-123', name: 'Acme Corp' },
  msa_version_id: 'msa-v1',
  msa_version: { id: 'msa-v1', version: '2.0' },
  signer_name: 'Jane Doe',
  signer_email: 'jane@acme.com',
  signed_at: '2026-02-15T10:00:00Z',
};

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'));
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/clients/:id/msa-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns signed_current true when client has signed current MSA', async () => {
    mockMsaVersionFindFirst.mockResolvedValue(mockCurrentMsa);
    mockSignatureFindUnique.mockResolvedValue(mockSignature);

    const request = makeRequest('http://localhost/api/clients/client-123/msa-status');
    const response = await GET(request, makeParams('client-123'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.has_current_msa).toBe(true);
    expect(data.signed_current).toBe(true);
    expect(data.current_msa_version).toBe('2.0');
    expect(data.signature).toBeTruthy();
    expect(data.signature.id).toBe('sig-456');

    expect(mockMsaVersionFindFirst).toHaveBeenCalledWith({
      where: { is_current: true },
    });

    expect(mockSignatureFindUnique).toHaveBeenCalledWith({
      where: {
        client_id_msa_version_id: {
          client_id: 'client-123',
          msa_version_id: 'msa-v1',
        },
      },
      include: {
        client: { select: { id: true, name: true } },
        msa_version: { select: { id: true, version: true } },
      },
    });
  });

  it('returns signed_current false when client has not signed', async () => {
    mockMsaVersionFindFirst.mockResolvedValue(mockCurrentMsa);
    mockSignatureFindUnique.mockResolvedValue(null);

    const request = makeRequest('http://localhost/api/clients/client-123/msa-status');
    const response = await GET(request, makeParams('client-123'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.has_current_msa).toBe(true);
    expect(data.signed_current).toBe(false);
    expect(data.current_msa_version).toBe('2.0');
    expect(data.signature).toBeNull();
  });

  it('returns has_current_msa false when no MSA version is current', async () => {
    mockMsaVersionFindFirst.mockResolvedValue(null);

    const request = makeRequest('http://localhost/api/clients/client-123/msa-status');
    const response = await GET(request, makeParams('client-123'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.has_current_msa).toBe(false);
    expect(data.signed_current).toBe(false);
    expect(data.current_msa_version).toBeNull();
    expect(data.signature).toBeNull();

    // Should not query for signatures when no current MSA exists
    expect(mockSignatureFindUnique).not.toHaveBeenCalled();
  });
});
