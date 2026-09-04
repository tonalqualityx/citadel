import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectCard } from '../ProjectCard';
import type { OracleProjectCard as OracleProjectCardData } from '@/lib/hooks/use-oracle-projects';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

function makeProject(overrides: Partial<OracleProjectCardData> = {}): OracleProjectCardData {
  return {
    id: 'proj-1',
    name: 'Website Redesign',
    client: { id: 'client-1', name: 'Acme' },
    status: 'in_progress',
    next_step: {
      text: 'Mike needs to approve the homepage copy.',
      owner: { id: MIKE_USER_ID, name: 'Mike' },
      owner_label: null,
      source: 'bast',
      at: '2026-09-04T07:00:00Z',
    },
    last_movement: { at: '2026-09-03T00:00:00Z', who: 'Mike', what: 'commented' },
    days_quiet: 1,
    stale: false,
    stalled_on_mike: true,
    blockers: [],
    counts_by_kind: { decision: 1, review: 2 },
    refresh_requested_at: null,
    open_url: '/projects/proj-1',
    email_summary: null,
    email_summary_at: null,
    linked_emails: [],
    ...overrides,
  };
}

describe('ProjectCard', () => {
  it('renders all five face elements: client, project name, next step, owner chip, last movement', () => {
    render(<ProjectCard project={makeProject()} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-card-client')).toHaveTextContent('Acme');
    expect(screen.getByTestId('project-card-name')).toHaveTextContent('Website Redesign');
    expect(screen.getByTestId('project-card-next-step')).toHaveTextContent('Mike needs to approve the homepage copy.');
    expect(screen.getByTestId('project-card-owner')).toHaveTextContent('Mike');
    expect(screen.getByTestId('project-card-movement')).toHaveTextContent('Mike commented yesterday.');
  });

  // Card anatomy fix — the next-step source stamp (e.g. "Bast, 7:00 AM") used to render
  // dash-joined onto the card face, making a 7th element out of a spec'd six-element
  // card. It now lives only in the drawer's next-step section.
  it('never renders the next-step source stamp on the card face', () => {
    render(<ProjectCard project={makeProject()} onOpen={vi.fn()} />);
    expect(screen.queryByText(/Bast, /)).not.toBeInTheDocument();
    expect(screen.getByTestId('project-card-next-step')).not.toHaveTextContent('Bast');
  });

  it('shows blocker-count chips by kind', () => {
    render(<ProjectCard project={makeProject()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Decisions 1/)).toBeInTheDocument();
    expect(screen.getByText(/Reviews 2/)).toBeInTheDocument();
  });

  it('has a red left edge only when stalled_on_mike is true', () => {
    const { rerender } = render(<ProjectCard project={makeProject({ stalled_on_mike: true })} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-card')).toHaveStyle({ borderLeftColor: 'var(--error)' });

    rerender(<ProjectCard project={makeProject({ stalled_on_mike: false })} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-card')).not.toHaveStyle({ borderLeftColor: 'var(--error)' });
  });

  it('the owner chip is red-tinted only when the owner is Mike', () => {
    const { rerender } = render(
      <ProjectCard
        project={makeProject({ next_step: { text: 'x', owner: { id: MIKE_USER_ID, name: 'Mike' }, owner_label: null, source: 'mike', at: null } })}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByTestId('project-card-owner')).toHaveStyle({ color: 'var(--error)' });

    rerender(
      <ProjectCard
        project={makeProject({ next_step: { text: 'x', owner: { id: 'other-user', name: 'Andy' }, owner_label: null, source: 'mike', at: null } })}
        onOpen={vi.fn()}
      />
    );
    expect(screen.getByTestId('project-card-owner')).not.toHaveStyle({ color: 'var(--error)' });
  });

  it('"Open project" links to the project\'s open_url and does not trigger onOpen', () => {
    const onOpen = vi.fn();
    render(<ProjectCard project={makeProject({ open_url: '/projects/proj-1' })} onOpen={onOpen} />);
    const link = screen.getByTestId('project-card-open-link');
    expect(link).toHaveAttribute('href', '/projects/proj-1');
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('clicking the card body calls onOpen with the project id', () => {
    const onOpen = vi.fn();
    render(<ProjectCard project={makeProject({ id: 'proj-42' })} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('project-card'));
    expect(onOpen).toHaveBeenCalledWith('proj-42');
  });
});
