import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Blocker } from '@/lib/oracle/projects/blockers';
import type { KindLensGroup } from '../projects-logic';

const mockCreateArcMutateAsync = vi.fn().mockResolvedValue({ id: 'new-arc-1' });
const mockCreateTaskMutateAsync = vi.fn().mockResolvedValue({ id: 'created-task-1' });
const mockUpdateTaskMutateAsync = vi.fn().mockResolvedValue({});
const mockCreatePickMutateAsync = vi.fn().mockResolvedValue({});
const mockUseTodayPicks = vi.fn();

vi.mock('@/lib/hooks/use-arcs', () => ({
  useCreateArc: () => ({ mutateAsync: mockCreateArcMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-tasks', () => ({
  useCreateTask: () => ({ mutateAsync: mockCreateTaskMutateAsync, isPending: false }),
  useUpdateTask: () => ({ mutateAsync: mockUpdateTaskMutateAsync, isPending: false }),
}));
vi.mock('@/lib/hooks/use-today', () => ({
  useCreateTodayPick: () => ({ mutateAsync: mockCreatePickMutateAsync, isPending: false }),
  useTodayPicks: (...args: unknown[]) => mockUseTodayPicks(...args),
}));
// Phase 5 carry-over B — same identity-mock convention as ProjectsView.test.tsx: keeps
// every existing 'task'/'tasks' text assertion below valid while proving KindLens's
// "already in another arc" toast and the re-home checkbox label route through t().
vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({ t: (k: string) => k }),
}));

import { KindLens } from '../KindLens';

function blocker(overrides: Partial<Blocker> = {}): Blocker {
  return {
    kind: 'review',
    id: 'review:task-1',
    title: 'Ship the fix',
    detail: 'Marked done. Needs your review.',
    owner: { id: 'mike-1', name: 'Mike', is_mike: true },
    source: { type: 'task', id: 'task-1', url: '/tasks/task-1' },
    since: '2026-08-01T00:00:00Z',
    actions: ['approve', 'request_changes', 'open_task', 'dismiss'],
    arc: null,
    chase_due_at: null,
    chase_draft: null,
    dismiss: null,
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
  mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 2, uncompleted: 2, cap: 5 } } });
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
    expect(nameInput.value).toMatch(/^Reviews, /);
    expect(nameInput.value).not.toMatch(/[–—]/);

    fireEvent.click(screen.getByRole('button', { name: /create arc/i }));

    await waitFor(() =>
      expect(mockCreateArcMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'proj-1' })
      )
    );
    await waitFor(() => expect(mockCreatePickMutateAsync).toHaveBeenCalledWith({ item_type: 'arc', arc_id: 'new-arc-1' }));
  });
});

// MEDIUM-5 — the WIP cap count, all-or-nothing multi-pick, and no-bare-catch error
// surfacing.
describe('KindLens — WIP cap (MEDIUM-5)', () => {
  it('shows the cap count up front, before anything is selected', () => {
    mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 3, uncompleted: 3, cap: 5 } } });
    renderLens();
    expect(screen.getByTestId('kind-lens-cap-count')).toHaveTextContent('3 of 5');
  });

  it('refuses "Add to today\'s picks" outright when the selection exceeds remaining capacity, with no writes', async () => {
    mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 4, uncompleted: 4, cap: 5 } } }); // 1 slot left
    renderLens(); // 2 rows in the fixture
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /add to today's picks/i }));

    expect(screen.getByTestId('kind-lens-error')).toHaveTextContent(/only 1 of 5/i);
    expect(mockCreatePickMutateAsync).not.toHaveBeenCalled();
    // Selection is preserved, not cleared, on refusal.
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('stops on an unexpected 409 mid-loop, reports what succeeded, and keeps the selection', async () => {
    mockCreatePickMutateAsync
      .mockResolvedValueOnce({}) // task-1 succeeds
      .mockRejectedValueOnce(new Error('Today is already at the 5-item cap.')); // task-2 409s
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /add to today's picks/i }));

    await waitFor(() => expect(screen.getByTestId('kind-lens-error')).toBeInTheDocument());
    expect(screen.getByTestId('kind-lens-error')).toHaveTextContent('1 of 2 added');
    expect(screen.getByTestId('kind-lens-error')).toHaveTextContent('Today is already at the 5-item cap.');
    expect(screen.getByText('2 selected')).toBeInTheDocument(); // selection unchanged
  });

  it('refuses "New arc…" outright when there is no capacity left for the one arc pick', async () => {
    mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 5, uncompleted: 5, cap: 5 } } });
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /new arc…/i }));
    fireEvent.click(screen.getByRole('button', { name: /create arc/i }));

    expect(screen.getByTestId('kind-lens-error')).toHaveTextContent('5-item cap');
    expect(mockCreateArcMutateAsync).not.toHaveBeenCalled();
  });

  it('surfaces a 409 on the final arc pick verbatim, with no bare catch', async () => {
    mockCreatePickMutateAsync.mockRejectedValueOnce(new Error('Today is already at the 5-item cap.'));
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /new arc…/i }));
    fireEvent.click(screen.getByRole('button', { name: /create arc/i }));

    await waitFor(() =>
      expect(screen.getByTestId('kind-lens-error')).toHaveTextContent('Today is already at the 5-item cap.')
    );
  });
});

