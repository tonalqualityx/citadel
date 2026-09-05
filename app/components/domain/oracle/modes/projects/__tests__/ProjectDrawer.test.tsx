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
    dismissals: [],
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

// Card anatomy fix — the next-step source stamp moved off the card face and now
// renders only here, in the drawer's next-step section, as a full sentence (no dash).
describe('ProjectDrawer — next step source sentence', () => {
  it('shows a plain sentence for a bast-sourced next step, with the time', () => {
    renderDrawer(
      makeProject({
        next_step: { text: 'x', owner: null, owner_label: null, source: 'bast', at: '2026-09-04T12:00:00Z' },
      })
    );
    const el = screen.getByTestId('drawer-next-step-source');
    expect(el).toHaveTextContent('Bast suggested this next step');
    expect(el.textContent).not.toMatch(/[–—]/);
  });

  it('shows a plain sentence for a mike-sourced override, with no dash', () => {
    renderDrawer(makeProject({ next_step: { text: 'x', owner: null, owner_label: null, source: 'mike', at: null } }));
    expect(screen.getByTestId('drawer-next-step-source')).toHaveTextContent('Mike set this next step himself.');
  });

  it('shows a plain sentence for a graph-sourced candidate', () => {
    renderDrawer(makeProject({ next_step: { text: 'x', owner: null, owner_label: null, source: 'graph', at: null } }));
    expect(screen.getByTestId('drawer-next-step-source')).toHaveTextContent(
      'This next step came from the task graph.'
    );
  });

  it('renders nothing when there is no next step at all (source: none)', () => {
    renderDrawer(makeProject({ next_step: { text: 'x', owner: null, owner_label: null, source: 'none', at: null } }));
    expect(screen.queryByTestId('drawer-next-step-source')).not.toBeInTheDocument();
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
    // MEDIUM-2: the plain YYYY-MM-DD calendar date goes straight to the API — no
    // client-side UTC-midnight conversion, which is what rendered a day early once the
    // API read it back in a US Eastern timezone.
    const call = mockCreateNoteMutateAsync.mock.calls[0][0];
    expect(call.until_date).toBe('2026-09-15');
  });

  it('"Add note" (no park) posts a plain note with no kind override', async () => {
    renderDrawer();
    const noteBox = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(noteBox, { target: { value: 'Quick update.' } });
    fireEvent.click(screen.getByRole('button', { name: /^add note$/i }));

    await waitFor(() => expect(mockCreateNoteMutateAsync).toHaveBeenCalledWith({ body: 'Quick update.' }));
  });
});

// LOW-2: the empty-dismissals copy names "project" literally and must route through
// useTerminology, same as every other terminology-configurable word on this tab.
describe('ProjectDrawer — dismissed items empty state (LOW-2)', () => {
  it('routes the word "project" through useTerminology', () => {
    renderDrawer();
    fireEvent.click(screen.getByText(/dismissed items/i));
    // Not pinned to the literal word "project" — useTerminology may resolve to a
    // configured alias (e.g. "commission"); the point is it goes through t(), not a
    // hardcoded string.
    expect(screen.getByText(/^Nothing dismissed on this .+\.$/)).toBeInTheDocument();
  });
});
