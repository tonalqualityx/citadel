import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { HomeItem } from '@/lib/home/types';
import type { HomeProjectResponse } from '@/lib/home/projects/types';

const h = vi.hoisted(() => ({ q: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/lib/hooks/use-home-project', () => ({ useHomeProject: () => h.q }));

import { HomeProjectDrawer } from '../HomeProjectDrawer';

function mkItem(key: string, over: Partial<HomeItem> = {}): HomeItem {
  return {
    key, type: 'task', title: `Title ${key}`, who: null, age: '3 days', why_now: 'A reason.', hard_date: null, effort: 'About 10 minutes', minutes: 10,
    actions: [{ id: 'done', label: 'Done', filled: true, href: null }], more_actions: [], default_if_ignored: 'Stays.', reason: 'Here.', pinned: false,
    opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'task', id: key, ids: [key], task_status: 'not_started' }, client: null, project: { id: 'p1', name: 'Grok rebuild' }, ...over,
  };
}
const NOW_ISO = new Date().toISOString();
function data(over: Partial<HomeProjectResponse> = {}): HomeProjectResponse {
  return {
    project: { id: 'p1', name: 'Grok rebuild', client: { id: 'c1', name: 'Gene Roberts' } },
    items: [{ item: mkItem('task:a'), where: 'Ready for you' }, { item: mkItem('task:b'), where: 'Back Thursday, November 12' }],
    waits: [],
    ...over,
  };
}
const card = {
  name: 'Grok rebuild',
  client: { name: 'Gene Roberts' },
  blockers: [],
  next_step: { text: 'Mike, send the preview to Gene.', owner: { id: 'u1', name: 'Mike' }, owner_label: null, source: 'bast' as const, at: NOW_ISO },
  last_movement: { at: NOW_ISO, who: 'Bast', what: 'x' },
  days_quiet: 0,
  stale: false,
  linked_emails: [
    { from: 'Gene', subject: 'Old', gist: null, received_at: '2026-11-01T15:00:00Z', deep_link: 'https://mail.example.com/old' },
    { from: 'Gene Roberts', subject: 'Preview', gist: 'Gene likes the preview.', received_at: '2026-11-09T15:00:00Z', deep_link: 'https://mail.example.com/new' },
  ],
};

function show(over: Partial<React.ComponentProps<typeof HomeProjectDrawer>> = {}) {
  const renderItem = vi.fn((item: HomeItem) => <button type="button">{`Card ${item.key}`}</button>);
  const onClose = vi.fn();
  render(<HomeProjectDrawer projectId="p1" card={card} userId="u1" timeZone="America/New_York" renderItem={renderItem} onClose={onClose} {...over} />);
  return { renderItem, onClose };
}

beforeEach(() => {
  h.q = { data: data(), isLoading: false, isError: false, refetch: vi.fn() };
});

describe('HomeProjectDrawer', () => {
  it('shows the status, the next step without "Mike, ", his items through renderItem, the last email link and the way out', () => {
    const { renderItem } = show();
    expect(screen.getByTestId('home-project-status')).toHaveTextContent('Moving. Last change today by Bast.');
    const step = screen.getByTestId('home-project-next-step');
    expect(step).toHaveTextContent('Next step: Send the preview to Gene.');
    expect(step).toHaveTextContent('Yours');
    expect(step).toHaveTextContent(/Bast wrote this at .* today\./);
    expect(renderItem).toHaveBeenCalledTimes(2);
    const items = screen.getAllByTestId('home-project-item');
    expect(items[0]).toHaveTextContent('Ready for you');
    expect(items[1]).toHaveTextContent('Back Thursday, November 12');
    const email = screen.getByRole('link', { name: 'Last client email: Monday, November 9, Gene Roberts: Gene likes the preview.' });
    expect(email).toHaveAttribute('href', 'https://mail.example.com/new');
    expect(screen.getByRole('link', { name: 'Open the full project' })).toHaveAttribute('href', '/projects/p1');
  });

  it('has no Edit, Refresh or Dismiss', () => {
    show();
    for (const name of [/edit/i, /refresh/i, /dismiss/i]) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('a project missing from the Oracle list shows its items and the way out only', () => {
    show({ card: null });
    expect(screen.queryByTestId('home-project-next-step')).toBeNull();
    expect(screen.queryByTestId('home-project-last-email')).toBeNull();
    expect(screen.queryByTestId('home-project-status')).toBeNull();
    expect(screen.getAllByTestId('home-project-item')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open the full project' })).toBeInTheDocument();
  });

  it('needs-you-now items drive the status sentence', () => {
    h.q = { ...h.q, data: data({ items: [{ item: mkItem('task:e', { type: 'emergency' }), where: 'Needs you now' }] }) };
    show();
    expect(screen.getByTestId('home-project-status')).toHaveTextContent('1 thing here needs you now.');
  });

  it('lists waits others hold', () => {
    h.q = { ...h.q, data: data({ waits: [{ who: 'Andy (client)', since: '2026-11-03T14:00:00Z', title: 'Logo files' }] }) };
    show({ card: null });
    const waits = within(screen.getByTestId('home-project-waits'));
    expect(waits.getByText(/Logo files\. Andy \(client\), since/)).toBeInTheDocument();
  });

  it('says so when nothing of his is open', () => {
    h.q = { ...h.q, data: data({ items: [] }) };
    show();
    expect(screen.getByText('Nothing of yours is open on this project.')).toBeInTheDocument();
  });

  it('shows a plain failure with a retry, and loading', () => {
    h.q = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.q.refetch).toHaveBeenCalled();
  });

  it('shows nothing of the body while closed', () => {
    h.q = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    show({ projectId: null, card: null });
    expect(screen.queryByRole('link', { name: 'Open the full project' })).toBeNull();
  });
});
