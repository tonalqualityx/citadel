import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { HomeItem, HomeResponse } from '@/lib/home/types';

const h = vi.hoisted(() => ({
  home: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  run: vi.fn(),
  done: vi.fn(),
  stop: vi.fn(),
  act: vi.fn(),
  undo: vi.fn(),
  saveRule: vi.fn(),
}));

vi.mock('@/lib/hooks/use-home', () => ({
  useHome: () => h.home,
  useHomeAct: () => h.act,
  useHomeUndo: () => h.undo,
  useHomeRule: () => h.saveRule,
  useHomeItemAction: () => ({
    run: h.run,
    done: h.done,
    stop: h.stop,
    pendingFor: () => null,
    statusFor: () => null,
    promptFor: () => null,
    busy: false,
  }),
}));
vi.mock('@/lib/hooks/use-oracle-projects', () => ({
  useOracleProjects: () => ({
    data: { projects: [{ id: 'p1', name: 'Grok rebuild', client: { id: 'c1', name: 'Gene Roberts' }, next_step: { text: 'Send the preview' } }], stalled_count: 0, generated_at: '' },
  }),
}));
vi.mock('@/lib/contexts/task-peek-context', () => ({
  TaskPeekProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTaskPeek: () => ({ openTaskPeek: vi.fn() }),
}));
const cal = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/lib/hooks/use-home-calendar', () => ({ useHomeCalendar: () => ({ data: cal.data }) }));
vi.mock('../CalendarDrawer', () => ({
  CalendarDrawer: (props: { eventId: string | null; renderItem: (item: HomeItem) => React.ReactNode; onOpenProject: (id: string) => void; onClose: () => void }) => (
    <div data-testid="cal-drawer">
      {props.eventId ? `meeting:${props.eventId}` : 'meeting closed'}
      {props.eventId ? <div data-testid="cal-drawer-item">{props.renderItem(mkItem('task:c1'))}</div> : null}
      <button type="button" onClick={() => props.onOpenProject('p1')}>meeting project</button>
    </div>
  ),
}));
const drawerProps = vi.hoisted(() => ({ last: null as null | { projectId: string | null; userId: string; timeZone: string; card: { id?: string } | null } }));
vi.mock('../HomeProjectDrawer', () => ({
  HomeProjectDrawer: (props: {
    projectId: string | null;
    userId: string;
    timeZone: string;
    card: { id?: string } | null;
    renderItem: (item: HomeItem) => React.ReactNode;
    onClose: () => void;
  }) => {
    drawerProps.last = props;
    return (
      <div data-testid="drawer">
        {props.projectId ? `open:${props.projectId}` : 'closed'}
        {props.projectId ? <div data-testid="drawer-item">{props.renderItem(mkItem('task:d1', { project: { id: 'p1', name: 'Grok rebuild' } }))}</div> : null}
        <button type="button" onClick={props.onClose}>close drawer</button>
      </div>
    );
  },
}));
vi.mock('../TodayList', () => ({
  TodayList: (props: { today: { arc_name: string } | null; selectedKey: string | null; onSelect: (i: HomeItem) => void; emptyText: string }) => (
    <div data-testid="today-list" data-selected={props.selectedKey ?? ''}>
      {props.today ? props.today.arc_name : props.emptyText}
    </div>
  ),
}));

import { HomeScreen } from '../HomeScreen';