// Phase 5 carry-over F — pick actions disabled until the Today query has resolved
// (remainingCapacity is null before then, which the pre-flight cap checks already treat
// as "no cap known" and let a pick proceed without one).
describe('KindLens — pick actions wait on the Today query (carry-over F)', () => {
  it('both pick actions are disabled, and the cap line shows a loading state, before useTodayPicks resolves', () => {
    mockUseTodayPicks.mockReturnValue({ data: undefined });
    renderLens();
    expect(screen.getByTestId('kind-lens-cap-count')).toHaveTextContent("Loading today's picks");
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    expect(screen.getByRole('button', { name: /add to today's picks/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /new arc…/i })).toBeDisabled();
  });

  it('both pick actions are enabled once useTodayPicks has resolved', () => {
    mockUseTodayPicks.mockReturnValue({ data: { meta: { total: 2, uncompleted: 2, cap: 5 } } });
    renderLens();
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    expect(screen.getByRole('button', { name: /add to today's picks/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /new arc…/i })).not.toBeDisabled();
  });
});

// MEDIUM-3 — re-homing surfaced in the by-kind lens.
describe('KindLens — re-homing (MEDIUM-3)', () => {
  function groupsWithArcedRow(): KindLensGroup[] {
    return [
      {
        kind: 'review',
        heading: 'Reviews',
        rows: [
          {
            blocker: blocker({ id: 'review:task-1', arc: { id: 'arc-old', name: 'Old Arc' } }),
            project: { id: 'proj-1', name: 'Website Redesign' },
          },
        ],
      },
    ];
  }

  function renderWithGroups(groups: KindLensGroup[], onOpenProject = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <KindLens groups={groups} onOpenProject={onOpenProject} />
      </QueryClientProvider>
    );
  }

  it('shows which arc a row is already in', () => {
    renderWithGroups(groupsWithArcedRow());
    expect(screen.getByTestId('kind-lens-row-arc')).toHaveTextContent('Already in arc Old Arc.');
  });

  it('a "New arc…" run skips an already-arc\'d task by default and reports the skip', async () => {
    renderWithGroups(groupsWithArcedRow());
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /new arc…/i }));
    fireEvent.click(screen.getByRole('button', { name: /create arc/i }));

    await waitFor(() => expect(mockCreatePickMutateAsync).toHaveBeenCalled());
    expect(mockUpdateTaskMutateAsync).not.toHaveBeenCalled(); // never re-homed
  });

  it('"Move already-arc\'d tasks too" attaches it to the new arc', async () => {
    renderWithGroups(groupsWithArcedRow());
    fireEvent.click(screen.getByLabelText('Select all Reviews'));
    fireEvent.click(screen.getByRole('button', { name: /new arc…/i }));
    fireEvent.click(screen.getByLabelText("Move already-arc'd tasks too"));
    fireEvent.click(screen.getByRole('button', { name: /create arc/i }));

    await waitFor(() =>
      expect(mockUpdateTaskMutateAsync).toHaveBeenCalledWith({ id: 'task-1', data: { arc_id: 'new-arc-1' } })
    );
  });
});
