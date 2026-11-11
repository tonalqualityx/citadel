import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HandsCard } from '../HandsCard';
import type { HomeItem } from '@/lib/home/types';

function job(key: string, title: string): HomeItem {
  return {
    key,
    type: 'task',
    title,
    who: null,
    age: '3 days',
    why_now: '',
    hard_date: null,
    effort: 'About 10 minutes',
    minutes: 10,
    actions: [
      { id: 'do_now', label: "I'll do it now", filled: false, href: null },
      { id: 'done', label: 'Done', filled: false, href: null },
      { id: 'not_now', label: 'Not now', filled: false, href: null },
    ],
    more_actions: [{ id: 'open_task', label: 'Open', filled: false, href: null }],
    default_if_ignored: '',
    reason: '',
    pinned: false,
    opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: key, left_off_note: null },
    source: { kind: 'task', id: key, ids: [key], task_status: 'not_started' },
    client: null,
    project: null,
  };
}

function row(): HomeItem {
  const a = job('task:a', 'Rotate the SFTP password');
  const b = job('task:b', 'Update the DNS record');
  return {
    ...job('hands:week', "This week's hands: 2 jobs, about 20 minutes in all."),
    type: 'hands',
    actions: [{ id: 'not_this_week', label: 'Not this week', filled: true, href: null }],
    more_actions: [],
    default_if_ignored: 'Stays here Monday to Friday until the jobs are done or you park it. Nothing happens on its own.',
    reason: 'Jobs tagged for hands wait for one weekly sitting, so they are not listed one by one.',
    source: { kind: 'hands', id: 'week', ids: ['a', 'b'], task_status: null },
    hands: {
      count: 2,
      minutes: 20,
      groups: [
        { sop_id: 's1', label: 'Rotate credentials', jobs: [{ title: a.title, minutes: 10, item: a }] },
        { sop_id: null, label: 'No written steps', jobs: [{ title: b.title, minutes: 10, item: b }] },
      ],
    },
  };
}

describe('HandsCard', () => {
  it('lists the jobs by group, "No written steps" last, each with Done, I\'ll do it now and Open (never Not now)', () => {
    render(<HandsCard item={row()} onAction={() => {}} pendingFor={() => null} />);
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads.slice(0, 2)).toEqual(['Rotate credentials', 'No written steps']);
    const first = screen.getByText('Rotate the SFTP password').closest('.home-hands-job') as HTMLElement;
    expect(within(first).getAllByRole('button').map((b) => b.textContent)).toEqual(['Done', "I'll do it now", 'Open']);
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('a job button passes the job\'s own item, and Not this week passes the row', () => {
    const onAction = vi.fn();
    const item = row();
    render(<HandsCard item={item} onAction={onAction} pendingFor={() => null} />);
    const second = screen.getByText('Update the DNS record').closest('.home-hands-job') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Done' }));
    expect(onAction.mock.calls[0][0].id).toBe('done');
    expect(onAction.mock.calls[0][1].key).toBe('task:b');
    fireEvent.click(screen.getByRole('button', { name: 'Not this week' }));
    expect(onAction.mock.calls[1][0].id).toBe('not_this_week');
    expect(onAction.mock.calls[1][1].key).toBe('hands:week');
  });

  it('shows the honest "If you do nothing" line and renders nothing without jobs', () => {
    render(<HandsCard item={row()} onAction={() => {}} pendingFor={() => null} />);
    expect(screen.getByText(/Stays here Monday to Friday/)).toBeInTheDocument();
    const { container } = render(<HandsCard item={{ ...row(), hands: null }} onAction={() => {}} pendingFor={() => null} />);
    expect(container.textContent).toBe('');
  });
});
