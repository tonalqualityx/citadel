import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HomeItem, HomeToday } from '@/lib/home/types';

const createAndAddToArc = vi.fn();
vi.mock('@/lib/hooks/use-home', () => ({
  useHomeArcActions: () => ({ createAndAddToArc }),
}));
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => apiGet(...a) } }));

import { TodayList } from '../TodayList';

function item(key: string, title: string, extra: Partial<HomeItem> = {}): HomeItem {
  return { key, title, who: null, effort: 'About 10 minutes', age: '3 days', hard_date: null, client: null, project: null, ...extra } as HomeItem;
}

function makeToday(extra: Partial<HomeToday> = {}): HomeToday {
  return {
    group_key: 'arc:1',
    arc_id: '1',
    arc_name: 'Grok of the Rock',
    client: { id: 'c1', name: 'Grok' },
    project: null,
    why: 'A security flag has been open 13 days.',
    size_line: 'About 1 hour 50 minutes',
    minutes_total: 110,
    minutes_free: 300,
    quick: [item('task:q1', 'Install the sign-in')],
    steps: [item('task:s1', 'Step one'), item('task:s2', 'Step two')],
    added_keys: [],
    swap: [
      { group_key: 'client:2', name: 'Alder', why: 'Her approval is waiting.', minutes: 35, effort: 'About 35 minutes' },
      { group_key: 'own', name: 'Indelible', why: 'Own work.', minutes: 50, effort: 'About 50 minutes' },
    ],
    lighter: { group_key: 'client:3', name: 'Zorp', why: 'Short.', minutes: 20, effort: 'About 20 minutes' },
    ...extra,
  } as HomeToday;
}

function setup(today: HomeToday | null = makeToday(), onAct = vi.fn().mockResolvedValue({ ok: true })) {
  const onSelect = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TodayList
        today={today}
        emptyText="Nothing proposed for today."
        selectedKey="task:s1"
        onSelect={onSelect}
        addCandidates={[item('task:x1', 'Fix the footer', { client: { id: 'c1', name: 'Grok' } as never })]}
        userId="u1"
        onAct={onAct}
      />
    </QueryClientProvider>,
  );
  return { onAct, onSelect };
}

beforeEach(() => {
  createAndAddToArc.mockReset().mockResolvedValue({ ok: true });
  apiGet.mockReset().mockResolvedValue({ tasks: [], total: 0, page: 1, limit: 8, totalPages: 0 });
});

