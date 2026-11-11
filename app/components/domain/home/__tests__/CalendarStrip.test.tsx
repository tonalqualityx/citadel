import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CalendarStrip, CalendarSoonLine } from '../CalendarStrip';
import type { HomeCalendarRow, HomeCalendarStrip } from '@/lib/home/calendar/types';

const row = (id: string, time: string, who: string, over: Partial<HomeCalendarRow> = {}): HomeCalendarRow => ({ id, time, who, muted: false, openable: true, ...over });
const empty: HomeCalendarStrip = { upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null };

describe('CalendarStrip', () => {
  it('renders nothing for no data, an empty strip, or nothing upcoming and no tomorrow line', () => {
    const a = render(<CalendarStrip strip={null} onOpen={vi.fn()} />);
    expect(a.container).toBeEmptyDOMElement();
    const b = render(<CalendarStrip strip={empty} onOpen={vi.fn()} />);
    expect(b.container).toBeEmptyDOMElement();
    const c = render(<CalendarStrip strip={{ ...empty, earlier: [row('e', '9:00', 'x')], all_day: 'All day: Home' }} onOpen={vi.fn()} />);
    expect(c.container).toBeEmptyDOMElement();
  });

  it('shows the group heading and time and who for each row, and opens only openable rows', () => {
    const onOpen = vi.fn();
    const strip: HomeCalendarStrip = {
      ...empty,
      upcoming: [row('a', 'Now', 'Morgan and Dan, VT Standard'), row('b', '3:30', 'Boys to Robotics, until 6:00', { muted: true, openable: false }), row('c', '3:00', 'Your time to answer Jessica', { muted: true })],
      all_day: 'All day: Home',
    };
    render(<CalendarStrip strip={strip} onOpen={onOpen} />);
    expect(screen.getByRole('heading', { name: 'On your calendar' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('calendar-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].tagName).toBe('BUTTON');
    expect(rows[1].tagName).toBe('DIV');
    expect(rows[2].tagName).toBe('BUTTON');
    expect(rows[0]).toHaveTextContent('NowMorgan and Dan, VT Standard');
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith('a');
    fireEvent.click(rows[1]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(within(rows[1]).getByText('Boys to Robotics, until 6:00').className).toContain('--text-muted');
    expect(within(rows[0]).getByText('Morgan and Dan, VT Standard').className).not.toContain('--text-muted');
    expect(screen.getByTestId('calendar-all-day')).toHaveTextContent('All day: Home');
  });

  it('folds earlier and later rows behind aria-expanded toggles', () => {
    const strip: HomeCalendarStrip = { ...empty, upcoming: [row('a', '2:00', 'A')], later: [row('l', '5:00', 'Later one')], earlier: [row('e1', '9:00', 'Early one'), row('e2', '10:00', 'Early two')] };
    render(<CalendarStrip strip={strip} onOpen={vi.fn()} />);
    const earlier = screen.getByRole('button', { name: '2 earlier today' });
    const later = screen.getByRole('button', { name: '1 more later today' });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    expect(later).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Early one')).toBeNull();
    fireEvent.click(earlier);
    expect(earlier).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Early one').className).toContain('--text-muted');
    fireEvent.click(later);
    expect(screen.getByText('Later one')).toBeInTheDocument();
    fireEvent.click(earlier);
    expect(screen.queryByText('Early one')).toBeNull();
  });

  it('shows the tomorrow line muted and clickable, even with nothing left today', () => {
    const onOpen = vi.fn();
    render(<CalendarStrip strip={{ ...empty, tomorrow: row('t', 'Tomorrow 1:00', 'Morgan and Dan, VT Standard', { muted: true }) }} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('calendar-row'));
    expect(onOpen).toHaveBeenCalledWith('t');
  });

  it('marks the selected row', () => {
    render(<CalendarStrip strip={{ ...empty, upcoming: [row('a', '2:00', 'A'), row('b', '3:00', 'B')] }} selectedId="b" onOpen={vi.fn()} />);
    const rows = screen.getAllByTestId('calendar-row');
    expect(rows[0]).toHaveAttribute('aria-current', 'false');
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
  });

  it('turns a dash in a who into a comma', () => {
    render(<CalendarStrip strip={{ ...empty, upcoming: [row('a', '2:00', 'Pat — Acme')] }} onOpen={vi.fn()} />);
    expect(screen.getByText('Pat, Acme')).toBeInTheDocument();
  });
});

describe('CalendarSoonLine', () => {
  it('renders nothing without a row, and a clickable line with one', () => {
    const a = render(<CalendarSoonLine row={null} onOpen={vi.fn()} />);
    expect(a.container).toBeEmptyDOMElement();
    const onOpen = vi.fn();
    render(<CalendarSoonLine row={row('s', '2:00', 'Erick, Bootleggers')} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('calendar-soon'));
    expect(onOpen).toHaveBeenCalledWith('s');
    expect(screen.getByTestId('calendar-soon')).toHaveTextContent('2:00Erick, Bootleggers');
  });
});
