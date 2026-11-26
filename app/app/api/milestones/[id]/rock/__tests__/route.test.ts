import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { milestone: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() }, projectTeamAssignment: { findFirst: vi.fn() } },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const find = prisma.milestone.findUnique as Mock;
const update = prisma.milestone.update as Mock;
const count = prisma.milestone.count as Mock;
const team = prisma.projectTeamAssignment.findFirst as Mock;
const ID = '11111111-1111-4111-8111-111111111111';
const project = { id: 'p1', is_deleted: false, next_step_text: null, next_step_owner_id: null, next_step_at: null };
const row = (o: Record<string, unknown> = {}) => ({
  id: ID, name: 'Launch', project_id: 'p1', phase_id: null, target_date: null, completed_at: null, notes: null, sort_order: 0,
  billing_amount: null, billing_status: 'pending', rock_quarter: null, rock_done_when: null,
  created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), project, ...o,
});
const req = (body: object) => new NextRequest(`http://localhost/api/milestones/${ID}/rock`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm' });
  update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
  count.mockResolvedValue(0);
});

describe('PATCH /api/milestones/[id]/rock', () => {
  it('hides a milestone from a tech user who is not on its project, as the full milestone PATCH does', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: 'u2', role: 'tech' });
    find.mockResolvedValue(row());
    team.mockResolvedValue(null);
    const res = await PATCH(req({ rock_quarter: '2027-Q1', rock_done_when: 'Done' }), ctx);
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets a tech user on the project mark it', async () => {
    (requireAuth as Mock).mockResolvedValue({ userId: 'u2', role: 'tech' });
    find.mockResolvedValue(row());
    team.mockResolvedValue({ id: 'a1' });
    const res = await PATCH(req({ rock_quarter: '2027-Q1', rock_done_when: 'Done' }), ctx);
    expect(res.status).toBe(200);
  });

  it('marks a rock with a done line and defaults the target date to the quarter end', async () => {
    find.mockResolvedValue(row());
    const res = await PATCH(req({ rock_quarter: '2027-Q1', rock_done_when: '  Three ADA quotes are out  ' }), ctx);
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.rock_quarter).toBe('2027-Q1');
    expect(data.rock_done_when).toBe('Three ADA quotes are out');
    expect(new Date(data.target_date).toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('writes only the rock fields, never billing', async () => {
    find.mockResolvedValue(row());
    await PATCH(req({ rock_quarter: '2027-Q1', rock_done_when: 'Done' }), ctx);
    expect(Object.keys(update.mock.calls[0][0].data).sort()).toEqual(['rock_done_when', 'rock_quarter', 'target_date']);
  });

  it('refuses any other field with a 400', async () => {
    find.mockResolvedValue(row());
    const res = await PATCH(req({ rock_quarter: '2027-Q1', rock_done_when: 'Done', billing_amount: 5 }), ctx);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('needs a done line when marking, but keeps an existing one', async () => {
    find.mockResolvedValue(row());
    const res = await PATCH(req({ rock_quarter: '2027-Q1' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('rock_needs_done_when');
    find.mockResolvedValue(row({ rock_quarter: '2027-Q1', rock_done_when: 'Old line', target_date: new Date('2027-02-01') }));
    const ok = await PATCH(req({ rock_quarter: '2027-Q2' }), ctx);
    expect(ok.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ rock_quarter: '2027-Q2', rock_done_when: 'Old line' });
  });

  it('answers 409 rock_cap when the quarter has seven others', async () => {
    find.mockResolvedValue(row());
    count.mockResolvedValue(7);
    const res = await PATCH(req({ rock_quarter: '2027-Q1', rock_done_when: 'Done' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rock_cap');
  });

  it('unmarks with null and clears the done line', async () => {
    find.mockResolvedValue(row({ rock_quarter: '2027-Q1', rock_done_when: 'Done' }));
    const res = await PATCH(req({ rock_quarter: null }), ctx);
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ rock_quarter: null, rock_done_when: null });
  });

  it('rejects a malformed quarter and a missing or deleted milestone', async () => {
    find.mockResolvedValue(row());
    expect((await PATCH(req({ rock_quarter: '2027-5', rock_done_when: 'x' }), ctx)).status).toBe(400);
    find.mockResolvedValue(null);
    expect((await PATCH(req({ rock_quarter: null }), ctx)).status).toBe(404);
    find.mockResolvedValue(row({ project: { ...project, is_deleted: true } }));
    expect((await PATCH(req({ rock_quarter: null }), ctx)).status).toBe(404);
  });
});
