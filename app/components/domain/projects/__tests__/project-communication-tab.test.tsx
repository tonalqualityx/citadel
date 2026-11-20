import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectCommunicationTab } from '../project-communication-tab';

const mockGet = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectCommunicationTab projectId="proj-1" />
    </QueryClientProvider>,
  );
}

const timeline = {
  items: [
    { kind: 'question', id: 'q1', at: '2026-11-13T10:00:00Z', title: 'Which crop?', detail: 'Asked of Lisa, open', from: 'Bast', href: '/tasks/t1', external: false, card: { id: 't1', title: 'Hero' }, state: 'open' },
    { kind: 'email', id: 'e1', at: '2026-11-12T10:00:00Z', title: 'Hero photo', detail: 'Wants more of the photo', from: 'Lisa', href: 'https://mail.google.com/mail/u/?authuser=a#all/1', external: true, card: { id: 't1', title: 'Hero' } },
    { kind: 'meeting', id: 'm1', at: '2026-11-10T10:00:00Z', title: 'Kickoff', detail: null, from: 'Mike', href: '/meetings/m1', external: false, card: null },
  ],
  counts: { email: 1, question: 1, meeting: 1 },
};

describe('ProjectCommunicationTab', () => {
  beforeEach(() => mockGet.mockReset());

  it('reads the project timeline and links each item to its thread, card or meeting', async () => {
    mockGet.mockResolvedValue(timeline);
    renderTab();
    const email = await screen.findByText('Hero photo');
    expect(mockGet).toHaveBeenCalledWith('/projects/proj-1/communication');
    expect(email.closest('a')).toHaveAttribute('href', 'https://mail.google.com/mail/u/?authuser=a#all/1');
    expect(email.closest('a')).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Which crop?').closest('a')).toHaveAttribute('href', '/tasks/t1');
    expect(screen.getByText('Kickoff').closest('a')).toHaveAttribute('href', '/meetings/m1');
    expect(screen.getAllByText('Card: Hero')).toHaveLength(2);
    expect(screen.getByText('All (3)')).toBeInTheDocument();
  });

  it('filters to one kind', async () => {
    mockGet.mockResolvedValue(timeline);
    renderTab();
    await screen.findByText('Hero photo');
    fireEvent.click(screen.getByText('Meetings (1)'));
    expect(screen.getByText('Kickoff')).toBeInTheDocument();
    expect(screen.queryByText('Hero photo')).not.toBeInTheDocument();
    expect(screen.queryByText('Which crop?')).not.toBeInTheDocument();
  });

  it('says so when the project has no communication', async () => {
    mockGet.mockResolvedValue({ items: [], counts: { email: 0, question: 0, meeting: 0 } });
    renderTab();
    expect(await screen.findByText('No communication yet')).toBeInTheDocument();
  });
});
