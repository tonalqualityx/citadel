import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Oracle Projects Tab (2026-09-04) — the flag DEFAULT-STATE variant (mirrors
// CoverBand.flag.test.tsx): the real, unmocked feature-flags import, proving the shipped
// defaults actually hide Plan/Process and show Projects. ModeShell.test.tsx mocks the
// flag to keep exercising the plan/process click paths — this file proves what a real
// user sees today.
vi.mock('@/lib/hooks/use-waiting-on-me', () => ({
  useWaitingOnMe: () => ({ data: undefined }),
}));

vi.mock('../WorkView', () => ({
  WorkView: () => <div data-testid="mock-work-view" />,
}));
vi.mock('../PlanView', () => ({ PlanView: () => <div data-testid="mock-plan-view" /> }));
vi.mock('../ProcessView', () => ({ ProcessView: () => <div data-testid="mock-process-view" /> }));
vi.mock('../projects/ProjectsView', () => ({ ProjectsView: () => <div data-testid="mock-projects-view" /> }));

import { ModeShell } from '../ModeShell';
import { ORACLE_HIDE_PLAN_PROCESS, ORACLE_PROJECTS_TAB } from '@/lib/config/feature-flags';

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ModeShell machines={[]} liveSessions={[]} legacyAttentionArcIds={new Set()} nowMs={Date.now()} />
    </QueryClientProvider>
  );
}

describe('ModeShell — default flag state (Oracle Projects Tab, 2026-09-04)', () => {
  it('the shipped defaults hide Plan/Process and enable Projects', () => {
    expect(ORACLE_HIDE_PLAN_PROCESS).toBe(true);
    expect(ORACLE_PROJECTS_TAB).toBe(true);
  });

  it('does not render the Plan or Process tabs by default', () => {
    renderShell();
    expect(screen.queryByTestId('mode-tab-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mode-tab-process')).not.toBeInTheDocument();
  });

  it('renders the Projects tab by default', () => {
    renderShell();
    expect(screen.getByTestId('mode-tab-projects')).toBeInTheDocument();
  });

  it('still defaults to Work mode', () => {
    renderShell();
    expect(screen.getByTestId('mock-work-view')).toBeInTheDocument();
  });
});
