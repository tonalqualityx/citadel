import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Blocker } from '@/lib/oracle/projects/blockers';

const mockUseArcs = vi.fn();
const mockCreateArcMutateAsync = vi.fn();
const mockUseTodayPicks = vi.fn();
const mockCreatePickMutateAsync = vi.fn();
const mockCreateTaskMutateAsync = vi.fn();
const mockUpdateTaskMutateAsync = vi.fn();

vi.mock('@/lib/hooks/use-arcs', () => ({
  useArcs: (...args: unknown[]) => mockUseArcs(...args),
  useCreateArc: () => ({ mutateAsync: mockCreateArcMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-today', () => ({
  useTodayPicks: (...args: unknown[]) => mockUseTodayPicks(...args),
  useCreateTodayPick: () => ({ mutateAsync: mockCreatePickMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-tasks', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateTaskMutateAsync, isPending: false }),
  useUpdateTask: () => ({ mutateAsync: mockUpdateTaskMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (k: string) => k }),
}));

import { PickToArcDialog } from '../PickToArcDialog';

function decisionBlocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'decision',
    id: 'decision:task-1',
    title: 'Approve homepage copy',
    detail: 'Bast needs a yes/no on the homepage headline.',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'task', id: 'task-1', url: '/tasks/task-1' },
    since: '2026-08-01T00:00:00Z',
    actions: ['reply', 'open_task', 'pick'],
    arc: null,
    chase_due_at: null,
    chase_draft: null,
    dismiss: null,
    ...overrides,
  };
}

function renderDialog(blocker = decisionBlocker()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PickToArcDialog
        open
        onOpenChange={vi.fn()}
        blocker={blocker}
        project={{ id: 'proj-1', name: 'Website Redesign' }}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseArcs.mockReturnValue({ data: { arcs: [{ id: 'arc-existing', name: 'Existing Arc' }] } });
  mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 2, uncompleted: 2, cap: 5 } } });
  mockCreateArcMutateAsync.mockResolvedValue({ id: 'new-arc-1' });
  mockCreatePickMutateAsync.mockResolvedValue({});
  mockCreateTaskMutateAsync.mockResolvedValue({ id: 'created-task-1' });
  mockUpdateTaskMutateAsync.mockResolvedValue({});
});

describe('PickToArcDialog — WIP cap banner', () => {
  it('shows the cap-count warning with the real cap number when at cap', () => {
    mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 5, uncompleted: 5, cap: 5 } } });
    renderDialog();
    expect(screen.getByTestId('wip-cap-warning')).toHaveTextContent('5-item cap');
  });

  it('does not show the warning below the cap', () => {
    renderDialog();
    expect(screen.queryByTestId('wip-cap-warning')).not.toBeInTheDocument();
  });
});

describe('PickToArcDialog — pick + attach calls', () => {
  it('picking with no arc just adds the today pick for the existing task', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));

    await waitFor(() => expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'task', task_id: 'task-1' }));
    expect(mockUpdateTaskMutateAsync).not.toHaveBeenCalled();
  });

  it('attaching to an existing arc PATCHes arc_id then picks', async () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText(/attach to an existing open arc/i));
    fireEvent.change(screen.getByLabelText('Existing arc'), { target: { value: 'arc-existing' } });
    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));

    await waitFor(() =>
      expect(mockUpdateTaskMutateAsync).toHaveBeenCalledWith({ id: 'task-1', data: { arc_id: 'arc-existing' } })
    );
    expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'task', task_id: 'task-1' });
  });

  it('a non-task blocker creates a task first, then picks it', async () => {
    const emailBlocker = decisionBlocker({
      kind: 'client_email',
      title: 'Andy asked for an update',
      detail: 'No reply yet.',
      source: { type: 'email', id: 'email-1', url: 'https://mail.google.com/x' },
    });
    renderDialog(emailBlocker);
    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));

    await waitFor(() => expect(mockCreateTaskMutateAsync).toHaveBeenCalled());
    expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'task', task_id: 'created-task-1' });
  });

  it('surfaces the 409 API message verbatim on the cap error', async () => {
    mockCreatePickMutateAsync.mockRejectedValueOnce(new Error('Today is already at the 5-item cap.'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));

    await waitFor(() => expect(screen.getByTestId('pick-error')).toHaveTextContent('Today is already at the 5-item cap.'));
  });
});

describe('PickToArcDialog — re-homing (MEDIUM-3)', () => {
  it('shows "Already in arc X" when the task is in a different arc than the target, and skips the attach unless moved', async () => {
    const arced = decisionBlocker({ arc: { id: 'arc-old', name: 'Old Arc' } });
    renderDialog(arced);
    fireEvent.click(screen.getByLabelText(/attach to an existing open arc/i));
    fireEvent.change(screen.getByLabelText('Existing arc'), { target: { value: 'arc-existing' } });

    expect(screen.getByTestId('already-in-arc-warning')).toHaveTextContent('Already in arc Old Arc.');

    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));
    await waitFor(() => expect(mockCreatePickMutateAsync).toHaveBeenCalled());
    // Not moved: no arc_id PATCH fires.
    expect(mockUpdateTaskMutateAsync).not.toHaveBeenCalled();
  });

  it('ticking "Move it here instead" attaches to the new target arc', async () => {
    const arced = decisionBlocker({ arc: { id: 'arc-old', name: 'Old Arc' } });
    renderDialog(arced);
    fireEvent.click(screen.getByLabelText(/attach to an existing open arc/i));
    fireEvent.change(screen.getByLabelText('Existing arc'), { target: { value: 'arc-existing' } });
    fireEvent.click(screen.getByLabelText('Move it here instead'));
    fireEvent.click(screen.getByRole('button', { name: /^pick$/i }));

    await waitFor(() =>
      expect(mockUpdateTaskMutateAsync).toHaveBeenCalledWith({ id: 'task-1', data: { arc_id: 'arc-existing' } })
    );
  });

  it('a task already in the SAME target arc is not flagged', () => {
    const sameArc = decisionBlocker({ arc: { id: 'arc-existing', name: 'Existing Arc' } });
    renderDialog(sameArc);
    fireEvent.click(screen.getByLabelText(/attach to an existing open arc/i));
    fireEvent.change(screen.getByLabelText('Existing arc'), { target: { value: 'arc-existing' } });

    expect(screen.queryByTestId('already-in-arc-warning')).not.toBeInTheDocument();
  });
});
