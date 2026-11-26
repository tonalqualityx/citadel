import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    initiative: { findMany: vi.fn(), update: vi.fn() },
    initiativeReading: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    recurringWork: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    milestone: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { focusOrder, isCheckDue, isStopCheckDue, loadInitiativeBoard, stopNumbers } from '../board';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const NOW = new Date('2026-11-26T15:00:00Z');
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const D = 'aaaaaaaa-0000-4000-8000-000000000004';
const N1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const PROJ = 'cccccccc-0000-4000-8000-000000000001';

describe('isCheckDue', () => {
  const base = { status: 'active', check_date: '2026-11-26', latest_check_in: null };
  it('is due on the check date itself and after it, with no check-in since', () => {
    expect(isCheckDue(base, NOW)).toBe(true);
    expect(isCheckDue({ ...base, check_date: '2026-11-20' }, NOW)).toBe(true);
    expect(isCheckDue({ ...base, check_date: '2026-11-27' }, NOW)).toBe(false);
  });
  it('is not due once Mike checked in on or after the check date', () => {
    expect(isCheckDue({ ...base, check_date: '2026-11-20', latest_check_in: { created_at: '2026-11-21T10:00:00Z' } }, NOW)).toBe(false);
    expect(isCheckDue({ ...base, check_date: '2026-11-20', latest_check_in: { created_at: '2026-11-19T10:00:00Z' } }, NOW)).toBe(true);
  });
  it('asks nothing of a proposed, paused or closed initiative, or one with no check date', () => {
    for (const status of ['proposed', 'paused', 'done', 'stopped']) expect(isCheckDue({ ...base, status }, NOW)).toBe(false);
    expect(isCheckDue({ ...base, check_date: null }, NOW)).toBe(false);
  });
});

describe('isStopCheckDue', () => {
  const missed = { target_by: '2026-11-20', pace: 'behind' as const };
  const base = { status: 'active', check_date: null, stop_condition: 'Fewer than 2 builds by Nov 20', latest_check_in: null, numbers: [missed] };
  it('comes due when a number reached its target date without meeting its target', () => {
    expect(isStopCheckDue(base, NOW)).toBe(true);
    expect(isStopCheckDue({ ...base, numbers: [{ ...missed, target_by: '2026-11-26' }] }, NOW)).toBe(true);
  });
  it('waits while every target date is still ahead, however the check date stands', () => {
    expect(isStopCheckDue({ ...base, check_date: '2026-11-20', numbers: [{ ...missed, target_by: '2027-03-31' }] }, NOW)).toBe(false);
  });
  it('waits until every number has reached its target date, so one early miss does not open it', () => {
    expect(isStopCheckDue({ ...base, numbers: [missed, { target_by: '2027-03-31', pace: 'behind' }] }, NOW)).toBe(false);
    expect(isStopCheckDue({ ...base, numbers: [missed, { target_by: '2026-11-25', pace: 'met' }] }, NOW)).toBe(true);
    expect(isStopCheckDue({ ...base, numbers: [{ ...missed, pace: 'met' }, { target_by: '2026-11-25', pace: 'met' }] }, NOW)).toBe(false);
  });
  it('does not come due for a met target, an unwritten stop condition or an inactive initiative', () => {
    expect(isStopCheckDue({ ...base, numbers: [{ ...missed, pace: 'met' }] }, NOW)).toBe(false);
    expect(isStopCheckDue({ ...base, stop_condition: '  ' }, NOW)).toBe(false);
    expect(isStopCheckDue({ ...base, status: 'paused' }, NOW)).toBe(false);
    expect(isStopCheckDue({ ...base, numbers: [] }, NOW)).toBe(false);
  });
  it('judges only the number the stop condition names', () => {
    const quotes = { label: 'ADA quotes sent', target_by: '2026-11-20', pace: 'behind' as const };
    const builds = { label: 'ADA builds signed', target_by: '2026-11-20', pace: 'met' as const };
    const named = { ...base, stop_condition: 'Fewer than 2 ADA builds signed by Nov 20', numbers: [quotes, builds] };
    expect(stopNumbers(named.stop_condition, named.numbers)).toEqual([builds]);
    // Builds signed met its target, so the condition is false: quotes missing theirs does not open the stop check.
    expect(isStopCheckDue(named, NOW)).toBe(false);
    expect(isStopCheckDue({ ...named, numbers: [quotes, { ...builds, pace: 'behind' }] }, NOW)).toBe(true);
    // A later deadline on a number the condition does not name does not hold it back.
    expect(isStopCheckDue({ ...named, numbers: [{ ...quotes, target_by: '2027-06-30' }, { ...builds, pace: 'behind' }] }, NOW)).toBe(true);
    // The wording without the label's short first word names the same number.
    const shortWording = { ...named, stop_condition: 'Fewer than 2 builds signed by Nov 20' };
    expect(stopNumbers(shortWording.stop_condition, shortWording.numbers)).toEqual([builds]);
    expect(isStopCheckDue(shortWording, NOW)).toBe(false);
    // A condition that names no number is judged on all of them.
    expect(stopNumbers('If it stops feeling worth it', named.numbers)).toEqual(named.numbers);
  });
  it('clears once Mike checks in after the target date (Keep going)', () => {
    expect(isStopCheckDue({ ...base, latest_check_in: { created_at: '2026-11-21T09:00:00Z' } }, NOW)).toBe(false);
    expect(isStopCheckDue({ ...base, latest_check_in: { created_at: '2026-11-19T09:00:00Z' } }, NOW)).toBe(true);
  });
});