function mkItem(key: string, over: Partial<HomeItem> = {}): HomeItem {
  return {
    key, type: 'task', title: `Title ${key}`, who: 'Gene Roberts', age: '3 days', why_now: 'A reason.', hard_date: null,
    effort: 'About 10 minutes', minutes: 10,
    actions: [{ id: 'done', label: 'Done', filled: true, href: null }], more_actions: [],
    default_if_ignored: 'Stays here.', reason: 'It is here.', pinned: false,
    opened: { summary: `Summary ${key}.`, summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'task', id: key, ids: [key], task_status: 'not_started' }, client: null, project: null, ...over,
  };
}
function mkRes(): HomeResponse {
  return {
    generated_at: '', date: '2026-11-09', timezone: 'America/New_York', screen_date_line: 'Monday, November 9', user_id: 'u1',
    today: { group_key: 'arc:1', arc_id: '1', arc_name: 'Grok of the Rock', client: null, project: null, why: 'Why.', size_line: 'About 1 hour', minutes_total: 60, minutes_free: 300, quick: [mkItem('task:q1')], steps: [mkItem('task:s1'), mkItem('task:s2')], added_keys: [], swap: [], lighter: null },
    sections: {
      needs_you_now: [mkItem('task:n1', { type: 'emergency' })], working_on: [], leads: [], mail: [], next: [mkItem('task:x1'), mkItem('task:x2')],
      handled: [{ id: 'h1', text: 'Replied to Mark', href: 'https://mail.example.com/t', at: '', undo_action_id: null, details: [] }, { id: 'k1', text: 'Gave 41 waiting tasks a day to come back.', href: null, at: '', undo_action_id: 'act-1', details: ['Renew the domain', 'Fix the form'] }], handled_more: null,
    },
    everything_else: { count: 3, line: '3 other items are on your plate and counted here.', groups: [{ key: 'parked', label: 'Parked by you', count: 3, owner: 'You', items: [
  { key: 'task:r1', title: 'Renew the domain', owner: 'You', check_text: 'Back Thursday, November 12', check_at: '2026-11-12T05:05:00Z', past_check: false, can_bring_forward: true },
  { key: null, title: 'Grok sign-off', owner: 'The Grok project', check_text: 'Waits for the sign-off', check_at: null, past_check: false, can_bring_forward: false },
] }], with_day: 2, past_day: 1, scope_line: '4 tasks on unsigned or paused projects are kept as scope, not work.' },
    empty: { today: 'Nothing proposed for today.', needs_you_now: 'Nothing urgent.', working_on: 'Nothing in progress.', leads: 'No sales leads are waiting on you.', mail: 'No client is waiting on a reply from you.', next: 'Nothing needs a decision from you right now.', projects: 'No active projects.', handled: 'Nothing new since you last looked.', everything_else: '' },
  };
}

beforeEach(() => {
  h.run.mockClear();
  cal.data = undefined;
  h.home = { data: mkRes(), isLoading: false, isError: false, refetch: vi.fn() };
});

