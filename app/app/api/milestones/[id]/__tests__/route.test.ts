import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    projectTeamAssignment: {
      findFirst: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockFindUnique = prisma.milestone.findUnique as Mock;
const mockUpdate = prisma.milestone.update as Mock;
const mockCount = prisma.milestone.count as Mock;

const ID = '11111111-1111-4111-8111-111111111111';

function baseMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: 'Launch',
    project_id: 'p1',
    phase_id: null,
    target_date: null,
    completed_at: null,
    notes: null,
    sort_order: 0,
    billing_amount: null,
    billing_status: 'pending',
    triggered_at: null,
    triggered_by_id: null,
    invoiced_at: null,
    invoiced_by_id: null,
    rock_quarter: null,
    rock_done_when: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    project: { id: 'p1', is_deleted: false },
    ...overrides,
  };
}

function patch(body: unknown) {
  const request = new NextRequest(`http://localhost/api/milestones/${ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ id: ID }) });
}

describe('PATCH /api/milestones/[id] quarter priorities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue({ userId: 'u1', email: 'a@b.c', role: 'admin' });
    mockCount.mockResolvedValue(0);
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...(((await mockFindUnique.mock.results.at(-1)?.value) as object) ?? baseMilestone()),
      ...data,
    }));
  });

  it('marks a rock and defaults the target date to the last day of the quarter', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    const res = await patch({ rock_quarter: '2027-Q1', rock_done_when: '  Site is live  ' });
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.rock_quarter).toBe('2027-Q1');
    expect(data.rock_done_when).toBe('Site is live');
    expect((data.target_date as Date).toISOString()).toBe('2027-03-31T00:00:00.000Z');
    const body = await res.json();
    expect(body.rock_quarter).toBe('2027-Q1');
    expect(body.rock_done_when).toBe('Site is live');
    expect(body).toHaveProperty('rock_decision');
    expect(['done', 'off_track', 'on_track']).toContain(body.rock_status);
  });

  it('keeps an existing target date', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone({ target_date: new Date('2027-02-15T00:00:00Z') }));
    await patch({ rock_quarter: '2027-Q1', rock_done_when: 'Site is live' });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.target_date).toBeUndefined();
    expect(data.rock_done_when).toBe('Site is live');
  });

  it('keeps a target date sent in the same request', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    await patch({ rock_quarter: '2027-Q1', rock_done_when: 'Live', target_date: '2027-02-01T00:00:00.000Z' });
    const data = mockUpdate.mock.calls[0][0].data;
    expect((data.target_date as Date).toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('returns 409 rock_cap when seven others hold the quarter', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    mockCount.mockResolvedValue(7);
    const res = await patch({ rock_quarter: '2027-Q1', rock_done_when: 'Live' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('rock_cap');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows the seventh rock when six others hold the quarter', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    mockCount.mockResolvedValue(6);
    const res = await patch({ rock_quarter: '2027-Q1', rock_done_when: 'Live' });
    expect(res.status).toBe(200);
  });

  it('counts only live projects and excludes the milestone itself', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone({ rock_quarter: '2027-Q1', target_date: new Date('2027-03-31') }));
    const res = await patch({ rock_quarter: '2027-Q1' });
    expect(res.status).toBe(200);
    expect(mockCount).toHaveBeenCalledWith({
      where: { rock_quarter: '2027-Q1', id: { not: ID }, project: { is_deleted: false } },
    });
  });

  it('rejects a bad quarter with 400', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    for (const bad of ['2027-Q5', '2027Q1', 'next', '']) {
      const res = await patch({ rock_quarter: bad, rock_done_when: 'Live' });
      expect(res.status).toBe(400);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('requires a done line to mark a milestone', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    for (const body of [{ rock_quarter: '2027-Q1' }, { rock_quarter: '2027-Q1', rock_done_when: '   ' }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('rock_needs_done_when');
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses to blank the done line on an existing rock', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({ rock_quarter: '2027-Q1', rock_done_when: 'Live', target_date: new Date('2027-03-31') })
    );
    for (const value of [null, '', '   ']) {
      const res = await patch({ rock_done_when: value });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('rock_needs_done_when');
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows re-sending the same quarter on a rock without a done line', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({ rock_quarter: '2027-Q1', rock_done_when: 'Live', target_date: new Date('2027-03-31') })
    );
    const res = await patch({ rock_quarter: '2027-Q1' });
    expect(res.status).toBe(200);
  });

  it('exposes rock_decision when the next step has waited on Mike over 7 days', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({
        rock_quarter: '2099-Q1',
        rock_done_when: 'Live',
        target_date: new Date('2099-03-31T00:00:00Z'),
        project: {
          id: 'p1',
          is_deleted: false,
          next_step_text: 'approve the ADA audit outline',
          next_step_owner_id: '3ecfb7be-20bb-43cb-9b4d-31c44337dc81',
          next_step_at: new Date(Date.now() - 10 * 86400000),
        },
      })
    );
    const body = await (await patch({ name: 'x' })).json();
    expect(body.rock_status).toBe('off_track');
    expect(body.rock_decision).toMatch(/^Waiting on you since [A-Z][a-z]{2} \d{1,2}: approve the ADA audit outline$/);
  });

  it('unmarking clears both rock fields', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({ rock_quarter: '2027-Q1', rock_done_when: 'Done', target_date: new Date('2027-03-31') })
    );
    const res = await patch({ rock_quarter: null });
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.rock_quarter).toBeNull();
    expect(data.rock_done_when).toBeNull();
    const body = await res.json();
    expect(body.rock_status).toBeNull();
  });

  it('refuses to clear the target date on a rock', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({ rock_quarter: '2027-Q1', target_date: new Date('2027-03-31') })
    );
    const res = await patch({ target_date: null });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('rock_needs_target_date');
  });

  it('refuses to clear the target date while marking', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    const res = await patch({ rock_quarter: '2027-Q1', target_date: null });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('rock_needs_target_date');
  });

  it('allows clearing the target date on a non-rock', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone({ target_date: new Date('2027-03-31') }));
    const res = await patch({ target_date: null });
    expect(res.status).toBe(200);
  });

  it('refuses a done-when line on a milestone that is not a rock', async () => {
    mockFindUnique.mockResolvedValue(baseMilestone());
    const res = await patch({ rock_done_when: 'Site is live' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('not_a_rock');
  });

  it('edits the done-when line of an existing rock on its own', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({ rock_quarter: '2027-Q1', target_date: new Date('2027-03-31') })
    );
    const res = await patch({ rock_done_when: 'Contract signed' });
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.rock_done_when).toBe('Contract signed');
    expect(mockCount).not.toHaveBeenCalled();
  });

  it('reports off_track for a past target date and done when completed', async () => {
    mockFindUnique.mockResolvedValue(
      baseMilestone({ rock_quarter: '2020-Q1', target_date: new Date('2020-03-31T00:00:00Z') })
    );
    expect((await (await patch({ name: 'x' })).json()).rock_status).toBe('off_track');
    mockFindUnique.mockResolvedValue(
      baseMilestone({
        rock_quarter: '2020-Q1',
        target_date: new Date('2020-03-31T00:00:00Z'),
        completed_at: new Date('2020-03-01T00:00:00Z'),
      })
    );
    expect((await (await patch({ name: 'x' })).json()).rock_status).toBe('done');
  });
});
