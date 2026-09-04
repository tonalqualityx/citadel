import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Blocker } from '@/lib/oracle/projects/blockers';
import type { KindLensGroup } from '../projects-logic';

const mockCreateArcMutateAsync = vi.fn().mockResolvedValue({ id: 'new-arc-1' });
const mockCreateTaskMutateAsync = vi.fn().mockResolvedValue({ id: 'created-task-1' });
const mockUpdateTaskMutateAsync = vi.fn().mockResolvedValue({});
const mockCreatePickMutateAsync = vi.fn().mockResolvedValue({});

vi.mock('@/lib/hooks/use-arcs', () => ({
  useCreateArc: () => ({ mutateAsync: mockCreateArcMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-tasks', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateTaskMutateAsync, isPending: false }),
  useUpdateTask: () => ({ mutateAsync: mockUpdateTaskMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-today', () => ({
  useCreateTodayPick: () => ({ mutateAsync: mockCreatePickMutateAsync, isPending: false }),
}));

import { KindLens } from '../KindLens';

function blocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'review',
    id: 'review:task-1',
    title: 'Ship the fix',
    detail: 'Marked done — needs your review',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'task', id: 'task-1', url: '/tasks/task-1' },
    since: '2026-08-01T00:00:00Z',
    actions: ['approve', 'request_changes', 'open_task', 'dismiss'],
    ...overrides,
  };
}

function makeGroups(): KindLensGroup[] {
  return [
    {
      kind: 'review',
      heading: 'Reviews',
      rows: [
        { blocker: blocker({ id: 'review:task-1' }), project: { id: 'proj-1', name: 'Website Redesign' } },
        {
          blocker: blocker({
            id: 'review:task-2',
            title: 'Ship the other fix',
            source: { type: 'task', id: 'task-2', url: '/tasks/task-2' },
          }),
          project: { id: 'proj-1', name: 'Website Redesign' },
        },
      ],
    },
  ];
}

function renderLens(onOpenProject = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KindLens groups={makeGroups()} onOpenProject={onOpenProject} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateArcMutateAsync.mockResolvedValue({ id: 'new-arc-1' });
  mockCreateTaskMutateAsync.mockResolvedValue({ id: 'created-task-1' });
  mockUpdateTaskMutateAsync.mockResolvedValue({});
  mockCreatePickMutateAsync.mockResolvedValue({});
});

describe('KindLens', () => {
  it('renders the heading with its row count', () => {
    renderLens();
    expect(screen.getByText('Reviews (2)')).toBeInTheDocument();
  });

  it('the action bar is hidden with nothing selected', () => {
    renderLens();
    expect(screen.queryByTestId('kind-lens-action-bar')).not.toBeInTheDocument();
  });

  it('"Select all" selects every row in the heading and shows the action bar', () => {
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));

    expect(screen.getByTestId('kind-lens-action-bar')).toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('clicking "Select all" again deselects everything and hides the action bar', () => {
    renderLens();
    const selectAll = screen.getByLabelText('Select all Reviews');
    fireEvent.click(selectAll);
    fireEvent.click(selectAll);
    expect(screen.queryByTestId('kind-lens-action-bar')).not.toBeInTheDocument();
  });

  it('selecting one row shows the action bar with count 1', () => {
    renderLens();
    fireEvent.click(screen.getByLabelText('Select Ship the fix'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('clicking a row (not its checkbox) calls onOpenProject', () => {
    const onOpenProject = vi.fn();
    renderLens(onOpenProject);
    fireEvent.click(screen.getAllByTestId('kind-lens-row')[0]);
    expect(onOpenProject).toHaveBeenCalledWith('proj-1');
  });

  it('"Add to today\'s picks" adds a today pick for each selected task', async () => {
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /add to today's picks/i }));

    await waitFor(() => expect(mockCreatePickMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'task', task_id: 'task-1' });
    expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'task', task_id: 'task-2' });
  });

  it('"New arc…" defaults the name to the heading + today\'s date and creates the arc on submit', async () => {
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /new arc…/i }));

    const nameInput = screen.getByLabelText('New arc name') as HTMLInputElement;
    expect(nameInput.value).toMatch(/^Reviews — /);

    fireEvent.click(screen.getByRole('button', { name: /create arc/i }));

    await waitFor(() =>
      expect(mockCreateArcMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'proj-1' })
      )
    );
    await waitFor(() => expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'arc', arc_id: 'new-arc-1' }));
  });
});
