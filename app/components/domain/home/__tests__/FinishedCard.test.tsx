import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FinishedCard } from '../FinishedCard';
import type { HomeFinishedRow, HomeItem } from '@/lib/home/types';

const U = (n: number) => `finished:7aa4a01a-1111-4222-8333-94444555566${n}`;
const row = (n: number, over: Partial<HomeFinishedRow> = {}): HomeFinishedRow => ({
  key: U(n),
  task_id: `7aa4a01a-1111-4222-8333-94444555567${n}`,
  title: `Task ${n}`,
  href: `/tasks/${n}`,
  group: 'main',
  strength: 'strong',
  ticked: true,
  evidence: [{ line: `Live on site${n}.test since Nov 2 (go-live receipt)`, href: `https://site${n}.test/` }],
  ...over,
});

function item(rows: HomeFinishedRow[], others: string[] = []): HomeItem {
  return {
    key: 'finished:all',
    type: 'finished',
    title: `${rows.length} tasks look finished. Close them?`,
    who: null,
    age: 'less than a day',
    why_now: 'Each one has proof of its own.',
    hard_date: null,
    effort: 'About 2 minutes',
    minutes: 2,
    actions: [
      { id: 'finished_close', label: 'Close the ticked ones', filled: true, href: null },
      { id: 'not_now', label: 'Not now', filled: false, href: null },
    ],
    more_actions: [],
    default_if_ignored: 'Stays here. Nothing closes on its own.',
    reason: 'A one-time look found proof.',
    pinned: false,
    opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'finished', id: 'all', ids: [], task_status: null },
    client: null,
    project: null,
    finished: { count: rows.length, rows, others },
  };
}

describe('FinishedCard', () => {
  it('shows each task with its proof, and ticks strong rows only', () => {
    render(<FinishedCard item={item([row(1), row(2, { strength: 'medium', ticked: false })])} onAction={vi.fn()} onAct={vi.fn()} />);
    expect(screen.getByText('Task 1')).toBeTruthy();
    expect(screen.getByText('Live on site1.test since Nov 2 (go-live receipt)')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  });

  it('Close the ticked ones sends only the ticked main keys', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    render(<FinishedCard item={item([row(1), row(2, { ticked: false }), row(3, { group: 'security' })])} onAction={vi.fn()} onAct={onAct} />);
    fireEvent.click(screen.getByText('Close the ticked ones'));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'finished_close', item_keys: [U(1)] }));
  });

  it('security and portal rows have their own Close this one and are never in the ticked batch', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    render(<FinishedCard item={item([row(1), row(3, { group: 'security', ticked: false }), row(4, { group: 'portal', ticked: false })])} onAction={vi.fn()} onAct={onAct} />);
    expect(screen.getByText('Security tasks (1). Each needs its own tap.')).toBeTruthy();
    expect(screen.getByText("Shows in the client's portal (1). Closing shows it as done to them.")).toBeTruthy();
    const ones = screen.getAllByText('Close this one');
    expect(ones).toHaveLength(2);
    fireEvent.click(ones[0]);
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'finished_close_one', item_key: U(3) }));
    expect(onAct).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'finished_close' }));
  });

  it('an unticked-checklist row offers Open only (no close button)', () => {
    render(<FinishedCard item={item([row(5, { group: 'unticked', ticked: false })])} onAction={vi.fn()} onAct={vi.fn()} />);
    expect(screen.getByText('Done except for unticked items (1).')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.queryByText('Close this one')).toBeNull();
  });

  it('Not finished sends finished_keep, and Not now is the home action', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    const onAction = vi.fn();
    render(<FinishedCard item={item([row(1)])} onAction={onAction} onAct={onAct} />);
    fireEvent.click(screen.getByText('Not finished'));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'finished_keep', item_key: U(1) }));
    fireEvent.click(screen.getByText('Not now'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].id).toBe('not_now');
  });

  it('the old sweep group has its own button, and other people are only counted', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    render(<FinishedCard item={item([row(6, { group: 'orphan', strength: 'medium', ticked: true }), row(7, { group: 'orphan', strength: 'medium', ticked: true })], ["5 of Sabeen's look finished. They were not asked."])} onAction={vi.fn()} onAct={onAct} />);
    expect(screen.getByText('Filed by the old session sweep (2). Close them?')).toBeTruthy();
    expect(screen.getByText("5 of Sabeen's look finished. They were not asked.")).toBeTruthy();
    fireEvent.click(screen.getByText('Close these'));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'finished_close', item_keys: [U(6), U(7)] }));
  });
});
