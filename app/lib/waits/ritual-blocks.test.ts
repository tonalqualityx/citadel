import { describe, it, expect } from 'vitest';
import {
  buildRitualBlocks,
  blockingSummary,
  selectBlockingToday,
  selectDueThisWeek,
  selectAdmin,
  type WaitCandidate,
  type TaskCandidate,
} from './ritual-blocks';
import { zonedTimeToUtc } from './business-days';

const MIKE = 'mike';
const et = (y: number, m: number, d: number, h = 12, mi = 0) => zonedTimeToUtc(y, m, d, h, mi);
const NOW = et(2026, 10, 21, 10);

let n = 0;
function wait(over: Partial<WaitCandidate> = {}): WaitCandidate {
  n++;
  return {
    id: `w${n}`,
    kind: 'handoff',
    state: 'waiting',
    title: `Wait ${n}`,
    due_at: et(2026, 10, 21, 17),
    blocks_client: true,
    client_waiting_since: et(2026, 10, 13),
    nag_level: 1,
    project_id: null,
    task_id: null,
    approval_request_id: null,
    client: { id: 'c1', name: 'SAPCC' },
    resolved_user_id: MIKE,
    ...over,
  };
}
const task = (over: Partial<TaskCandidate> = {}): TaskCandidate => ({
  id: `t${++n}`,
  title: `Task ${n}`,
  due_date: et(2026, 10, 23),
  promised_to: null,
  client: null,
  ...over,
});

describe('Blocking today', () => {
  it('takes only Mike\'s client-blocking waits due today or earlier', () => {
    const waits = [
      wait({ id: 'in' }),
      wait({ id: 'late', due_at: et(2026, 10, 15, 17) }),
      wait({ id: 'tomorrow', due_at: et(2026, 10, 22, 17) }),
      wait({ id: 'internal', blocks_client: false }),
      wait({ id: 'other', resolved_user_id: 'nils' }),
      wait({ id: 'done', state: 'done' }),
      wait({ id: 'paused', state: 'paused' }),
      wait({ id: 'human', state: 'needs_human' }),
      wait({ id: 'held', state: 'blocked_by_switch' }),
    ];
    const r = selectBlockingToday(waits, MIKE, NOW);
    expect(r.rows.map((x) => x.id).sort()).toEqual(['held', 'human', 'in', 'late']);
  });

  it('counts the whole of today in Eastern, even late in the evening', () => {
    const w = wait({ id: 'evening', due_at: et(2026, 10, 21, 23, 30) });
    expect(selectBlockingToday([w], MIKE, NOW).total).toBe(1);
  });

  it('puts project approvals first, then the longest client wait', () => {
    const waits = [
      wait({ id: 'old-handoff', client_waiting_since: et(2026, 10, 1) }),
      wait({ id: 'new-approval', kind: 'approval', project_id: 'p1', client_waiting_since: et(2026, 10, 19) }),
      wait({ id: 'older-approval', kind: 'approval', project_id: 'p2', client_waiting_since: et(2026, 10, 10) }),
      wait({ id: 'approval-no-project', kind: 'approval', client_waiting_since: et(2026, 10, 2) }),
      wait({ id: 'undated', client_waiting_since: null }),
    ];
    expect(selectBlockingToday(waits, MIKE, NOW).rows.map((x) => x.id)).toEqual([
      'older-approval',
      'new-approval',
      'old-handoff',
      'approval-no-project',
      'undated',
    ]);
  });

  it('shows five and counts the rest', () => {
    const waits = Array.from({ length: 8 }, (_, i) => wait({ id: `b${i}`, client_waiting_since: et(2026, 10, 1 + i) }));
    const r = selectBlockingToday(waits, MIKE, NOW);
    expect(r.rows).toHaveLength(5);
    expect(r.more).toBe(3);
    expect(r.total).toBe(8);
    expect(r.overflow.map((x) => x.id)).toEqual(['b5', 'b6', 'b7']);
  });

  it('labels the wait, and at level 3 names who has heard nothing', () => {
    const [a] = selectBlockingToday([wait({ client_waiting_since: et(2026, 10, 13) })], MIKE, NOW).rows;
    expect(a.label).toBe('waiting 8 days');
    expect(a.waiting_days).toBe(8);
    const [b] = selectBlockingToday([wait({ client_waiting_since: et(2026, 10, 13), nag_level: 3 })], MIKE, NOW).rows;
    expect(b.label).toBe('SAPCC has heard nothing for 8 days');
    expect(b.countdown).toBe(true);
  });

  it('points each row at the right door', () => {
    const rows = selectBlockingToday(
      [
        wait({ id: 'a', task_id: 't1', client_waiting_since: et(2026, 10, 1) }),
        wait({ id: 'b', approval_request_id: 'ar1', client_waiting_since: et(2026, 10, 2) }),
        wait({ id: 'c', project_id: 'p1', client_waiting_since: et(2026, 10, 3) }),
        wait({ id: 'd', client_waiting_since: et(2026, 10, 4) }),
      ],
      MIKE,
      NOW
    ).rows;
    expect(rows.map((r) => r.action)).toEqual([
      { type: 'task', id: 't1' },
      { type: 'approval', id: 'ar1' },
      { type: 'project', id: 'p1' },
      { type: 'wait', id: 'd' },
    ]);
  });

  it('breaks ties stably', () => {
    const same = et(2026, 10, 13);
    const waits = [wait({ id: 'z', title: 'Z', client_waiting_since: same }), wait({ id: 'a', title: 'A', client_waiting_since: same })];
    expect(selectBlockingToday(waits, MIKE, NOW).rows.map((x) => x.id)).toEqual(['a', 'z']);
  });
});

