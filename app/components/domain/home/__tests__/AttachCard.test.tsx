import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachCard } from '../AttachCard';
import type { HomeAttach, HomeItem } from '@/lib/home/types';

const KEY = 'attach:7aa4a01a-1111-4222-8333-944445555666';
const W = 'project:7aa4a01a-1111-4222-8333-944445555001';
const H = 'project:7aa4a01a-1111-4222-8333-944445555002';

function item(over: Partial<HomeAttach> = {}): HomeItem {
  return {
    key: KEY,
    type: 'attach',
    title: 'New email from Ashlei (Thermalnetics): add to "Thermalnetics website" or "Thermalnetics hosting", or start a new project?',
    who: 'Ashlei',
    age: 'less than a day',
    why_now: 'It could belong to more than one piece of work.',
    hard_date: null,
    effort: 'About 1 minute',
    minutes: 1,
    actions: [{ id: 'not_now', label: 'Not now', filled: false, href: null }],
    more_actions: [],
    default_if_ignored: 'It stays here. Nothing is added to your list for it.',
    reason: 'Nothing was attached on a guess.',
    pinned: false,
    opened: { summary: '', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'attach', id: '7aa4a01a-1111-4222-8333-944445555666', ids: [], task_status: null },
    client: null,
    project: null,
    attach: {
      key: KEY,
      source_kind: 'email',
      source_href: 'https://mail.google.com/mail/u/0/#all/abc',
      candidates: [
        { choice: W, label: 'Thermalnetics website', href: '/projects/7aa4a01a-1111-4222-8333-944445555001' },
        { choice: H, label: 'Thermalnetics hosting', href: '/projects/7aa4a01a-1111-4222-8333-944445555002' },
      ],
      can_new_project: true,
      can_task: false,
      ...over,
    },
  } as HomeItem;
}

describe('AttachCard', () => {
  it('shows each candidate as a link to its work, and the email link', () => {
    render(<AttachCard item={item()} onAction={vi.fn()} onAct={vi.fn()} />);
    const links = screen.getByTestId('attach-candidates').querySelectorAll('a');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['/projects/7aa4a01a-1111-4222-8333-944445555001', '/projects/7aa4a01a-1111-4222-8333-944445555002']);
    expect(screen.getByText('Open it').getAttribute('href')).toContain('mail.google.com');
  });

  it('has one button per candidate, New project and Not work, and no Just a task unless offered', () => {
    render(<AttachCard item={item()} onAction={vi.fn()} onAct={vi.fn()} />);
    expect(screen.getAllByTestId('attach-candidate-button').map((b) => b.textContent)).toEqual(['Thermalnetics website', 'Thermalnetics hosting']);
    expect(screen.getByText('New project')).toBeTruthy();
    expect(screen.getByText('Not work')).toBeTruthy();
    expect(screen.queryByText('Just a task')).toBeNull();
  });

  it('offers Just a task when the source names one deliverable, and New project only with a client', () => {
    render(<AttachCard item={item({ can_task: true, can_new_project: false })} onAction={vi.fn()} onAct={vi.fn()} />);
    expect(screen.getByText('Just a task')).toBeTruthy();
    expect(screen.queryByText('New project')).toBeNull();
  });

  it('each answer sends attach_choose with its choice', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    render(<AttachCard item={item({ can_task: true })} onAction={vi.fn()} onAct={onAct} />);
    fireEvent.click(screen.getAllByTestId('attach-candidate-button')[1]);
    await waitFor(() => expect(onAct).toHaveBeenLastCalledWith({ action: 'attach_choose', item_key: KEY, choice: H }));
    fireEvent.click(screen.getByText('New project'));
    await waitFor(() => expect(onAct).toHaveBeenLastCalledWith({ action: 'attach_choose', item_key: KEY, choice: 'new_project' }));
    fireEvent.click(screen.getByText('Just a task'));
    await waitFor(() => expect(onAct).toHaveBeenLastCalledWith({ action: 'attach_choose', item_key: KEY, choice: 'task' }));
    fireEvent.click(screen.getByText('Not work'));
    await waitFor(() => expect(onAct).toHaveBeenLastCalledWith({ action: 'attach_choose', item_key: KEY, choice: 'not_work' }));
  });

  it('Not now is the home action', () => {
    const onAction = vi.fn();
    render(<AttachCard item={item()} onAction={onAction} onAct={vi.fn()} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(onAction.mock.calls[0][0].id).toBe('not_now');
  });
});
