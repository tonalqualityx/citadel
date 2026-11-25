import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';
import { GET as GET_ONE, PATCH, DELETE } from '../[id]/route';
import { POST as POST_NUMBER } from '../[id]/numbers/route';
import { PATCH as PATCH_NUMBER, DELETE as DELETE_NUMBER } from '../[id]/numbers/[numberId]/route';
import { POST as POST_READING } from '../[id]/readings/route';
import { POST as POST_CHECK_IN } from '../[id]/check-ins/route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    initiative: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    initiativeNumber: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    initiativeReading: { create: vi.fn() },
    initiativeCheckIn: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    client: { findUnique: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INIT = '33333333-3333-4333-8333-333333333333';
const NUM = '44444444-4444-4444-8444-444444444444';

const req = (method: string, body?: object, url = 'http://localhost/api/initiatives') =>
  new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const ctx = (extra: { numberId?: string } = {}) => ({ params: Promise.resolve({ id: INIT, numberId: extra.numberId ?? NUM }) });

const numberRow = (o: Record<string, unknown> = {}) => ({
  id: NUM, initiative_id: INIT, label: 'ADA quotes sent', unit: 'count', direction: 'up',
  baseline_value: null, baseline_at: null, target_value: '10.00', target_by: new Date('2027-03-31'),
  source: 'manual', last_value: null, last_read_at: null, position: 0,
  created_at: new Date('2026-11-01'), updated_at: new Date('2026-11-01'), ...o,
});

const row = (o: Record<string, unknown> = {}) => ({
  id: INIT, name: 'ADA-compliant site builds', bet: 'ADA audits sell', nightmare: null, prevention: null, repair: null,
  cost_of_waiting: null, stop_condition: null, check_date: null, check_every_days: null, next_decision: null,
  status: 'proposed', health: 'unchecked', health_reason: null, owner_id: USER, client_id: null, sort_order: 0,
  activated_at: null, closed_at: null, closed_reason: null, created_by_id: USER, is_deleted: false,
  created_at: new Date('2026-11-01'), updated_at: new Date('2026-11-01'), numbers: [], check_ins: [], ...o,
});

const validNumber = { label: 'ADA quotes sent', unit: 'count', direction: 'up', target_value: 10, target_by: '2027-03-31' };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: USER, email: 'm@x.com', role: 'admin' });
  (requireRole as Mock).mockReturnValue(undefined);
  // update echoes what it was given onto the stored row
  p.initiative.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
  p.initiative.findUnique.mockResolvedValue(row());
});

describe('GET /api/initiatives', () => {
  it('lists non-deleted initiatives with numbers as plain numbers', async () => {
    p.initiative.findMany.mockResolvedValue([row({ numbers: [numberRow()] })]);
    const res = await GET(req('GET'));
    const body = await res.json();
    expect(p.initiative.findMany.mock.calls[0][0].where).toEqual({ is_deleted: false });
    expect(body.total).toBe(1);
    expect(body.initiatives[0].numbers[0].target_value).toBe(10);
    expect(body.initiatives[0].latest_check_in).toBeNull();
  });
  it('filters by status and rejects an unknown one', async () => {
    p.initiative.findMany.mockResolvedValue([]);
    await GET(req('GET', undefined, 'http://localhost/api/initiatives?status=active'));
    expect(p.initiative.findMany.mock.calls[0][0].where).toEqual({ is_deleted: false, status: 'active' });
    const bad = await GET(req('GET', undefined, 'http://localhost/api/initiatives?status=nope'));
    expect(bad.status).toBe(400);
  });
});

