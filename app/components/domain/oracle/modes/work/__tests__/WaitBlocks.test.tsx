import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

const openTaskPeek = vi.fn();
const mutate = vi.fn();
vi.mock('@/lib/contexts/task-peek-context', () => ({ useTaskPeek: () => ({ openTaskPeek }) }));
vi.mock('@/lib/hooks/use-waits', () => ({ useUpdateWait: () => ({ mutate, isPending: false }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BlockingToday } from '../BlockingToday';
import { DueThisWeek } from '../DueThisWeek';
import { AdminBlock } from '../AdminBlock';
import type { BlockingRow } from '@/lib/waits/ritual-blocks';

function row(over: Partial<BlockingRow> = {}): BlockingRow {
  return {
    id: 'w1',
    title: 'Approve the VCDP sitemap',
    kind: 'approval',
    state: 'waiting',
    client: { id: 'c1', name: 'VCDP' },
    project_id: null,
    due_at: '2026-10-21T21:00:00.000Z',
    client_waiting_since: '2026-10-13T14:00:00.000Z',
    waiting_days: 8,
    nag_level: 1,
    business_days_late: 0,
    label: 'waiting 8 days',
    countdown: false,
    is_project_approval: false,
    action: { type: 'wait', id: 'w1' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BlockingToday', () => {
  it('renders nothing when there is nothing blocking', () => {
    const { container } = render(<BlockingToday blocks={{ rows: [], more: 0, total: 0, overflow: [] }} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<BlockingToday blocks={undefined} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('shows the client, the wait, and one button per row', () => {
    render(<BlockingToday blocks={{ rows: [row()], more: 0, total: 1, overflow: [] }} />);
    expect(screen.getByTestId('blocking-today')).toBeInTheDocument();
    expect(screen.getByText('Approve the VCDP sitemap')).toBeInTheDocument();
    expect(screen.getByText('VCDP · waiting 8 days')).toBeInTheDocument();
    expect(screen.getAllByTestId('blocking-row-action')).toHaveLength(1);
    expect(screen.queryByTestId('blocking-more')).not.toBeInTheDocument();
  });

  it('a task row opens the task peek', () => {
    render(<BlockingToday blocks={{ rows: [row({ action: { type: 'task', id: 't9' } })], more: 0, total: 1, overflow: [] }} />);
    fireEvent.click(screen.getByText('Open task'));
    expect(openTaskPeek).toHaveBeenCalledWith('t9');
  });

  it('a project approval links to the project', () => {
    render(
      <BlockingToday
        blocks={{ rows: [row({ project_id: 'p1', action: { type: 'approval', id: 'ar1' } })], more: 0, total: 1, overflow: [] }}
      />
    );
    expect(screen.getByText('Open approval').closest('a')).toHaveAttribute('href', '/projects/p1');
  });

  it('a bare gate closes the wait as approved', () => {
    render(<BlockingToday blocks={{ rows: [row()], more: 0, total: 1, overflow: [] }} />);
    fireEvent.click(screen.getByText('Approved'));
    expect(mutate).toHaveBeenCalledWith({ id: 'w1', patch: { action: 'resolve', resolution: 'approved' } });
  });

  it('a bare handoff offers Mark done', () => {
    render(<BlockingToday blocks={{ rows: [row({ kind: 'handoff' })], more: 0, total: 1, overflow: [] }} />);
    fireEvent.click(screen.getByText('Mark done'));
    expect(mutate).toHaveBeenCalledWith({ id: 'w1', patch: { action: 'resolve', resolution: 'completed' } });
  });

  it('shows "and N more" and expands to the overflow rows', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', title: 'Second' })];
    render(<BlockingToday blocks={{ rows, more: 2, total: 4, overflow: [row({ id: 'c', title: 'Third' }), row({ id: 'd', title: 'Fourth' })] }} />);
    expect(screen.getAllByTestId('blocking-row')).toHaveLength(2);
    const more = screen.getByTestId('blocking-more');
    expect(more).toHaveTextContent('and 2 more blocking a client');
    fireEvent.click(more);
    expect(screen.getAllByTestId('blocking-row')).toHaveLength(4);
    expect(more).toHaveTextContent('Show fewer');
  });

  it('marks a countdown row', () => {
    render(
      <BlockingToday
        blocks={{ rows: [row({ countdown: true, label: 'VCDP has heard nothing for 8 days' })], more: 0, total: 1, overflow: [] }}
      />
    );
    expect(screen.getByTestId('blocking-row')).toHaveAttribute('data-countdown', 'true');
    expect(screen.getByText(/has heard nothing for 8 days/)).toBeInTheDocument();
  });
});

describe('DueThisWeek', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<DueThisWeek block={{ rows: [], more: 0, total: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists rows with a date and no overdue wording, and counts the rest', () => {
    render(
      <DueThisWeek
        block={{
          rows: [
            { id: 't1', type: 'task', title: 'Send the Herba invoice', due_at: '2026-10-23T16:00:00.000Z', client: { id: 'c', name: 'Herba' }, state: null, action: { type: 'task', id: 't1' } },
            { id: 'w2', type: 'wait', title: 'Say what kind of meeting the Dan call is', due_at: '2026-10-22T16:00:00.000Z', client: null, state: 'waiting', action: { type: 'wait', id: 'w2' } },
          ],
          more: 3,
          total: 5,
        }}
      />
    );
    expect(screen.getAllByTestId('due-row')).toHaveLength(2);
    expect(screen.getByText(/Herba · Fri, Oct 23/)).toBeInTheDocument();
    expect(screen.getByTestId('due-more')).toHaveTextContent('and 3 more');
    expect(document.body.textContent).not.toMatch(/overdue/i);
    fireEvent.click(screen.getByText('Send the Herba invoice'));
    expect(openTaskPeek).toHaveBeenCalledWith('t1');
  });
});

describe('AdminBlock', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<AdminBlock block={{ rows: [], more: 0, total: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the task from a row and counts the rest', () => {
    render(
      <AdminBlock
        block={{ rows: [{ id: 'a1', title: 'File the quarterly estimate', due_date: null, client: null }], more: 4, total: 5 }}
      />
    );
    fireEvent.click(screen.getByText('File the quarterly estimate'));
    expect(openTaskPeek).toHaveBeenCalledWith('a1');
    expect(screen.getByTestId('admin-more')).toHaveTextContent('and 4 more');
  });
});
