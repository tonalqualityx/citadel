'use client';

import * as React from 'react';
import { Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDueSoonTasks, useCreateTodayPick } from '@/lib/hooks/use-today';

// Clarity Phase 4a — the due-soon row at the foot of Today: tasks due within 24h that
// haven't been consciously picked for today yet. Closes the "born at night, invisible
// until morning" gap. One-tap "add to Today" respects the WIP cap — a 409 surfaces
// inline with the warning tint, not just a background toast, so the cap reads as an
// explicit choice-point rather than a silent failure.
export function DueSoonRow() {
  const { data, isLoading } = useDueSoonTasks();
  const createPick = useCreateTodayPick();
  const [capMessage, setCapMessage] = React.useState<string | null>(null);

  const tasks = data?.tasks ?? [];

  if (isLoading || tasks.length === 0) return null;

  async function handleAddToToday(taskId: string) {
    setCapMessage(null);
    try {
      await createPick.mutateAsync({ item_type: 'task', task_id: taskId });
    } catch (error) {
      setCapMessage(error instanceof Error ? error.message : 'Could not add to Today.');
    }
  }

  return (
    <section className="flex flex-col gap-1.5 border-t border-border-warm pt-2" data-testid="due-soon-row">
      <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold text-text-sub">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        Due soon · {tasks.length}
      </h3>

      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm"
            data-testid="due-soon-item"
          >
            <span className="min-w-0 truncate text-text-main">{task.title}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAddToToday(task.id)}
              disabled={createPick.isPending}
              aria-label={`Add "${task.title}" to Today`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add to Today
            </Button>
          </li>
        ))}
      </ul>

      {capMessage && (
        <p
          className="rounded-md px-2 py-1 text-xs font-medium"
          style={{ backgroundColor: 'var(--warning-subtle)', color: 'var(--warning)' }}
          role="alert"
          data-testid="due-soon-cap-message"
        >
          {capMessage}
        </p>
      )}
    </section>
  );
}
