'use client';

import { AlertTriangle } from 'lucide-react';

export interface WorkerState {
  online: boolean;
  paused: boolean;
}

// Shown only when the design worker cannot take work. `worker` comes from GET /api/design/tasks.
export function WorkerBanner({ worker }: { worker: WorkerState | null | undefined }) {
  if (!worker || (worker.online && !worker.paused)) return null;
  const message = worker.paused
    ? 'The design worker is paused. New work will wait until it is resumed.'
    : 'The design worker is offline. You can open a session, but nothing will run until it is back.';
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-border-warm px-4 py-3 text-sm"
      style={{ backgroundColor: 'var(--warning-subtle)', color: 'var(--warning)' }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
