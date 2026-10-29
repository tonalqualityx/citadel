'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useAdminPublishes, useAdminSessions } from '@/lib/hooks/use-design-admin';
import { StatusChip } from './Workspace';

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function AdminOverview() {
  const sessions = useAdminSessions();
  const publishes = useAdminPublishes();

  if (sessions.isLoading || publishes.isLoading) return <Spinner />;
  const requests = (sessions.data?.sessions ?? []).filter((s) => s.publish_requested_at);

  return (
    <div className="space-y-6">
      <section aria-label="Publish requests" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Publish requests</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-text-sub">None. Requests only appear where designer publish is switched off.</p>
        ) : (
          <ul className="space-y-1" data-testid="publish-requests">
            {requests.map((s) => (
              <li key={s.id} className="text-sm text-text-main">
                {s.designer.name} asked for a publish of {s.site.name}: {s.task.title}{' '}
                <span className="text-xs text-text-sub">{new Date(s.publish_requested_at as string).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Sessions" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Sessions</h2>
        {!sessions.data || sessions.data.sessions.length === 0 ? (
          <p className="text-sm text-text-sub">No design sessions yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-warm bg-surface">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border-warm text-left text-xs text-text-sub">
                  {['Task', 'Site', 'Designer', 'Status', 'Timer', 'Cost'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sessions.data.sessions.map((s) => (
                  <tr key={s.id} className="border-b border-border-warm last:border-0">
                    <td className="px-3 py-2 text-text-main">{s.task.title}</td>
                    <td className="px-3 py-2 text-text-sub">{s.site.name}</td>
                    <td className="px-3 py-2 text-text-sub">{s.designer.name}</td>
                    <td className="px-3 py-2"><StatusChip status={s.status} /></td>
                    <td className="px-3 py-2 text-text-sub" data-testid="session-timer">{s.timer.running ? `Running ${formatElapsed(s.timer.elapsed_s)}` : s.timer.elapsed_s > 0 ? `Stopped at ${formatElapsed(s.timer.elapsed_s)}` : 'Not running'}</td>
                    <td className="px-3 py-2 text-text-sub">${s.cost_usd.toFixed(2)} of ${s.budget_usd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Publish history" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Publish history</h2>
        {!publishes.data || publishes.data.publishes.length === 0 ? (
          <p className="text-sm text-text-sub">Nothing published yet.</p>
        ) : (
          <ul className="divide-y divide-border-warm rounded-lg border border-border-warm bg-surface">
            {publishes.data.publishes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Link href={`/design/publishes/${p.id}`} className="text-primary underline underline-offset-2">
                  {p.kind === 'rollback' ? 'Rollback' : 'Publish'} on {p.site.name}
                </Link>
                <Badge variant={p.main_role === 'production' ? 'error' : 'default'} size="sm">{p.main_role === 'production' ? 'Live site' : 'Client preview'}</Badge>
                <span className="text-text-sub">{p.status.replace(/_/g, ' ')} by {p.actor.name}</span>
                <span className="ml-auto text-xs text-text-sub">{new Date(p.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
