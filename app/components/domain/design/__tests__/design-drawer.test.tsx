import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { TaskDrawer } from '../TaskDrawer';
import { WorkerBanner } from '../WorkerBanner';
import { SessionList } from '../SessionList';
import type { DesignDrawer } from '@/lib/hooks/use-design';

const task = (id: string, title: string, session: DesignDrawer['projects'][0]['phases'][0]['tasks'][0]['session'] = null) =>
  ({ id, title, status: 'todo', phase: 'Build', session });

const drawer = (over: Partial<DesignDrawer> = {}): DesignDrawer => ({
  worker: { online: true, paused: false },
  projects: [
    {
      id: 'p1', name: 'VCDP', site: { id: 's1', name: 'vcdp.org', available: true },
      phases: [
        { name: 'Discovery', tasks: [task('t1', 'Hero copy')] },
        { name: 'Build', tasks: [
          task('t2', 'Footer', { id: 'x1', status: 'active', mine: true, chip: 'awaiting_you', published_at: null }),
          task('t3', 'Nav', { id: null, status: 'active', mine: false, chip: 'active', published_at: null }),
        ] },
      ],
    },
    { id: 'p2', name: 'Offsite', site: { id: 's2', name: 'off.org', available: false }, phases: [{ name: null, tasks: [task('t4', 'Logo')] }] },
  ],
  ...over,
});

describe('TaskDrawer', () => {
  it('groups by project then phase', () => {
    render(<TaskDrawer drawer={drawer()} taskTerm="Quests" onOpenTask={vi.fn()} />);
    const vcdp = screen.getByRole('region', { name: 'VCDP' });
    expect(within(vcdp).getByText('Discovery')).toBeTruthy();
    expect(within(vcdp).getByText('Build')).toBeTruthy();
    expect(within(vcdp).getByText('Hero copy')).toBeTruthy();
    expect(screen.getByText('No phase')).toBeTruthy();
  });

  it('shows mine / taken / none chips and disables taken', () => {
    const onOpen = vi.fn();
    render(<TaskDrawer drawer={drawer()} taskTerm="Quests" onOpenTask={onOpen} />);
    expect(screen.getByText('Mine: Waiting on you')).toBeTruthy();
    expect(screen.getByText('Taken')).toBeTruthy();
    expect(screen.getAllByText('No session').length).toBe(2);
    const navRow = screen.getByText('Nav').closest('li')!;
    expect((within(navRow).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByText('Footer').closest('li')!).getByRole('button', { name: 'Resume' }));
    expect(onOpen).toHaveBeenCalledWith('t2');
  });

  it('marks sites not on the box as not available yet and blocks opening', () => {
    const onOpen = vi.fn();
    render(<TaskDrawer drawer={drawer()} taskTerm="Quests" onOpenTask={onOpen} />);
    const btn = screen.getByRole('button', { name: 'Not available yet' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/this site is not set up for design/)).toBeTruthy();
  });

  it('renders the empty state', () => {
    render(<TaskDrawer drawer={drawer({ projects: [] })} taskTerm="Quests" onOpenTask={vi.fn()} />);
    expect(screen.getByText('No open quests yet')).toBeTruthy();
  });
});

describe('WorkerBanner', () => {
  it('is silent when online', () => {
    const { container } = render(<WorkerBanner worker={{ online: true, paused: false }} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows offline', () => {
    render(<WorkerBanner worker={{ online: false, paused: false }} />);
    expect(screen.getByRole('status').textContent).toMatch(/offline/);
  });
  it('shows paused (even when online)', () => {
    render(<WorkerBanner worker={{ online: true, paused: true }} />);
    expect(screen.getByRole('status').textContent).toMatch(/paused/);
  });
});

describe('SessionList', () => {
  it('links to the workspace', () => {
    render(<SessionList sessions={[{ id: 'abc', task: { id: 't', title: 'Hero' }, site: { name: 'vcdp.org' }, status: 'awaiting_input', last_publish: null, cost_usd: 0, budget_usd: 10, updated_at: '' }]} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/design/s/abc');
    expect(screen.getByText('awaiting input')).toBeTruthy();
  });
  it('empty', () => {
    render(<SessionList sessions={[]} />);
    expect(screen.getByText('No sessions yet.')).toBeTruthy();
  });
});
