import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.hoisted(() => ({ answer: vi.fn(), push: vi.fn(), data: { questions: [] as unknown[], open_count: 0 } }));
vi.mock('@/lib/hooks/use-task-questions', () => ({
  useTaskQuestions: () => ({ data: q.data, isLoading: false }),
  useAnswerQuestion: () => q.answer,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: q.push }) }));

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { TriageBoard } from '../TriageBoard';
import { CARD_CHANGED_MESSAGE } from '@/lib/tasks/triage-copy';
import type { HomeTriage, HomeTriageCard } from '@/lib/home/types';

const U = '7aa4a01a-1111-4222-8333-9444455';
const card = (n: number, over: Partial<HomeTriageCard> = {}): HomeTriageCard => ({
  task_id: `${U}${String(n).padStart(5, '0')}`,
  title: `Idea ${n}`,
  href: `/tasks/${n}`,
  kind: 'task',
  created_at: '2026-11-01T00:00:00Z',
  age_days: 5,
  summary: 'Make the footer links bigger.',
  release_line: 'Hands this to Bast to do.',
  release_details: ['Status: Not started', 'Assigned to Bast', 'Tags added: from-triage'],
  release_version: `v${n}`,
  release_ready: true,
  release_block: null,
  open_questions: 0,
  looks_done: null,
  project: null,
  ...over,
});
const triage = (cards: HomeTriageCard[], asked: HomeTriage['asked_after_release'] = []): HomeTriage => ({
  count: cards.length,
  open_questions: cards.reduce((a, c) => a + c.open_questions, 0),
  groups: [],
  cards,
  asked_after_release: asked,
});
const items = () => screen.getAllByTestId('triage-card-item');

beforeEach(() => q.push.mockReset());

