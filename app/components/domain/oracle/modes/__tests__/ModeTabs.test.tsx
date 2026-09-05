import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Oracle Projects Tab (2026-09-04) — pin the flags so the Projects tab is guaranteed to
// render regardless of the real env, matching the shipped defaults.
vi.mock('@/lib/config/feature-flags', () => ({
  ORACLE_PROJECTS_TAB: true,
  ORACLE_HIDE_PLAN_PROCESS: true,
}));

// Spec polish (2026-09-04) — ModeTabs now calls useTerminology for the Projects tab's
// label/tooltip. Mocked here (same pattern as MobileNav.test.tsx) so this suite never
// needs a real QueryClientProvider just to render a nav bar.
vi.mock('@/lib/hooks/use-terminology', () => ({
  useTerminology: () => ({
    t: (key: string) => {
      const terms: Record<string, string> = { projects: 'Projects', project: 'Project' };
      return terms[key] ?? key;
    },
  }),
}));

import { ModeTabs } from '../ModeTabs';

describe('ModeTabs — Projects badge (Mike, 2026-09-04)', () => {
  it('renders no badge when projectsBadgeCount is 0 (default)', () => {
    render(<ModeTabs mode="work" onChange={() => {}} />);
    expect(screen.queryByTestId('mode-tab-projects-badge')).not.toBeInTheDocument();
  });

  it('renders no badge when projectsBadgeCount is explicitly 0', () => {
    render(<ModeTabs mode="work" onChange={() => {}} projectsBadgeCount={0} />);
    expect(screen.queryByTestId('mode-tab-projects-badge')).not.toBeInTheDocument();
  });

  it('renders the badge when projectsBadgeCount > 0, with a visually-hidden text node for assistive tech', () => {
    render(<ModeTabs mode="work" onChange={() => {}} projectsBadgeCount={3} />);
    expect(screen.getByTestId('mode-tab-projects-badge')).toBeInTheDocument();
    // The dot itself is aria-hidden (decorative); the announced text lives in a
    // separate visually-hidden node so screen readers pick it up reliably.
    expect(screen.getByTestId('mode-tab-projects-badge')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('3 projects waiting on you')).toBeInTheDocument();
    expect(screen.getByText('3 projects waiting on you')).toHaveClass('sr-only');
  });

  it('renders the count as visible text inside the dot itself, not only in the sr-only node (Mike: "a red dot indicator with the number")', () => {
    render(<ModeTabs mode="work" onChange={() => {}} projectsBadgeCount={7} />);
    const badge = screen.getByTestId('mode-tab-projects-badge');
    expect(badge).toHaveTextContent('7');
  });

  it('the Projects tab label comes from useTerminology, matching the Sidebar\'s own t(\'projects\')', () => {
    render(<ModeTabs mode="work" onChange={() => {}} />);
    expect(screen.getByTestId('mode-tab-projects')).toHaveTextContent('Projects');
  });

  it('the badge is never rendered on the Work tab, even with a count', () => {
    render(<ModeTabs mode="work" onChange={() => {}} projectsBadgeCount={5} />);
    // Only one badge total — on Projects, never duplicated onto any other tab.
    expect(screen.getAllByTestId('mode-tab-projects-badge')).toHaveLength(1);
  });
});
