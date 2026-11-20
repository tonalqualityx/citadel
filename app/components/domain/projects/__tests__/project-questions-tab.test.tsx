import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectQuestionsTab, questionAsker, questionFor } from '../project-questions-tab';
import { answerSavedText } from '@/lib/hooks/use-project-questions';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

function renderTab(canAnswer = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectQuestionsTab projectId="proj-1" canAnswer={canAnswer} />
    </QueryClientProvider>,
  );
}

const base = {
  position: 0,
  what_it_is: 'Which photo crop the client wants on the home hero.',
  sources: [{ who: 'Lisa', said: 'Can we see more of the mountain?', at: '2026-11-13' }],
  checked: 'The current crop and the master photo.',
  unknown: 'How much of the town she wants kept.',
  recommend_why: null,
  if_nobody: 'The cards it holds wait.',
  answer_option_id: null,
  answer_text: null,
  answered_at: null,
  citation: null,
  released_without_answer: false,
  asked_by_lane: null,
};

const clientQ = {
  ...base,
  id: 'q1',
  task_id: 't1',
  question: 'Which crop should the hero use?',
  options: [
    { id: 'wide', label: 'Wider crop', consequence: 'More mountain, less town.' },
    { id: 'keep', label: 'Keep it', consequence: 'Nothing changes.' },
  ],
  recommended_option_id: 'wide',
  if_nobody_action: 'wait',
  state: 'open',
  version: '2026-11-13T10:00:00.000Z',
  created_at: '2026-11-13T15:00:00.000Z',
  asked_of_contact: { id: 'c1', name: 'Lisa', email: 'lisa@example.test' },
  asked_by: { id: 'u-bast', name: 'Bast' },
  blocks: [
    { id: 't2', title: 'Crop the hero master', status: 'blocked' },
    { id: 't3', title: 'Deploy to staging', status: 'blocked' },
  ],
  task: { id: 't1', title: 'Vermont hero', status: 'blocked', project_id: 'proj-1', project: { id: 'proj-1', name: 'VCDP' } },
};

const mikeQ = {
  ...base,
  id: 'q2',
  task_id: 't4',
  question: 'Is the booth page still wanted?',
  options: null,
  recommended_option_id: null,
  if_nobody_action: 'wait',
  state: 'open',
  version: '2026-11-14T10:00:00.000Z',
  created_at: '2026-11-14T15:00:00.000Z',
  asked_of_contact: null,
  asked_by: null,
  asked_by_lane: 'dox',
  blocks: [],
  task: { id: 't4', title: 'Booth page', status: 'not_started', project_id: 'proj-1', project: { id: 'proj-1', name: 'VCDP' } },
};

describe('ProjectQuestionsTab', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("reads the project's open questions and shows who each is for, who asked, when, its card and the cards it holds", async () => {
    mockGet.mockResolvedValue({ questions: [clientQ, mikeQ], total: 2 });
    renderTab();
    expect(await screen.findByText('Which crop should the hero use?')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/questions?state=open&for=all&project_id=proj-1&limit=500&include_triage=1');
    const items = screen.getAllByTestId('project-question');
    expect(items).toHaveLength(2);
    // oldest first, as the route returns them
    expect(items[0]).toHaveTextContent('Which crop should the hero use?');
    expect(items[1]).toHaveTextContent('Is the booth page still wanted?');
    expect(items[0]).toHaveTextContent('For Lisa (client)');
    expect(items[0]).toHaveTextContent('Asked by Bast');
    expect(items[0]).toHaveTextContent('13 Nov 2026');
    expect(screen.getByText('Card: Vermont hero').closest('a')).toHaveAttribute('href', '/tasks/t1');
    expect(screen.getByText('Crop the hero master').closest('a')).toHaveAttribute('href', '/tasks/t2');
    expect(screen.getByText('Deploy to staging').closest('a')).toHaveAttribute('href', '/tasks/t3');
    expect(items[1]).toHaveTextContent('For Mike');
    expect(items[1]).toHaveTextContent('Asked by Dox');
    expect(items[1]).toHaveTextContent('Holds no cards');
    expect(screen.getByText('2 open questions, oldest first.')).toBeInTheDocument();
  });

  it("answers in place on the question's own card and says how many cards it let go", async () => {
    mockGet.mockResolvedValue({ questions: [clientQ], total: 1 });
    mockPost.mockResolvedValue({ released_task_ids: ['t2', 't3'] });
    renderTab();
    await screen.findByText('Which crop should the hero use?');
    fireEvent.click(screen.getByText('Wider crop'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tasks/t1/questions/q1/answer', { option_id: 'wide', version: '2026-11-13T10:00:00.000Z' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Answer saved. 2 cards it held are free to start.'));
    // the list is read again after the answer
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('answers with written words through the Other box', async () => {
    mockGet.mockResolvedValue({ questions: [mikeQ], total: 1 });
    mockPost.mockResolvedValue({ released_task_ids: [] });
    renderTab();
    await screen.findByText('Is the booth page still wanted?');
    fireEvent.click(screen.getByText('Other answer'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Yes, keep it' } });
    fireEvent.click(screen.getByText('Send answer'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tasks/t4/questions/q2/answer', { text: 'Yes, keep it', version: '2026-11-14T10:00:00.000Z' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Answer saved.'));
  });

  it('is read only for anyone but Mike', async () => {
    mockGet.mockResolvedValue({ questions: [clientQ], total: 1 });
    renderTab(false);
    await screen.findByText('Which crop should the hero use?');
    expect(screen.queryByText('Wider crop')).not.toBeInTheDocument();
    expect(screen.getByText('Only Mike answers these.')).toBeInTheDocument();
  });

  it('a failed answer says so and keeps the question', async () => {
    mockGet.mockResolvedValue({ questions: [clientQ], total: 1 });
    mockPost.mockRejectedValue(new Error('boom'));
    renderTab();
    await screen.findByText('Which crop should the hero use?');
    fireEvent.click(screen.getByText('Keep it'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That answer didn't save. Nothing changed."));
    expect(screen.getByText('Which crop should the hero use?')).toBeInTheDocument();
  });

  it('says so when the project has no open questions', async () => {
    mockGet.mockResolvedValue({ questions: [], total: 0 });
    renderTab();
    expect(await screen.findByText('No open questions')).toBeInTheDocument();
  });

  it('says when only part of a long list is shown', async () => {
    mockGet.mockResolvedValue({ questions: [clientQ], total: 501 });
    renderTab();
    expect(await screen.findByText('501 open questions, oldest first. Showing the first 1.')).toBeInTheDocument();
  });
});

describe('question labels', () => {
  it('names who the question is for and who asked it', () => {
    expect(questionFor({ asked_of_contact: null })).toBe('Mike');
    expect(questionFor({ asked_of_contact: { id: 'c', name: null, email: 'a@b.test' } })).toBe('a@b.test (client)');
    expect(questionAsker({ asked_by: null, asked_by_lane: null })).toBe('Not recorded');
    expect(questionAsker({ asked_by: null, asked_by_lane: 'bast' })).toBe('Bast');
    expect(questionAsker({ asked_by: { id: 'u', name: 'Mike' }, asked_by_lane: 'chat' })).toBe('Mike');
  });

  it('counts the cards an answer let go', () => {
    expect(answerSavedText(0)).toBe('Answer saved.');
    expect(answerSavedText(1)).toBe('Answer saved. 1 card it held is free to start.');
    expect(answerSavedText(3)).toBe('Answer saved. 3 cards it held are free to start.');
  });
});
