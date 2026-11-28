import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FirstList } from '../FirstList';
import type { HomeFirstList, HomeFirstRow } from '@/lib/home/types';

const T = '7aa4a01a-1111-4222-8333-944445500001';
const row = (over: Partial<HomeFirstRow>): HomeFirstRow => ({
  key: 'k',
  tier: 'decision',
  tier_label: 'Your call',
  title: 'A title',
  line: 'A line.',
  amount: null,
  date: null,
  age: null,
  open: { kind: 'item', key: 'k', tile: 'next' },
  ...over,
});

function setup(list: HomeFirstList | undefined, allOpen = false) {
  const h = { onTalk: vi.fn(), onOpenTask: vi.fn(), onOpenItem: vi.fn(), onToggleAll: vi.fn() };
  const view = render(<FirstList list={list} allOpen={allOpen} {...h} />);
  return { h, ...view };
}

describe('FirstList', () => {
  it('shows an amount on money rows, a date on deadline rows and an age on decisions', () => {
    setup({
      more: 0,
      rows: [
        row({ key: 'm', tier: 'money', tier_label: 'Money', title: 'Invoice 1042 for Acme', amount: '$4,250', line: 'Unpaid since Nov 3.', open: { kind: 'link', href: '/clients/c1' } }),
        row({ key: 'd', tier: 'deadline', tier_label: 'Due soon', title: 'Launch the site', date: 'Fri, Nov 13', line: 'Due Friday, November 13.' }),
        row({ key: 'x', title: 'Decide the plan', age: '5 days' }),
      ],
    });
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('$4,250')).toBeInTheDocument();
    expect(within(items[0]).getByText('Money')).toBeInTheDocument();
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/clients/c1');
    expect(within(items[1]).getByText('Fri, Nov 13')).toBeInTheDocument();
    expect(within(items[2]).getByText('5 days')).toBeInTheDocument();
  });

  it('tapping a Triage row calls onTalk once with that card', () => {
    const { h } = setup({ more: 0, rows: [row({ key: `task:${T}`, title: 'Idea A', open: { kind: 'triage', task_id: T, title: 'Idea A' } })] });
    fireEvent.click(screen.getByRole('button', { name: /Idea A/ }));
    expect(h.onTalk).toHaveBeenCalledTimes(1);
    expect(h.onTalk).toHaveBeenCalledWith({ key: `task:${T}`, title: 'Idea A', type: 'task', task_id: T, tile: 'triage' });
    expect(h.onOpenTask).not.toHaveBeenCalled();
  });

  it('tapping a task row opens that task, and any other row opens its tile', () => {
    const { h } = setup({
      more: 0,
      rows: [
        row({ key: 'task:a', title: 'Task A', open: { kind: 'task', task_id: 'a', key: 'task:a', title: 'Task A', item_type: 'task' } }),
        row({ key: 'thread:b', title: 'Thread B', open: { kind: 'item', key: 'thread:b', tile: 'leads' } }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /Task A/ }));
    expect(h.onOpenTask).toHaveBeenCalledWith({ task_id: 'a', key: 'task:a', title: 'Task A', item_type: 'task' });
    fireEvent.click(screen.getByRole('button', { name: /Thread B/ }));
    expect(h.onOpenItem).toHaveBeenCalledWith('thread:b', 'leads');
  });

  it('an empty list says so, and the Everything else button toggles with aria-expanded and the more count', () => {
    const { h, rerender } = setup({ rows: [], more: 0 });
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Everything else' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(h.onToggleAll).toHaveBeenCalledTimes(1);
    rerender(<FirstList list={{ rows: [], more: 4 }} allOpen onTalk={h.onTalk} onOpenTask={h.onOpenTask} onOpenItem={h.onOpenItem} onToggleAll={h.onToggleAll} />);
    expect(screen.getByRole('button', { name: /Everything else, and 4 more/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a missing list reads as empty', () => {
    setup(undefined);
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
  });

  it('shows no dash', () => {
    const { container } = setup({ rows: [row({ title: 'A — B' })], more: 0 });
    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
