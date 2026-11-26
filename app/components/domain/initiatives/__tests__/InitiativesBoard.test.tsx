import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InitiativesBoard, type BoardActions } from '../InitiativesBoard';
import type { BoardInitiative, InitiativeBoard } from '@/lib/hooks/use-initiatives';

const NOW = new Date('2026-11-26T15:00:00Z');
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';

function initiative(id: string, o: Partial<BoardInitiative> = {}): BoardInitiative {
  return {
    id,
    name: `Initiative ${id.slice(-1)}`,
    bet: 'Agencies will pay for ADA builds once one is public.',
    nightmare: 'A signed build fails an audit after launch.',
    prevention: null,
    repair: null,
    cost_of_waiting: null,
    stop_condition: null,
    check_date: '2026-12-04',
    check_every_days: null,
    next_decision: null,
    status: 'active',
    health: 'on_track',
    health_reason: null,
    closed_at: null,
    closed_reason: null,
    updated_at: '2026-11-20T00:00:00Z',
    numbers: [],
    latest_check_in: null,
    attached: { projects: [], recurring: [], tasks: [] },
    attached_count: 0,
    rocks: [],
    check_due: false,
    stop_check_due: false,
    decision_waiting: false,
    ...o,
  };
}

const ada = initiative(A, {
  name: 'ADA-compliant site builds',
  health: 'behind',
  health_reason: 'ADA quotes sent is behind pace: 1 of 3 expected by now',
  next_decision: 'Pick the two agencies to pitch the ADA audit to first',
  stop_condition: 'Fewer than 2 builds signed by Mar 31',
  check_date: '2026-11-20',
  check_due: true,
  stop_check_due: true,
  decision_waiting: true,
  numbers: [
    {
      id: 'n1', label: 'ADA quotes sent', unit: 'count', direction: 'up', baseline_value: 0, baseline_at: '2026-11-01', target_value: 6,
      target_by: '2027-03-31', source: 'manual', last_value: 1, last_read_at: '2026-11-20', pace: 'behind', expected: 3,
      readings: [{ value: 0, read_at: '2026-11-10' }, { value: 1, read_at: '2026-11-20' }],
    },
  ],
  attached: {
    projects: [{ id: 'p1', name: 'ADA audit offer page', status: 'in_progress' }],
    recurring: [{ id: 'r1', title: 'Weekly ADA prospect list', is_active: true }],
    tasks: [{ id: 't1', title: 'Rule proposal: nightmare step', status: 'done' }],
  },
  attached_count: 3,
  rocks: [
    { id: 'm1', name: 'Launch the ADA audit offer page', project_id: 'p1', project_name: 'x', target_date: '2027-01-31', rock_quarter: '2026-Q4', rock_done_when: null, rock_status: 'on_track', rock_decision: null },
    { id: 'm2', name: 'First ADA case study', project_id: 'p1', project_name: 'x', target_date: '2027-02-28', rock_quarter: '2026-Q4', rock_done_when: null, rock_status: 'off_track', rock_decision: 'Waiting on you since Jan 12: approve the outline' },
  ],
});
const partner = initiative(B, { name: 'Partnership work', next_decision: 'Pick the first partner' });
const proposed = initiative(C, { name: 'Indelible articles', status: 'proposed', health: 'unchecked', check_date: null });

const board: InitiativeBoard = {
  quarter: '2026-Q4',
  summary: { active: 2, decisions_waiting: 1, rocks_this_quarter: 5, rocks_off_track: 1, proposed: 1, paused: 0, closed: 0 },
  focus_id: A,
  initiatives: [ada, partner, proposed],
  quarter_rocks: [
    ...ada.rocks.map((r) => ({ ...r, initiative_id: A })),
    { id: 'm9', name: 'Unattached rock', project_id: 'p9', project_name: 'Other project', target_date: '2026-12-20', rock_quarter: '2026-Q4', rock_done_when: null, rock_status: 'on_track', rock_decision: null, initiative_id: null },
  ],
};

function actions(): BoardActions {
  return { onFocus: vi.fn(), onTalk: vi.fn(), onCheckInOpen: vi.fn(), onCheckIn: vi.fn(), onKeepGoing: vi.fn(), onStop: vi.fn() };
}

