'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { lastMovementSentence, KIND_HEADINGS } from './projects-logic';
import type { OracleProjectCard as OracleProjectCardData, OracleProjectNextStep } from '@/lib/hooks/use-oracle-projects';

interface ProjectCardProps {
  project: OracleProjectCardData;
  onOpen: (projectId: string) => void;
}

// Oracle Projects Tab Phase 4 — the by-project lens's card face. Carries exactly the
// anatomy the spec calls for: client name, project name, next-step sentence (with its
// source hint), owner chip, last-movement sentence, and blocker-count chips. Red left
// edge only when stalled_on_mike. Fixed height so the grid stays even regardless of how
// long any one project's next-step text runs — overflow is clipped, not wrapped
// indefinitely; the drawer is where the full text lives.
export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const isMikeOwner = project.next_step.owner?.id === MIKE_USER_ID;
  const ownerName = project.next_step.owner?.name ?? project.next_step.owner_label ?? 'Unassigned';
  const stamp = nextStepStamp(project.next_step);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="project-card"
      onClick={() => onOpen(project.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(project.id);
        }
      }}
      className="flex h-56 flex-col justify-between rounded-lg border bg-[var(--bg-elevated)] p-4 shadow-soft cursor-pointer transition-colors hover:border-primary/40"
      style={{
        borderColor: 'var(--border)',
        borderLeftColor: project.stalled_on_mike ? 'var(--error)' : 'var(--border)',
        borderLeftWidth: project.stalled_on_mike ? 4 : 1,
      }}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          data-testid="project-card-client"
          className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-sub"
        >
          {project.client.name}
        </div>
        <div data-testid="project-card-name" className="mt-0.5 text-sm font-semibold text-text-main line-clamp-1">
          {project.name}
        </div>

        <div data-testid="project-card-next-step" className="mt-2 text-sm text-text-main line-clamp-2">
          {project.next_step.text}
          {stamp && <span className="ml-1 text-xs text-text-sub">— {stamp}</span>}
        </div>

        <div data-testid="project-card-movement" className="mt-2 text-xs text-text-sub line-clamp-1">
          {lastMovementSentence(project.last_movement, project.days_quiet)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <span
            data-testid="project-card-owner"
            className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium"
            style={
              isMikeOwner
                ? { backgroundColor: 'var(--error-subtle)', color: 'var(--error)', borderColor: 'var(--error-subtle)' }
                : { backgroundColor: 'var(--accent-subtle)', color: 'var(--text-main)', borderColor: 'var(--border)' }
            }
          >
            {ownerName}
          </span>
          {Object.entries(project.counts_by_kind).map(([kind, count]) => (
            <Badge key={kind} variant="default" size="sm" className="shrink-0">
              {KIND_HEADINGS[kind as keyof typeof KIND_HEADINGS] ?? kind} {count}
            </Badge>
          ))}
        </div>

        <Link
          href={project.open_url}
          onClick={(e) => e.stopPropagation()}
          data-testid="project-card-open-link"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open project
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function nextStepStamp(nextStep: OracleProjectNextStep): string | null {
  if (nextStep.source === 'mike') return "Mike's own";
  if (nextStep.source === 'bast') {
    if (!nextStep.at) return 'Bast';
    const time = new Date(nextStep.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `Bast, ${time}`;
  }
  if (nextStep.source === 'graph') return 'graph';
  return null;
}