describe('POST /api/initiatives', () => {
  it('creates with every field, owner falling back to the caller when no Mike user exists, and numbers in order', async () => {
    p.initiative.create.mockResolvedValue(row());
    p.client.findUnique.mockResolvedValue({ id: OTHER });
    const res = await POST(req('POST', {
      name: 'ADA-compliant site builds', bet: 'ADA audits sell', nightmare: 'No one buys', prevention: 'Pitch agencies',
      repair: 'Sell the audit alone', cost_of_waiting: 'Lost quarter', stop_condition: 'Fewer than 2 quotes by March 31',
      check_date: '2027-01-15', check_every_days: 14, next_decision: 'Pick two agencies', status: 'proposed',
      health_reason: 'fresh', client_id: OTHER, sort_order: 2, closed_reason: null,
      numbers: [validNumber, { ...validNumber, label: 'Agencies pitched' }],
    }));
    expect(res.status).toBe(201);
    const data = p.initiative.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: 'ADA-compliant site builds', bet: 'ADA audits sell', nightmare: 'No one buys', prevention: 'Pitch agencies',
      repair: 'Sell the audit alone', cost_of_waiting: 'Lost quarter', stop_condition: 'Fewer than 2 quotes by March 31',
      check_every_days: 14, next_decision: 'Pick two agencies', status: 'proposed', health_reason: 'fresh',
      owner_id: USER, client_id: OTHER, sort_order: 2, created_by_id: USER, activated_at: null, closed_at: null,
    });
    expect(data.check_date).toEqual(new Date('2027-01-15'));
    expect(data.numbers.create).toHaveLength(2);
    expect(data.numbers.create.map((n: { position: number }) => n.position)).toEqual([0, 1]);
    expect(data.numbers.create[0]).toMatchObject({ label: 'ADA quotes sent', unit: 'count', direction: 'up', target_value: 10, source: 'manual' });
  });

  it('accepts a proposed initiative with no numbers', async () => {
    p.initiative.create.mockResolvedValue(row());
    const res = await POST(req('POST', { name: 'Idea' }));
    expect(res.status).toBe(201);
    expect(p.initiative.create.mock.calls[0][0].data.numbers.create).toEqual([]);
  });

  it('accepts exactly three numbers and rejects four with 409 number_cap', async () => {
    p.initiative.create.mockResolvedValue(row());
    const three = await POST(req('POST', { name: 'x', numbers: [validNumber, validNumber, validNumber] }));
    expect(three.status).toBe(201);
    p.initiative.create.mockClear();
    const four = await POST(req('POST', { name: 'x', numbers: [validNumber, validNumber, validNumber, validNumber] }));
    expect(four.status).toBe(409);
    expect((await four.json()).code).toBe('number_cap');
    expect(p.initiative.create).not.toHaveBeenCalled();
  });

  it('requires a target and a target date on a number, and a valid unit, direction and source length', async () => {
    for (const bad of [
      { ...validNumber, target_value: undefined },
      { ...validNumber, target_by: undefined },
      { ...validNumber, unit: 'widgets' },
      { ...validNumber, direction: 'sideways' },
      { ...validNumber, source: 'x'.repeat(41) },
      { ...validNumber, label: 'x'.repeat(121) },
    ]) {
      const res = await POST(req('POST', { name: 'x', numbers: [bad] }));
      expect(res.status).toBe(400);
    }
    expect(p.initiative.create).not.toHaveBeenCalled();
  });

  it('enforces the field length limits', async () => {
    expect((await POST(req('POST', { name: 'x'.repeat(121) }))).status).toBe(400);
    expect((await POST(req('POST', { name: 'x', next_decision: 'x'.repeat(301) }))).status).toBe(400);
    expect((await POST(req('POST', { name: 'x', health_reason: 'x'.repeat(201) }))).status).toBe(400);
  });

  it('creating active with no bet or no number is refused, and with both it sets activated_at', async () => {
    p.initiative.count.mockResolvedValue(0);
    const noBet = await POST(req('POST', { name: 'x', status: 'active', numbers: [validNumber] }));
    expect(noBet.status).toBe(422);
    expect((await noBet.json()).code).toBe('bet_required');
    const noNumber = await POST(req('POST', { name: 'x', status: 'active', bet: 'b' }));
    expect(noNumber.status).toBe(422);
    expect((await noNumber.json()).code).toBe('number_required');
    p.initiative.create.mockResolvedValue(row());
    const ok = await POST(req('POST', { name: 'x', status: 'active', bet: 'b', numbers: [validNumber] }));
    expect(ok.status).toBe(201);
    expect(p.initiative.create.mock.calls[0][0].data.activated_at).toBeInstanceOf(Date);
  });

  it('creating a sixth active initiative answers 409 initiative_cap naming the five', async () => {
    p.initiative.count.mockResolvedValue(5);
    const five = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: `id-${i}`, name }));
    p.initiative.findMany.mockResolvedValue(five);
    const res = await POST(req('POST', { name: 'six', status: 'active', bet: 'b', numbers: [validNumber] }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe('initiative_cap');
    expect(body.active).toEqual(five);
    expect(body.error).toContain('A, B, C, D, E');
  });

  it('writes need the pm or admin role', async () => {
    (requireRole as Mock).mockImplementation(() => { throw new Error('forbidden'); });
    const res = await POST(req('POST', { name: 'x' }));
    expect(res.status).toBe(500);
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['pm', 'admin']);
    expect(p.initiative.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/initiatives/[id]', () => {
  it('returns the initiative with numbers ordered by position and the latest check-in', async () => {
    p.initiative.findFirst.mockResolvedValue(row({
      numbers: [numberRow({ id: 'b', position: 1, label: 'Second' }), numberRow({ id: 'a', position: 0, label: 'First' })],
      check_ins: [{ id: 'c1', initiative_id: INIT, health: 'behind', note: 'slow', author_id: USER, created_at: new Date('2026-11-10') }],
    }));
    const body = await (await GET_ONE(req('GET'), ctx())).json();
    expect(body.numbers.map((n: { label: string }) => n.label)).toEqual(['First', 'Second']);
    expect(body.latest_check_in).toMatchObject({ health: 'behind', note: 'slow' });
  });
  it('404s for a missing or deleted one', async () => {
    p.initiative.findFirst.mockResolvedValue(null);
    expect((await GET_ONE(req('GET'), ctx())).status).toBe(404);
    expect(p.initiative.findFirst.mock.calls[0][0].where).toEqual({ id: INIT, is_deleted: false });
  });
});

