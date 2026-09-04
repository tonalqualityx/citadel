import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Oracle Projects Tab (2026-09-04) — pin the flags so the Projects tab is guaranteed to
// render regardless of the real env, matching the shipped defaults.
vi.mock('@/lib/config/feature-flags', () => ({
  ORACLE_PROJECTS_TAB: true,
  ORACLE_HIDE_PLAN_PROCESS: true,
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

  it('renders the badge when projectsBadgeCount > 0', () => {
    render(<ModeTabs mode="work" onChange={() => {}} projectsBadgeCount={3} />);
    expect(screen.getByTestId('mode-tab-projects-badge')).toBeInTheDocument();
    expect(screen.getByTestId('mode-tab-projects-badge')).toHaveAttribute('aria-label', '3 stalled on Mike');
  });

  it('the badge is never rendered on the Work tab, even with a count', () => {
    render(<ModeTabs mode="work" onChange={() => {}} projectsBadgeCount={5} />);
    // Only one badge total — on Projects, never duplicated onto any other tab.
    expect(screen.getAllByTestId('mode-tab-projects-badge')).toHaveLength(1);
  });
});
