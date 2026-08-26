import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    scheduledInvoice: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    accord: {
      findUnique: vi.fn(),
    },
  },
}));

import { GET, POST } from '../route';
import { PATCH, GET as GET_BY_ID } from '../[id]/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindMany = prisma.scheduledInvoice.findMany as Mock;
const mockFindUnique = prisma.scheduledInvoice.findUnique as Mock;
const mockCreate = prisma.scheduledInvoice.create as Mock;
const mockUpdate = prisma.scheduledInvoice.update as Mock;
const mockAccordFindUnique = prisma.accord.findUnique as Mock;

const ACCORD_ID = '550e8400-e29b-41d4-a716-446655440040';
const ROW_ID = '550e8400-e29b-41d4-a716-446655440041';

function createGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/scheduled-invoices');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), { method: 'GET' });
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/scheduled-invoices', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/scheduled-invoices/${ROW_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const makeParams = () => Promise.resolve({ id: ROW_ID });

function baseRow(overrides: Record<string, any> = {}) {
  return {
    id: ROW_ID,
    accord_id: ACCORD_ID,
    client_id: null,
    project_id: null,
    charter_id: null,
    ware_id: null,
    accord_item_id: null,
    item_kind: null,
    trigger_type: 'signature',
    trigger_ref: null,
    amount_source: 'accord_item',
    amount_percent: null,
    amount_cached: null,
    currency: 'USD',
    due_on: null,
    status: 'pending',
    notified_at: null,
    sent_at: null,
    paid_at: null,
    quickbooks_ref: null,
    notes: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('scheduled-invoices CRUD (project-record-citadel-changes.md section 1.3/2.3, ruling 33)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm', email: 'pm@test.com' });
    mockAccordFindUnique.mockResolvedValue({ id: ACCORD_ID });
  });

  describe('GET /api/scheduled-invoices', () => {
    it('lists rows filtered by accord_id', async () => {
      mockFindMany.mockResolvedValue([baseRow()]);

      const response = await GET(createGetRequest({ accord_id: ACCORD_ID }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accord_id: ACCORD_ID }) })
      );
      expect(body.scheduled_invoices).toHaveLength(1);
      expect(body.scheduled_invoices[0].id).toBe(ROW_ID);
    });

    it('filters by status (the notify cron read path)', async () => {
      mockFindMany.mockResolvedValue([]);
      await GET(createGetRequest({ status: 'pending' }));

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'pending' }) })
      );
    });
  });

  describe('POST /api/scheduled-invoices', () => {
    it('creates a row with the required trigger/amount fields', async () => {
      mockCreate.mockResolvedValue(baseRow());

      const response = await POST(
        createPostRequest({
          accord_id: ACCORD_ID,
          trigger_type: 'signature',
          amount_source: 'accord_item',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(mockAccordFindUnique).toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accord_id: ACCORD_ID,
            trigger_type: 'signature',
            amount_source: 'accord_item',
            currency: 'USD',
            status: 'pending',
          }),
        })
      );
      expect(body.status).toBe('pending');
    });

    it('requires pm/admin role', async () => {
      mockCreate.mockResolvedValue(baseRow());
      await POST(
        createPostRequest({ accord_id: ACCORD_ID, trigger_type: 'signature', amount_source: 'accord_item' })
      );

      expect(mockRequireRole).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', role: 'pm' }),
        ['pm', 'admin']
      );
    });

    it('returns 404 when the accord does not exist', async () => {
      mockAccordFindUnique.mockResolvedValue(null);

      const response = await POST(
        createPostRequest({ accord_id: ACCORD_ID, trigger_type: 'signature', amount_source: 'accord_item' })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Accord not found');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects a missing required field (Zod validation)', async () => {
      const response = await POST(createPostRequest({ accord_id: ACCORD_ID }));
      expect(response.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/scheduled-invoices/[id] (status transitions)', () => {
    it('updates status and sent_at', async () => {
      mockFindUnique.mockResolvedValue(baseRow());
      mockUpdate.mockResolvedValue(baseRow({ status: 'sent', sent_at: new Date('2026-08-27') }));

      const response = await PATCH(
        createPatchRequest({ status: 'sent', sent_at: '2026-08-27T00:00:00.000Z' }),
        { params: makeParams() }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROW_ID },
          data: expect.objectContaining({ status: 'sent', sent_at: new Date('2026-08-27T00:00:00.000Z') }),
        })
      );
      expect(body.status).toBe('sent');
    });

    it('stores a Mike-typed quickbooks_ref verbatim (never fetched, ruling 12)', async () => {
      mockFindUnique.mockResolvedValue(baseRow());
      mockUpdate.mockResolvedValue(baseRow({ quickbooks_ref: 'QB-1042' }));

      await PATCH(createPatchRequest({ quickbooks_ref: 'QB-1042' }), { params: makeParams() });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ quickbooks_ref: 'QB-1042' }) })
      );
    });

    it('returns 404 for a non-existent row', async () => {
      mockFindUnique.mockResolvedValue(null);

      const response = await PATCH(createPatchRequest({ status: 'sent' }), { params: makeParams() });
      expect(response.status).toBe(404);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('requires pm/admin role', async () => {
      mockFindUnique.mockResolvedValue(baseRow());
      mockUpdate.mockResolvedValue(baseRow());
      await PATCH(createPatchRequest({ status: 'sent' }), { params: makeParams() });

      expect(mockRequireRole).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', role: 'pm' }),
        ['pm', 'admin']
      );
    });
  });

  describe('GET /api/scheduled-invoices/[id]', () => {
    it('returns a single row', async () => {
      mockFindUnique.mockResolvedValue(baseRow());
      const response = await GET_BY_ID(new NextRequest(`http://localhost/api/scheduled-invoices/${ROW_ID}`), {
        params: makeParams(),
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.id).toBe(ROW_ID);
    });

    it('returns 404 when missing', async () => {
      mockFindUnique.mockResolvedValue(null);
      const response = await GET_BY_ID(new NextRequest(`http://localhost/api/scheduled-invoices/${ROW_ID}`), {
        params: makeParams(),
      });
      expect(response.status).toBe(404);
    });
  });
});
