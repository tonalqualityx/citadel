import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OracleProjectCard } from '@/lib/hooks/use-oracle-projects';

const mockOverrideMutateAsync = vi.fn().mockResolvedValue({});
const mockClearMutateAsync = vi.fn().mockResolvedValue({});
const mockRefreshMutate = vi.fn();
const mockCreateNoteMutateAsync = vi.fn().mockResolvedValue({});

vi.mock('@/lib/hooks/use-next-step', () => ({
  useOverrideNextStep: () => ({ mutateAsync: mockOverrideMutateAsync, isPending: false }),
  useClearNextStepOverride: () => ({ mutateAsync: mockClearMutateAsync, isPending: false }),
  useRefreshNextStep: () => ({ mutate: mockRefreshMutate, isPending: false }),
}));

vi.mock('@/lib/hooks/use-project-notes', () => ({
  useProjectNotes: () => ({ data: { notes: [], count: 0 }, isLoading: false }),
  useCreateProjectNote: () => ({ mutateAsync: mockCreateNoteMutateAsync, isPending: false }),
}));

vi.mock('@/lib/hooks/use-users', () => ({
  useUsers: () => ({ data: { users: [{ id: 'mike-1', name: 'Mike' }] }, isLoading: false }),
}));

import { ProjectDrawer } from '../ProjectDrawer';

function makeProject(overrides: Partial<OracleProjectCard> = {}): OracleProjectCard {
  return {
    id: 'proj-1',
    name: 'Website Redesign',
    client: { id: 'client-1', name: 'Acme' },
    status: 'in_progress',
    next_step: {
      text: 'Mike needs to approve the homepage copy.',
      owner: null,
      owner_label: null,
      source: 'graph',
      at: null,
    },
    last_movement: null,
    days_quiet: 5,
    stale: false,
    stalled_on_mike: true,
    blockers: [],
    counts_by_kind: {},
    refresh_requested_at: null,
    open_url: '/projects/proj-1',
    email_summary: null,
    email_summary_at: null,
    linked_emails: [],
    ...overrides,
  };
}

function renderDrawer(project = makeProject(), onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectDrawer project={project} open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOverrideMutateAsync.mockResolvedValue({});
  mockClearMutateAsync.mockResolvedValue({});
  mockCreateNoteMutateAsync.mockResolvedValue({});
});

describe('ProjectDrawer — next step override', () => {
  it('editing and saving calls the override PATCH mutation with the new text', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

    const textarea = screen.getByDisplayValue('Mike needs to approve the homepage copy.');
    fireEvent.change(textarea, { target: { value: 'Mike, sign off on the copy today.' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockOverrideMutateAsync).toHaveBeenCalledWith({ text: 'Mike, sign off on the copy today.' })
    );
  });

  it('"Clear override" is only shown when the current source is mike, and calls the clear mutation', async () => {
    renderDrawer(makeProject({ next_step: { text: 'x', owner: null, owner_label: null, source: 'graph', at: null } }));
    expect(screen.queryByRole('button', { name: /clear override/i })).not.toBeInTheDocument();

    renderDrawer(makeProject({ next_step: { text: 'x', owner: null, owner_label: null, source: 'mike', at: null } }));
    fireEvent.click(screen.getByRole('button', { name: /clear override/i }));
    await waitFor(() => expect(mockClearMutateAsync).toHaveBeenCalled());
  });
});

describe('ProjectDrawer — refresh', () => {
  it('clicking Refresh calls the refresh mutation (POST refresh)', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    expect(mockRefreshMutate).toHaveBeenCalled();
  });

  it('shows a "Refreshing…" state when refresh_requested_at is set, and the button is disabled', () => {
    renderDrawer(makeProject({ refresh_requested_at: '2026-09-04T12:00:00Z' }));
    const btn = screen.getByRole('button', { name: /refreshing/i });
    expect(btn).toBeDisabled();
  });
});

describe('ProjectDrawer — notes / park until', () => {
  it('typing a note and clicking "Park until…" then "Park" posts a parked_until note', async () => {
    renderDrawer();
    const noteBox = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(noteBox, { target: { value: 'Waiting on the client to confirm the domain.' } });
    fireEvent.click(screen.getByRole('button', { name: /park until/i }));

    const dateInput = screen.getByLabelText('Park until');
    fireEvent.change(dateInput, { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: /^park$/i }));

    await waitFor(() =>
      expect(mockCreateNoteMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'parked_until',
          body: 'Waiting on the client to confirm the domain.',
        })
      )
    );
    const call = mockCreateNoteMutateAsync.mock.calls[0][0];
    expect(new Date(call.until_date).toISOString().startsWith('2026-09-15')).toBe(true);
  });

  it('"Add note" (no park) posts a plain note with no kind override', async () => {
    renderDrawer();
    const noteBox = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(noteBox, { target: { value: 'Quick update.' } });
    fireEvent.click(screen.getByRole('button', { name: /^add note$/i }));

    await waitFor(() => expect(mockCreateNoteMutateAsync).toHaveBeenCalledWith({ body: 'Quick update.' }));
  });
});
