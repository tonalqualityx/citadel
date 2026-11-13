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
import { TriagePanel, TRIAGE_PANEL_STORAGE_KEY } from '../TriagePanel';
import type { HomeTriageCard } from '@/lib/home/types';
import { CARD_CHANGED_MESSAGE } from '@/lib/tasks/triage-copy';

const ID = '7aa4a01a-1111-4222-8333-944445555666';
const base: HomeTriageCard = {
  task_id: ID,
  title: 'Idea',
  href: `/tasks/${ID}`,
  kind: 'task',
  created_at: '2026-11-01T00:00:00Z',
  age_days: 5,
  summary: '',
  release_line: 'Hands this to Bast to do.',
  release_details: ['Status: Not started', 'Assigned to Bast', 'Tags added: from-triage'],
  release_version: 'v1',
  release_ready: true,
  release_block: null,
  open_questions: 0,
  triage_rev: 0,
  recent_changes: [],
  plan_line: null,
  target_start_date: null,
  target_launch_date: null,
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
    expect(within(p).getByTestId('release-line').textContent).toBe('On release: Hands this to Bast to do.');
    // Compact by default: the Details disclosure is behind More; the buttons are always there.
    expect(within(p).queryByTestId('release-details')).toBeNull();
    expect(p.getAttribute('data-expanded')).toBe('false');
    fireEvent.click(within(p).getByTestId('triage-more'));
    expect(p.getAttribute('data-expanded')).toBe('true');
    const details = within(p).getByTestId('release-details');
    expect(within(details).getByText('Details')).toBeTruthy();
    expect(details.textContent).toContain('Tags added: from-triage');
    expect(p.querySelector('[data-testid="release-line"]')!.textContent).not.toContain('from-triage');
    fireEvent.click(within(p).getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(m.act).toHaveBeenCalledWith({ action: 'triage_release_card', task_ids: [ID], release_version: 'v1' }));
    fireEvent.click(within(p).getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(m.act).toHaveBeenCalledWith({ action: 'triage_drop', task_ids: [ID] }));
  });

  it('a Release refused as card_changed says what changed, from the card\'s last change lines', async () => {
    m.card = { ...base, recent_changes: [{ line: 'Plan: Billing model updated by the chat', at: '2026-11-13T12:00:00Z', by: 'the chat' }] };
    m.act.mockRejectedValueOnce(new Error(CARD_CHANGED_MESSAGE));
    wrap(<TriagePanel taskId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(screen.getByTestId('triage-what-changed').textContent).toBe('The plan changed: Billing model updated by the chat. Nothing was released. Open the Plan tab, then tap Release again.'));
  });

  it('Talk to Dox opens the card conversation in place, bound to the page', () => {
    m.card = base;
    wrap(<TriagePanel taskId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Dox' }));
    expect(m.talkAbout).toHaveBeenCalledWith(expect.objectContaining({ task_id: ID, own_conversation: true, tile: 'triage' }), { bindToPage: true });
  });

  it('a not-sorted card has Release disabled with the reason', () => {
    m.card = { ...base, kind: null, release_ready: false, release_block: 'unsorted', release_line: 'Not sorted yet', release_details: [] };
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

  it('the panel remembers More or Less per device', () => {
    m.card = base;
    window.localStorage.removeItem(TRIAGE_PANEL_STORAGE_KEY);
    const first = wrap(<TriagePanel taskId={ID} />);
    fireEvent.click(screen.getByTestId('triage-more'));
    expect(window.localStorage.getItem(TRIAGE_PANEL_STORAGE_KEY)).toBe('1');
    first.unmount();
    wrap(<TriagePanel taskId={ID} />);
    expect(screen.getByTestId('triage-panel').getAttribute('data-expanded')).toBe('true');
    window.localStorage.removeItem(TRIAGE_PANEL_STORAGE_KEY);
  });

  it('a project card shows ONE facts line (contract, launch, phases, pages, yours, open questions) and no placeholder sentences, shape or sitemap', () => {
    m.card = {
      ...base,
      kind: 'project_setup',
      open_questions: 2,
      project: {
        project_id: 'p1',
        name: 'Grok',
        status: 'queue',
        start_date: null,
        target_date: '2027-01-19',
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
    const facts = screen.getByTestId('triage-facts');
    expect(Array.from(facts.querySelectorAll('li')).map((l) => l.textContent)).toEqual(['Signed Oct 20', 'Launch Jan 19, 2027', '2 phases', '2 pages', '1 yours', '2 open questions']);
    const p = screen.getByTestId('triage-panel');
    expect(p.textContent).not.toContain('Lisa designs the pages');
    expect(p.textContent).not.toContain('Hero first');
    expect(p.textContent).not.toContain('What will be yours');
  });

  it('a project card with nothing drafted says it in counts, not sentences', () => {
    m.card = { ...base, kind: 'project_setup', project: { project_id: 'p1', name: 'Bare', status: 'queue', start_date: null, target_date: '2027-01-19', phases: [], mike_parts: [], contract: null, deal: null, sitemap: [] } };
    wrap(<TriagePanel taskId={ID} />);
    expect(Array.from(screen.getByTestId('triage-facts').querySelectorAll('li')).map((l) => l.textContent)).toEqual(['No deal linked', 'Launch Jan 19, 2027', '0 phases', '0 pages', '0 yours']);
    expect(screen.getByTestId('triage-panel').textContent).not.toMatch(/No phases drafted yet|No pages drafted yet|Nothing is marked/);
  });
});