describe('InitiativesBoard', () => {
  it('opens on the focused initiative with its state, next decision and what is attached', () => {
    render(<InitiativesBoard board={board} focusId={null} actions={actions()} now={NOW} />);
    const focused = screen.getByTestId('initiative-focused');
    expect(within(focused).getByText('ADA-compliant site builds')).toBeTruthy();
    expect(within(focused).getByText('Behind')).toBeTruthy();
    expect(within(focused).getByText('Pick the two agencies to pitch the ADA audit to first')).toBeTruthy();
    expect(within(focused).getByText(/First ADA case study, by Feb 28: Waiting on you since Jan 12/)).toBeTruthy();
    const aside = screen.getByTestId('initiative-aside');
    expect(within(aside).getByText('1 project · 1 recurring · 1 task')).toBeTruthy();
    expect(within(aside).getByText('ADA audit offer page').closest('a')?.getAttribute('href')).toBe('/projects/p1');
    expect(within(aside).getByText(/next check Nov 20/)).toBeTruthy();
    expect(screen.getByTestId('initiative-counts').textContent).toBe('2 active · 1 decision waiting · 5 rocks this quarter, 1 off track');
  });

  it('opens what each count counts', () => {
    const a = actions();
    render(<InitiativesBoard board={board} focusId={B} actions={a} now={NOW} />);
    const counts = screen.getByTestId('initiative-counts');
    fireEvent.click(within(counts).getByText('2 active'));
    const activeList = screen.getByTestId('initiative-count-list');
    expect(activeList.textContent).toContain('ADA-compliant site builds');
    expect(activeList.textContent).toContain('Partnership work');
    fireEvent.click(within(activeList).getByText('ADA-compliant site builds'));
    expect(a.onFocus).toHaveBeenLastCalledWith(A);
    fireEvent.click(within(counts).getByText('1 decision waiting'));
    expect(a.onFocus).toHaveBeenLastCalledWith(A);
    fireEvent.click(within(counts).getByText(/rocks this quarter/));
    const list = screen.getByTestId('initiative-count-list');
    expect(list.textContent).toContain('First ADA case study, by Feb 28');
    expect(list.textContent).toContain('Unattached rock, by Dec 20');
    expect(list.textContent).toContain('no initiative');
    expect(within(list).getByText('Unattached rock, by Dec 20').closest('a')?.getAttribute('href')).toBe('/projects/p9');
    fireEvent.click(within(list).getAllByText('ADA-compliant site builds')[0]);
    expect(a.onFocus).toHaveBeenLastCalledWith(A);
  });

  it('lists the initiatives when more than one decision is waiting', () => {
    const a = actions();
    const two = { ...board, summary: { ...board.summary, decisions_waiting: 2 }, initiatives: [ada, { ...partner, decision_waiting: true }, proposed] };
    render(<InitiativesBoard board={two} focusId={null} actions={a} now={NOW} />);
    fireEvent.click(screen.getByText('2 decisions waiting'));
    const list = screen.getByTestId('initiative-count-list');
    fireEvent.click(within(list).getByText('Partnership work'));
    expect(a.onFocus).toHaveBeenLastCalledWith(B);
  });

  it('shows the other active initiatives as tiles and proposed ones on one quiet line', () => {
    const a = actions();
    render(<InitiativesBoard board={board} focusId={null} actions={a} now={NOW} />);
    const tiles = screen.getAllByTestId('initiative-tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].textContent).toContain('Partnership work');
    expect(tiles[0].textContent).toContain('On track');
    expect(tiles[0].textContent).toContain('Next: Pick the first partner');
    fireEvent.click(tiles[0]);
    expect(a.onFocus).toHaveBeenCalledWith(B);

    const quiet = screen.getByTestId('initiative-quiet');
    expect(quiet.textContent).toBe('1 proposed');
    fireEvent.click(within(quiet).getByText('1 proposed'));
    fireEvent.click(within(quiet).getByText('Indelible articles'));
    expect(a.onFocus).toHaveBeenCalledWith(C);
  });

  it('focuses the initiative named in focusId', () => {
    render(<InitiativesBoard board={board} focusId={B} actions={actions()} now={NOW} />);
    expect(within(screen.getByTestId('initiative-focused')).getByText('Partnership work')).toBeTruthy();
    expect(screen.getAllByTestId('initiative-tile')[0].textContent).toContain('ADA-compliant site builds');
  });

  it('asks the check-in question with taps, and offers Keep going and Stop it at a due stop check', () => {
    const a = actions();
    render(<InitiativesBoard board={board} focusId={null} actions={a} now={NOW} />);
    fireEvent.click(screen.getByText('Check in'));
    expect(a.onCheckInOpen).toHaveBeenCalledWith(ada);
    const q = screen.getByTestId('check-in-question');
    expect(q.textContent).toContain('On track, behind, or something changed?');
    fireEvent.click(within(q).getByText('Behind'));
    expect(a.onCheckIn).toHaveBeenCalledWith(ada, 'behind');
    fireEvent.click(within(q).getByText('Something changed'));
    expect(a.onTalk).toHaveBeenCalledWith(ada);

    const stop = screen.getByTestId('stop-check');
    expect(stop.textContent).toContain('Fewer than 2 builds signed by Mar 31');
    fireEvent.click(within(stop).getByText('Keep going'));
    fireEvent.click(within(stop).getByText('Stop it'));
    expect(a.onKeepGoing).toHaveBeenCalledWith(ada);
    expect(a.onStop).toHaveBeenCalledWith(ada);
  });

  it('opens the full text of a cut line in place, and says what is not written yet', () => {
    render(<InitiativesBoard board={board} focusId={null} actions={actions()} now={NOW} />);
    const bet = screen.getByText('The bet').closest('button')!;
    expect(bet.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bet);
    expect(bet.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Prevention').parentElement?.textContent).toContain('Not written yet');
  });

  it('shows an empty state with the chat when there are no initiatives', () => {
    const a = actions();
    render(
      <InitiativesBoard
        board={{ ...board, focus_id: null, initiatives: [], summary: { ...board.summary, active: 0 } }}
        focusId={null}
        actions={a}
        now={NOW}
      />,
    );
    expect(screen.getByText('No initiatives yet')).toBeTruthy();
    fireEvent.click(screen.getByText('Talk it through'));
    expect(a.onTalk).toHaveBeenCalledWith(null);
  });
});