describe('TriageBoard', () => {
  it('renders one card per idea in a grid, in the order the server sent', () => {
    render(<TriageBoard triage={triage([card(1), card(2), card(3)])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByTestId('triage-grid')).toBeTruthy();
    expect(items().map((c) => within(c).getByRole('link').textContent)).toEqual(['Idea 1', 'Idea 2', 'Idea 3']);
  });

  it('empty state says what to do', () => {
    render(<TriageBoard triage={triage([])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByText('Nothing in Triage. Tell Bast and it lands here.')).toBeTruthy();
    expect(screen.queryByTestId('triage-grid')).toBeNull();
  });

  it('a plain card: kind in words, age, linked title, summary, On release line, Release filled, Drop, Talk about this', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    const onTalk = vi.fn();
    const c = card(1);
    render(<TriageBoard triage={triage([c])} onAct={onAct} onTalk={onTalk} />);
    const el = items()[0];
    expect(within(el).getByText('Single task')).toBeTruthy();
    expect(within(el).getByText('5 days old')).toBeTruthy();
    expect(within(el).getByRole('link', { name: 'Idea 1' }).getAttribute('href')).toBe('/tasks/1');
    expect(within(el).getByText('Make the footer links bigger.')).toBeTruthy();
    expect(within(el).getByTestId('release-line').textContent).toBe(`On release: ${c.release_line}`);
    // System words (status, tags) never appear on the tab card, and there is no Details disclosure there.
    expect(el.textContent).not.toMatch(/not_started|Not started|from-triage|kickoff|needs-pm-release/);
    expect(within(el).queryByTestId('release-details')).toBeNull();
    expect(within(el).getByRole('button', { name: 'Release' }).getAttribute('data-filled')).toBe('true');
    fireEvent.click(within(el).getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_release_card', task_ids: [c.task_id], release_version: 'v1' }));
    fireEvent.click(within(el).getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_drop', task_ids: [c.task_id] }));
    fireEvent.click(within(el).getByRole('button', { name: 'Talk about this' }));
    expect(onTalk).toHaveBeenCalledWith({ key: `task:${c.task_id}`, title: 'Idea 1', type: 'task', task_id: c.task_id, tile: 'triage' });
  });

  it('the whole card opens the card page; its buttons and link do not trigger that', async () => {
    render(<TriageBoard triage={triage([card(1)])} onAct={vi.fn().mockResolvedValue({})} onTalk={vi.fn()} />);
    const el = items()[0];
    fireEvent.click(within(el).getByText('Make the footer links bigger.'));
    expect(q.push).toHaveBeenCalledWith('/tasks/1');
    q.push.mockReset();
    fireEvent.click(within(el).getByRole('button', { name: 'Drop' }));
    fireEvent.click(within(el).getByRole('button', { name: 'Talk about this' }));
    fireEvent.click(within(el).getByRole('link', { name: 'Idea 1' }));
    await waitFor(() => expect(q.push).not.toHaveBeenCalled());
  });

  it('a not-sorted card says so and Release is disabled', () => {
    const onAct = vi.fn();
    render(<TriageBoard triage={triage([card(1, { kind: null, release_ready: false, release_block: 'unsorted', release_line: 'Not sorted yet' })])} onAct={onAct} onTalk={vi.fn()} />);
    const el = items()[0];
    expect(within(el).getByText('Not sorted yet', { selector: '.home-tkind' })).toBeTruthy();
    const rel = within(el).getByRole('button', { name: 'Release' }) as HTMLButtonElement;
    expect(rel.disabled).toBe(true);
    expect(within(el).getByTestId('release-line').getAttribute('data-blocked')).toBe('unsorted');
    expect(within(el).getByTestId('release-line').textContent).toContain('Release is off');
    fireEvent.click(rel);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('a card blocked by a quote shows the server reason and disables Release', () => {
    render(<TriageBoard triage={triage([card(1, { kind: 'project_addition', release_ready: false, release_block: 'still_quote', release_line: 'Grok is still a quote, so release is refused.' })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByTestId('release-line').textContent).toContain('Grok is still a quote');
    expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a project card shows contract state with a deal link, phases with Yours marked, and the page count with first names', () => {
    const project = {
      project_id: 'p1',
      name: 'Grok rebuild',
      status: 'queue',
      phases: ['Discover', 'Design', 'Build', 'Content', 'Launch'].map((n, i) => ({ id: `ph${i}`, name: n, summary: `${n} summary`, mike_part: n === 'Content' ? 'Approve the copy' : null })),
      mike_parts: [{ phase: 'Content', text: 'Approve the copy' }],
      contract: { status: 'signed' as const, signed_at: '2026-10-20T15:00:00Z', version: 1, deal_id: 'd1', deal_href: '/deals/d1' },
      deal: { id: 'd1', name: 'Grok deal', href: '/deals/d1' },
      sitemap: ['Home', 'About', 'Shop', 'Blog', 'Contact', 'Faq', 'Terms', 'Privacy'].map((n, i) => ({ id: `pg${i}`, name: n, page_type: null, needs_design: false, notes: null })),
    };
    render(<TriageBoard triage={triage([card(1, { kind: 'project_setup', project })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    const el = items()[0];
    expect(within(el).getByText('New project')).toBeTruthy();
    const c = within(el).getByTestId('triage-contract');
    expect(c.textContent).toContain('Contract signed Oct 20, 2026');
    expect(within(c).getByRole('link', { name: 'Grok deal' }).getAttribute('href')).toBe('/deals/d1');
    const phases = within(el).getByRole('list', { name: 'Phases' });
    expect(within(phases).getAllByRole('listitem')).toHaveLength(5);
    expect(within(phases).getAllByText('Yours')).toHaveLength(1);
    expect(within(el).getByText('8 pages: Home, About, Shop, and 5 more')).toBeTruthy();
    expect(within(el).queryAllByText(/task/i)).toHaveLength(0);
  });

  it('a looks-done card comes with a badge, the evidence with its links, and Close as done (filled), Not done, Talk about this', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    const c = card(1, { looks_done: { evidence: 'Shipped in 3ee16d7, see https://example.com/a and https://example.com/b.', links: [{ text: 'https://example.com/a', href: 'https://example.com/a' }, { text: 'https://example.com/b', href: 'https://example.com/b' }] } });
    render(<TriageBoard triage={triage([c, card(2)])} onAct={onAct} onTalk={vi.fn()} />);
    const el = items()[0];
    expect(el.getAttribute('data-looks-done')).toBe('true');
    expect(within(el).getByText('Looks done')).toBeTruthy();
    expect(within(el).getByTestId('looks-done-evidence').textContent).toContain('Shipped in 3ee16d7, see example.com/a and example.com/b.');
    expect(within(el).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('https://')).map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(within(el).queryByRole('button', { name: 'Release' })).toBeNull();
    expect(within(el).getByRole('button', { name: 'Close as done' }).getAttribute('data-filled')).toBe('true');
    fireEvent.click(within(el).getByRole('button', { name: 'Close as done' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_close_done', task_ids: [c.task_id] }));
    fireEvent.click(within(el).getByRole('button', { name: 'Not done' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_not_done', task_ids: [c.task_id] }));
    expect(within(el).getByRole('button', { name: 'Talk about this' })).toBeTruthy();
  });

  it('the questions button shows the count and opens the questions in place without opening the card', () => {
    q.data = {
      questions: [{ id: 'q1', state: 'open', ask: 'Which logo?', what_it_is: 'The header logo', sources: [], checked: 'x', unknown: 'y', options: [], if_nobody_action: 'wait_for_mike', version: 'a' }],
      open_count: 1,
    };
    render(<TriageBoard triage={triage([card(1, { open_questions: 3 })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    const el = items()[0];
    const btn = within(el).getByRole('button', { name: 'Questions 3' });
    fireEvent.click(btn);
    expect(within(el).getByTestId('task-questions')).toBeTruthy();
    expect(q.push).not.toHaveBeenCalled();
    fireEvent.click(within(el).getByTestId('task-questions'));
    expect(q.push).not.toHaveBeenCalled();
    q.data = { questions: [], open_count: 0 };
  });

  it('Asked after release lists released cards with their question counts and links', () => {
    render(
      <TriageBoard
        triage={triage([card(1)], [{ task_id: 'r1', title: 'Released thing', href: '/tasks/r1', status: 'not_started', open_questions: 2, released_at: '2026-11-10T00:00:00Z' }])}
        onAct={vi.fn()}
        onTalk={vi.fn()}
      />,
    );
    const strip = screen.getByTestId('asked-after-release');
    expect(within(strip).getByRole('heading', { name: 'Asked after release' })).toBeTruthy();
    expect(within(strip).getByRole('link', { name: 'Released thing' }).getAttribute('href')).toBe('/tasks/r1');
    expect(strip.textContent).toContain('2 questions');
  });

  it('the strip shows with an empty grid too, and not at all when nothing was asked', () => {
    const { rerender } = render(
      <TriageBoard triage={triage([], [{ task_id: 'r1', title: 'R', href: '/tasks/r1', status: 'in_progress', open_questions: 1, released_at: '2026-11-10T00:00:00Z' }])} onAct={vi.fn()} onTalk={vi.fn()} />,
    );
    expect(screen.getByTestId('asked-after-release')).toBeTruthy();
    expect(screen.getByText('Nothing in Triage. Tell Bast and it lands here.')).toBeTruthy();
    rerender(<TriageBoard triage={triage([card(1)])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.queryByTestId('asked-after-release')).toBeNull();
  });

  it('a 409 card_changed leaves the card in place and says it changed so he reads the new line first', async () => {
    const onAct = vi.fn().mockRejectedValue(new Error(CARD_CHANGED_MESSAGE));
    render(<TriageBoard triage={triage([card(1)])} onAct={onAct} onTalk={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    const note = await screen.findByTestId('triage-changed');
    expect(note.textContent).toContain('changed after you read it');
    expect(note.textContent).toContain('tap Release again');
    // The button stays usable: the hook has refetched, the next tap sends the new version.
    expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('any other failure shows no card-changed note', async () => {
    render(<TriageBoard triage={triage([card(1)])} onAct={vi.fn().mockRejectedValue(new Error('boom'))} onTalk={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId('triage-changed')).toBeNull();
  });

  it('shows no em or en dash', () => {
    const { container } = render(<TriageBoard triage={triage([card(1, { summary: 'a — b' })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
