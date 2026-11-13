import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';

const m = vi.hoisted(() => ({ card: undefined as unknown, act: vi.fn(), talkAbout: vi.fn() }));
vi.mock('@/lib/hooks/use-triage-card', () => ({
  useTriageCard: () => ({ data: m.card }),
  triageCardKeys: { task: (id: string) => ['triage-card', id] },
}));
vi.mock('@/lib/hooks/use-home', () => ({ useHomeAct: () => m.act }));
vi.mock('@/components/domain/bast-chat/BastChatProvider', () => ({ useBastChatShell: () => ({ talkAbout: m.talkAbout }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TriagePanel } from '../TriagePanel';
import type { HomeTriageCard } from '@/lib/home/types';

const ID = '7aa4a01a-1111-4222-8333-944445555666';
const base: HomeTriageCard = {
  task_id: ID,
  title: 'Idea',
  href: `/tasks/${ID}`,
  kind: 'task',
  created_at: '2026-11-01T00:00:00Z',
  age_days: 5,
  summary: '',
  release_line: 'Moves to Not started, assigned to Bast.',
  release_version: 'v1',
  release_ready: true,
  release_block: null,
  open_questions: 0,
  looks_done: null,
  project: null,
};
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  m.act.mockReset().mockResolvedValue({});
  m.talkAbout.mockReset();
});

describe('TriagePanel', () => {
  it('renders nothing when the card is not available (not Mike, or not in Triage)', () => {
    m.card = null;
    const { container } = wrap(<TriagePanel taskId={ID} />);
    expect(container.textContent).toBe('');
  });

  it('shows the kind, the On release line and the actions, and Release sends the version it read', async () => {
    m.card = base;
    wrap(<TriagePanel taskId={ID} />);
    const p = screen.getByTestId('triage-panel');
    expect(within(p).getByText('Single task')).toBeTruthy();
    expect(within(p).getByTestId('release-line').textContent).toBe('On release: Moves to Not started, assigned to Bast.');
    fireEvent.click(within(p).getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(m.act).toHaveBeenCalledWith({ action: 'triage_release_card', task_ids: [ID], release_version: 'v1' }));
    fireEvent.click(within(p).getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(m.act).toHaveBeenCalledWith({ action: 'triage_drop', task_ids: [ID] }));
  });

  it('Talk about this opens the card conversation in place, bound to the page', () => {
    m.card = base;
    wrap(<TriagePanel taskId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Talk about this' }));
    expect(m.talkAbout).toHaveBeenCalledWith(expect.objectContaining({ task_id: ID, own_conversation: true, tile: 'triage' }), { bindToPage: true });
  });

  it('a not-sorted card has Release disabled with the reason', () => {
    m.card = { ...base, kind: null, release_ready: false, release_block: 'unsorted', release_line: 'Not sorted yet' };
    wrap(<TriagePanel taskId={ID} />);
    expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Not sorted yet', { selector: '.home-tkind' })).toBeTruthy();
  });

  it('a looks-done card shows the evidence and the looks-done actions', async () => {
    m.card = { ...base, looks_done: { evidence: 'Done in abc123 https://example.com/c', links: [{ text: 'https://example.com/c', href: 'https://example.com/c' }] } };
    wrap(<TriagePanel taskId={ID} />);
    expect(screen.getByTestId('looks-done-evidence').textContent).toContain('Done in abc123 example.com/c');
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close as done' }));
    await waitFor(() => expect(m.act).toHaveBeenCalledWith({ action: 'triage_close_done', task_ids: [ID] }));
  });

  it('a project card shows the full block: contract link, every phase with summary, what will be his, the whole sitemap, and no tasks', () => {
    m.card = {
      ...base,
      kind: 'project_setup',
      project: {
        project_id: 'p1',
        name: 'Grok',
        status: 'queue',
        phases: [
          { id: 'a', name: 'Design', summary: 'Lisa designs the pages', mike_part: null },
          { id: 'b', name: 'Content', summary: 'Copy gets written', mike_part: 'Approve the copy' },
        ],
        mike_parts: [{ phase: 'Content', text: 'Approve the copy' }],
        contract: { status: 'signed', signed_at: '2026-10-20T15:00:00Z', version: 1, deal_id: 'd1', deal_href: '/deals/d1' },
        deal: { id: 'd1', name: 'Grok deal', href: '/deals/d1' },
        sitemap: [
          { id: 's1', name: 'Home', page_type: 'landing', needs_design: true, notes: 'Hero first' },
          { id: 's2', name: 'About', page_type: null, needs_design: false, notes: null },
        ],
      },
    };
    wrap(<TriagePanel taskId={ID} />);
    const full = screen.getByTestId('triage-project-full');
    expect(within(full).getByRole('link', { name: 'Grok deal' }).getAttribute('href')).toBe('/deals/d1');
    expect(full.textContent).toContain('Contract signed Oct 20, 2026');
    expect(full.textContent).toContain('Lisa designs the pages');
    expect(full.textContent).toContain('Copy gets written');
    expect(within(full).getByText('What will be yours')).toBeTruthy();
    expect(full.textContent).toContain('Approve the copy');
    expect(within(full).getByText('Sitemap (2)')).toBeTruthy();
    expect(full.textContent).toContain('Home');
    expect(full.textContent).toContain('Hero first');
  });
});
