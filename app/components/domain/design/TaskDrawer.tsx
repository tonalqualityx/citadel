'use client';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { DesignDrawer, DrawerTask } from '@/lib/hooks/use-design';

const CHIP_LABELS: Record<string, string> = {
  active: 'Active',
  awaiting_you: 'Waiting on you',
  paused_budget: 'Paused: budget',
  stopped: 'Stopped',
  publishing: 'Publishing',
  publish_requested: 'Publish requested',
  closed: 'Closed',
};

function SessionChip({ task }: { task: DrawerTask }) {
  const s = task.session;
  if (!s) return <span className="text-xs text-text-sub">No session</span>;
  if (!s.mine) return <Badge variant="default" size="sm">Taken</Badge>;
  return (
    <Badge variant={s.chip === 'awaiting_you' ? 'warning' : 'info'} size="sm">
      Mine: {CHIP_LABELS[s.chip] ?? s.chip}
    </Badge>
  );
}

export interface TaskDrawerProps {
  drawer: DesignDrawer;
  /** Plural term for the empty state, e.g. "Quests". */
  taskTerm: string;
  onOpenTask: (taskId: string) => void;
  pendingTaskId?: string | null;
}

export function TaskDrawer({ drawer, taskTerm, onOpenTask, pendingTaskId }: TaskDrawerProps) {
  if (drawer.projects.length === 0) {
    return (
      <EmptyState
        title={`No open ${taskTerm.toLowerCase()} yet`}
        description={`When a ${taskTerm.toLowerCase().replace(/s$/, '')} is assigned on a site you design, it shows up here.`}
      />
    );
  }
  return (
    <div className="space-y-6">
      {drawer.projects.map((project) => (
        <section key={`${project.id}:${project.site.id}`} aria-label={project.name} className="rounded-lg border border-border-warm bg-surface">
          <header className="flex items-center justify-between gap-2 border-b border-border-warm px-4 py-3">
            <h2 className="text-base font-semibold text-text-main">{project.name}</h2>
            <span className="text-xs text-text-sub">{project.site.name}</span>
          </header>
          {!project.site.available && (
            <p className="px-4 pt-3 text-sm text-text-sub">Not available yet: this site is not set up for design on the box.</p>
          )}
          <div className="space-y-4 p-4">
            {project.phases.map((phase) => (
              <div key={phase.name ?? '__none'}>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-text-sub">{phase.name ?? 'No phase'}</h3>
                <ul className="divide-y divide-border-warm">
                  {phase.tasks.map((task) => {
                    const taken = !!task.session && !task.session.mine;
                    const disabled = !project.site.available || taken || pendingTaskId === task.id;
                    return (
                      <li key={task.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 truncate text-sm text-text-main">{task.title}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <SessionChip task={task} />
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onOpenTask(task.id)}
                            className="min-h-[44px] rounded-md border border-border-warm px-3 text-sm text-text-main hover:bg-background-light disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1"
                          >
                            {!project.site.available ? 'Not available yet' : task.session?.mine ? 'Resume' : 'Start'}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
