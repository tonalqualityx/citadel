import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { CalendarEventPopover } from '../CalendarEventPopover';
import type { TodayCalendarMeeting } from '@/lib/hooks/use-today';

function meeting(overrides: Partial<TodayCalendarMeeting> = {}): TodayCalendarMeeting {
  return {
    id: 'evt-1',
    title: 'BRIC board',
    start: '2026-07-21T18:00:00.000Z',
    end: '2026-07-21T18:30:00.000Z',
    description: null,
    meet_url: null,
    location: null,
    attendees: null,
    ...overrides,
  };
}

describe('CalendarEventPopover', () => {
  it('renders nothing when closed', () => {
    render(<CalendarEventPopover meeting={meeting()} timezone="America/New_York" open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('calendar-event-popover')).not.toBeInTheDocument();
  });

  it('renders title and time range when open', () => {
    render(<CalendarEventPopover meeting={meeting()} timezone="America/New_York" open onClose={vi.fn()} />);
    const popover = screen.getByTestId('calendar-event-popover');
    expect(popover).toHaveTextContent('BRIC board');
    expect(popover).toHaveTextContent('30 min');
  });

  it('renders no Join button when meet_url is absent', () => {
    render(<CalendarEventPopover meeting={meeting()} timezone="America/New_York" open onClose={vi.fn()} />);
    expect(screen.queryByTestId('calendar-event-join')).not.toBeInTheDocument();
  });

  it('renders a Join button linking to meet_url when present', () => {
    render(
      <CalendarEventPopover
        meeting={meeting({ meet_url: 'https://meet.google.com/e2e-fixture' })}
        timezone="America/New_York"
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('calendar-event-join')).toHaveAttribute('href', 'https://meet.google.com/e2e-fixture');
  });

  it('never renders raw HTML from the description (no dangerouslySetInnerHTML path)', () => {
    render(
      <CalendarEventPopover
        meeting={meeting({ description: '<img src=x onerror=alert(1)>' })}
        timezone="America/New_York"
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('calendar-event-popover').querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('calendar-event-popover').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('linkifies a bare URL in the description into a real anchor', () => {
    render(
      <CalendarEventPopover
        meeting={meeting({ description: 'Agenda: https://docs.example.com/agenda' })}
        timezone="America/New_York"
        open
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole('link', { name: 'https://docs.example.com/agenda' });
    expect(link).toHaveAttribute('href', 'https://docs.example.com/agenda');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders attendees with response status, capped display, and "+N more"', () => {
    const attendees = Array.from({ length: 10 }, (_, i) => ({
      email: `a${i}@x.com`,
      display_name: `Attendee ${i}`,
      response_status: i === 0 ? 'accepted' : 'needsAction',
    }));
    render(
      <CalendarEventPopover meeting={meeting({ attendees })} timezone="America/New_York" open onClose={vi.fn()} />
    );
    expect(screen.getAllByTestId('calendar-event-attendee')).toHaveLength(8);
    expect(screen.getByText('+ 2 more')).toBeInTheDocument();
    expect(screen.getByText('1 of 10 accepted')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', () => {
    const onClose = vi.fn();
    render(<CalendarEventPopover meeting={meeting()} timezone="America/New_York" open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<CalendarEventPopover meeting={meeting()} timezone="America/New_York" open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the location when present', () => {
    render(
      <CalendarEventPopover meeting={meeting({ location: 'Springfield VT' })} timezone="America/New_York" open onClose={vi.fn()} />
    );
    expect(screen.getByText('Springfield VT')).toBeInTheDocument();
  });
});
