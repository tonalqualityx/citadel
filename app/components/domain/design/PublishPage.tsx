'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/hooks/use-auth';
import { usePublishPage, type PublishChange, type PublishGate, type PublishShown } from '@/lib/hooks/use-design-publish';
import { BeforeAfter, pairAssetsByWidth } from './BeforeAfter';
import { DiffFacts, GateList, isProductionTone } from './PublishConfirmDialog';
import { RollbackButton } from './RollbackButton';

const STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  awaiting_confirmation: { label: 'Awaiting confirmation', variant: 'info' },
  expired: { label: 'Expired', variant: 'default' },
  queued: { label: 'Queued', variant: 'info' },
  running: { label: 'Publishing', variant: 'info' },
  published: { label: 'Published', variant: 'success' },
  blocked_gates: { label: 'Blocked: a gate was red', variant: 'error' },
  blocked_policy: { label: 'Blocked', variant: 'error' },
  conflict: { label: 'Conflict with main', variant: 'warning' },
  failed: { label: 'Failed', variant: 'error' },
  rolled_back: { label: 'Rolled back', variant: 'default' },
};

function gatesFrom(raw: unknown, shown: Partial<PublishShown> | null): { status: string; entries: PublishGate[] } {
  if (Array.isArray(raw)) {
    const entries = raw
      .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object' && typeof (g as Record<string, unknown>).name === 'string')
      .map((g) => ({ name: g.name as string, ok: g.ok === true, ...(typeof g.summary === 'string' ? { summary: g.summary } : {}) }));
    if (entries.length) return { status: entries.every((g) => g.ok) ? 'green' : 'red', entries };
  }
  return shown?.gates ?? { status: 'unknown', entries: [] };
}

function ChangeBlock({ sessionId, change }: { sessionId: string; change: PublishChange }) {
  const pairs = pairAssetsByWidth(change, []);
  return (
    <li className="space-y-2 rounded-lg border border-border-warm bg-surface p-3" data-testid="publish-change">
      <p className="text-sm font-medium text-text-main">{change.summary}</p>
      {change.pages.length > 0 && <p className="text-xs text-text-sub">Pages: {change.pages.join(', ')}</p>}
      {pairs.length > 0 && <BeforeAfter sessionId={sessionId} pairs={pairs} />}
    </li>
  );
}

export function PublishPage({ publishId }: { publishId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { data, isLoading, error } = usePublishPage(publishId);

  if (isLoading) return <Spinner />;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-sub">This publish could not be found.</p>
        <Link href="/design" className="text-sm text-primary underline">Back to your quests</Link>
      </div>
    );
  }

  const { publish, session, changes } = data;
  const shown = publish.confirmation_shown;
  const production = isProductionTone({ main_role: (shown?.main_role ?? publish.main_role) as 'client_preview' | 'production' });
  const st = STATUS[publish.status] ?? { label: publish.status.replace(/_/g, ' '), variant: 'default' as const };
  const targetWords = shown?.target_words ?? (production ? 'the LIVE production site' : 'the client preview');
  const active = publish.status === 'queued' || publish.status === 'running';
  const rolledBackFrom = publish.kind === 'rollback';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={`/design/s/${session.id}`} className="text-sm text-text-sub hover:text-text-main">Back to the session</Link>
        <h1 className="text-lg font-semibold text-text-main">{rolledBackFrom ? 'Rollback' : 'Publish'}: {session.task.title}</h1>
        <Badge variant={st.variant} data-testid="publish-status">{st.label}</Badge>
        {active && <span className="inline-flex items-center gap-2 text-xs text-text-sub"><Spinner size="sm" /> Updating</span>}
        <div className="ml-auto">
          <RollbackButton
            publishId={publish.id}
            canRollback={data.can_rollback}
            isAdmin={user?.role === 'admin'}
            isPublisher={!!user && user.id === publish.actor_id}
            targetWords={targetWords}
            onRolledBack={(id) => router.push(`/design/publishes/${id}`)}
          />
        </div>
      </header>

      <section aria-label="What was confirmed" className={`rounded-lg border p-4 ${production ? 'border-error bg-error/10' : 'border-border-warm bg-surface'}`} data-testid="publish-confirmed" data-tone={production ? 'production' : 'client_preview'}>
        <p className={`text-sm ${production ? 'font-semibold text-error' : 'text-text-main'}`}>
          {rolledBackFrom ? 'Rolled back' : 'Published'} to {targetWords}
          {shown?.live_url ? <>: <a href={shown.live_url} target="_blank" rel="noopener noreferrer" className="break-all underline">{shown.live_url}</a></> : null}
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-text-sub">Main branch</dt><dd className="font-mono text-text-main">{shown?.main_branch ?? 'unknown'}</dd>
          <dt className="text-text-sub">Version</dt><dd className="font-mono text-text-main">{(publish.head_sha ?? '').slice(0, 7) || 'unknown'}</dd>
          <dt className="text-text-sub">By</dt><dd className="text-text-main">{session.designer.name} ({publish.actor_role})</dd>
          {publish.confirmed_at && (<><dt className="text-text-sub">Confirmed</dt><dd className="text-text-main">{new Date(publish.confirmed_at).toLocaleString()}</dd></>)}
        </dl>
        {publish.error && <p role="alert" className="mt-2 text-sm text-error">{publish.error}</p>}
        {data.rollback_reason && publish.status === 'published' && !data.can_rollback && (
          <p className="mt-2 text-xs text-text-sub">{data.rollback_reason === 'not_latest' ? 'A later publish exists, so this one can no longer be rolled back here.' : null}</p>
        )}
      </section>

      {shown?.diff_summary && shown.files_changed && shown.pages_affected && shown.cost_usd !== undefined && (
        <section aria-label="Diff summary" className="rounded-lg border border-border-warm bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-text-main">What changed</h2>
          <DiffFacts shown={{ diff_summary: shown.diff_summary, files_changed: shown.files_changed, pages_affected: shown.pages_affected, cost_usd: shown.cost_usd }} />
        </section>
      )}

      <section aria-label="Gates" className="rounded-lg border border-border-warm bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-text-main">Gates</h2>
        <GateList {...gatesFrom(publish.gates, shown)} />
      </section>

      {publish.cost_usd !== null && <p className="text-sm text-text-sub">Publish cost: ${publish.cost_usd.toFixed(2)}</p>}

      <section aria-label="Changeset" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Changeset</h2>
        {changes.length === 0 ? (
          <p className="text-sm text-text-sub">No changes are recorded for this publish.</p>
        ) : (
          <ul className="space-y-3">{changes.map((c) => <ChangeBlock key={c.id} sessionId={session.id} change={c} />)}</ul>
        )}
      </section>
    </div>
  );
}
