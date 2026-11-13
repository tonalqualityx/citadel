import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QuestionList } from '../QuestionList';
import type { QuestionView } from '@/lib/tasks/question-context';

const base: QuestionView = {
  id: 'q1',
  task_id: 't1',
  position: 0,
  question: 'Show the map on the finder page?',
  what_it_is: 'The finder page needs a layout decision.',
  sources: [{ who: 'Mike', said: 'Decide after the call', at: '2026-11-10', url: 'https://example.test/thread' }],
  checked: 'The brief was read.',
  unknown: 'Whether mobile matters.',
  options: [
    { id: 'map', label: 'Show the map', consequence: 'Heavier page.' },
    { id: 'list', label: 'List only', consequence: 'Lighter page.' },
  ],
  recommended_option_id: 'map',
  recommend_why: 'Visitors look nearby first.',
  if_nobody: 'The card is released and the map goes ahead.',
  if_nobody_action: 'go_with_recommendation',
  state: 'open',
  answer_option_id: null,
  answer_text: null,
  answered_at: null,
  citation: null,
  released_without_answer: false,
};
const free: QuestionView = { ...base, id: 'q2', question: 'Which week should it go live?', options: null, recommended_option_id: null, recommend_why: null, if_nobody_action: 'wait' };

describe('QuestionList', () => {
  it('shows each open question on one line with its options, the recommended one marked, and an Other answer box', async () => {
    const onAnswer = vi.fn().mockResolvedValue(true);
    render(<QuestionList questions={[base, free]} onAnswer={onAnswer} />);
    expect(screen.getAllByTestId('question')).toHaveLength(2);
    const rec = screen.getByRole('button', { name: /Show the map/ });
    expect(rec.textContent).toContain('Recommended');
    expect(screen.getByRole('button', { name: 'List only' })).toBeTruthy();
    fireEvent.click(rec);
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('q1', { option_id: 'map' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Other answer' })[1]);
    const box = screen.getByLabelText('Other answer');
    const send = screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: ' The week of the 23rd ' } });
    fireEvent.click(send);
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('q2', { text: 'The week of the 23rd' }));
  });

  it('Context opens the parts in place and closes again', () => {
    render(<QuestionList questions={[base]} onAnswer={vi.fn()} />);
    expect(screen.queryByTestId('question-context')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    const ctx = screen.getByTestId('question-context');
    for (const s of ['What it is.', 'The finder page needs a layout decision.', 'Mike (2026-11-10): Decide after the call', 'The brief was read.', 'Whether mobile matters.', 'Heavier page.', 'Visitors look nearby first.', 'goes with the recommendation']) {
      expect(ctx.textContent).toContain(s);
    }
    expect(within(ctx).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('https://example.test/thread');
    fireEvent.click(screen.getByRole('button', { name: 'Hide context' }));
    expect(screen.queryByTestId('question-context')).toBeNull();
  });

  it('a free text question that waits says so in its Context', () => {
    render(<QuestionList questions={[free]} onAnswer={vi.fn()} contextOpen />);
    expect(screen.getByTestId('question-context').textContent).toContain('keeps this part waiting');
  });

  it('an answered question folds to "question, answer, date" with a Change link that reopens the buttons', async () => {
    const answered: QuestionView = { ...base, state: 'answered', answer_option_id: 'list', answer_text: 'List only', answered_at: '2026-11-12T17:00:00Z', citation: 'x' };
    const onAnswer = vi.fn().mockResolvedValue(true);
    render(<QuestionList questions={[answered]} onAnswer={onAnswer} />);
    const row = screen.getByTestId('question');
    expect(row.textContent).toContain('Show the map on the finder page?');
    expect(row.textContent).toContain('List only');
    expect(row.textContent).toContain('12 Nov');
    expect(screen.queryByRole('button', { name: 'Show the map' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: /Show the map/ }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('q1', { option_id: 'map' }));
  });

  it('a defaulted question is never shown as his answer', () => {
    const defaulted: QuestionView = { ...base, state: 'defaulted', released_without_answer: true };
    render(<QuestionList questions={[defaulted]} onAnswer={vi.fn()} />);
    const row = screen.getByTestId('question');
    expect(row.textContent).toContain('released without an answer');
    expect(row.textContent).not.toMatch(/\d{1,2} Nov/);
    expect(screen.getByRole('button', { name: 'Answer' })).toBeTruthy();
  });

  it('is read only without onAnswer, hides withdrawn questions and says when there are none', () => {
    const { rerender } = render(<QuestionList questions={[base, { ...free, state: 'withdrawn' }]} />);
    expect(screen.getAllByTestId('question')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Other answer' })).toBeNull();
    expect(screen.getByText('Only Mike answers these.')).toBeTruthy();
    rerender(<QuestionList questions={[]} />);
    expect(screen.getByText('No questions on this card.')).toBeTruthy();
  });
});
