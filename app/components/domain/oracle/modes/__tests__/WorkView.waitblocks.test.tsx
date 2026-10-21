import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

const flags = { ORACLE_WAIT_BLOCKS: true, ORACLE_WORK_DOORS: false };
vi.mock('@/lib/config/feature-flags', () => ({
  get ORACLE_WAIT_BLOCKS() {
    return flags.ORACLE_WAIT_BLOCKS;
  },
  get ORACLE_WORK_DOORS() {
    return flags.ORACLE_WORK_DOORS;
  },
}));

const blocks = {
  blocking_today: { rows: [], more: 0, total: 1, overflow: [] },
  due_this_week: { rows: [], more: 0, total: 1 },
  admin: { rows: [], more: 0, total: 1 },
  summary: '',
  generated_at: '',
};
const useMyWaitBlocks = vi.fn((_enabled?: boolean) => ({ data: blocks }));
vi.mock('@/lib/hooks/use-waits', () => ({ useMyWaitBlocks: (e?: boolean) => useMyWaitBlocks(e), useUpdateWait: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('@/lib/hooks/use-today', () => ({
  useTodayPicks: () => ({ data: { picks: [] } }),
  useTodayCalendar: () => ({ data: { timezone: 'America/New_York', date: '2026-10-21', meetings: [] } }),
  useDueSoonTasks: () => ({ data: { tasks: [] } }),
}));
vi.mock('@/lib/hooks/use-accords', () => ({ usePipelineAccords: () => ({ data: undefined }) }));
vi.mock('@/lib/hooks/use-triage-stats', () => ({ useTriageStats: () => ({ data: undefined }) }));

vi.mock('../work/SignalsRail', () => ({ SignalsRail: () => <div data-testid="signals-rail" /> }));
vi.mock('../work/ClockStrip', () => ({ ClockStrip: () => <div data-testid="clock-strip" /> }));
vi.mock('../work/TodaysPicksHero', () => ({ TodaysPicksHero: () => <div data-testid="todays-picks-hero" /> }));
vi.mock('../work/DoorsRow', () => ({ DoorsRow: () => <div data-testid="doors-row" /> }));
vi.mock('../work/BlockingToday', () => ({ BlockingToday: () => <div data-testid="blocking-today" /> }));
vi.mock('../work/DueThisWeek', () => ({ DueThisWeek: () => <div data-testid="due-this-week" /> }));
vi.mock('../work/AdminBlock', () => ({ AdminBlock: () => <div data-testid="admin-block" /> }));

import { WorkView } from '../WorkView';

function renderView() {
  return render(<WorkView machines={[]} liveSessions={[]} waitingOnMe={undefined} nowMs={Date.now()} onGoToMode={() => {}} />);
}

beforeEach(() => {
  flags.ORACLE_WAIT_BLOCKS = true;
  flags.ORACLE_WORK_DOORS = false;
  useMyWaitBlocks.mockClear();
});

describe('WorkView wait blocks and doors flags', () => {
  it('defaults: the three blocks show in order and the doors row is hidden', () => {
    renderView();
    const order = ['signals-rail', 'clock-strip', 'blocking-today', 'todays-picks-hero', 'due-this-week', 'admin-block'];
    const present = Array.from(screen.getByTestId('work-view').children).map((c) => c.getAttribute('data-testid'));
    expect(present).toEqual(order);
    expect(screen.queryByTestId('doors-row')).not.toBeInTheDocument();
  });

  it('ORACLE_WORK_DOORS on brings the doors row back at the foot', () => {
    flags.ORACLE_WORK_DOORS = true;
    renderView();
    const present = Array.from(screen.getByTestId('work-view').children).map((c) => c.getAttribute('data-testid'));
    expect(present.at(-1)).toBe('doors-row');
  });

  it('ORACLE_WAIT_BLOCKS off removes the blocks and skips the fetch', () => {
    flags.ORACLE_WAIT_BLOCKS = false;
    renderView();
    expect(screen.queryByTestId('blocking-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('due-this-week')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-block')).not.toBeInTheDocument();
    expect(useMyWaitBlocks).toHaveBeenCalledWith(false);
  });
});