describe('Due this week', () => {
  it('lists the other waits and tasks within 7 days by date, once each', () => {
    const waits = [
      wait({ id: 'blk' }),
      wait({ id: 'soon', blocks_client: false, due_at: et(2026, 10, 24, 17) }),
      wait({ id: 'client-tomorrow', due_at: et(2026, 10, 22, 17) }),
      wait({ id: 'far', blocks_client: false, due_at: et(2026, 11, 20, 17) }),
      wait({ id: 'task-wait', blocks_client: false, due_at: et(2026, 10, 25, 17), task_id: 't-dup' }),
    ];
    const blocking = selectBlockingToday(waits, MIKE, NOW);
    const r = selectDueThisWeek(
      waits,
      [task({ id: 't-dup', due_date: et(2026, 10, 25) }), task({ id: 't-solo', due_date: et(2026, 10, 23) }), task({ id: 't-far', due_date: et(2026, 12, 1) })],
      MIKE,
      NOW,
      blocking.pickedIds
    );
    expect(r.rows.map((x) => x.id)).toEqual(['client-tomorrow', 't-solo', 'soon', 'task-wait']);
    expect(r.total).toBe(4);
  });

  it('caps at seven and counts the rest', () => {
    const waits = Array.from({ length: 10 }, (_, i) => wait({ id: `d${i}`, blocks_client: false, due_at: et(2026, 10, 22, 8 + i) }));
    const r = selectDueThisWeek(waits, [], MIKE, NOW, new Set());
    expect(r.rows).toHaveLength(7);
    expect(r.more).toBe(3);
  });

  it('ignores other people\'s waits', () => {
    const r = selectDueThisWeek([wait({ resolved_user_id: 'nils', blocks_client: false })], [], MIKE, NOW, new Set());
    expect(r.total).toBe(0);
  });
});

describe('Admin', () => {
  it('shows five and counts the rest', () => {
    const admin = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, title: `A${i}`, due_date: null, client: null }));
    const r = selectAdmin(admin);
    expect(r.rows).toHaveLength(5);
    expect(r.more).toBe(2);
  });
});

describe('buildRitualBlocks', () => {
  it('composes the three blocks and never reads a focus flag', () => {
    const w = wait({ id: 'one' });
    // A candidate shape with no focus field at all: the selectors cannot depend on one.
    expect(Object.keys(w)).not.toContain('is_focus');
    const b = buildRitualBlocks({ waits: [w], tasks: [], admin: [], mikeId: MIKE, now: NOW });
    expect(b.blocking_today.rows.map((r) => r.id)).toEqual(['one']);
    expect(b.due_this_week.total).toBe(0);
    expect(b.admin.total).toBe(0);
    expect(b.generated_at).toBe(NOW.toISOString());
  });

  it('summarizes Blocking today for the ritual overview', () => {
    const many = Array.from({ length: 8 }, () => wait());
    const b = buildRitualBlocks({ waits: many, tasks: [], admin: [], mikeId: MIKE, now: NOW });
    expect(blockingSummary(b.blocking_today)).toBe('5 blocking a client, 3 more behind them.');
    expect(blockingSummary(buildRitualBlocks({ waits: [], tasks: [], admin: [], mikeId: MIKE, now: NOW }).blocking_today)).toBe(
      'Nothing is blocking a client today.'
    );
    expect(blockingSummary(buildRitualBlocks({ waits: [wait()], tasks: [], admin: [], mikeId: MIKE, now: NOW }).blocking_today)).toBe(
      '1 blocking a client.'
    );
  });
});