describe('focusOrder', () => {
  const mk = (id: string, o: Record<string, unknown>) => ({ id, status: 'active', health: 'on_track', check_date: null, sort_order: 0, latest_check_in: null, ...o });
  it('puts a passed check date first, then behind, then the soonest check date', () => {
    const items = [
      mk(A, { check_date: '2026-12-20' }),
      mk(B, { health: 'behind', check_date: '2026-12-30' }),
      mk(C, { check_date: '2026-11-20' }),
      mk(D, { check_date: '2026-12-05' }),
    ];
    expect(focusOrder(items, NOW).map((i) => i.id)).toEqual([C, B, D, A]);
  });
  it('treats a rock waiting on Mike as a decision waiting, and keeps sort order on ties', () => {
    const items = [mk(A, { sort_order: 2 }), mk(B, { sort_order: 1 }), mk(C, { decision_waiting: true, sort_order: 3 })];
    expect(focusOrder(items, NOW).map((i) => i.id)).toEqual([C, B, A]);
  });
});

const initiativeRow = (id: string, o: Record<string, unknown> = {}) => ({
  id, name: `Initiative ${id.slice(-1)}`, bet: 'A bet', nightmare: null, prevention: null, repair: null, cost_of_waiting: null,
  stop_condition: null, check_date: null, check_every_days: null, next_decision: null, status: 'active', health: 'unchecked',
  health_reason: 'Not checked yet: no reading after the baseline', owner_id: MIKE_USER_ID, client_id: null, sort_order: 0,
  activated_at: null, closed_at: null, closed_reason: null, created_by_id: MIKE_USER_ID, is_deleted: false,
  created_at: new Date('2026-11-01'), updated_at: new Date('2026-11-01'), numbers: [], check_ins: [], ...o,
});

