'use client';

import { EmptyState } from '@/components/ui/empty-state';

// Oracle Projects Tab — Phase 1 placeholder. This mode ships now (behind
// ORACLE_PROJECTS_TAB, on by default) so the tab itself, the escort-law badge, and the
// flag plumbing can land and be reviewed independently of the real signals API. Phase 2
// wires GET /api/oracle/projects; Phase 4 replaces this file with the real card/kind-lens
// view (ProjectCard, ProjectDrawer, BlockerRow, KindLens, PickToArcDialog, NotesLog,
// EmailSummary) per implementation/plans/oracle-projects-tab.md.
export function ProjectsView() {
  return (
    <EmptyState
      title="Projects"
      description="Phase 2 wires the data."
    />
  );
}
