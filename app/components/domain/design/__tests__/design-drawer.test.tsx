import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { WorkerBanner } from '../WorkerBanner';
import { SessionList } from '../SessionList';

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
    render(<SessionList sessions={[{ id: 'abc', task: { id: 't', title: 'Hero' }, site: { name: 'vcdp.org' }, status: 'awaiting_input', last_publish: null, updated_at: '' }]} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/design/s/abc');
    expect(screen.getByText('awaiting input')).toBeTruthy();
  });
  it('empty', () => {
    render(<SessionList sessions={[]} />);
    expect(screen.getByText('No sessions yet.')).toBeTruthy();
  });
});
