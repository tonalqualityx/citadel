import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetainerMonthPanel, pastMonthLine } from '../RetainerMonthPanel';
import { RetainerMonthsBoard, countLine, focusOrder } from '../RetainerMonthsBoard';
import type { RetainerMonthView } from '@/types/entities';

const month = (o: Partial<RetainerMonthView> = {}): RetainerMonthView => ({
  id: 'm1', charter_id: 'c1', charter_name: 'Kava', client_id: 'cl', client_name: 'Kava Bars', month: '2026-12', state: 'planned',
  hours_allotted: 10, planning_task_id: null, planned_at: null, planned_by_id: null, note: null,
  used_minutes: 390, outside_minutes: 150, unassigned_minutes: 0, frozen: false,
  outside: [{ id: 't9', title: 'Menu photo swap', minutes: 90 }, { id: 't8', title: 'Hours page fix', minutes: 60 }],
  items: [{ id: 'i1', title: 'Two blog posts', estimate_min_low: 180, estimate_min_high: 240, task_id: 't1', recurring_work_id: null, position: 0, used_minutes: 210 }],
  ...o,
});

describe('RetainerMonthPanel', () => {
  it('shows used against the allotment, items with ranges, and the outside list', () => {
    render(<RetainerMonthPanel month={month()} />);
    expect(screen.getByTestId('usage-line').textContent).toBe('Used 6.5 h of 10 h');
    expect(screen.getByText('Two blog posts')).toBeTruthy();
    expect(screen.getByText('3 to 4 h')).toBeTruthy();
    expect(screen.getByTestId('outside-the-plan').textContent).toContain('Menu photo swap');
    expect(screen.getByTestId('outside-the-plan').textContent).toContain('2.5 h');
    expect(screen.queryByTestId('usage-bar-past')).toBeNull();
  });

  it('continues the bar in the warning color past the allotment', () => {
    render(<RetainerMonthPanel month={month({ used_minutes: 750 })} />);
    const within = screen.getByTestId('usage-bar-within');
    const past = screen.getByTestId('usage-bar-past');
    expect(within.className).toContain('bg-primary');
    expect(past.className).toContain('bg-warning');
    expect(past.className).not.toMatch(/red|error/);
    expect(within.getAttribute('style')).toContain('80%');
  });

  it('shows Use this plan only while planning, and calls onConfirm', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<RetainerMonthPanel month={month({ state: 'planning' })} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Use this plan'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    rerender(<RetainerMonthPanel month={month({ state: 'planned' })} onConfirm={onConfirm} />);
    expect(screen.queryByText('Use this plan')).toBeNull();
    rerender(<RetainerMonthPanel month={month({ state: 'closed' })} onConfirm={onConfirm} />);
    expect(screen.queryByText('Use this plan')).toBeNull();
  });

  it('has no justify button on outside work, and one line per past month', () => {
    render(<RetainerMonthPanel month={month()} past={[{ id: 'p1', month: '2026-11', state: 'closed', hours_allotted: 10, used_minutes: 690, outside_minutes: 180 }]} />);
    expect(screen.queryByText(/justify/i)).toBeNull();
    expect(screen.getByTestId('past-months').textContent).toBe('November: 11.5 h of 10 h, 3 h outside the plan');
    expect(pastMonthLine({ id: 'x', month: '2026-10', state: 'closed', hours_allotted: 8, used_minutes: 240, outside_minutes: 0 })).toBe('October: 4 h of 8 h');
  });
});

