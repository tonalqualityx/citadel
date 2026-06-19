import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindMany = prisma.clientContact.findMany as Mock;

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/contacts/resolve${query}`);
}

describe('GET /api/contacts/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'pm@x.com' });
  });

  it('returns 400 when email param is missing', async () => {
    const response = await GET(req(''));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('email query parameter is required');
  });

  it('returns empty matches for an unknown email', async () => {
    mockFindMany.mockResolvedValue([]);
    const response = await GET(req('?email=nobody@example.com'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.email).toBe('nobody@example.com');
    expect(body.matches).toEqual([]);
  });

  it('queries case-insensitively on the trimmed email, excluding soft-deleted', async () => {
    mockFindMany.mockResolvedValue([]);
    await GET(req('?email=%20Editor@Site.com%20'));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          email: { equals: 'Editor@Site.com', mode: 'insensitive' },
          client: { is_deleted: false },
        }),
      })
    );
  });

  it('maps a match to client + sites with site_type, domains, and notes', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'contact-1',
        name: 'Editor',
        role: 'Editor',
        can_initiate_work: true,
        is_primary: true,
        client: {
          id: 'client-1',
          name: 'Vermont Standard',
          type: 'direct',
          status: 'active',
          sites: [
            {
              id: 'site-1',
              name: 'The Vermont Standard',
              url: 'https://thevermontstandard.com',
              site_type: 'wordpress',
              notes: 'Main newspaper site.',
              domains: [{ name: 'thevermontstandard.com' }],
            },
            {
              id: 'site-2',
              name: 'Wheels to Learning',
              url: 'https://wheelstolearningvt.org',
              site_type: 'eleventy',
              notes: 'Education nonprofit project.',
              domains: [{ name: 'wheelstolearningvt.org' }],
            },
          ],
        },
      },
    ]);

    const response = await GET(req('?email=editor@thevermontstandard.com'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.matches).toHaveLength(1);
    const match = body.matches[0];
    expect(match.contact_id).toBe('contact-1');
    expect(match.can_initiate_work).toBe(true);
    expect(match.client).toEqual({
      id: 'client-1',
      name: 'Vermont Standard',
      type: 'direct',
      status: 'active',
    });
    expect(match.sites).toHaveLength(2);
    expect(match.sites[1]).toEqual({
      id: 'site-2',
      name: 'Wheels to Learning',
      url: 'https://wheelstolearningvt.org',
      site_type: 'eleventy',
      domains: ['wheelstolearningvt.org'],
      notes: 'Education nonprofit project.',
    });
  });
});
