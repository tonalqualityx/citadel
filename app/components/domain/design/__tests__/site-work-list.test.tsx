import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import * as React from 'react';

const push = vi.fn();
const mutateAsync = vi.fn();
const openState = { isPending: false, variables: undefined as string | undefined };
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/hooks/use-design', async (orig) => ({
  ...(await orig<typeof import('@/lib/hooks/use-design')>()),
  useOpenDesignSession: () => ({ mutateAsync, ...openState }),
}));

import { SiteWorkList } from '../SiteWorkList';
import type { DesignDrawer, DrawerEntry } from '@/lib/hooks/use-design';

const none: DrawerEntry = { action: 'none', session_id: null, task_id: null, reason: null, chip: null };
const project = (id: string, site: string, entry: Partial<DrawerEntry>, over: Partial<DesignDrawer['projects'][0]> = {}): DesignDrawer['projects'][0] => ({
  id, name: `${site} project`, site: { id: `s-${id}`, name: site, available: true },
  open_tasks: 2, track_stage: null, entry: { ...none, ...entry }, phases: [], ...over,
});
const drawer = (projects: DesignDrawer['projects']): DesignDrawer => ({ worker: { online: true, paused: false }, projects });

beforeEach(() => {
  push.mockReset();
  mutateAsync.mockReset();
  openState.isPending = false;
  openState.variables = undefined;
});

describe('SiteWorkList', () => {
  it('shows site, project, task count and stage, one row per project', () => {
    render(<SiteWorkList drawer={drawer([
      project('p1', 'vcdp.org', { action: 'start', task_id: 't1' }, { open_tasks: 1, track_stage: 'refine' }),
      project('p2', 'off.org', { action: 'start', task_id: 't2' }),
    ])} />);
    const rows = screen.getAllByTestId('site-row');
    expect(rows.map((r) => r.getAttribute('data-project-id'))).toEqual(['p1', 'p2']);
    const first = screen.getByRole('region', { name: 'vcdp.org' });
    expect(within(first).getByText('vcdp.org project')).toBeTruthy();
    expect(within(first).getByText('1 open quest')).toBeTruthy();
    expect(within(first).getByText('Stage: Refine')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'off.org' })).getByText('2 open quests')).toBeTruthy();
  });

  it('Resume navigates to the session without a POST, and shows the chip', () => {
    render(<SiteWorkList drawer={drawer([project('p1', 'vcdp.org', { action: 'resume', session_id: 'sess-1', task_id: 't1', chip: 'awaiting_you' })])} />);
    expect(screen.getByText('Mine: Waiting on you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(push).toHaveBeenCalledWith('/design/s/sess-1');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('a pm entry shows View and an In use chip', () => {
    render(<SiteWorkList drawer={drawer([project('p1', 'vcdp.org', { action: 'view', session_id: 'sess-1', task_id: 't1', chip: 'active' })])} />);
    expect(screen.getByText('In use: Active')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(push).toHaveBeenCalledWith('/design/s/sess-1');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('an admin or tech entry shows Join and an In use chip', () => {
    render(<SiteWorkList drawer={drawer([project('p1', 'vcdp.org', { action: 'join', session_id: 'sess-2', task_id: 't1', chip: 'awaiting_you' })])} />);
    expect(screen.getByText('In use: Waiting on you')).toBeTruthy();
    expect(screen.queryByText(/^Mine:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(push).toHaveBeenCalledWith('/design/s/sess-2');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Open posts the task id then navigates', async () => {
    mutateAsync.mockResolvedValue({ session: { id: 'new-1' } });
    render(<SiteWorkList drawer={drawer([project('p1', 'vcdp.org', { action: 'start', task_id: 't9' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(mutateAsync).toHaveBeenCalledWith('t9');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/design/s/new-1'));
  });

  it('a failed open stays on the page', async () => {
    mutateAsync.mockRejectedValue(new Error('no'));
    render(<SiteWorkList drawer={drawer([project('p1', 'vcdp.org', { action: 'start', task_id: 't9' })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('disables Open while a session is being opened', () => {
    openState.isPending = true;
    openState.variables = 't9';
    render(<SiteWorkList drawer={drawer([project('p1', 'vcdp.org', { action: 'start', task_id: 't9' })])} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('unavailable, taken, not ready and read-only states', () => {
    render(<SiteWorkList drawer={drawer([
      project('p1', 'a.org', { action: 'none', reason: 'unavailable' }),
      project('p2', 'b.org', { action: 'none', reason: 'taken', chip: 'active' }),
      project('p3', 'c.org', { action: 'none', reason: 'read_only' }),
      project('p4', 'd.org', { action: 'none', reason: 'not_ready' }),
    ])} />);
    const na = screen.getByRole('button', { name: 'Not available yet' }) as HTMLButtonElement;
    const used = screen.getByRole('button', { name: 'In use' }) as HTMLButtonElement;
    expect(na.disabled).toBe(true);
    expect(used.disabled).toBe(true);
    expect(screen.getByText('Taken: Active')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Not ready yet' }) as HTMLButtonElement).disabled).toBe(true);
    const c = screen.getByRole('region', { name: 'c.org' });
    expect(within(c).queryByRole('button')).toBeNull();
    expect(within(c).getByText('No session yet')).toBeTruthy();
    fireEvent.click(na);
    expect(push).not.toHaveBeenCalled();
  });

  it('renders the empty state', () => {
    render(<SiteWorkList drawer={drawer([])} />);
    expect(screen.getByText('No sites with open work yet')).toBeTruthy();
    expect(screen.getByText('Sites with open quests show up here.')).toBeTruthy();
  });
});
