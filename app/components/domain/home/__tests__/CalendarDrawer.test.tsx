import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { HomeItem } from '@/lib/home/types';
import type { HomeCalendarEventResponse } from '@/lib/home/calendar/types';

const h = vi.hoisted(() => ({ q: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() }, id: [] as (string | null)[] }));
vi.mock('@/lib/hooks/use-home-calendar', () => ({ useHomeCalendarEvent: (id: string | null) => { h.id.push(id); return h.q; } }));

import { CalendarDrawer } from '../CalendarDrawer';

function mkItem(key: string): HomeItem {
  return {
    key, type: 'task', title: `Title ${key}`, who: null, age: '3 days', why_now: 'A reason.', hard_date: null, effort: 'About 10 minutes', minutes: 10,
    actions: [{ id: 'done', label: 'Done', filled: true, href: null }], more_actions: [], default_if_ignored: 'Stays.', reason: 'Here.', pinned: false,
    opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'task', id: key, ids: [key], task_status: 'not_started' }, client: null, project: { id: 'p1', name: 'Phil' },
  };
}
function data(over: Partial<HomeCalendarEventResponse> = {}): HomeCalendarEventResponse {
  return {
    event: { id: 'e1', title: 'VT call', when: 'Wednesday 2:00 to 2:30', location: 'Room 4', join: { href: 'https://meet.google.com/abc', label: 'Join on Google Meet' }, invite_text: 'Agenda https://evil.example/x', invite_links: [{ href: 'https://acme.zoom.us/j/1', label: 'Join on Zoom' }] },
    client: { id: 'c1', name: 'VT Standard' },
    also_with: ['Nerd Herd'],
    people: [{ name: 'Morgan Ellis', detail: 'VT Standard', reply: null }, { name: 'Dan Price', detail: 'VT Standard', reply: 'has not replied' }],
    matched_by: 'Matched by the email address of Morgan and Dan.',
    hints: [{ text: 'You owe Morgan a reply: Re: x.', muted: false }, { text: 'You set aside a reply to Dan until Friday.', muted: true }],
    items: [{ item: mkItem('task:a'), where: 'Ready for you' }],
    more_items: 2,
    more_project_id: 'p1',
    links: [
      { label: 'Phil Camp memorial page', href: null, project_id: 'p1' },
      { label: 'Last email: Wednesday, November 11, Morgan: Hi', href: 'https://mail.google.com/x', project_id: null },
      { label: 'Intelligence report', href: 'https://reports.example.com/i', project_id: null },
      { label: 'Open VT Standard', href: '/clients/c1', project_id: null },
    ],
    ...over,
  };
}

function show(over: Partial<React.ComponentProps<typeof CalendarDrawer>> = {}) {
  const renderItem = vi.fn((item: HomeItem) => <button type="button">{`Card ${item.key}`}</button>);
  const onClose = vi.fn();
  const onOpenProject = vi.fn();
  render(<CalendarDrawer eventId="e1" renderItem={renderItem} onOpenProject={onOpenProject} onClose={onClose} {...over} />);
  return { renderItem, onClose, onOpenProject };
}

beforeEach(() => {
  h.q = { data: data(), isLoading: false, isError: false, refetch: vi.fn() };
  h.id = [];
});

describe('CalendarDrawer', () => {
  it('shows the head, Join, who, how it matched, hints, his item cards, links and the invite text', () => {
    const { renderItem } = show();
    expect(screen.getByText('VT Standard', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('VT call')).toBeInTheDocument();
    expect(screen.getByText('Wednesday 2:00 to 2:30')).toBeInTheDocument();
    expect(screen.getByText('Room 4')).toBeInTheDocument();
    const join = screen.getByRole('link', { name: 'Join on Google Meet' });
    expect(join).toHaveAttribute('href', 'https://meet.google.com/abc');
    expect(join).toHaveAttribute('target', '_blank');
    expect(join).toHaveAttribute('rel', 'noopener noreferrer');
    const withSec = screen.getByTestId('calendar-with');
    expect(withSec).toHaveTextContent('Morgan Ellis, VT Standard');
    expect(withSec).toHaveTextContent('Dan Price, VT Standard, has not replied');
    expect(withSec).toHaveTextContent('Matched by the email address of Morgan and Dan.');
    expect(withSec).toHaveTextContent('Also with: Nerd Herd');
    expect(screen.getByTestId('calendar-hints')).toHaveTextContent('You owe Morgan a reply: Re: x.');
    expect(screen.getByTestId('calendar-items')).toHaveTextContent('Your items for VT Standard');
    expect(renderItem).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Card task:a')).toBeInTheDocument();
    const invite = screen.getByTestId('calendar-invite');
    expect(invite).toHaveTextContent('Agenda https://evil.example/x');
    expect(within(invite).queryByRole('link', { name: /evil/ })).toBeNull();
    expect(within(invite).getByRole('link', { name: 'Join on Zoom' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens email and report links in a new tab, and a client link in place', () => {
    show();
    const links = screen.getByTestId('calendar-links');
    for (const name of [/Last email/, 'Intelligence report']) {
      const a = within(links).getByRole('link', { name });
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
    const client = within(links).getByRole('link', { name: 'Open VT Standard' });
    expect(client).toHaveAttribute('href', '/clients/c1');
    expect(client).not.toHaveAttribute('target');
  });

  it('a project link and "and 2 more" both hand the project to the caller', () => {
    const { onOpenProject } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Phil Camp memorial page' }));
    expect(onOpenProject).toHaveBeenLastCalledWith('p1');
    fireEvent.click(screen.getByRole('button', { name: 'and 2 more' }));
    expect(onOpenProject).toHaveBeenCalledTimes(2);
  });

  it('"and N more" is plain text when the items sit in different projects', () => {
    h.q = { ...h.q, data: data({ more_project_id: null }) };
    show();
    expect(screen.queryByRole('button', { name: 'and 2 more' })).toBeNull();
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
  });

  it('leaves out sections that have nothing', () => {
    h.q = { ...h.q, data: data({ hints: [], items: [], more_items: 0, links: [], also_with: [], event: { ...data().event, join: null, invite_text: null, invite_links: [], location: null } }) };
    show();
    for (const id of ['calendar-hints', 'calendar-items', 'calendar-links', 'calendar-invite']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByRole('link', { name: /Join/ })).toBeNull();
  });

  it('shows the loading and failed states, and Try again refetches', () => {
    h.q = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const a = render(<CalendarDrawer eventId="e1" renderItem={vi.fn()} onOpenProject={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Loading.')).toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    h.q = { data: undefined, isLoading: false, isError: true, refetch };
    render(<CalendarDrawer eventId="e1" renderItem={vi.fn()} onOpenProject={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('The meeting did not load. Nothing was changed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('asks for the event it is given, and renders no content when closed', () => {
    show();
    expect(h.id[0]).toBe('e1');
    expect(screen.getByTestId('home-calendar-drawer')).toBeInTheDocument();
  });
});
