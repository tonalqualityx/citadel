import { describe, it, expect, vi } from 'vitest';

const q = vi.hoisted(() => ({ answer: vi.fn(), data: { questions: [] as unknown[], open_count: 0 } }));
vi.mock('@/lib/hooks/use-task-questions', () => ({
  useTaskQuestions: () => ({ data: q.data, isLoading: false }),
  useAnswerQuestion: () => q.answer,
}));

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { TriageCard } from '../TriageCard';
import { triageTalkCard, openTriageConversation } from '../triage-talk';
import type { HomeTriage, HomeTriageGroup } from '@/lib/home/types';

const P = '7aa4a01a-1111-4222-8333-944445555666';
const tasks = (n: number, project = 'Stronghold') =>
  Array.from({ length: n }, (_, i) => ({ task_id: `7aa4a01a-1111-4222-8333-94444555${String(i).padStart(4, '0')}`, title: `Idea ${i + 1}`, href: `/tasks/${i}`, project_name: project, open_questions: 0 }));
const group = (over: Partial<HomeTriageGroup> = {}): HomeTriageGroup => {
  const t = tasks(5);
  return { key: `project:${P}`, kind: 'project', label: 'Stronghold', count: 5, titles: t.slice(0, 3).map((x) => x.title), tasks: t, open_questions: 0, project_id: P, still_quote: false, ...over };
};
const triage = (groups: HomeTriageGroup[]): HomeTriage => ({ count: groups.reduce((n, g) => n + g.count, 0), open_questions: groups.reduce((n, g) => n + g.open_questions, 0), groups });