describe('PATCH /api/initiatives/[id]', () => {
  const existing = (o: Record<string, unknown> = {}) => ({ id: INIT, status: 'proposed', bet: 'a bet', activated_at: null, _count: { numbers: 1 }, ...o });

  it('updates every plain field', async () => {
    p.initiative.findFirst.mockResolvedValue(existing());
    p.client.findUnique.mockResolvedValue({ id: OTHER });
    p.user.findUnique.mockResolvedValue({ id: OTHER });
    const fields = {
      name: 'New name', bet: 'New bet', nightmare: 'n', prevention: 'p', repair: 'r', cost_of_waiting: 'c', stop_condition: 's',
      check_every_days: 7, next_decision: 'Decide X', health_reason: 'hr', owner_id: OTHER, client_id: OTHER, sort_order: 3,
      closed_reason: null,
    };
    const res = await PATCH(req('PATCH', { ...fields, check_date: '2027-02-01' }), ctx());
    expect(res.status).toBe(200);
    const first = p.initiative.update.mock.calls[0][0];
    expect(first.data).toMatchObject(fields);
    expect(first.data.check_date).toEqual(new Date('2027-02-01'));
  });

  it('activating sets activated_at; done and stopped set closed_at; leaving a closed status clears it', async () => {
    p.initiative.findFirst.mockResolvedValue(existing());
    p.initiative.count.mockResolvedValue(2);
    await PATCH(req('PATCH', { status: 'active' }), ctx());
    expect(p.initiative.update.mock.calls[0][0].data).toMatchObject({ status: 'active', closed_at: null });
    expect(p.initiative.update.mock.calls[0][0].data.activated_at).toBeInstanceOf(Date);

    p.initiative.update.mockClear();
    p.initiative.findFirst.mockResolvedValue(existing({ status: 'active' }));
    await PATCH(req('PATCH', { status: 'stopped', closed_reason: 'Stop condition met' }), ctx());
    const stopped = p.initiative.update.mock.calls[0][0].data;
    expect(stopped.status).toBe('stopped');
    expect(stopped.closed_at).toBeInstanceOf(Date);
    expect(stopped.closed_reason).toBe('Stop condition met');

    p.initiative.update.mockClear();
    p.initiative.findFirst.mockResolvedValue(existing({ status: 'done' }));
    await PATCH(req('PATCH', { status: 'paused' }), ctx());
    expect(p.initiative.update.mock.calls[0][0].data.closed_at).toBeNull();
  });

  it('activating a sixth answers 409 initiative_cap and writes nothing', async () => {
    p.initiative.findFirst.mockResolvedValue(existing());
    p.initiative.count.mockResolvedValue(5);
    p.initiative.findMany.mockResolvedValue([{ id: '1', name: 'A' }]);
    const res = await PATCH(req('PATCH', { status: 'active' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('initiative_cap');
    expect(p.initiative.update).not.toHaveBeenCalled();
  });

  it('the cap count leaves out the initiative itself', async () => {
    p.initiative.findFirst.mockResolvedValue(existing());
    p.initiative.count.mockResolvedValue(4);
    await PATCH(req('PATCH', { status: 'active' }), ctx());
    expect(p.initiative.count.mock.calls[0][0].where).toEqual({ status: 'active', is_deleted: false, id: { not: INIT } });
  });

  it('activating with an empty bet or no number is refused', async () => {
    p.initiative.count.mockResolvedValue(0);
    p.initiative.findFirst.mockResolvedValue(existing({ bet: '   ' }));
    const noBet = await PATCH(req('PATCH', { status: 'active' }), ctx());
    expect(noBet.status).toBe(422);
    expect((await noBet.json()).code).toBe('bet_required');
    p.initiative.findFirst.mockResolvedValue(existing({ _count: { numbers: 0 } }));
    const noNumber = await PATCH(req('PATCH', { status: 'active' }), ctx());
    expect(noNumber.status).toBe(422);
    expect((await noNumber.json()).code).toBe('number_required');
    expect(p.initiative.update).not.toHaveBeenCalled();
  });

  it('emptying the bet of an active initiative is refused', async () => {
    p.initiative.findFirst.mockResolvedValue(existing({ status: 'active' }));
    p.initiative.count.mockResolvedValue(1);
    const res = await PATCH(req('PATCH', { bet: '' }), ctx());
    expect(res.status).toBe(422);
  });

  it('changing check_date recomputes health', async () => {
    p.initiative.findFirst.mockResolvedValue(existing());
    await PATCH(req('PATCH', { check_date: '2027-02-01' }), ctx());
    expect(p.initiative.update).toHaveBeenCalledTimes(2);
    expect(p.initiative.update.mock.calls[1][0].data).toHaveProperty('health');
  });

  it('404s when missing', async () => {
    p.initiative.findFirst.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { name: 'x' }), ctx())).status).toBe(404);
  });
});

