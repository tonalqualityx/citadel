import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OracleProjectsResponse } from '@/lib/hooks/use-oracle-projects';

const mockUseOracleProjects = vi.fn();
const mockRefreshAllMutate = vi.fn();

vi.mock('@/lib/hooks/use-oracle-projects', () => ({
  useOracleProjects: (...args: unknown[]) => mockUseOracleProjects(...args),
}));

vi.mock('@/lib/hooks/use-next-step', () => ({
  useRefreshAllNextSteps: () => ({ mutate: mockRefreshAllMutate, isPending: false }),
}));

// This file tests ProjectsView's own logic (lens toggle, empty/loading/error states, the
// stalled summary line) — not the drawer's or KindLens's own behavior, which have their
// own test files. Shallow-mocked here, same pattern as ModeShell.test.tsx.
vi.mock('../ProjectDrawer', () => ({
  ProjectDrawer: ({ project }: { project: { id: string } | null }) => (
    <div data-testid="mock-drawer">{project ? `open:${project.id}` : 'closed'}</div>
  ),
}));
vi.mock('../KindLens', () => ({
  KindLens: () => <div data-testid="mock-kind-lens" />,
}));

import { ProjectsView } from '../ProjectsView';

// This test environment's real window.localStorage is unreliable (a Node
// `--localstorage-file` warning fires and getItem/setItem are missing) — stub a plain
// in-memory implementation so the lens-persistence tests exercise ProjectsView's own
// try/catch read/write logic against something that actually behaves like storage.
function stubLocalStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
  return fake;
}

function project(overrides: Partial<OracleProjectsResponse['projects'][number]> = {}) {
  return {
    id: 'proj-1',
    name: 'Website Redesign',
    client: { id: 'client-1', name: 'Acme' },
    status: 'in_progress',
    next_step: { text: 'Do a thing', owner: null, owner_label: null, source: 'graph' as const, at: null },
    last_movement: null,
    days_quiet: null,
    stale: false,
    stalled_on_mike: false,
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

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectsView />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
});

describe('ProjectsView — loading / error / empty states', () => {
  it('shows a spinner while loading', () => {
    mockUseOracleProjects.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderView();
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
  });

  it('shows an error empty-state on isError', () => {
    mockUseOracleProjects.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderView();
    expect(screen.getByText(/couldn't load projects/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no in-progress projects', () => {
    mockUseOracleProjects.mockReturnValue({
      data: { projects: [], stalled_count: 0, generated_at: 'x' },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText(/no projects in progress/i)).toBeInTheDocument();
  });
});

describe('ProjectsView — stalled summary / badge count flow', () => {
  it('shows the stalled count from the API when > 0', () => {
    mockUseOracleProjects.mockReturnValue({
      data: { projects: [project()], stalled_count: 3, generated_at: 'x' },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByTestId('stalled-summary')).toHaveTextContent('3 projects stalled on you');
  });

  it('shows a calm message when nothing is stalled', () => {
    mockUseOracleProjects.mockReturnValue({
      data: { projects: [project()], stalled_count: 0, generated_at: 'x' },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByTestId('stalled-summary')).toHaveTextContent('Nothing stalled on you right now');
  });

  it('uses singular "project" for a stalled count of 1', () => {
    mockUseOracleProjects.mockReturnValue({
      data: { projects: [project()], stalled_count: 1, generated_at: 'x' },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByTestId('stalled-summary')).toHaveTextContent('1 project stalled on you');
  });
});

describe('ProjectsView — lens toggle', () => {
  beforeEach(() => {
    mockUseOracleProjects.mockReturnValue({
      data: { projects: [project()], stalled_count: 0, generated_at: 'x' },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('defaults to the By project lens and renders the projects grid', () => {
    renderView();
    expect(screen.getByTestId('lens-toggle-project')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('projects-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-kind-lens')).not.toBeInTheDocument();
  });

  it('switching to By kind renders KindLens instead of the grid, and persists to localStorage', () => {
    renderView();
    fireEvent.click(screen.getByTestId('lens-toggle-kind'));

    expect(screen.getByTestId('lens-toggle-kind')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mock-kind-lens')).toBeInTheDocument();
    expect(screen.queryByTestId('projects-grid')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('oracle.projects.lens')).toBe('kind');
  });

  it('a stored "kind" lens is read back on mount', () => {
    window.localStorage.setItem('oracle.projects.lens', 'kind');
    renderView();
    expect(screen.getByTestId('lens-toggle-kind')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ProjectsView — Refresh all', () => {
  it('calls the refresh-all mutation', () => {
    mockUseOracleProjects.mockReturnValue({
      data: { projects: [project()], stalled_count: 0, generated_at: 'x' },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /refresh all/i }));
    expect(mockRefreshAllMutate).toHaveBeenCalled();
  });
});
