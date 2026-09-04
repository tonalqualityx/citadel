'use client';

import * as React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useOracleProjects } from '@/lib/hooks/use-oracle-projects';
import { useRefreshAllNextSteps } from '@/lib/hooks/use-next-step';
import { sortProjectCards, groupByKind } from './projects-logic';
import { ProjectCard } from './ProjectCard';
import { KindLens } from './KindLens';
import { ProjectDrawer } from './ProjectDrawer';

type Lens = 'project' | 'kind';

const LENS_STORAGE_KEY = 'oracle.projects.lens';

function readStoredLens(): Lens {
  try {
    const stored = window.localStorage.getItem(LENS_STORAGE_KEY);
    if (stored === 'project' || stored === 'kind') return stored;
  } catch {
    // localStorage unavailable (private mode, disabled, SSR) — default lens stays.
  }
  return 'project';
}

function storeLens(lens: Lens) {
  try {
    window.localStorage.setItem(LENS_STORAGE_KEY, lens);
  } catch {
    // Best-effort only — a failed write just means the choice doesn't persist.
  }
}

// Oracle Projects Tab Phase 4 — the tab. Lens toggle (By project | By kind, default By
// project, persisted in localStorage), Refresh all, a stalled summary line, and the
// drawer host shared by both lenses.
export function ProjectsView() {
  const [lens, setLens] = React.useState<Lens>('project');
  const [openProjectId, setOpenProjectId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLens(readStoredLens());
  }, []);

  const { data, isLoading, isError, refetch } = useOracleProjects(lens === 'kind' ? 'kind' : undefined);
  const refreshAll = useRefreshAllNextSteps();

  function changeLens(next: Lens) {
    setLens(next);
    storeLens(next);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="projects-loading">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load projects"
        description="Something went wrong fetching the Projects tab."
        action={
          <Button size="sm" variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const projects = data?.projects ?? [];

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects in progress"
        description="Contracted projects show up here once they move to in progress."
      />
    );
  }

  const sorted = sortProjectCards(projects);
  const stalled = data?.stalled_count ?? 0;
  const openProject = projects.find((p) => p.id === openProjectId) ?? null;
  const kindGroups = lens === 'kind' ? groupByKind(data?.by_kind ?? {}) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center rounded-lg border p-1"
          style={{ borderColor: 'var(--border)' }}
          role="group"
          aria-label="Projects lens"
        >
          <button
            type="button"
            data-testid="lens-toggle-project"
            aria-pressed={lens === 'project'}
            onClick={() => changeLens('project')}
            className="rounded-md px-3 py-1 text-sm font-medium transition-colors"
            style={
              lens === 'project'
                ? { backgroundColor: 'var(--accent-subtle)', color: 'var(--text-main)' }
                : { color: 'var(--text-sub)' }
            }
          >
            By project
          </button>
          <button
            type="button"
            data-testid="lens-toggle-kind"
            aria-pressed={lens === 'kind'}
            onClick={() => changeLens('kind')}
            className="rounded-md px-3 py-1 text-sm font-medium transition-colors"
            style={
              lens === 'kind'
                ? { backgroundColor: 'var(--accent-subtle)', color: 'var(--text-main)' }
                : { color: 'var(--text-sub)' }
            }
          >
            By kind
          </button>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => refreshAll.mutate()}
          disabled={refreshAll.isPending}
        >
          Refresh all
        </Button>
      </div>

      <div data-testid="stalled-summary" className="text-sm text-text-sub">
        {stalled > 0
          ? `${stalled} project${stalled === 1 ? '' : 's'} stalled on you`
          : 'Nothing stalled on you right now'}
      </div>

      {lens === 'project' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="projects-grid">
          {sorted.map((project) => (
            <ProjectCard key={project.id} project={project} onOpen={setOpenProjectId} />
          ))}
        </div>
      ) : (
        <KindLens groups={kindGroups} onOpenProject={setOpenProjectId} />
      )}

      <ProjectDrawer
        project={openProject}
        open={!!openProject}
        onOpenChange={(next) => {
          if (!next) setOpenProjectId(null);
        }}
      />
    </div>
  );
}
