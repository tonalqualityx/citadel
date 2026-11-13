import { describe, it, expect, vi } from 'vitest';
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
  it('shows the count, each group with its count and three titles, and expands to all', () => {
    render(<TriageCard triage={triage([group()])} onAct={vi.fn()} onTalk={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('5 ideas wait');
    const g = screen.getByTestId('triage-group');
    expect(within(g).getByText('Idea 3')).toBeTruthy();
    expect(within(g).queryByText('Idea 4')).toBeNull();
    fireEvent.click(within(g).getByRole('button', { name: 'Show all 5' }));
    expect(within(g).getByText('Idea 5')).toBeTruthy();
    expect(within(g).getAllByRole('button', { name: 'Release' })).toHaveLength(5);
  });

  it('Release plan, Drop all and Release post the triage acts', async () => {
    const onAct = vi.fn().mockResolvedValue({});
    const g = group();
    render(<TriageCard triage={triage([g])} onAct={onAct} onTalk={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release plan' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_release_plan', group_key: `project:${P}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop all 5' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_drop', task_ids: g.tasks.map((t) => t.task_id) }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' })[0]);
    await waitFor(() => expect(onAct).toHaveBeenCalledWith({ action: 'triage_release', task_ids: [g.tasks[0].task_id] }));
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Talk about this' })[0]);
    expect(onTalk).toHaveBeenLastCalledWith({ key: P, title: 'Triage: Stronghold (5 ideas)', tile: 'triage' });
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
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
