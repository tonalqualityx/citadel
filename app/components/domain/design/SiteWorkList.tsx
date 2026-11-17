'use client';

import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { stageStepLabel } from '@/components/domain/design/track/StageStrip';
import { useOpenDesignSession, type DesignDrawer, type DrawerProject } from '@/lib/hooks/use-design';
import { getTerminology } from '@/lib/hooks/use-terminology';

// Static terms, not the terminology hook: it reads /users/me/preferences, which is 403 for a designer.
const terms = getTerminology('awesome');

const CHIP_LABELS: Record<string, string> = {
  active: 'Active',
  awaiting_you: 'Waiting on you',
  stopped: 'Stopped',
  publishing: 'Publishing',
  publish_requested: 'Publish requested',
  closed: 'Closed',
};

function EntryChip({ project }: { project: DrawerProject }) {
  const { entry } = project;
  if (!entry.chip) return null;
  const label = CHIP_LABELS[entry.chip] ?? entry.chip;
  if (entry.action === 'none') {
    return <Badge variant="default" size="sm">{`Taken: ${label}`}</Badge>;
  }
  if (entry.action === 'join' || entry.action === 'view') {
    return <Badge variant="default" size="sm">{`In use: ${label}`}</Badge>;
  }
  return (
    <Badge variant={entry.chip === 'awaiting_you' ? 'warning' : 'info'} size="sm">
      {`Mine: ${label}`}
    </Badge>
  );
}

function openText(n: number): string {
  const noun = (n === 1 ? terms.t('task') : terms.t('tasks')).toLowerCase();
  return `${n} open ${noun}`;
}

export interface SiteWorkListProps {
  drawer: DesignDrawer;
}

export function SiteWorkList({ drawer }: SiteWorkListProps) {
  const router = useRouter();
  const open = useOpenDesignSession();

  async function onOpen(taskId: string) {
    try {
      const { session } = await open.mutateAsync(taskId);
      router.push(`/design/s/${session.id}`);
    } catch {
      // toast shown by the hook
    }
  }

  if (drawer.projects.length === 0) {
    return (
      <EmptyState
        title="No sites with open work yet"
        description={`Sites with open ${terms.t('tasks').toLowerCase()} show up here.`}
      />
    );
  }

  return (
    <ul className="space-y-3">
      {drawer.projects.map((project) => {
        const { entry } = project;
        const key = `${project.id}:${project.site.id}`;
        const labelId = `site-row-${key}`;
        const stage = project.track_stage ? stageStepLabel(project.track_stage) : null;
        const pending = open.isPending && open.variables === entry.task_id;
        return (
          <li key={key} className="list-none">
            <section
              aria-labelledby={labelId}
              data-testid="site-row"
              data-project-id={project.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-warm bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <h3 id={labelId} className="truncate text-base font-semibold text-text-main">{project.site.name}</h3>
                <p className="truncate text-sm text-text-sub">{project.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-sub">
                  <span>{openText(project.open_tasks)}</span>
                  {stage && <span>{`Stage: ${stage}`}</span>}
                  <EntryChip project={project} />
                </p>
              </div>
              <div className="shrink-0">
                {(entry.action === 'resume' || entry.action === 'join' || entry.action === 'view') && entry.session_id ? (
                  <Button size="sm" onClick={() => router.push(`/design/s/${entry.session_id}`)}>
                    {entry.action === 'resume' ? 'Resume' : entry.action === 'join' ? 'Join' : 'View'}
                  </Button>
                ) : entry.action === 'start' && entry.task_id ? (
                  <Button size="sm" disabled={open.isPending} onClick={() => onOpen(entry.task_id!)}>
                    {pending ? 'Opening' : 'Open'}
                  </Button>
                ) : entry.reason === 'unavailable' ? (
                  <Button size="sm" variant="secondary" disabled>Not available yet</Button>
                ) : entry.reason === 'taken' ? (
                  <Button size="sm" variant="secondary" disabled>In use</Button>
                ) : entry.reason === 'not_ready' ? (
                  <Button size="sm" variant="secondary" disabled>Not ready yet</Button>
                ) : (
                  <span className="text-sm text-text-sub">No session yet</span>
                )}
              </div>
            </section>
          </li>
        );
      })}
    </ul>
  );
}
