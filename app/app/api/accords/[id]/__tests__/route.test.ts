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
    accord: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Use the REAL formatAccordResponse — this is exactly the function the handoff doc's
// feature-detection reads, so the round-trip test needs the real serialization, not a
// pass-through mock.
import { GET, PATCH } from '../route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockAccordFindUnique = prisma.accord.findUnique as Mock;
const mockAccordUpdate = prisma.accord.update as Mock;

const ACCORD_ID = '550e8400-e29b-41d4-a716-446655440030';

function createGetRequest(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/accords/${ACCORD_ID}`, { method: 'GET' });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/accords/${ACCORD_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const makeParams = () => Promise.resolve({ id: ACCORD_ID });

function baseAccord(overrides: Record<string, any> = {}) {
  return {
    id: ACCORD_ID,
    name: 'Test Accord',
    status: 'lead',
    client_id: null,
    client: null,
    owner_id: 'user-1',
    owner: null,
    lead_name: null,
    lead_business_name: null,
    lead_email: null,
    lead_phone: null,
    lead_notes: null,
    notes: null,
    rejection_reason: null,
    payment_confirmed: false,
    payment_confirmed_at: null,
    total_value: null,
    entered_current_status_at: new Date('2026-01-01'),
    lost_at: null,
    signed_at: null,
    pipeline_stage: null,
    pipeline_stage_at: null,
    record_dir: null,
    charter_items: [],
    commission_items: [],
    keep_items: [],
    _count: { charter_items: 0, commission_items: 0, keep_items: 0 },
    is_deleted: false,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('Accord pipeline fields (project-record-citadel-changes.md, ruling 33)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm', email: 'pm@test.com' });
  });

  it('GET always serializes pipeline_stage/pipeline_stage_at/record_dir, even when null', async () => {
    mockAccordFindUnique.mockResolvedValue(baseAccord());

    const response = await GET(createGetRequest(), { params: makeParams() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('pipeline_stage', null);
    expect(body).toHaveProperty('pipeline_stage_at', null);
    expect(body).toHaveProperty('record_dir', null);
  });

  it('PATCH round-trips pipeline_stage, pipeline_stage_at, and record_dir', async () => {
    const stageAt = '2026-08-27T12:00:00.000Z';
    mockAccordUpdate.mockResolvedValue(
      baseAccord({
        pipeline_stage: 'proposal_drafted',
        pipeline_stage_at: new Date(stageAt),
        record_dir: '/Documents/Wright/prospects/acme/site/2026-08',
      })
    );

    const response = await PATCH(
      createPatchRequest({
        pipeline_stage: 'proposal_drafted',
        pipeline_stage_at: stageAt,
        record_dir: '/Documents/Wright/prospects/acme/site/2026-08',
      }),
      { params: makeParams() }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockAccordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ACCORD_ID },
        data: expect.objectContaining({
          pipeline_stage: 'proposal_drafted',
          pipeline_stage_at: new Date(stageAt),
          record_dir: '/Documents/Wright/prospects/acme/site/2026-08',
        }),
      })
    );
    expect(body.pipeline_stage).toBe('proposal_drafted');
    expect(body.record_dir).toBe('/Documents/Wright/prospects/acme/site/2026-08');
  });

  it('PATCH clears pipeline_stage_at to null on an explicit null (not left undefined)', async () => {
    mockAccordUpdate.mockResolvedValue(baseAccord({ pipeline_stage: 'lost' }));

    await PATCH(
      createPatchRequest({ pipeline_stage: 'lost', pipeline_stage_at: null }),
      { params: makeParams() }
    );

    expect(mockAccordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pipeline_stage_at: null }),
      })
    );
  });

  it('leaves pipeline fields untouched when absent from the PATCH body', async () => {
    mockAccordUpdate.mockResolvedValue(baseAccord({ name: 'Renamed' }));

    await PATCH(createPatchRequest({ name: 'Renamed' }), { params: makeParams() });

    const call = mockAccordUpdate.mock.calls[0][0];
    expect(call.data.pipeline_stage).toBeUndefined();
    expect(call.data.record_dir).toBeUndefined();
    // pipeline_stage_at is explicitly normalized (undefined-guarded), so it stays undefined
    // (a no-op update field), never coerced to null, when the key is absent from the body.
    expect(call.data.pipeline_stage_at).toBeUndefined();
  });

  it('requires pm/admin role for PATCH', async () => {
    mockAccordUpdate.mockResolvedValue(baseAccord());
    await PATCH(createPatchRequest({ pipeline_stage: 'lead' }), { params: makeParams() });

    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', role: 'pm' }),
      ['pm', 'admin']
    );
  });
});
