import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { checklist: { findMany: vi.fn(), findUnique: vi.fn() } } }));
vi.mock('@/lib/checklists/service', async (orig) => ({
  ...(await orig<typeof import('@/lib/checklists/service')>()),
  createChecklistFromTemplate: vi.fn(),
  setItemState: vi.fn(),
}));

import { GET, POST } from '../route';
import { GET as GET_ONE } from '../[id]/route';
import { PATCH } from '../[id]/items/[key]/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { ChecklistError, createChecklistFromTemplate, itemsFromTemplate, setItemState } from '@/lib/checklists/service';
import { ONBOARDING_BUILD_TEMPLATE } from '@/lib/checklists/templates';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const CL = '11111111-1111-4111-8111-111111111111';
const ID = '55555555-5555-4555-8555-555555555555';
const checklist = () => ({
  id: ID, kind: 'onboarding', client_id: CL, accord_id: null, charter_id: null, project_id: null, started_at: new Date(), done_at: null,
  items: itemsFromTemplate(ONBOARDING_BUILD_TEMPLATE).map((r) => ({ ...r, state: 'missing', verified_by_id: null, verified_at: null, evidence: null })),
});
const req = (url: string, method: string, body?: object) =>
  new NextRequest(`http://localhost${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
const idCtx = { params: Promise.resolve({ id: ID }) };
const itemCtx = (key = 'assets.logo') => ({ params: Promise.resolve({ id: ID, key }) });

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm', email: 'x@y.z' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('staff auth', () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ['GET list', () => GET(req(`/api/checklists?client_id=${CL}`, 'GET'))],
    ['POST', () => POST(req('/api/checklists', 'POST', { kind: 'onboarding', client_id: CL, template: 'onboarding.build' }))],
    ['GET one', () => GET_ONE(req(`/api/checklists/${ID}`, 'GET'), idCtx)],
    ['PATCH item', () => PATCH(req(`/api/checklists/${ID}/items/assets.logo`, 'PATCH', { state: 'received' }), itemCtx())],
  ];
  it.each(calls)('%s answers 401 without a session', async (_n, fn) => {
    (requireAuth as Mock).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await fn()).status).toBe(401);
  });
  it.each(calls)('%s answers 403 for a non-staff role', async (_n, fn) => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await fn()).status).toBe(403);
    expect(createChecklistFromTemplate).not.toHaveBeenCalled();
    expect(setItemState).not.toHaveBeenCalled();
  });
});

describe('POST /api/checklists', () => {
  const body = { kind: 'onboarding', client_id: CL, template: 'onboarding.build' };
  it('creates from a template: 201, then 200 for the open one', async () => {
    (createChecklistFromTemplate as Mock).mockResolvedValueOnce({ checklist: checklist(), created: true });
    const res = await POST(req('/api/checklists', 'POST', body));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.done).toBe(false);
    expect(out.items.find((i: { key: string }) => i.key === 'assets.logo')).toMatchObject({ client_label: 'Your logo file', gate: 'before_work' });
    (createChecklistFromTemplate as Mock).mockResolvedValueOnce({ checklist: checklist(), created: false });
    expect((await POST(req('/api/checklists', 'POST', body))).status).toBe(200);
  });
  it('maps service errors to 400 and 404, and refuses a bad body', async () => {
    (createChecklistFromTemplate as Mock).mockRejectedValueOnce(new ChecklistError('Unknown template x', 'unknown_template'));
    expect((await POST(req('/api/checklists', 'POST', { ...body, template: 'x' }))).status).toBe(400);
    (createChecklistFromTemplate as Mock).mockRejectedValueOnce(new ChecklistError('Client not found', 'client_not_found'));
    expect((await POST(req('/api/checklists', 'POST', body))).status).toBe(404);
    expect((await POST(req('/api/checklists', 'POST', { ...body, kind: 'weird' }))).status).toBe(400);
  });
});

describe('GET /api/checklists', () => {
  it('needs client_id and lists that client\'s checklists', async () => {
    expect((await GET(req('/api/checklists', 'GET'))).status).toBe(400);
    p.checklist.findMany.mockResolvedValue([checklist()]);
    const res = await GET(req(`/api/checklists?client_id=${CL}`, 'GET'));
    expect(res.status).toBe(200);
    expect(p.checklist.findMany.mock.calls[0][0].where).toEqual({ client_id: CL });
    expect((await res.json()).meta.count).toBe(1);
  });
  it('GET one 404s for a missing checklist', async () => {
    p.checklist.findUnique.mockResolvedValue(null);
    expect((await GET_ONE(req(`/api/checklists/${ID}`, 'GET'), idCtx)).status).toBe(404);
  });
});

describe('PATCH /api/checklists/[id]/items/[key]', () => {
  it('sets state with evidence and records the signed-in user as verifier', async () => {
    (setItemState as Mock).mockResolvedValue(checklist());
    const res = await PATCH(req(`/api/checklists/${ID}/items/assets.logo`, 'PATCH', { state: 'verified', evidence: 'Drive file 1abc' }), itemCtx());
    expect(res.status).toBe(200);
    expect((setItemState as Mock).mock.calls[0].slice(1)).toEqual([ID, 'assets.logo', { state: 'verified', evidence: 'Drive file 1abc', verified_by_id: 'u1' }]);
  });
  it('refuses an unknown state, and maps evidence_required and item_not_found', async () => {
    expect((await PATCH(req('/x', 'PATCH', { state: 'done' }), itemCtx())).status).toBe(400);
    (setItemState as Mock).mockRejectedValueOnce(new ChecklistError('needs evidence', 'evidence_required'));
    expect((await PATCH(req('/x', 'PATCH', { state: 'verified' }), itemCtx())).status).toBe(400);
    (setItemState as Mock).mockRejectedValueOnce(new ChecklistError('Item not found', 'item_not_found'));
    expect((await PATCH(req('/x', 'PATCH', { state: 'received' }), itemCtx('nope.key'))).status).toBe(404);
  });
});
