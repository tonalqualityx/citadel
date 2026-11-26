import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/retainer-months/service', async (orig) => {
  const actual = await orig<typeof import('@/lib/retainer-months/service')>();
  return {
    ...actual,
    listMonths: vi.fn(), loadMonth: vi.fn(), viewMonth: vi.fn(), confirmMonth: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn(),
  };
});

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import * as svc from '@/lib/retainer-months/service';
import { GET as LIST } from '../route';
import { GET as ONE } from '../[id]/route';
import { POST as CONFIRM } from '../[id]/confirm/route';
import { POST as ADD } from '../[id]/items/route';
import { PATCH, DELETE } from '../[id]/items/[itemId]/route';

const s = svc as unknown as Record<string, Mock>;
const ID = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const req = (method: string, body?: object, url = 'http://localhost/api/retainer-months') =>
  new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const ctx = { params: Promise.resolve({ id: ID }) };
const ictx = { params: Promise.resolve({ id: ID, itemId: ITEM }) };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: USER, email: 'm@x.com', role: 'admin' });
  (requireRole as Mock).mockReturnValue(undefined);
  s.viewMonth.mockResolvedValue({ id: ID, month: '2026-12' });
  s.loadMonth.mockResolvedValue({ id: ID });
});

describe('GET /api/retainer-months', () => {
  it('lists the requested month', async () => {
    s.listMonths.mockResolvedValue({ month: '2026-12', retainers: [], upcoming: [{ id: 'next', month: '2027-01' }] });
    const res = await LIST(req('GET', undefined, 'http://localhost/api/retainer-months?month=2026-12'));
    expect(s.listMonths).toHaveBeenCalledWith('2026-12');
    expect(await res.json()).toEqual({ month: '2026-12', retainers: [], upcoming: [{ id: 'next', month: '2027-01' }] });
  });
  it('defaults to the current month and 400s on a bad one', async () => {
    s.listMonths.mockResolvedValue({ month: 'x', retainers: [] });
    await LIST(req('GET'));
    expect(s.listMonths.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}$/);
    const bad = await LIST(req('GET', undefined, 'http://localhost/api/retainer-months?month=2026-13'));
    expect(bad.status).toBe(400);
  });
});

describe('GET /api/retainer-months/[id]', () => {
  it('returns the month view', async () => {
    const res = await ONE(req('GET'), ctx);
    expect(res.status).toBe(200);
    expect(s.loadMonth).toHaveBeenCalledWith(ID);
  });
  it('404s through the service', async () => {
    s.loadMonth.mockRejectedValue(new ApiError('Retainer month not found', 404));
    expect((await ONE(req('GET'), ctx)).status).toBe(404);
  });
});

describe('POST /api/retainer-months/[id]/confirm', () => {
  it('confirms as the signed-in user', async () => {
    const res = await CONFIRM(req('POST'), ctx);
    expect(res.status).toBe(200);
    expect(s.confirmMonth).toHaveBeenCalledWith(ID, USER);
    expect(requireRole).toHaveBeenCalled();
  });
  it('409s on a closed month', async () => {
    s.confirmMonth.mockRejectedValue(new ApiError('closed', 409));
    expect((await CONFIRM(req('POST'), ctx)).status).toBe(409);
  });
});

describe('items routes', () => {
  it('POST adds an item (201) and validates the body', async () => {
    s.addItem.mockResolvedValue({ id: ITEM });
    const ok = await ADD(req('POST', { title: 'Blog', estimate_min_low: 60, estimate_min_high: 90 }), ctx);
    expect(ok.status).toBe(201);
    expect(s.addItem).toHaveBeenCalledWith(ID, { title: 'Blog', estimate_min_low: 60, estimate_min_high: 90 });
    expect((await ADD(req('POST', { title: '' }), ctx)).status).toBe(400);
    expect((await ADD(req('POST', { title: 'x', estimate_min_low: 1, estimate_min_high: 2, nope: 1 }), ctx)).status).toBe(400);
  });
  it('POST 409s on a closed month', async () => {
    s.addItem.mockRejectedValue(new ApiError('closed', 409));
    expect((await ADD(req('POST', { title: 'x', estimate_min_low: 1, estimate_min_high: 2 }), ctx)).status).toBe(409);
  });
  it('PATCH changes an item', async () => {
    s.updateItem.mockResolvedValue({ id: ITEM, title: 'New' });
    const res = await PATCH(req('PATCH', { title: 'New' }), ictx);
    expect(s.updateItem).toHaveBeenCalledWith(ID, ITEM, { title: 'New' });
    expect((await res.json()).title).toBe('New');
  });
  it('PATCH 400s when the service refuses the range', async () => {
    s.updateItem.mockRejectedValue(new ApiError('range', 400));
    expect((await PATCH(req('PATCH', { estimate_min_low: 9 }), ictx)).status).toBe(400);
  });
  it('DELETE removes an item; 409 on a closed month', async () => {
    expect((await DELETE(req('DELETE'), ictx)).status).toBe(200);
    expect(s.removeItem).toHaveBeenCalledWith(ID, ITEM);
    s.removeItem.mockRejectedValue(new ApiError('closed', 409));
    expect((await DELETE(req('DELETE'), ictx)).status).toBe(409);
  });
});