describe('TodayList', () => {
  it('renders the empty text when nothing is proposed', () => {
    setup(null);
    expect(screen.getByText('Nothing proposed for today.')).toBeInTheDocument();
  });

  it('shows both group headings, the rows and the day foot', () => {
    setup();
    expect(screen.getByText('Quick, before you start')).toBeInTheDocument();
    expect(screen.getByText("Today's arc: Grok of the Rock")).toBeInTheDocument();
    expect(screen.getByText('Install the sign-in')).toBeInTheDocument();
    expect(screen.getByText('Step one')).toBeInTheDocument();
    expect(screen.getByText('About 1 hour 50 minutes')).toBeInTheDocument();
    expect(screen.getByText('Why this arc: a security flag has been open 13 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lighter today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap arc' })).toBeInTheDocument();
  });

  it('leaves out the quick heading when there is no quick item', () => {
    setup(makeToday({ quick: [] }));
    expect(screen.queryByText('Quick, before you start')).toBeNull();
  });

  it('marks the selected row and selects on click', async () => {
    const { onSelect } = setup();
    expect(screen.getByText('Step one').closest('button')).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByText('Install the sign-in'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'task:q1' }));
  });

  it('flags a day that no longer fits without red and keeps the size line text', () => {
    setup(makeToday({ minutes_total: 190, minutes_free: 120, size_line: 'About 3 hours 10 minutes, more than today has free' }));
    const line = screen.getByText('About 3 hours 10 minutes, more than today has free');
    expect(line).toHaveAttribute('data-overflow', 'true');
    expect(line.className).toContain('--warning-line');
    expect(line.className).not.toMatch(/red/);
  });

  it('Lighter today sends lighter with the group', async () => {
    const { onAct } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Lighter today' }));
    expect(onAct).toHaveBeenCalledWith({ action: 'lighter', to_group_key: 'client:3' });
  });

  it('hides Lighter today when there is none', () => {
    setup(makeToday({ lighter: null }));
    expect(screen.queryByRole('button', { name: 'Lighter today' })).toBeNull();
  });

  it('Swap arc shows two choices, and picking one swaps', async () => {
    const { onAct } = setup();
    expect(screen.queryByText('Her approval is waiting.', { exact: false })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Swap arc' }));
    expect(screen.getByText('About 35 minutes')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Alder.').closest('button')!);
    expect(onAct).toHaveBeenCalledWith({ action: 'swap', to_group_key: 'client:2' });
    expect(screen.queryByText('About 35 minutes')).toBeNull();
  });

  it('removes a step through More and sends arc_remove with the day group', async () => {
    const { onAct } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step two' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from arc' }));
    expect(onAct).toHaveBeenCalledWith({ action: 'arc_remove', item_key: 'task:s2', group_key: 'arc:1' });
  });

  it('reorders and sends the full new order', async () => {
    const { onAct } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step one' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    expect(onAct).toHaveBeenCalledWith({ action: 'arc_reorder', group_key: 'arc:1', step_keys: ['task:s2', 'task:s1'] });
  });

  it('falls back to the server order when a reorder is rejected', async () => {
    const onAct = vi.fn().mockRejectedValue(new Error('no'));
    setup(makeToday(), onAct);
    await userEvent.click(screen.getByRole('button', { name: 'More for: Step one' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    await waitFor(() => {
      const titles = screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
      expect(titles).toEqual(['Step one', 'Step two']);
    });
  });

  it('adds an in-view match with origin in_view', async () => {
    const { onAct } = setup();
    await userEvent.type(screen.getByRole('combobox'), 'footer');
    await userEvent.click(await screen.findByRole('button', { name: /Fix the footer/ }));
    expect(onAct).toHaveBeenCalledWith({ action: 'arc_add', item_key: 'task:x1', group_key: 'arc:1', origin: 'in_view' });
  });

  it('adds an open task from the search with origin search', async () => {
    apiGet.mockResolvedValue({ tasks: [{ id: 'ABC', title: 'Old open task' }], total: 1, page: 1, limit: 8, totalPages: 1 });
    const { onAct } = setup();
    await userEvent.type(screen.getByRole('combobox'), 'old open');
    await userEvent.click(await screen.findByRole('button', { name: /Old open task/ }));
    expect(onAct).toHaveBeenCalledWith({ action: 'arc_add', item_key: 'task:abc', group_key: 'arc:1', origin: 'search' });
    expect(apiGet).toHaveBeenCalledWith('/tasks', expect.objectContaining({ params: expect.objectContaining({ search: 'old open', assignee_id: 'u1', statuses: 'not_started,in_progress,blocked,review' }) }));
  });

  it('Enter on text with no match creates the task and adds it', async () => {
    setup();
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'Call Gene about the flag');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /as a new task/ })).not.toBeDisabled());
    await userEvent.type(box, '{Enter}');
    await waitFor(() => expect(createAndAddToArc).toHaveBeenCalledWith('Call Gene about the flag', 'u1', 'arc:1'));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('keeps the typed text when the add fails', async () => {
    const onAct = vi.fn().mockRejectedValue(new Error('no'));
    setup(makeToday(), onAct);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'footer');
    await userEvent.click(await screen.findByRole('button', { name: /Fix the footer/ }));
    await waitFor(() => expect(onAct).toHaveBeenCalled());
    expect(box).toHaveValue('footer');
  });

  it('does not offer a current step in the add box', async () => {
    setup();
    await userEvent.type(screen.getByRole('combobox'), 'Step');
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('as a new task');
  });

  it('uses no dash, priority label or red in the visible text', () => {
    setup();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[–—]/);
    expect(text.toLowerCase()).not.toMatch(/overdue|priority/);
  });
});