describe('upcoming plan block', () => {
  const next = month({
    id: 'next', month: '2027-01', state: 'planning', created_at: '2026-11-25T06:20:00.000Z', used_minutes: 0, outside_minutes: 0, outside: [],
    items: [
      { id: 'n1', title: 'Two blog posts', estimate_min_low: 180, estimate_min_high: 240, task_id: null, recurring_work_id: null, position: 0, used_minutes: 0 },
      { id: 'n2', title: 'Report', estimate_min_low: 60, estimate_min_high: 90, task_id: null, recurring_work_id: null, position: 1, used_minutes: 0 },
    ],
  });

  it('shows the next month plan with items, total and Use this plan for that month', () => {
    const onConfirm = vi.fn();
    render(<RetainerMonthPanel month={month({ state: 'planned' })} upcoming={next} onConfirm={onConfirm} />);
    const block = screen.getByTestId('upcoming-plan');
    expect(block.textContent).toContain('January plan');
    expect(block.textContent).toContain('drafted');
    expect(screen.getAllByTestId('upcoming-item')).toHaveLength(2);
    expect(screen.getByTestId('upcoming-total').textContent).toBe('Total 4 to 5.5 h of 10 h');
    fireEvent.click(screen.getByTestId('upcoming-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'next' }));
    // the planned current month has no button of its own
    expect(screen.getAllByText('Use this plan')).toHaveLength(1);
  });

  it('keeps a current-month button only when the current month itself is planning', () => {
    render(<RetainerMonthPanel month={month({ state: 'planning' })} upcoming={next} onConfirm={vi.fn()} />);
    expect(screen.getAllByText('Use this plan')).toHaveLength(2);
  });

  it('shows no button once the upcoming month is planned, and no block without one', () => {
    const { rerender } = render(<RetainerMonthPanel month={month()} upcoming={{ ...next, state: 'planned' }} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('upcoming-plan').textContent).toContain('planned');
    expect(screen.queryByText('Use this plan')).toBeNull();
    rerender(<RetainerMonthPanel month={month()} />);
    expect(screen.queryByTestId('upcoming-plan')).toBeNull();
  });
});

describe('RetainerMonthsBoard', () => {
  const a = month({ id: 'a', client_name: 'Alpha', state: 'planned', outside_minutes: 0, outside: [], used_minutes: 100 });
  const b = month({ id: 'b', client_name: 'Beta', state: 'planned', outside_minutes: 60, used_minutes: 300 });
  const c = month({ id: 'c', client_name: 'Gamma', state: 'planning', outside_minutes: 0, outside: [], used_minutes: 0 });

  it('focuses a waiting plan, then most outside time', () => {
    expect(focusOrder([a, b, c]).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
  it('writes the count line', () => {
    expect(countLine([a, b, c])).toBe('3 retainers · 1 plan to confirm · 1 has work outside the plan');
  });
  it('counts and focuses a retainer whose next month plan is waiting', () => {
    const up = new Map([['c-a', month({ id: 'ua', charter_id: 'c-a', month: '2027-01', state: 'planning' })]]);
    const aa = { ...a, charter_id: 'c-a' };
    const bb = { ...b, charter_id: 'c-b' };
    expect(focusOrder([bb, aa], up).map((r) => r.id)).toEqual(['a', 'b']);
    expect(countLine([aa, bb], up)).toBe('2 retainers · 1 plan to confirm · 1 has work outside the plan');
    const onConfirm = vi.fn();
    render(<RetainerMonthsBoard month="2026-12" retainers={[aa, bb]} upcoming={[...up.values()]} focusId={null} onFocus={vi.fn()} onConfirm={onConfirm} onTalk={vi.fn()} />);
    expect(screen.getByTestId('retainer-counts').textContent).toContain('1 plan to confirm');
    fireEvent.click(screen.getByTestId('upcoming-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'ua' }));
    expect(screen.getByTestId('retainer-tile').textContent).toContain('planned');
  });

  it('a tile says plan to confirm when that retainer has one waiting', () => {
    const up = [month({ id: 'ub', charter_id: 'c-b', month: '2027-01', state: 'planning' })];
    render(<RetainerMonthsBoard month="2026-12" retainers={[{ ...a, charter_id: 'c-a' }, { ...b, charter_id: 'c-b' }]} upcoming={up} focusId="a" onFocus={vi.fn()} onConfirm={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByTestId('retainer-tile').textContent).toContain('plan to confirm');
  });

  it('renders the focus and tiles, and clicking a tile focuses it', () => {
    const onFocus = vi.fn();
    render(<RetainerMonthsBoard month="2026-12" retainers={[a, b, c]} focusId={null} onFocus={onFocus} onConfirm={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByText('Gamma: December')).toBeTruthy();
    const tiles = screen.getAllByTestId('retainer-tile');
    expect(tiles).toHaveLength(2);
    fireEvent.click(tiles[0]);
    expect(onFocus).toHaveBeenCalledWith('b');
    expect(tiles[0].textContent).toContain('outside: 1 h');
  });
});