describe('DELETE /api/initiatives/[id]', () => {
  it('soft deletes', async () => {
    p.initiative.findFirst.mockResolvedValue({ id: INIT });
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(p.initiative.update).toHaveBeenCalledWith({ where: { id: INIT }, data: { is_deleted: true } });
  });
  it('404s when already gone', async () => {
    p.initiative.findFirst.mockResolvedValue(null);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(404);
  });
});

describe('numbers', () => {
  it('adds a number to an initiative with room, in the next position', async () => {
    p.initiative.findFirst.mockResolvedValue({ id: INIT, _count: { numbers: 2 } });
    p.initiativeNumber.create.mockResolvedValue(numberRow({ position: 2 }));
    const res = await POST_NUMBER(req('POST', validNumber), ctx());
    expect(res.status).toBe(201);
    expect(p.initiativeNumber.create.mock.calls[0][0].data).toMatchObject({ initiative_id: INIT, position: 2, source: 'manual' });
    expect((await res.json()).target_value).toBe(10);
  });

  it('adding a fourth is 409 number_cap', async () => {
    p.initiative.findFirst.mockResolvedValue({ id: INIT, _count: { numbers: 3 } });
    const res = await POST_NUMBER(req('POST', validNumber), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('number_cap');
    expect(p.initiativeNumber.create).not.toHaveBeenCalled();
  });

  it('a number without a target is refused', async () => {
    const res = await POST_NUMBER(req('POST', { label: 'x', unit: 'count', direction: 'up' }), ctx());
    expect(res.status).toBe(400);
  });

  it('PATCH updates a number and recomputes health; 404 for another initiative\'s number', async () => {
    p.initiativeNumber.findFirst.mockResolvedValue({ ...numberRow(), initiative: { status: 'proposed' } });
    p.initiativeNumber.update.mockResolvedValue(numberRow({ target_value: '20.00' }));
    const res = await PATCH_NUMBER(req('PATCH', { target_value: 20, target_by: '2027-06-30', label: 'New' }), ctx({ numberId: NUM }));
    expect(res.status).toBe(200);
    expect(p.initiativeNumber.update.mock.calls[0][0].data).toMatchObject({ target_value: 20, label: 'New' });
    expect(p.initiative.update).toHaveBeenCalled();
    p.initiativeNumber.findFirst.mockResolvedValue(null);
    expect((await PATCH_NUMBER(req('PATCH', { label: 'x' }), ctx({ numberId: NUM }))).status).toBe(404);
  });

  it('DELETE removes a number but not the last one of an active initiative', async () => {
    p.initiativeNumber.findFirst.mockResolvedValue({ ...numberRow(), initiative: { status: 'active' } });
    p.initiativeNumber.count.mockResolvedValue(1);
    const refused = await DELETE_NUMBER(req('DELETE'), ctx({ numberId: NUM }));
    expect(refused.status).toBe(422);
    expect(p.initiativeNumber.delete).not.toHaveBeenCalled();
    p.initiativeNumber.count.mockResolvedValue(2);
    const ok = await DELETE_NUMBER(req('DELETE'), ctx({ numberId: NUM }));
    expect(ok.status).toBe(200);
    expect(p.initiativeNumber.delete).toHaveBeenCalledWith({ where: { id: NUM } });
  });
});

describe('readings', () => {
  it('the first reading becomes the baseline and the last value; health stays unchecked', async () => {
    const at = '2026-11-05T00:00:00.000Z';
    p.initiativeNumber.findFirst.mockResolvedValue(numberRow());
    p.initiativeReading.create.mockResolvedValue({ id: 'r1', number_id: NUM, value: '3.00', read_at: new Date(at), source: 'manual' });
    p.initiativeNumber.update.mockResolvedValue(numberRow({ baseline_value: '3.00', last_value: '3.00' }));
    p.initiative.findUnique.mockResolvedValue(row({
      check_date: new Date('2027-01-01'),
      numbers: [numberRow({ baseline_value: '3.00', baseline_at: new Date(at), last_value: '3.00', last_read_at: new Date(at) })],
    }));
    const res = await POST_READING(req('POST', { number_id: NUM, value: 3, read_at: at }), ctx());
    expect(res.status).toBe(201);
    expect(p.initiativeNumber.update.mock.calls[0][0].data).toEqual({
      last_value: 3, last_read_at: new Date(at), baseline_value: 3, baseline_at: new Date(at),
    });
    const stored = p.initiative.update.mock.calls[0][0].data;
    expect(stored.health).toBe('unchecked');
    const body = await res.json();
    expect(body.reading.value).toBe(3);
    expect(body.number.baseline_value).toBe(3);
  });

  it('a later reading updates last_value and recomputes health to behind', async () => {
    const base = new Date('2026-11-01T00:00:00Z');
    const at = '2026-11-15T00:00:00.000Z';
    const existingNumber = numberRow({ baseline_value: '0.00', baseline_at: base, last_value: '0.00', last_read_at: base, target_by: new Date('2026-11-29') });
    p.initiativeNumber.findFirst.mockResolvedValue(existingNumber);
    p.initiativeReading.create.mockResolvedValue({ id: 'r2', number_id: NUM, value: '1.00', read_at: new Date(at), source: 'chat' });
    p.initiativeNumber.update.mockResolvedValue({ ...existingNumber, last_value: '1.00', last_read_at: new Date(at) });
    p.initiative.findUnique.mockResolvedValue(row({
      check_date: new Date('2099-01-01'),
      numbers: [{ ...existingNumber, target_value: '10.00', last_value: '1.00', last_read_at: new Date(at) }],
    }));
    const res = await POST_READING(req('POST', { number_id: NUM, value: 1, read_at: at, source: 'chat' }), ctx());
    expect(res.status).toBe(201);
    expect(p.initiativeNumber.update.mock.calls[0][0].data).toEqual({ last_value: 1, last_read_at: new Date(at) });
    const stored = p.initiative.update.mock.calls[0][0].data;
    expect(stored.health).toBe('behind');
    expect(stored.health_reason).toContain('ADA quotes sent is behind pace');
  });

  it('a back-dated reading does not replace a newer last value', async () => {
    const newer = new Date('2026-11-20T00:00:00Z');
    p.initiativeNumber.findFirst.mockResolvedValue(numberRow({ baseline_value: '0.00', baseline_at: new Date('2026-11-01'), last_value: '5.00', last_read_at: newer }));
    p.initiativeReading.create.mockResolvedValue({ id: 'r3', number_id: NUM, value: '2.00', read_at: new Date('2026-11-10'), source: 'manual' });
    await POST_READING(req('POST', { number_id: NUM, value: 2, read_at: '2026-11-10T00:00:00Z' }), ctx());
    expect(p.initiativeNumber.update).not.toHaveBeenCalled();
  });

  it('404s for a number of another initiative', async () => {
    p.initiativeNumber.findFirst.mockResolvedValue(null);
    expect((await POST_READING(req('POST', { number_id: NUM, value: 1 }), ctx())).status).toBe(404);
  });
});

describe('check-ins', () => {
  it('records a check-in as the caller and recomputes health from it', async () => {
    p.initiative.findFirst.mockResolvedValue({ id: INIT, check_every_days: null });
    const created = new Date();
    p.initiativeCheckIn.create.mockResolvedValue({ id: 'c1', initiative_id: INIT, health: 'on_track', note: 'Two quotes out', author_id: USER, created_at: created });
    p.initiative.findUnique.mockResolvedValue(row({
      check_date: new Date('2099-01-01'),
      numbers: [numberRow()],
      check_ins: [{ id: 'c1', initiative_id: INIT, health: 'on_track', note: 'Two quotes out', author_id: USER, created_at: created }],
    }));
    const res = await POST_CHECK_IN(req('POST', { health: 'on_track', note: 'Two quotes out' }), ctx());
    expect(res.status).toBe(201);
    expect(p.initiativeCheckIn.create.mock.calls[0][0].data).toEqual({ initiative_id: INIT, health: 'on_track', note: 'Two quotes out', author_id: USER });
    const stored = p.initiative.update.mock.calls[0][0].data;
    expect(stored.health).toBe('on_track');
    expect(stored.health_reason).toContain('Two quotes out');
  });

  it('rolls check_date forward when the initiative has a cadence', async () => {
    p.initiative.findFirst.mockResolvedValue({ id: INIT, check_every_days: 14 });
    p.initiativeCheckIn.create.mockResolvedValue({ id: 'c1', initiative_id: INIT, health: 'behind', note: null, author_id: USER, created_at: new Date() });
    await POST_CHECK_IN(req('POST', { health: 'behind' }), ctx());
    const first = p.initiative.update.mock.calls[0][0];
    expect(first.data.check_date).toBeInstanceOf(Date);
    expect(first.data.check_date.getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
  });

  it('refuses a note over 300 characters and a bad health', async () => {
    expect((await POST_CHECK_IN(req('POST', { health: 'on_track', note: 'x'.repeat(301) }), ctx())).status).toBe(400);
    expect((await POST_CHECK_IN(req('POST', { health: 'great' }), ctx())).status).toBe(400);
    expect(p.initiativeCheckIn.create).not.toHaveBeenCalled();
  });

  it('404s for a missing initiative', async () => {
    p.initiative.findFirst.mockResolvedValue(null);
    expect((await POST_CHECK_IN(req('POST', { health: 'on_track' }), ctx())).status).toBe(404);
  });
});

describe('second check fixes: owner default, one-number minimum, number fields, health on read', () => {
  const MIKE = '55555555-5555-4555-8555-555555555555';
  const existing = (o: Record<string, unknown> = {}) => ({ id: INIT, status: 'proposed', bet: 'a bet', activated_at: null, _count: { numbers: 1 }, ...o });

  it('a create with no owner makes Mike the owner, looked up by his email, even when someone else creates it', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: OTHER, email: 'staff@x.com', role: 'pm' });
    p.user.findUnique.mockResolvedValue({ id: MIKE });
    p.initiative.create.mockResolvedValue(row());
    const res = await POST(req('POST', { name: 'Idea' }));
    expect(res.status).toBe(201);
    expect(p.user.findUnique).toHaveBeenCalledWith({ where: { email: 'mike@becomeindelible.com' }, select: { id: true } });
    expect(p.initiative.create.mock.calls[0][0].data).toMatchObject({ owner_id: MIKE, created_by_id: OTHER });
  });

  it('an explicit owner is kept over the default', async () => {
    p.user.findUnique.mockResolvedValue({ id: OTHER });
    p.initiative.create.mockResolvedValue(row());
    await POST(req('POST', { name: 'Idea', owner_id: OTHER }));
    expect(p.initiative.create.mock.calls[0][0].data.owner_id).toBe(OTHER);
  });

  it.each(['paused', 'done', 'stopped'])('creating as %s with no number is 422 number_required, and with one it is created', async (status) => {
    p.initiative.create.mockResolvedValue(row({ status }));
    const none = await POST(req('POST', { name: 'x', bet: 'b', status }));
    expect(none.status).toBe(422);
    expect((await none.json()).code).toBe('number_required');
    expect(p.initiative.create).not.toHaveBeenCalled();
    const one = await POST(req('POST', { name: 'x', bet: 'b', status, numbers: [validNumber] }));
    expect(one.status).toBe(201);
  });

  it.each(['paused', 'done', 'stopped'])('moving a proposed initiative with no number to %s is 422 and writes nothing', async (status) => {
    p.initiative.findFirst.mockResolvedValue(existing({ _count: { numbers: 0 } }));
    const res = await PATCH(req('PATCH', { status }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('number_required');
    expect(p.initiative.update).not.toHaveBeenCalled();
  });

  it('moving back to proposed with no number is allowed', async () => {
    p.initiative.findFirst.mockResolvedValue(existing({ status: 'paused', _count: { numbers: 0 } }));
    const res = await PATCH(req('PATCH', { status: 'proposed' }), ctx());
    expect(res.status).toBe(200);
  });

  it.each(['paused', 'done', 'stopped', 'active'])('the last number of a %s initiative cannot be removed', async (status) => {
    p.initiativeNumber.findFirst.mockResolvedValue({ ...numberRow(), initiative: { status } });
    p.initiativeNumber.count.mockResolvedValue(1);
    const res = await DELETE_NUMBER(req('DELETE'), ctx({ numberId: NUM }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('number_required');
    expect(p.initiativeNumber.delete).not.toHaveBeenCalled();
  });

  it('the last number of a proposed initiative can be removed', async () => {
    p.initiativeNumber.findFirst.mockResolvedValue({ ...numberRow(), initiative: { status: 'proposed' } });
    p.initiativeNumber.count.mockResolvedValue(1);
    const res = await DELETE_NUMBER(req('DELETE'), ctx({ numberId: NUM }));
    expect(res.status).toBe(200);
    expect(p.initiativeNumber.delete).toHaveBeenCalledWith({ where: { id: NUM } });
  });

  it('PATCH on a number stores and returns every editable field', async () => {
    p.initiativeNumber.findFirst.mockResolvedValue({ ...numberRow(), initiative: { status: 'active' } });
    const body = {
      label: 'Proposals sent', unit: 'dollars', direction: 'down', baseline_value: 4, baseline_at: '2026-11-01T00:00:00Z',
      target_value: 1, target_by: '2027-06-30', source: 'citadel:proposals_sent:ada', position: 2,
    };
    p.initiativeNumber.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => numberRow(data));
    const res = await PATCH_NUMBER(req('PATCH', body), ctx({ numberId: NUM }));
    expect(res.status).toBe(200);
    const data = p.initiativeNumber.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      label: 'Proposals sent', unit: 'dollars', direction: 'down', baseline_value: 4, target_value: 1,
      source: 'citadel:proposals_sent:ada', position: 2,
    });
    expect(data.baseline_at).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(data.target_by).toEqual(new Date('2027-06-30'));
    expect(await res.json()).toMatchObject({
      label: 'Proposals sent', unit: 'dollars', direction: 'down', baseline_value: 4, target_value: 1,
      source: 'citadel:proposals_sent:ada', position: 2,
    });
    const returned = await PATCH_NUMBER(req('PATCH', body), ctx({ numberId: NUM }));
    const json = await returned.json();
    expect(new Date(json.baseline_at)).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(new Date(json.target_by)).toEqual(new Date('2027-06-30'));
  });

  it('PATCH on a number rejects a bad unit or direction', async () => {
    p.initiativeNumber.findFirst.mockResolvedValue({ ...numberRow(), initiative: { status: 'active' } });
    expect((await PATCH_NUMBER(req('PATCH', { unit: 'miles' }), ctx({ numberId: NUM }))).status).toBe(400);
    expect((await PATCH_NUMBER(req('PATCH', { direction: 'sideways' }), ctx({ numberId: NUM }))).status).toBe(400);
    expect(p.initiativeNumber.update).not.toHaveBeenCalled();
  });

  it('a read recomputes health when the check date passed with nothing new, and stores it', async () => {
    const measured = numberRow({
      baseline_value: '0.00', baseline_at: new Date('2026-01-01'), last_value: '9.00', last_read_at: new Date('2026-02-01'),
      target_value: '10.00', target_by: new Date('2026-12-31'),
    });
    const stale = row({ status: 'active', health: 'on_track', health_reason: 'old', check_date: new Date('2026-03-01'), numbers: [measured] });
    p.initiative.findFirst.mockResolvedValue(stale);
    const one = await (await GET_ONE(req('GET'), ctx())).json();
    expect(one.health).toBe('unchecked');
    expect(one.health_reason).toContain('2026-03-01');
    expect(p.initiative.update).toHaveBeenCalledWith({ where: { id: INIT }, data: { health: 'unchecked', health_reason: one.health_reason } });

    p.initiative.update.mockClear();
    p.initiative.findMany.mockResolvedValue([stale]);
    const list = await (await GET(req('GET'))).json();
    expect(list.initiatives[0].health).toBe('unchecked');
    expect(p.initiative.update).toHaveBeenCalledTimes(1);
  });

  it('a read with health unchanged writes nothing', async () => {
    p.initiative.findFirst.mockResolvedValue(row({ health: 'unchecked', health_reason: 'Not checked yet: no reading after the baseline' }));
    await GET_ONE(req('GET'), ctx());
    expect(p.initiative.update).not.toHaveBeenCalled();
  });
});