describe('loadInitiativeBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    p.initiative.update.mockResolvedValue({});
    p.initiativeReading.findMany.mockResolvedValue([]);
    p.project.findMany.mockResolvedValue([]);
    p.recurringWork.findMany.mockResolvedValue([]);
    p.task.findMany.mockResolvedValue([]);
    p.milestone.findMany.mockResolvedValue([]);
  });

  it('answers an empty board with no focus', async () => {
    p.initiative.findMany.mockResolvedValue([]);
    const board = await loadInitiativeBoard(NOW);
    expect(board).toMatchObject({ quarter: '2026-Q4', focus_id: null, initiatives: [], quarter_rocks: [] });
    expect(board.summary).toEqual({ active: 0, decisions_waiting: 0, rocks_this_quarter: 0, rocks_off_track: 0, proposed: 0, paused: 0, closed: 0 });
    expect(p.initiativeReading.findMany).not.toHaveBeenCalled();
  });

  it('orders, attaches, reads trends and rocks, and counts', async () => {
    const number = {
      id: N1, initiative_id: B, label: 'ADA quotes sent', unit: 'count', direction: 'up', baseline_value: '0', baseline_at: new Date('2026-11-01'),
      target_value: '6', target_by: new Date('2027-03-31'), source: 'manual', last_value: '1', last_read_at: new Date('2026-11-20'), position: 0,
      created_at: new Date('2026-11-01'), updated_at: new Date('2026-11-20'),
    };
    p.initiative.findMany.mockResolvedValue([
      initiativeRow(A, { check_date: new Date('2026-12-20') }),
      initiativeRow(B, { numbers: [number], check_date: new Date('2026-11-20'), stop_condition: 'Fewer than 2 builds by March' }),
      initiativeRow(C, { status: 'proposed' }),
      initiativeRow(D, { status: 'stopped', closed_at: new Date('2026-11-10') }),
    ]);
    // Newest first, as the query orders them; the board turns them oldest first for the line.
    p.initiativeReading.findMany.mockResolvedValue([
      { number_id: N1, value: '1', read_at: new Date('2026-11-20') },
      { number_id: N1, value: '0', read_at: new Date('2026-11-10') },
    ]);
    p.project.findMany.mockResolvedValue([{ id: PROJ, name: 'ADA audit offer page', status: 'in_progress', initiative_id: A }]);
    p.recurringWork.findMany.mockResolvedValue([{ id: 'r1', title: null, is_active: true, initiative_id: A, sop: { title: 'Weekly ADA prospect list' } }]);
    p.task.findMany.mockResolvedValue([{ id: 't1', title: 'Rule proposal: nightmare step', status: 'done', initiative_id: B }]);
    p.milestone.findMany.mockResolvedValue([
      {
        id: 'm1', name: 'First ADA case study', project_id: PROJ, target_date: new Date('2026-12-31'), completed_at: null, rock_quarter: '2026-Q4',
        rock_done_when: 'Published', project: { name: 'ADA audit offer page', initiative_id: A, next_step_text: 'approve the outline', next_step_owner_id: MIKE_USER_ID, next_step_at: new Date('2026-11-12') },
      },
      {
        id: 'm2', name: 'Unattached rock', project_id: 'x', target_date: new Date('2026-12-31'), completed_at: null, rock_quarter: '2026-Q4',
        rock_done_when: null, project: { name: 'Other', initiative_id: null, next_step_text: null, next_step_owner_id: null, next_step_at: null },
      },
    ]);

    const board = await loadInitiativeBoard(NOW);

    expect(p.milestone.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { rock_quarter: '2026-Q4', project: { is_deleted: false } } }));
    // B's check date passed with no check-in; A has a rock waiting on Mike: both are decisions, B's check date is sooner.
    expect(board.initiatives.map((i) => i.id)).toEqual([B, A, C, D]);
    expect(board.focus_id).toBe(B);
    expect(board.summary).toEqual({ active: 2, decisions_waiting: 2, rocks_this_quarter: 2, rocks_off_track: 1, proposed: 1, paused: 0, closed: 1 });

    const b = board.initiatives[0];
    // Its target date (Mar 31) is still ahead, so the stop condition is not judged yet.
    expect(b).toMatchObject({ check_due: true, stop_check_due: false, decision_waiting: true, attached_count: 1 });
    expect(b.numbers[0]).toMatchObject({ pace: 'behind', readings: [{ value: 0 }, { value: 1 }] });
    expect(b.numbers[0].expected).toBeGreaterThan(1);

    const a = board.initiatives[1];
    expect(a.attached).toEqual({
      projects: [{ id: PROJ, name: 'ADA audit offer page', status: 'in_progress' }],
      recurring: [{ id: 'r1', title: 'Weekly ADA prospect list', is_active: true }],
      tasks: [],
    });
    expect(a.rocks).toEqual([
      expect.objectContaining({ id: 'm1', rock_status: 'off_track', rock_decision: 'Waiting on you since Nov 12: approve the outline' }),
    ]);
    expect(a).toMatchObject({ check_due: false, decision_waiting: true });
    expect(board.initiatives[2]).toMatchObject({ status: 'proposed', decision_waiting: false });
    // The count line's rock list holds every rock this quarter, the unattached one too.
    expect(board.quarter_rocks.map((r) => [r.id, r.initiative_id])).toEqual([['m1', A], ['m2', null]]);
  });
});
