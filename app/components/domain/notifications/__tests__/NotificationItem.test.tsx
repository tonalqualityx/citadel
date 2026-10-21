import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { NotificationItem } from '../NotificationItem';

const T = '14d1ef50-0000-4000-8000-000000000000';
const base = { id: 'n1', message: null, is_read: false, read_at: null, bundle_count: 1, created_at: new Date().toISOString() };

describe('NotificationItem click', () => {
  it('opens the task page for a new portal request alert and marks it read', () => {
    const onMarkAsRead = vi.fn();
    const onClose = vi.fn();
    render(
      <NotificationItem
        notification={{ ...base, type: 'system_alert', title: 'New portal request from Acme: Fix menu', entity_type: 'task', entity_id: T }}
        onMarkAsRead={onMarkAsRead}
        onDelete={vi.fn()}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText(/New portal request from Acme/));
    expect(push).toHaveBeenCalledWith(`/tasks/${T}`);
    expect(onMarkAsRead).toHaveBeenCalledWith('n1');
    expect(onClose).toHaveBeenCalled();
  });
  it('uses the task link in the message when the row has no entity', () => {
    push.mockClear();
    render(
      <NotificationItem
        notification={{ ...base, type: 'system_alert', title: 'New portal request from Acme', message: `Open the task: https://x.test/tasks/${T}`, entity_type: null, entity_id: null }}
        onMarkAsRead={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/New portal request from Acme/));
    expect(push).toHaveBeenCalledWith(`/tasks/${T}`);
  });
});