describe('TriageCard', () => {
  it('shows the count, and every idea as its own row with a link to its card, a summary, an age and its own actions', () => {
    const t = tasks(5).map((x, i) => ({ ...x, summary: `Wanted ${i + 1}`, created_at: '2026-11-01T00:00:00Z' }));
    render(<TriageCard triage={triage([group({ tasks: t, titles: t.slice(0, 3).map((x) => x.title) })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('5 ideas wait');
    const rows = screen.getAllByTestId('triage-row');
    expect(rows).toHaveLength(5);
    const first = within(rows[0]);
    expect(first.getByRole('link').getAttribute('href')).toBe('/tasks/0');
    expect(first.getByText('Wanted 1')).toBeTruthy();
    expect(first.getByText(/days old|weeks old|months old/)).toBeTruthy();
    expect(first.getByRole('button', { name: 'Release' })).toBeTruthy();
    expect(first.getByRole('button', { name: 'Drop' })).toBeTruthy();
    expect(first.getByRole('button', { name: 'Talk about this' })).toBeTruthy();
  });

  it('a long group shows five ideas and the rest behind Show all', () => {
    const t = tasks(8);
    render(<TriageCard triage={triage([group({ count: 8, tasks: t })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getAllByTestId('triage-row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(screen.getAllByTestId('triage-row')).toHaveLength(8);
  });

  it('Release plan, Drop all and Release post the triage acts', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    const g = group();
    render(<TriageCard triage={triage([g])} onAct={onAct} onTalk={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release plan' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_release_plan', group_key: `project:${P}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop all 5' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_drop', task_ids: g.tasks.map((t) => t.task_id) }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' })[0]);
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_release', task_ids: [g.tasks[0].task_id] }));
  });

  it('ideas with no project are not a plan: no Release plan, no Drop all, each idea has its own buttons', () => {
    const t = tasks(2, 'x');
    const none = group({ key: 'none', kind: 'none', label: 'No project', count: 2, tasks: t, titles: t.map((x) => x.title), project_id: null });
    render(<TriageCard triage={triage([none])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Release plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Drop all/ })).toBeNull();
    const rows = screen.getAllByTestId('triage-row');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(within(r).getByRole('button', { name: 'Release' })).toBeTruthy();
      expect(within(r).getByRole('button', { name: 'Drop' })).toBeTruthy();
      expect(within(r).getByRole('link')).toBeTruthy();
    }
  });

  it('Release plan on a quote project says it is still a quote and sends nothing', () => {
    const onAct = vi.fn();
    render(<TriageCard triage={triage([group({ still_quote: true })])} onAct={onAct} onTalk={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release plan' }));
    expect(screen.getByRole('status').textContent).toBe('That project is still a quote. Nothing was released.');
    expect(onAct).not.toHaveBeenCalled();
  });

  it('Talk about this hands the chat the group, then the one idea', () => {
    const onTalk = vi.fn();
    render(<TriageCard triage={triage([group()])} onAct={vi.fn()} onTalk={onTalk} />);
    const talks = screen.getAllByRole('button', { name: 'Talk about this' });
    fireEvent.click(talks[talks.length - 1]);
    expect(onTalk).toHaveBeenLastCalledWith({ key: P, title: 'Triage: Stronghold (5 ideas)', tile: 'triage' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Talk about this' })[0]);
    expect(onTalk.mock.calls.at(-1)![0]).toMatchObject({ type: 'task', title: 'Idea 1' });
  });

  it('shows five groups and the rest behind Show all groups', () => {
    const many = Array.from({ length: 7 }, (_, i) => group({ key: `project:g${i}`, label: `P${i}`, project_id: null, kind: 'pass' }));
    render(<TriageCard triage={triage(many)} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getAllByTestId('triage-group')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 7 groups' }));
    expect(screen.getAllByTestId('triage-group')).toHaveLength(7);
  });
});

describe('a group of one idea', () => {
  it('its Talk about this is that idea\'s own conversation; a group of several stays the general chat', () => {
    const onTalk = vi.fn();
    const one = group({ count: 1, tasks: tasks(1), titles: ['Idea 1'] });
    const { unmount } = render(<TriageCard triage={triage([one])} onAct={vi.fn()} onTalk={onTalk} />);
    const g = screen.getByTestId('triage-group');
    const buttons = within(g).getAllByRole('button', { name: 'Talk about this' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onTalk.mock.calls[0][0]).toMatchObject({ key: `task:${one.tasks[0].task_id}`, task_id: one.tasks[0].task_id });
    unmount();
    const many = vi.fn();
    render(<TriageCard triage={triage([group()])} onAct={vi.fn()} onTalk={many} />);
    const gb = within(screen.getByTestId('triage-group')).getAllByRole('button', { name: 'Talk about this' });
    fireEvent.click(gb[gb.length - 1]);
    expect(many.mock.calls[0][0].task_id).toBeUndefined();
  });
});

describe('triage talk seam', () => {
  it('a pass group travels as a title only; the seam falls back to the existing chat', () => {
    const card = triageTalkCard(group({ key: 'pass:triage-pass:x', kind: 'pass', project_id: null, label: 'x' }));
    expect(card.key).toBe('triage:pass:triage-pass:x');
    const open = vi.fn();
    openTriageConversation(card, open);
    expect(open).toHaveBeenCalledWith(card);
  });
  it('one idea gets its own conversation: the card is handed on marked as such', () => {
    const t = tasks(1)[0];
    const card = triageTalkCard(group(), t);
    const open = vi.fn();
    openTriageConversation(card, open);
    expect(open).toHaveBeenCalledWith({ ...card, own_conversation: true });
    expect(open.mock.calls[0][0].task_id).toBe(t.task_id);
  });
  it('a task id that is not a uuid never gets its own conversation', () => {
    const open = vi.fn();
    openTriageConversation({ key: 'task:x', title: 'x', task_id: 'not-a-uuid', tile: 'triage' }, open);
    expect(open.mock.calls[0][0].own_conversation).toBeUndefined();
  });
});

describe('questions on the Triage row', () => {
  const withQuestions = () => {
    const t = tasks(2).map((x, i) => ({ ...x, open_questions: i === 0 ? 2 : 0 }));
    return group({ count: 2, titles: t.map((x) => x.title), tasks: t, open_questions: 2 });
  };
  const oneQuestion = {
    id: 'q1', task_id: 't', position: 0, question: 'Show the map?', what_it_is: 'A layout decision is needed.', sources: [{ who: 'Mike', said: 'Decide later' }],
    checked: 'The brief was read.', unknown: 'Whether mobile matters.', options: [{ id: 'a', label: 'Map', consequence: 'Heavy.' }, { id: 'b', label: 'List', consequence: 'Light.' }],
    recommended_option_id: 'a', recommend_why: 'Nearby first.', if_nobody: 'It waits for you.', if_nobody_action: 'wait', state: 'open',
    answer_option_id: null, answer_text: null, answered_at: null, citation: null, released_without_answer: false, version: '2026-11-12T10:00:00.000Z',
  };

  it('the heading and the group show the question totals; only a card with open questions gets a Questions button', () => {
    const g = withQuestions();
    render(<TriageCard triage={{ count: 2, open_questions: 2, groups: [g] }} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('2 questions to answer');
    expect(screen.getByTestId('triage-group').textContent).toContain('2 questions for you');
    expect(screen.getAllByRole('button', { name: 'Questions 2' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Questions 0/ })).toBeNull();
  });

  it('Questions n opens the list in place and an answer goes to the answer handler', async () => {
    q.data = { questions: [oneQuestion], open_count: 1 };
    q.answer.mockResolvedValue(true);
    const g = withQuestions();
    render(<TriageCard triage={{ count: 2, open_questions: 2, groups: [g] }} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.queryByTestId('question-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Questions 2' }));
    expect(screen.getByTestId('question-list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Map/ }));
    await waitFor(() => expect(q.answer).toHaveBeenCalledWith('q1', { option_id: 'a', version: '2026-11-12T10:00:00.000Z' }));
  });

  it('without questions the heading and rows are unchanged', () => {
    render(<TriageCard triage={triage([group()])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toContain('question');
    expect(screen.queryByRole('button', { name: /^Questions/ })).toBeNull();
  });
});

describe('Looks done group', () => {
  const ld = (over = {}) => ({ task_id: '7aa4a01a-1111-4222-8333-944445550001', title: 'Fix the footer', href: '/tasks/7aa4a01a-1111-4222-8333-944445550001', project_name: null, evidence: 'Shipped in abc1234, see https://example.test/page. Done.', open_questions: 0, summary: 'Make it work.', created_at: '2026-11-10T00:00:00Z', ...over });
  const withLd = (looks = [ld()]) => ({ count: 1 + looks.length, looks_done: looks, open_questions: 0, groups: [group({ count: 1, tasks: tasks(1), titles: ['Idea 1'], kind: 'none', key: 'none', label: 'No project', project_id: null })] }) as HomeTriage;

  it('comes first under its own heading, the count line says how many look done, and links in the evidence are clickable', () => {
    render(<TriageCard triage={withLd()} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('2 ideas wait for you, 1 looks done');
    const g = screen.getByTestId('looks-done-group');
    expect(within(g).getByRole('heading', { level: 3 }).textContent).toContain('Looks done');
    expect(g.compareDocumentPosition(screen.getByTestId('triage-group')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ev = screen.getByTestId('looks-done-evidence');
    expect(ev.textContent).toBe('Shipped in abc1234, see https://example.test/page. Done.');
    const link = within(ev).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.test/page');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('Close as done and Not done post their acts for that card; Talk about this opens its own conversation', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    const onTalk = vi.fn();
    render(<TriageCard triage={withLd()} onAct={onAct} onTalk={onTalk} />);
    const row = within(screen.getByTestId('looks-done-row'));
    fireEvent.click(row.getByRole('button', { name: 'Close as done' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_close_done', task_ids: ['7aa4a01a-1111-4222-8333-944445550001'] }));
    fireEvent.click(row.getByRole('button', { name: 'Not done' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_not_done', task_ids: ['7aa4a01a-1111-4222-8333-944445550001'] }));
    fireEvent.click(row.getByRole('button', { name: 'Talk about this' }));
    expect(onTalk.mock.calls[0][0]).toMatchObject({ type: 'task', task_id: '7aa4a01a-1111-4222-8333-944445550001' });
  });

  it('a marked card with no note says so, and an untrusted address scheme is plain text', () => {
    render(<TriageCard triage={withLd([ld({ evidence: '' }), ld({ task_id: '7aa4a01a-1111-4222-8333-944445550002', evidence: 'javascript:alert(1) done' })])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getAllByTestId('looks-done-evidence')[0].textContent).toBe('Marked as done, but no note was left.');
    expect(within(screen.getAllByTestId('looks-done-evidence')[1]).queryByRole('link')).toBeNull();
  });

  it('a section with nothing marked shows no Looks done heading', () => {
    render(<TriageCard triage={triage([group()])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.queryByTestId('looks-done-group')).toBeNull();
  });
});
