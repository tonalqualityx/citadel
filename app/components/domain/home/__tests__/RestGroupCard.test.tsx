import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { HomeEverythingElseGroup } from '@/lib/home/types';
import { RestGroupCard } from '../RestGroupCard';

const group: HomeEverythingElseGroup = {
  key: 'scheduled',
  label: 'Back on a day',
  count: 3,
  owner: 'You',
  items: [
    { key: 'task:a', title: 'First task', owner: 'You', check_text: 'Back Thursday, November 12', check_at: '2026-11-12T05:05:00Z', past_check: false, can_bring_forward: true },
    { key: 'task:b', title: 'Second task', owner: 'You', check_text: 'Back Friday, November 13', check_at: null, past_check: false, can_bring_forward: true },
    { key: null, title: 'Grok sign-off', owner: 'The Grok sign-off', check_text: 'Waits for the sign-off', check_at: null, past_check: false, can_bring_forward: false },
  ],
};

describe('RestGroupCard', () => {
  it('renders heading lines and every row with owner and check text', () => {
    render(<RestGroupCard headingLines={['3 other items are counted here. 2 have a day to come back.', 'None is past its day.']} group={group} emptyText="" onBringForward={vi.fn()} />);
    expect(screen.getByText('None is past its day.')).toBeInTheDocument();
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Back Friday, November 13')).toBeInTheDocument();
    expect(screen.getByText('The Grok sign-off')).toBeInTheDocument();
  });
  it('shows the button only where it can move, and posts that item key', () => {
    const onBringForward = vi.fn();
    render(<RestGroupCard headingLines={['x']} group={group} emptyText="" onBringForward={onBringForward} />);
    const buttons = screen.getAllByRole('button', { name: 'Bring it forward' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onBringForward).toHaveBeenCalledWith('task:b');
  });
  it('disables the button while that item is moving and shows the empty text with no group', () => {
    const { rerender } = render(<RestGroupCard headingLines={['x']} group={group} emptyText="" busyKey="task:a" onBringForward={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Bring it forward' })[0]).toBeDisabled();
    rerender(<RestGroupCard headingLines={['x']} group={null} emptyText="Nothing here." onBringForward={vi.fn()} />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