describe('HomeScreen', () => {
  it('opens on Today with the first arc step open in the card', () => {
    render(<HomeScreen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monday, November 9');
    expect(screen.getByRole('button', { name: /Today: Grok of the Rock/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('today-list')).toHaveAttribute('data-selected', 'task:s1');
    expect(screen.getByRole('heading', { level: 2, name: 'Title task:s1' })).toBeInTheDocument();
  });
  it('picking a tile lists its rows and opens the first one', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /need you now|needs you now/ }));
    expect(screen.getByRole('button', { name: /Title task:n1/ })).toHaveAttribute('data-rule', 'now');
    expect(screen.getByRole('heading', { level: 2, name: 'Title task:n1' })).toBeInTheDocument();
  });
  it('Slice 6a: the Monday hands row opens as the hands card, and a job button runs on the job\'s own item', () => {
    const job = mkItem('task:j1', { title: 'Rotate the SFTP password', actions: [{ id: 'do_now', label: "I'll do it now", filled: false, href: null }, { id: 'done', label: 'Done', filled: false, href: null }], more_actions: [{ id: 'open_task', label: 'Open', filled: false, href: null }] });
    const row = mkItem('hands:week', {
      type: 'hands',
      title: "This week's hands: 1 job, about 10 minutes in all.",
      actions: [{ id: 'not_this_week', label: 'Not this week', filled: true, href: null }],
      source: { kind: 'hands', id: 'week', ids: ['j1'], task_status: null },
      hands: { count: 1, minutes: 10, groups: [{ sop_id: null, label: 'No written steps', jobs: [{ title: 'Rotate the SFTP password', minutes: 10, item: job }] }] },
    });
    const res = mkRes();
    res.sections.next = [row, mkItem('task:x1')];
    h.home = { data: res, isLoading: false, isError: false, refetch: vi.fn() };
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /decisions ready/ }));
    expect(screen.getByRole('heading', { level: 2, name: /This week's hands/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'No written steps' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.run.mock.calls[0][1].key).toBe('task:j1');
    fireEvent.click(screen.getByRole('button', { name: 'Not this week' }));
    expect(h.run.mock.calls[1][0].id).toBe('not_this_week');
    expect(h.run.mock.calls[1][1].key).toBe('hands:week');
  });
  it('choosing another row swaps the card, and nothing reorders', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /decisions ready/ }));
    const rows = () => screen.getAllByRole('button', { name: /Title task:x/ }).map((b) => b.textContent);
    const before = rows();
    fireEvent.click(screen.getByRole('button', { name: /Title task:x2/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Title task:x2' })).toBeInTheDocument();
    expect(rows()).toEqual(before);
  });
  it('a card button runs through the item actions with the day group key', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][1].key).toBe('task:s1');
    expect(h.run.mock.calls[0][2]).toEqual({ groupKey: 'arc:1' });
  });
  it('empty tile shows its sentence', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /sales leads waiting/ }));
    expect(screen.getAllByText('No sales leads are waiting on you.').length).toBeGreaterThan(0);
  });
  it('handled, everything else and projects tiles work', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /handled for you/ }));
    expect(screen.getByRole('link', { name: 'Open the thread' })).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: /everything else/ }));
    fireEvent.click(screen.getByRole('button', { name: /Parked by you/ }));
    expect(screen.getByText(/Held by: You/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^1\s*project$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the project' }));
    expect(screen.getByTestId('drawer')).toHaveTextContent('open:p1');
  });
  it('Slice 8a: the project drawer is the home drawer, gets his zone and id, and its item buttons run the same action wiring', () => {
    render(<HomeScreen />);
    expect(screen.getByTestId('drawer')).toHaveTextContent('closed');
    fireEvent.click(screen.getByRole('button', { name: /^1\s*project$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the project' }));
    expect(drawerProps.last).toMatchObject({ projectId: 'p1', userId: 'u1', timeZone: 'America/New_York' });
    const inDrawer = within(screen.getByTestId('drawer-item'));
    // No link back into the drawer from inside the drawer.
    expect(inDrawer.queryByRole('button', { name: 'Grok rebuild' })).toBeNull();
    fireEvent.click(inDrawer.getByRole('button', { name: 'Done' }));
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][1]).toMatchObject({ key: 'task:d1' });
    fireEvent.click(screen.getByRole('button', { name: 'close drawer' }));
    expect(screen.getByTestId('drawer')).toHaveTextContent('closed');
  });
  it('everything else opens a group card with rows, and Bring it forward posts the right body', async () => {
    h.act.mockResolvedValue({});
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /everything else/ }));
    expect(screen.getByText('3 other items are counted here. 2 have a day to come back.')).toBeInTheDocument();
    expect(screen.getByText('1 is past their day.')).toBeInTheDocument();
    expect(screen.getByText('Renew the domain')).toBeInTheDocument();
    expect(screen.getByText('Back Thursday, November 12')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Bring it forward' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(h.act).toHaveBeenCalledWith({ action: 'bring_forward', item_key: 'task:r1' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Bring it forward' })[0]).not.toBeDisabled());
  });
  it('a keeper line shows its details muted and Undo posts its id; a classifier line has no Undo', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /handled for you/ }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Gave 41 waiting tasks/ }));
    expect(screen.getByText('Fix the form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(h.undo).toHaveBeenCalledWith('act-1');
  });
  it('a pinned item shows the working bar and collapses the lists to one line', () => {
    const res = mkRes();
    res.sections.working_on = [mkItem('task:p', { pinned: true })];
    h.home = { data: res, isLoading: false, isError: false, refetch: vi.fn() };
    render(<HomeScreen />);
    expect(screen.getByRole('region', { name: 'Working on' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'What needs you' })).toBeNull();
    expect(screen.getByText(/more are waiting\. They'll keep\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show my lists' }));
    expect(screen.getByRole('group', { name: 'What needs you' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide my lists' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Working on' })).getByRole('button', { name: 'Stop for now' }));
    fireEvent.change(screen.getByLabelText('Where did you leave it?'), { target: { value: 'At step 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop for now' }));
    expect(h.stop).toHaveBeenCalledWith(res.sections.working_on[0], 'At step 2');
  });
  it('Slice 10a: the calendar strip sits above the Today list, only on Today, and a row opens the meeting drawer', () => {
    const row = { id: 'ev1', time: '2:00', who: 'Erick, Bootleggers (lead)', muted: false, openable: true };
    cal.data = { upcoming: [row], later: [], earlier: [], all_day: null, tomorrow: null, soon: null };
    render(<HomeScreen />);
    const strip = screen.getByTestId('home-calendar-strip');
    const list = screen.getByTestId('today-list');
    expect(strip.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('cal-drawer')).toHaveTextContent('meeting closed');
    fireEvent.click(screen.getByTestId('calendar-row'));
    expect(screen.getByTestId('cal-drawer')).toHaveTextContent('meeting:ev1');
    fireEvent.click(screen.getByRole('button', { name: /need you now|needs you now/ }));
    expect(screen.queryByTestId('home-calendar-strip')).toBeNull();
  });
  it('Slice 10a: no strip when the calendar has nothing or has not loaded', () => {
    render(<HomeScreen />);
    expect(screen.queryByTestId('home-calendar-strip')).toBeNull();
  });
  it('Slice 10a: the meeting drawer\'s item cards use the same action wiring, and its project link closes it and opens the project drawer', () => {
    cal.data = { upcoming: [{ id: 'ev1', time: '2:00', who: 'A', muted: false, openable: true }], later: [], earlier: [], all_day: null, tomorrow: null, soon: null };
    render(<HomeScreen />);
    fireEvent.click(screen.getByTestId('calendar-row'));
    const card = within(screen.getByTestId('cal-drawer-item'));
    fireEvent.click(card.getByRole('button', { name: 'Done' }));
    expect(h.run).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'meeting project' }));
    expect(screen.getByTestId('cal-drawer')).toHaveTextContent('meeting closed');
    expect(screen.getByTestId('drawer')).toHaveTextContent('open:p1');
  });
  it('Slice 10a: the pinned line shows only with soon set, above the working bar', () => {
    const res = mkRes();
    res.sections.working_on = [mkItem('task:p', { pinned: true })];
    h.home = { data: res, isLoading: false, isError: false, refetch: vi.fn() };
    const { unmount } = render(<HomeScreen />);
    expect(screen.queryByTestId('calendar-soon')).toBeNull();
    unmount();
    cal.data = { upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: { id: 'ev9', time: '2:00', who: 'Erick, Bootleggers', muted: false, openable: true } };
    render(<HomeScreen />);
    const soon = screen.getByTestId('calendar-soon');
    expect(soon).toHaveTextContent('2:00Erick, Bootleggers');
    expect(soon.compareDocumentPosition(screen.getByRole('region', { name: 'Working on' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(soon);
    expect(screen.getByTestId('cal-drawer')).toHaveTextContent('meeting:ev9');
  });
  it('loading and error states', () => {
    h.home = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const { unmount } = render(<HomeScreen />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    unmount();
    const refetch = vi.fn();
    h.home = { data: undefined, isLoading: false, isError: true, refetch };
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
    const way = screen.getByRole('link', { name: 'Open the Overlook' });
    expect(way.getAttribute('href')).toBe('/dashboard?view=overlook');
  });
  it('shows no em or en dash anywhere', () => {
    const { container } = render(<HomeScreen />);
    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
