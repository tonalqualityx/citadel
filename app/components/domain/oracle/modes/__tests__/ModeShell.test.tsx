import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/hooks/use-waiting-on-me', () => ({
  useWaitingOnMe: () => ({ data: undefined }),
}));

// Oracle Projects Tab Phase 2 — mocked so this shell-logic test never fires a real
// network request for the projects signals feed (same reasoning as use-waiting-on-me
// above: this file tests mode switching, not data fetching). A vi.fn() (not a plain
// arrow) so one test below can override its return value to check the badge wiring.
vi.mock('@/lib/hooks/use-oracle-projects', () => ({
  useOracleProjects: vi.fn(() => ({ data: undefined })),
}));

// Oracle Projects Tab (2026-09-04) — "tabs visible" variant (mirrors CoverBand.test.tsx's
// pattern of mocking a flag ON to keep exercising this file's own click/switch tests,
// while ModeShell.flag.test.tsx exercises the REAL shipped defaults, unmocked). Without
// this, the shipped default (ORACLE_HIDE_PLAN_PROCESS=true) would hide the Plan/Process
// tabs this file's tests click.
vi.mock('@/lib/config/feature-flags', () => ({
  ORACLE_PROJECTS_TAB: true,
  ORACLE_HIDE_PLAN_PROCESS: false,
}));

// Shallow-mock every mode view — this test's job is the SHELL's own logic (default mode,
// tab switching, Return to Work, no auto-switch), not each view's own data-fetching tree
// (covered by their own logic-module tests + the e2e composition spec).
vi.mock('../WorkView', () => ({
  WorkView: ({ onGoToMode }: { onGoToMode: (m: string) => void }) => (
    <div data-testid="mock-work-view">
      <button onClick={() => onGoToMode('process')}>go-to-process-door</button>
    </div>
  ),
}));
vi.mock('../PlanView', () => ({ PlanView: () => <div data-testid="mock-plan-view" /> }));
vi.mock('../ProcessView', () => ({ ProcessView: () => <div data-testid="mock-process-view" /> }));
vi.mock('../projects/ProjectsView', () => ({ ProjectsView: () => <div data-testid="mock-projects-view" /> }));

import { ModeShell } from '../ModeShell';
import { useOracleProjects } from '@/lib/hooks/use-oracle-projects';

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ModeShell machines={[]} liveSessions={[]} legacyAttentionArcIds={new Set()} nowMs={Date.now()} />
    </QueryClientProvider>
  );
}

describe('ModeShell', () => {
  it('defaults to Work mode', () => {
    renderShell();
    expect(screen.getByTestId('mock-work-view')).toBeInTheDocument();
    expect(screen.getByTestId('mode-tab-work')).toHaveAttribute('aria-current', 'page');
  });

  it('Return to Work is hidden while in Work mode', () => {
    renderShell();
    expect(screen.queryByTestId('return-to-work')).not.toBeInTheDocument();
  });

  it('clicking the Plan tab switches to Plan mode and shows Return to Work', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('mode-tab-plan'));
    expect(screen.getByTestId('mock-plan-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-work-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('return-to-work')).toBeInTheDocument();
  });

  it('clicking the Process tab switches to Process mode', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('mode-tab-process'));
    expect(screen.getByTestId('mock-process-view')).toBeInTheDocument();
  });

  it('clicking the Projects tab switches to Projects mode', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('mode-tab-projects'));
    expect(screen.getByTestId('mock-projects-view')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-work-view')).not.toBeInTheDocument();
  });

  it('Return to Work goes back to Work mode', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('mode-tab-plan'));
    fireEvent.click(screen.getByTestId('return-to-work'));
    expect(screen.getByTestId('mock-work-view')).toBeInTheDocument();
  });

  it('a door click (via onGoToMode) switches mode exactly like a tab click', () => {
    renderShell();
    fireEvent.click(screen.getByText('go-to-process-door'));
    expect(screen.getByTestId('mock-process-view')).toBeInTheDocument();
  });

  it('never auto-switches: re-rendering with different props does not change the mode away from what was clicked', () => {
    const { rerender } = renderShell();
    fireEvent.click(screen.getByTestId('mode-tab-plan'));
    expect(screen.getByTestId('mock-plan-view')).toBeInTheDocument();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ModeShell machines={[]} liveSessions={[]} legacyAttentionArcIds={new Set()} nowMs={Date.now() + 999_999} />
      </QueryClientProvider>
    );
    // Still Plan — nothing about the passage of time or new props flips it back to Work.
    expect(screen.getByTestId('mock-plan-view')).toBeInTheDocument();
  });

  it('passes the real stalled_count through to the Projects tab badge', () => {
    vi.mocked(useOracleProjects).mockReturnValueOnce({ data: { stalled_count: 4 } } as ReturnType<
      typeof useOracleProjects
    >);
    renderShell();
    expect(screen.getByTestId('mode-tab-projects-badge')).toBeInTheDocument();
    expect(screen.getByText('4 projects waiting on you')).toBeInTheDocument();
  });

  it('shows no badge when the projects feed reports zero stalled projects', () => {
    vi.mocked(useOracleProjects).mockReturnValueOnce({ data: { stalled_count: 0 } } as ReturnType<
      typeof useOracleProjects
    >);
    renderShell();
    expect(screen.queryByTestId('mode-tab-projects-badge')).not.toBeInTheDocument();
  });
});
