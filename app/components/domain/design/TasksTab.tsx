'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useOpenDesignSession, useSiteTasks, type SiteTask } from '@/lib/hooks/use-design';

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', review: 'In review', on_hold: 'On hold',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, ' ');

function dueText(d: string | null): string | null {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function TaskRow({ task, currentTaskId, onWork, busy }: { task: SiteTask; currentTaskId: string | null; onWork: (id: string) => void; busy: boolean }) {
  const [open, setOpen] = React.useState(false);
  const due = dueText(task.due_date);
  return (
    <li className="rounded-lg border border-border-warm bg-surface p-3" data-testid="site-task">
      <button type="button" className="flex w-full flex-col gap-1 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-sm font-medium text-text-main">{task.title}</span>
          <Badge variant="default" size="sm">{statusLabel(task.status)}</Badge>
        </span>
        <span className="text-xs text-text-sub">
          {[due ? `Due ${due}` : null, task.assignee_first_name, task.project.name].filter(Boolean).join(' - ')}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2" data-testid="site-task-detail">
          <p className="whitespace-pre-wrap text-sm text-text-main">{task.description ?? 'No description.'}</p>
          {task.id === currentTaskId ? (
            <p className="text-xs text-text-sub">This is the task you are working on.</p>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={() => onWork(task.id)}>Work on this</Button>
          )}
        </div>
      )}
    </li>
  );
}

export function TasksTab({ sessionId, currentTaskId = null }: { sessionId: string; currentTaskId?: string | null }) {
  const router = useRouter();
  const [mine, setMine] = React.useState(true);
  const q = useSiteTasks(sessionId, mine);
  const open = useOpenDesignSession();

  const work = (taskId: string) =>
    open.mutate(taskId, { onSuccess: (r) => router.push(`/design/s/${r.session.id}`) });

  return (
    <div className="flex flex-col gap-3" data-testid="tasks-tab">
      <div role="group" aria-label="Task filter" className="inline-flex self-start rounded-md border border-border-warm bg-surface p-0.5">
        {([[true, 'Assigned to me'], [false, 'All on this site']] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={mine === value}
            onClick={() => setMine(value)}
            className={`min-h-8 rounded-sm px-3 text-xs font-medium ${mine === value ? 'bg-primary text-white' : 'text-text-sub hover:bg-background-light hover:text-text-main'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <p role="alert" className="text-sm text-text-sub">The tasks could not be loaded.</p>
      ) : (q.data?.tasks?.length ?? 0) === 0 ? (
        <p className="p-2 text-sm text-text-sub">{mine ? 'Nothing assigned to you on this site.' : 'No open tasks on this site.'}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Site tasks">
          {(q.data?.tasks ?? []).map((t) => (
            <TaskRow key={t.id} task={t} currentTaskId={currentTaskId} onWork={work} busy={open.isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}
