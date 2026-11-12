import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ data: undefined as unknown, reconcile: vi.fn(async () => true), refetch: vi.fn(async () => undefined) }));
vi.mock('@/lib/hooks/use-work-clocks', () => ({ useWorkClocks: () => ({ data: h.data, refetch: h.refetch }) }));
vi.mock('@/lib/hooks/use-home', () => ({ useHomeReconcile: () => h.reconcile }));

import { WorkClockLines } from '../WorkClockLines';

const mike = { minutes: 130, unlogged_minutes: 130, logged_minutes: 0, sessions: 3, days: 2, inferred_from: '3 of your sessions on 2 days', basis: ['7 prompts'], suggested: 130, choices: [15, 30, 60, 90, 120], line: "Your time: about 2 h 10 m this month (Bast's estimate from 3 of your sessions on 2 days). Log it?" };
const bast = { minutes: 65, agent_minutes: null, cost_usd: 3.4, line: 'Bast worked: 1 h 05 m, $3.40.' };

beforeEach(() => {
  h.reconcile.mockClear();
  h.data = { target_key: 'project:p1', month_start: '', mike, bast };
});

describe('WorkClockLines', () => {
  it('shows both lines, the estimate worded as an estimate', () => {
    render(<WorkClockLines targetKey="project:p1" />);
    expect(screen.getByTestId('work-clock-mike')).toHaveTextContent("Bast's estimate from 3 of your sessions on 2 days");
    expect(screen.getByTestId('work-clock-bast')).toHaveTextContent('Bast worked: 1 h 05 m, $3.40.');
  });
  it('renders nothing when there are no clocks', () => {
    h.data = { target_key: 'task:t', month_start: '', mike: null, bast: null };
    const { container } = render(<WorkClockLines targetKey="task:t" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('Log it preselects the estimate and a tap posts log_clock with those minutes', async () => {
    render(<WorkClockLines targetKey="project:p1" />);
    fireEvent.click(screen.getByTestId('work-clock-log-open'));
    expect(screen.getByRole('button', { name: '130 minutes' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('work-clock-log-go'));
    await waitFor(() => expect(h.reconcile).toHaveBeenCalledWith({ action: 'log_clock', target_key: 'project:p1', minutes: 130 }));
  });
  it('a chosen minute or a typed number replaces the estimate', async () => {
    render(<WorkClockLines targetKey="task:t1" />);
    fireEvent.click(screen.getByTestId('work-clock-log-open'));
    fireEvent.click(screen.getByRole('button', { name: '60 minutes' }));
    fireEvent.click(screen.getByTestId('work-clock-log-go'));
    await waitFor(() => expect(h.reconcile).toHaveBeenLastCalledWith({ action: 'log_clock', target_key: 'task:t1', minutes: 60 }));
    fireEvent.click(screen.getByTestId('work-clock-log-open'));
    fireEvent.change(screen.getByPlaceholderText('Minutes'), { target: { value: '42' } });
    fireEvent.click(screen.getByTestId('work-clock-log-go'));
    await waitFor(() => expect(h.reconcile).toHaveBeenLastCalledWith({ action: 'log_clock', target_key: 'task:t1', minutes: 42 }));
  });
  it('nothing is logged until the tap, and no Log it when everything is logged', () => {
    render(<WorkClockLines targetKey="project:p1" />);
    expect(h.reconcile).not.toHaveBeenCalled();
    h.data = { target_key: 'project:p1', month_start: '', mike: { ...mike, unlogged_minutes: 0, suggested: null }, bast: null };
    render(<WorkClockLines targetKey="project:p2" />);
    expect(screen.queryAllByTestId('work-clock-log-open')).toHaveLength(1);
  });
});
